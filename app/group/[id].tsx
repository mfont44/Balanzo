import { ConfirmModal } from '@/components/ConfirmModal';
import { useThemeColors } from '@/hooks';
import type { ExpenseWithPayer, MemberBalance, Settlement } from '@/services/expenses';
import {
    createSettlementExpense,
    deleteExpense,
    fetchExpensesForGroup,
    fetchGroup,
    fetchGroupBalances,
    getExpenseWithSplits,
    liquidateOrphanExpenses,
    updateExpense,
} from '@/services/expenses';
import { addMemberToGroup, leaveGroup } from '@/services/groups';
import type { GroupMemberWithUser } from '@/services/groupService';
import { fetchGroupMembers, getMemberDisplayName } from '@/services/groupService';
import { supabase } from '@/services/supabase';
import { getDisplayName, useAuthStore } from '@/store';
import { ACCENT } from '@/theme/colors';
import type { Group } from '@/types/database';
import { DISPLAY_SETTLED_THRESHOLD, isSettled, roundMoney } from '@/utils/calculations';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Banknote, Check, ChevronRight, MoreVertical, Plus, ScanLine, Settings } from 'lucide-react-native';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    RefreshControl,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Never show null or empty: full_name else User-{first 5 of user_id}. */
function getDisplayNameForMember(member: GroupMemberWithUser): string {
  return getMemberDisplayName(member);
}

export default function GroupDetailScreen() {
  const colors = useThemeColors();
  const { id, fromLink } = useLocalSearchParams<{ id: string; fromLink?: string }>();
  const router = useRouter();
  const { user, profile, loadProfile } = useAuthStore();
  const groupId = id ?? '';
  const autoJoinFromLinkDone = useRef(false);

  useEffect(() => {
    if (user?.id && !profile) loadProfile(user.id);
  }, [user?.id, profile, loadProfile]);

  const currentUserDisplayName = getDisplayName(profile, user?.email);

  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<ExpenseWithPayer[]>([]);
  const [members, setMembers] = useState<GroupMemberWithUser[]>([]);
  const [balances, setBalances] = useState<MemberBalance[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [quadrarModalVisible, setQuadrarModalVisible] = useState(false);
  const setSettingsVisibleRef = useRef(setSettingsVisible);
  const setShareModalVisibleRef = useRef(setShareModalVisible);
  const activeSettlements = settlements.filter((s) => roundMoney(s.amount) >= DISPLAY_SETTLED_THRESHOLD);
  const realExpenses = expenses.filter((e) => !e.is_settlement);
  const orphanExpenses = realExpenses.filter((e) => (e as { paid_by?: string | null }).paid_by == null);
  const [isLiquidating, setIsLiquidating] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [expenseMenuExpenseId, setExpenseMenuExpenseId] = useState<string | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ description: string; amount: string; paidBy: string; date: string; memberUserIds: string[] } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  setSettingsVisibleRef.current = setSettingsVisible;
  setShareModalVisibleRef.current = setShareModalVisible;
  const navigation = useNavigation();

  const inviteCode = (group?.invite_code?.trim() ?? '').toUpperCase() || '—';

  useEffect(() => {
    if (!editingExpenseId) {
      setEditForm(null);
      return;
    }
    let cancelled = false;
    getExpenseWithSplits(editingExpenseId).then((data) => {
      if (cancelled || !data) return;
      const { expense, splits } = data;
      const dateStr = expense.date ? (expense.date as string).slice(0, 10) : '';
      setEditForm({
        description: expense.description ?? '',
        amount: String(expense.amount ?? ''),
        paidBy: expense.paid_by ?? '',
        date: dateStr,
        memberUserIds: splits.map((s) => s.user_id),
      });
    });
    return () => { cancelled = true; };
  }, [editingExpenseId]);

  const showAlert = (title: string, message: string) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertVisible(true);
  };

  const handleCopyCode = async () => {
    const code = group?.invite_code?.trim().toUpperCase();
    if (code) {
      await Clipboard.setStringAsync(code);
      showAlert('Copiat', 'Codi copiat al porta-retalls.');
    }
  };

  const handleShareViaApp = async () => {
    const code = (group?.invite_code?.trim() ?? '').toUpperCase() || '';
    const shareMessage = `Uneix-te al meu grup de Tally! Codi: ${code}`;
    try {
      if (Platform.OS === 'web') {
        await Clipboard.setStringAsync(shareMessage);
        showAlert('Copiat', 'Missatge copiat al porta-retalls.');
        return;
      }
      const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(shareMessage)}`;
      try {
        await Linking.openURL(whatsappUrl);
      } catch {
        await Share.share({
          message: shareMessage,
          title: 'Invitar a Tally.app',
        });
      }
    } catch (e) {
      if (e instanceof Error && e.message !== 'User did not share') {
        showAlert('Error', e.message || 'No s\'ha pogut obrir WhatsApp. Comprova que el tens instal·lat.');
      }
    }
  };

  const handleMarkAsPaid = async (fromUserId: string, toUserId: string, amount: number) => {
    if (!groupId) return;
    const key = `${fromUserId}-${toUserId}`;
    setSettlingId(key);
    try {
      await createSettlementExpense({ groupId, fromUserId, toUserId, amount });
      load();
    } catch (e) {
      showAlert('Error', e instanceof Error ? e.message : 'No s\'ha pogut marcar com a pagat.');
    } finally {
      setSettlingId(null);
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: group ? group.name : 'Grup',
      headerShown: true,
      headerStyle: { backgroundColor: colors.background },
      headerTintColor: colors.text,
      headerShadowVisible: false,
      headerTitleStyle: { fontSize: 17, fontWeight: '600', color: colors.text },
      headerRight: () => (
        <View style={styles.headerRightRow} pointerEvents="box-none">
          <TouchableOpacity
            onPress={() => setShareModalVisible(true)}
            style={[styles.headerRightBtn, { backgroundColor: colors.cardBackground }]}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            activeOpacity={0.7}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Compartir grup"
          >
            <Ionicons name="share-social-outline" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSettingsVisible(true)}
            style={[styles.headerRightBtn, { backgroundColor: colors.cardBackground }]}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            activeOpacity={0.7}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Configuració del grup"
          >
            <Settings size={20} color={colors.text} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, group, colors.background, colors.text, colors.cardBackground, setShareModalVisible, setSettingsVisible]);

  const load = useCallback(async () => {
    if (!groupId) return;
    try {
      const [g, ex, mems] = await Promise.all([
        fetchGroup(groupId),
        fetchExpensesForGroup(groupId),
        fetchGroupMembers(groupId),
      ]);
      setGroup(g ?? null);
      setExpenses(ex);
      setMembers(mems);
      const memberWithNames = mems.map((m) => ({
        user_id: m.user_id,
        full_name: getDisplayNameForMember(m),
      }));
      if (mems.length > 0) {
        const { balances: b, settlements: s } = await fetchGroupBalances(groupId, memberWithNames);
        setBalances(b);
        setSettlements(s);
      } else {
        setBalances([]);
        setSettlements([]);
      }
    } catch {
      setGroup(null);
      setExpenses([]);
      setMembers([]);
      setBalances([]);
      setSettlements([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      if (groupId) load();
    }, [groupId, load])
  );

  // Auto-join when opened via deep link (tallyapp://group/:id) and user is not yet a member
  useEffect(() => {
    if (fromLink !== '1' || !group || !user?.id || autoJoinFromLinkDone.current) return;
    const isMember = members.some((m) => m.user_id === user.id);
    if (isMember) {
      autoJoinFromLinkDone.current = true;
      return;
    }
    autoJoinFromLinkDone.current = true;
    addMemberToGroup(groupId, user.id).then(({ error }) => {
      if (!error) load();
    });
  }, [fromLink, group, groupId, user?.id, members, load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const formatAmount = (amount: number, currency: string) =>
    `${amount.toFixed(2)} ${currency}`;

  const isCreator = group && user?.id && group.created_by === user.id;

  const handleDeleteGroup = () => {
    if (!groupId || !isCreator) return;
    Alert.alert(
      'Eliminar grup',
      'Estàs segur? Aquesta acció esborrarà totes les despeses i membres.',
      [
        { text: 'Cancel·lar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleting(true);
              await supabase.from('groups').delete().eq('id', groupId);
              setSettingsVisible(false);
              router.replace('/');
            } catch (e) {
              showAlert('Error', e instanceof Error ? e.message : 'No s\'ha pogut eliminar el grup.');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`group-expenses-${groupId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'expenses',
          filter: `group_id=eq.${groupId}`,
        },
        () => {
          load();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, load]);

  if (!groupId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.secondaryText }]}>Group no trobat</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.inner}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          style={[styles.scroll, { backgroundColor: colors.background }]}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
        >
          {balances.length > 0 && (
            <View style={styles.section}>
              <View style={styles.balancesSectionHeader}>
                <Text style={[styles.sectionTitle, styles.balancesSectionHeaderTitle, { color: colors.secondaryText }]}>Balanços</Text>
                <TouchableOpacity
                  style={styles.veureHistorialBtn}
                  onPress={() => router.push({ pathname: '/group-balance-detail', params: { groupId } } as never)}
                >
                  <Text style={[styles.veureHistorialText, { color: colors.secondaryText }]}>Veure historial</Text>
                  <ChevronRight size={16} color={colors.secondaryText} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.balancesCard, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
                activeOpacity={0.8}
                onPress={() => router.push({ pathname: '/group-balance-detail', params: { groupId } } as never)}
              >
                {balances.map((b) => {
                  const isYou = b.user_id === user?.id;
                  return (
                    <View key={b.user_id} style={styles.balanceRow}>
                      <Text style={[styles.balanceName, { color: colors.text }]} numberOfLines={1}>
                        {isYou ? currentUserDisplayName : (b.full_name?.trim() || `User-${(b.user_id ?? '').slice(0, 5)}` || 'User-?????')}
                      </Text>
                      <View style={styles.balanceNetRow}>
                        {isSettled(b.net) && (
                          <Check size={16} color="#22C55E" strokeWidth={2.5} style={styles.quadratIcon} />
                        )}
                        <Text
                          style={[
                            styles.balanceNet,
                            { color: colors.secondaryText },
                            !isSettled(b.net) && b.net > 0 && styles.balancePositive,
                            !isSettled(b.net) && b.net < 0 && styles.balanceNegative,
                            isSettled(b.net) && styles.balanceQuadrat,
                          ]}
                        >
                          {isSettled(b.net)
                            ? `Quadrat (0.00 ${group?.currency ?? 'EUR'})`
                            : b.net > 0
                              ? `Et deuen ${roundMoney(b.net).toFixed(2)} ${group?.currency ?? 'EUR'}`
                              : `Deus ${roundMoney(-b.net).toFixed(2)} ${group?.currency ?? 'EUR'}`}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.liquidarBtn, { borderColor: ACCENT }]}
                onPress={() => setQuadrarModalVisible(true)}
                activeOpacity={0.85}
              >
                <Banknote size={20} color={ACCENT} strokeWidth={2} />
                <Text style={[styles.liquidarBtnText, { color: ACCENT }]}>Quadrar comptes</Text>
              </TouchableOpacity>
            </View>
          )}

          {isCreator && orphanExpenses.length > 0 && (
            <View style={[styles.orphanBanner, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
              <Text style={[styles.orphanBannerText, { color: colors.text }]}>
                Hi ha despeses d'usuaris que han marxat.
              </Text>
              <TouchableOpacity
                style={[styles.orphanBannerBtn, { backgroundColor: colors.accent }]}
                onPress={async () => {
                  if (!user?.id || !groupId) return;
                  setIsLiquidating(true);
                  const { error } = await liquidateOrphanExpenses(groupId, user.id);
                  setIsLiquidating(false);
                  if (error) {
                    showAlert('Error', error.message);
                    return;
                  }
                  load();
                }}
                disabled={isLiquidating}
              >
                {isLiquidating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.orphanBannerBtnText}>Liquidar aquestes despeses</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Despeses</Text>
          {realExpenses.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.text }]}>No hi ha despeses encara</Text>
              <Text style={[styles.emptySubtext, { color: colors.secondaryText }]}>
                Afegeix una despesa manual o escaneja un tiquet.
              </Text>
              <TouchableOpacity
                style={[styles.emptyBtn, { backgroundColor: colors.accent }]}
                onPress={() =>
                  router.push({ pathname: '/add-expense', params: { groupId } } as never)
                }
              >
                <Text style={[styles.emptyBtnText, { color: '#fff' }]}>Afegir despesa manual</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.expenseList}>
              {realExpenses.map((item) => (
                <View key={item.id} style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={[styles.cardDesc, { color: colors.text }]} numberOfLines={1}>{item.description}</Text>
                    <TouchableOpacity
                      style={[styles.cardMenuBtn, { backgroundColor: colors.cardBackground }]}
                      onPress={() => setExpenseMenuExpenseId(item.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MoreVertical size={18} color={colors.text} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.cardAmount, { color: colors.accent }]}>
                    {formatAmount(item.amount, group?.currency ?? 'EUR')}
                  </Text>
                  <Text style={[styles.cardPayer, { color: colors.secondaryText }]}>
                    Pagat per: {item.payer_name?.trim() || (item.paid_by ? `User-${item.paid_by.slice(0, 5)}` : 'Usuari inactiu')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

<View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.bottomBtn, { backgroundColor: colors.buttonSecondaryBg, borderColor: colors.border }]}
          onPress={() =>
            router.push({ pathname: '/add-expense', params: { groupId } } as never)
          }
        >
          <Plus size={16} color={colors.text} strokeWidth={2.5} />
          <Text style={[styles.bottomBtnText, { color: colors.text }]}>Manual</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bottomBtn, { backgroundColor: colors.accent, borderColor: colors.accent }]}
          onPress={() =>
            router.push({ pathname: '/scan-receipt', params: { groupId } } as never)
          }
        >
          <ScanLine size={16} color="#fff" strokeWidth={2} />
          <Text style={[styles.bottomBtnText, { color: '#fff' }]}>
            Escanejar Tiquet
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={settingsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSettingsVisible(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.cardBackground, borderColor: colors.border }]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Configuració del grup</Text>
            <Text style={[styles.mutedText, { color: colors.textSecondary }]}>{members.length} membres al grup</Text>
            {isCreator && (
              <TouchableOpacity
                style={styles.deleteGroupBtn}
                onPress={handleDeleteGroup}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={[styles.deleteGroupText, { color: '#fff' }]}>Eliminar grup</Text>
                )}
              </TouchableOpacity>
            )}
            {!isCreator && (
              <>
                <TouchableOpacity
                  style={[styles.leaveGroupBtn, { borderColor: colors.border }]}
                  onPress={async () => {
                    if (!user?.id) return;
                    setIsLeaving(true);
                    const { error } = await leaveGroup(groupId, user.id);
                    setIsLeaving(false);
                    setSettingsVisible(false);
                    if (error) {
                      showAlert('Error', error.message);
                      return;
                    }
                    router.replace('/');
                  }}
                  disabled={isLeaving}
                >
                  {isLeaving ? (
                    <ActivityIndicator size="small" color={colors.text} />
                  ) : (
                    <Text style={[styles.leaveGroupBtnText, { color: colors.text }]}>Sortir del grup</Text>
                  )}
                </TouchableOpacity>
                <Text style={[styles.mutedText, { color: colors.textSecondary }]}>Només el creador pot eliminar el grup.</Text>
              </>
            )}
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setSettingsVisible(false)}
            >
              <Text style={styles.modalCloseText}>Tancar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Share Center modal: Convidar al grup – invite code, copy, share via WhatsApp */}
      <Modal
        visible={shareModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setShareModalVisible(false)}
      >
        <TouchableOpacity
          style={[styles.modalOverlay, styles.shareModalOverlay]}
          activeOpacity={1}
          onPress={() => setShareModalVisible(false)}
        >
          <View
            style={[
              styles.modalContent,
              styles.shareModalContent,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, styles.shareModalTitle, { color: colors.text }]}>Convidar al grup</Text>
            <View style={styles.shareModalCodeRow}>
              <View style={[styles.shareInviteCodeBox, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
                <Text style={[styles.shareModalCodeText, { color: colors.text }]} selectable>
                  {inviteCode}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.copyCodeIconBtn, { borderColor: colors.border }]}
                onPress={handleCopyCode}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="copy-outline" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.sharePrimaryBtn}
              onPress={() => {
                setShareModalVisible(false);
                handleShareViaApp();
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="share-social" size={18} color="#fff" style={styles.sharePrimaryBtnIcon} />
              <Text style={styles.sharePrimaryBtnText}>Compartir via WhatsApp</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.shareModalCloseLink}
              onPress={() => setShareModalVisible(false)}
            >
              <Text style={styles.modalCloseText}>Tancar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={quadrarModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setQuadrarModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setQuadrarModalVisible(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.cardBackground, borderColor: colors.border }]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Quadrar deutes</Text>
            <Text style={[styles.mutedText, { color: colors.textSecondary }]}>
              Toca un pagament per marcar-lo com a pagat.
            </Text>
            <ScrollView style={styles.quadrarList} nestedScrollEnabled>
              {activeSettlements.map((s, i) => {
                const fromName = s.from_user_id === user?.id ? currentUserDisplayName : (s.from_name?.trim() || `User-${(s.from_user_id ?? '').slice(0, 5)}`);
                const toName = s.to_user_id === user?.id ? 'tu' : (s.to_name?.trim() || `User-${(s.to_user_id ?? '').slice(0, 5)}`);
                const rowId = `${s.from_user_id}-${s.to_user_id}`;
                const isSettling = settlingId === rowId;
                return (
                  <TouchableOpacity
                    key={`${s.from_user_id}-${s.to_user_id}-${i}`}
                    style={[styles.quadrarRow, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
                    onPress={() => {
                      handleMarkAsPaid(s.from_user_id, s.to_user_id, roundMoney(s.amount));
                      setQuadrarModalVisible(false);
                    }}
                    disabled={isSettling}
                  >
                    <Text style={[styles.quadrarRowText, { color: colors.text }]} numberOfLines={1}>
                      {fromName} → {toName}: {formatAmount(s.amount, group?.currency ?? 'EUR')}
                    </Text>
                    {isSettling ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Text style={[styles.quadrarRowAction, { color: colors.accent }]}>Marcar com a pagat</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setQuadrarModalVisible(false)}
            >
              <Text style={styles.modalCloseText}>Tancar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Expense card action menu – bottom sheet (Editar / Eliminar) */}
      <Modal
        visible={expenseMenuExpenseId != null}
        transparent
        animationType="slide"
        onRequestClose={() => setExpenseMenuExpenseId(null)}
      >
        <TouchableOpacity
          style={styles.bottomSheetOverlay}
          activeOpacity={1}
          onPress={() => setExpenseMenuExpenseId(null)}
        >
          <View style={[styles.expenseMenuBottomSheet, { backgroundColor: colors.cardBackground, borderColor: colors.border }]} onStartShouldSetResponder={() => true}>
            {expenseMenuExpenseId && (() => {
              const item = realExpenses.find((e) => e.id === expenseMenuExpenseId);
              if (!item) return null;
              return (
                <>
                  <TouchableOpacity
                    style={[styles.expenseMenuItem, { borderColor: colors.border }]}
                    onPress={() => {
                      setEditingExpenseId(expenseMenuExpenseId);
                      setExpenseMenuExpenseId(null);
                    }}
                  >
                    <Text style={[styles.expenseMenuItemText, { color: colors.text }]}>Editar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.expenseMenuItem, styles.expenseMenuItemDanger, { borderColor: colors.border }]}
                    onPress={() => {
                      const id = expenseMenuExpenseId;
                      setExpenseMenuExpenseId(null);
                      Alert.alert(
                        'Eliminar despesa?',
                        'Aquesta acció no es pot desfer.',
                        [
                          { text: 'Cancel·lar', style: 'cancel' },
                          {
                            text: 'Eliminar',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await deleteExpense(id);
                                load();
                              } catch (e) {
                                showAlert('Error', e instanceof Error ? e.message : 'No s\'ha pogut eliminar la despesa.');
                              }
                            },
                          },
                        ]
                      );
                    }}
                  >
                    <Text style={styles.expenseMenuItemTextDanger}>Eliminar</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Nested Edit expense modal – form (description, amount, payer, date) */}
      <Modal
        visible={editingExpenseId != null}
        transparent
        animationType="fade"
        onRequestClose={() => { setEditingExpenseId(null); setEditForm(null); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { setEditingExpenseId(null); setEditForm(null); }}
          />
          <View style={[styles.editExpenseModalContent, { backgroundColor: colors.cardBackground, borderColor: colors.border }]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Editar despesa</Text>
            {editForm ? (
              <ScrollView keyboardShouldPersistTaps="handled" style={styles.editExpenseForm}>
                <Text style={[styles.editExpenseLabel, { color: colors.textSecondary }]}>Descripció</Text>
                <TextInput
                  style={[styles.editExpenseInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  value={editForm.description}
                  onChangeText={(t) => setEditForm((f) => f ? { ...f, description: t } : f)}
                  placeholder="ex: Sopar"
                  placeholderTextColor={colors.textSecondary}
                  editable={!editSaving}
                />
                <Text style={[styles.editExpenseLabel, { color: colors.textSecondary }]}>Import</Text>
                <TextInput
                  style={[styles.editExpenseInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                  value={editForm.amount}
                  onChangeText={(t) => setEditForm((f) => f ? { ...f, amount: t } : f)}
                  placeholder="0.00"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="decimal-pad"
                  editable={!editSaving}
                />
                <Text style={[styles.editExpenseLabel, { color: colors.textSecondary }]}>Pagat per (nom)</Text>
                <View style={styles.editExpenseMemberList}>
                  {members.map((m) => {
                    const isSelected = editForm.paidBy === m.user_id;
                    return (
                      <TouchableOpacity
                        key={m.user_id}
                        style={[
                          styles.editExpenseMemberChip,
                          { borderColor: colors.border, backgroundColor: colors.card },
                          isSelected && styles.editExpenseMemberChipActive,
                        ]}
                        onPress={() => setEditForm((f) => f ? { ...f, paidBy: m.user_id } : f)}
                        disabled={editSaving}
                      >
                        <Text
                          style={[
                            styles.editExpenseMemberChipText,
                            { color: colors.text },
                            isSelected && styles.editExpenseMemberChipTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {getDisplayNameForMember(m)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.editExpenseActions}>
                  <TouchableOpacity
                    style={[styles.editExpenseCancelBtn, { borderColor: colors.border }]}
                    onPress={() => { setEditingExpenseId(null); setEditForm(null); }}
                  >
                    <Text style={[styles.editExpenseCancelText, { color: colors.text }]}>Cancel·lar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.editExpenseSaveBtn, { backgroundColor: colors.accent }]}
                    disabled={editSaving || !editForm.description.trim() || !editForm.amount || editForm.memberUserIds.length === 0}
                    onPress={async () => {
                      if (!editingExpenseId || !editForm) return;
                      setEditSaving(true);
                      try {
                        await updateExpense(editingExpenseId, {
                          description: editForm.description.trim(),
                          amount: Number(editForm.amount.replace(',', '.')) || 0,
                          paidBy: editForm.paidBy,
                          memberUserIds: editForm.memberUserIds,
                        });
                        setEditingExpenseId(null);
                        setEditForm(null);
                        load();
                      } catch (e) {
                        showAlert('Error', e instanceof Error ? e.message : 'No s\'ha pogut desar.');
                      } finally {
                        setEditSaving(false);
                      }
                    }}
                  >
                    {editSaving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.editExpenseSaveText}>Desar</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : (
              <View style={styles.editExpenseLoading}>
                <ActivityIndicator size="large" color={colors.accent} />
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmModal
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        cancelLabel={null}
        confirmLabel="D'acord"
        onCancel={() => setAlertVisible(false)}
        onConfirm={() => setAlertVisible(false)}
        onRequestClose={() => setAlertVisible(false)}
      />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1 },
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerRightBtn: {
    minWidth: 44,
    minHeight: 44,
    padding: 6,
    marginRight: 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: 18, paddingBottom: 92 },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quadrarList: { maxHeight: 280, marginVertical: 12 },
  quadrarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  quadrarRowText: { fontSize: 13, flex: 1 },
  quadrarRowAction: { fontSize: 12, fontWeight: '600', color: ACCENT },
  balancesCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  balanceName: { fontSize: 13, flex: 1 },
  balanceNetRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quadratIcon: { marginRight: 0 },
  balanceNet: { fontSize: 12, fontWeight: '600' },
  balanceQuadrat: { color: '#22C55E' },
  balancePositive: { color: ACCENT },
  balanceNegative: { color: '#EF4444' },
  balancesSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  balancesSectionHeaderTitle: { marginBottom: 0 },
  balancesHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  veureHistorialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  veureHistorialText: { fontSize: 12, fontWeight: '500' },
  liquidarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 12,
    gap: 10,
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  liquidarBtnText: { fontSize: 16, fontWeight: '600' },
  bottomSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  expenseMenuBottomSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 12,
    paddingBottom: 32,
    overflow: 'hidden',
  },
  editExpenseModalContent: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 400,
    maxHeight: '85%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    margin: 24,
  },
  editExpenseForm: { maxHeight: 420 },
  editExpenseLabel: { fontSize: 11, fontWeight: '600', marginBottom: 6, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  editExpenseInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  editExpenseMemberList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  editExpenseMemberChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  editExpenseMemberChipActive: { borderColor: ACCENT, backgroundColor: 'rgba(99, 102, 241, 0.15)' },
  editExpenseMemberChipText: { fontSize: 13, fontWeight: '600' },
  editExpenseMemberChipTextActive: { color: ACCENT },
  editExpenseActions: { flexDirection: 'row', gap: 12, marginTop: 20, marginBottom: 8 },
  editExpenseCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  editExpenseCancelText: { fontSize: 15, fontWeight: '600' },
  editExpenseSaveBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  editExpenseSaveText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  editExpenseLoading: { paddingVertical: 32, alignItems: 'center' },
  quadrarBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: ACCENT,
  },
  quadrarBtnText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  empty: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptySubtext: {
    fontSize: 12,
    marginBottom: 20,
    textAlign: 'center',
  },
  emptyBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  emptyBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  expenseList: { gap: 10 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  cardDesc: { fontSize: 14, fontWeight: '600', flex: 1 },
  cardMenuBtn: { padding: 6, marginLeft: 8, borderRadius: 8 },
  cardAmount: { fontSize: 15, fontWeight: '700', color: ACCENT, marginTop: 2 },
  cardPayer: { fontSize: 12, marginTop: 2 },
  expenseMenuItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  expenseMenuItemDanger: { borderBottomWidth: 0 },
  expenseMenuItemText: { fontSize: 16, fontWeight: '500' },
  expenseMenuItemTextDanger: { fontSize: 16, fontWeight: '500', color: '#EF4444' },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    padding: 10,
    paddingBottom: 24,
    gap: 8,
    borderTopWidth: 1,
  },
  bottomBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 2,
  },
  bottomBtnAccent: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  bottomBtnText: { fontSize: 13, fontWeight: '600' },
  bottomBtnTextDark: { color: '#fff' },
  errorText: { fontSize: 16, textAlign: 'center', marginTop: 48 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 24,
  },
  shareModalOverlay: {
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalContent: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
  },
  shareModalContent: {
    maxWidth: 340,
    alignSelf: 'center',
    paddingVertical: 18,
    paddingHorizontal: 24,
    gap: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
  shareModalTitle: { textAlign: 'center', marginBottom: 0 },
  shareModalCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  shareInviteCodeBox: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareModalCodeText: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 4,
  },
  copyCodeIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sharePrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    backgroundColor: ACCENT,
    paddingVertical: 0,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  sharePrimaryBtnIcon: { marginRight: 8 },
  sharePrimaryBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  shareModalCloseLink: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  orphanBanner: {
    marginHorizontal: 24,
    marginBottom: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  orphanBannerText: { fontSize: 14, marginBottom: 4 },
  orphanBannerBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orphanBannerBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  leaveGroupBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 12,
  },
  leaveGroupBtnText: { fontSize: 15, fontWeight: '600' },
  deleteGroupBtn: {
    backgroundColor: '#EF4444',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  deleteGroupText: { fontSize: 16, fontWeight: '600' },
  mutedText: { fontSize: 14, marginBottom: 12 },
  inviteCodeBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  inviteCodeText: { fontSize: 22, fontWeight: '700', letterSpacing: 4 },
  copyBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  copyBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  modalCloseBtn: { paddingVertical: 12, alignItems: 'center' },
  modalCloseText: { fontSize: 15, fontWeight: '500', color: ACCENT },
});
