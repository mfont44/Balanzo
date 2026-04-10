import { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useThemeColors } from '@/hooks';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '@/store';
import { fetchGroupMembers, getMemberDisplayName } from '@/services/groupService';
import { createExpenseWithCustomSplits } from '@/services/expenses';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { GroupMemberWithUser } from '@/services/groupService';
import { ACCENT } from '@/theme/colors';
import Avatar from '@/components/Avatar';

interface ReceiptItem {
  name: string;
  price: number;
}

function getDisplayNameForMember(member: GroupMemberWithUser): string {
  return getMemberDisplayName(member);
}

interface AssignableItem extends ReceiptItem {
  id: string;
}

export default function AssignItemsScreen() {
  const colors = useThemeColors();
  const { groupId, itemsJson } = useLocalSearchParams<{
    groupId: string;
    itemsJson: string;
  }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [items, setItems] = useState<AssignableItem[]>([]);
  const [members, setMembers] = useState<GroupMemberWithUser[]>([]);
  const [assignment, setAssignment] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertSuccess, setAlertSuccess] = useState(false);
  const headerHeight = useHeaderHeight();

  useEffect(() => {
    try {
      const data = itemsJson ? JSON.parse(itemsJson as string) : { items: [], total: 0 };
      const list = Array.isArray(data.items) ? data.items : [];
      setItems(
        list.map((it: ReceiptItem, i: number) => ({
          id: `item-${i}`,
          name: String(it?.name ?? '').trim() || 'Sense nom',
          price: Number(Number(it?.price ?? 0).toFixed(2)),
        }))
      );
    } catch {
      setItems([]);
    }
  }, [itemsJson]);

  const loadMembers = useCallback(async () => {
    if (!groupId) return;
    const list = await fetchGroupMembers(groupId);
    setMembers(list);
  }, [groupId]);

  useEffect(() => {
    loadMembers().finally(() => setLoading(false));
  }, [loadMembers]);

  const toggleAssign = (itemId: string, userId: string) => {
    setAssignment((prev) => {
      const current = prev[itemId] ?? [];
      const has = current.includes(userId);
      const next = has ? current.filter((id) => id !== userId) : [...current, userId];
      return { ...prev, [itemId]: next };
    });
  };

  const updateItemPrice = (itemId: string, price: number) => {
    const p = Math.round(price * 100) / 100;
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, price: p } : it))
    );
  };

  const addManualItem = () => {
    setItems((prev) => [
      ...prev,
      { id: `item-${Date.now()}`, name: 'Nou producte', price: 0 },
    ]);
  };

  const computedTotal = items.reduce((s, i) => s + i.price, 0);
  const displayTotal = Math.round(computedTotal * 100) / 100;

  const perUserAmount: Record<string, number> = {};
  members.forEach((m) => (perUserAmount[m.user_id] = 0));
  items.forEach((item) => {
    const userIds = assignment[item.id] ?? [];
    if (userIds.length > 0) {
      const part = Math.round((item.price / userIds.length) * 100) / 100;
      userIds.forEach((uid) => {
        perUserAmount[uid] = Math.round((perUserAmount[uid] + part) * 100) / 100;
      });
    }
  });
  const splits = Object.entries(perUserAmount)
    .filter(([, amount]) => amount > 0)
    .map(([user_id, amount_owed]) => ({ user_id, amount_owed }));

  const canConfirm = splits.length > 0 && displayTotal > 0 && user?.id;

  const handleConfirm = async () => {
    if (!groupId || !user?.id || !canConfirm) return;
    setSaving(true);
    try {
      await createExpenseWithCustomSplits({
        groupId,
        paidBy: user.id,
        amount: displayTotal,
        description: 'Tiquet (IA)',
        splits,
        isAiScanned: true,
      });
      setAlertTitle('Despesa guardada');
      setAlertMessage('El repartiment s\'ha desat correctament.');
      setAlertSuccess(true);
      setAlertVisible(true);
    } catch (e) {
      setAlertTitle('Error');
      setAlertMessage(e instanceof Error ? e.message : 'No s\'ha pogut guardar.');
      setAlertSuccess(false);
      setAlertVisible(true);
    } finally {
      setSaving(false);
    }
  };

  if (!groupId) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={styles.muted}>Falta l\'identificador del grup.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={headerHeight}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
        <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Productes del tiquet</Text>
        {items.length === 0 ? (
          <Text style={[styles.muted, { color: colors.secondaryText }]}>Cap producte. Afegeix-ne un manualment.</Text>
        ) : (
          items.map((item) => {
            const assigned = assignment[item.id] ?? [];
            const part = assigned.length > 0 ? item.price / assigned.length : 0;
            return (
              <View key={item.id} style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
                <View style={styles.cardRow}>
                  <TextInput
                    style={[styles.itemName, { color: colors.text }]}
                    value={item.name}
                    onChangeText={(t) =>
                      setItems((prev) =>
                        prev.map((i) => (i.id === item.id ? { ...i, name: t } : i))
                      )
                    }
                    placeholder="Nom"
                    placeholderTextColor={colors.secondaryText}
                  />
                  <TextInput
                    style={styles.itemPrice}
                    value={item.price > 0 ? String(item.price) : ''}
                    onChangeText={(t) => updateItemPrice(item.id, parseFloat(t) || 0)}
                    placeholder="0.00"
                    placeholderTextColor={colors.secondaryText}
                    keyboardType="decimal-pad"
                  />
                </View>
                <Text style={[styles.cardSub, { color: colors.secondaryText }]}>
                  {assigned.length > 0
                    ? `Repartit entre ${assigned.length}: ${part.toFixed(2)} € cada un`
                    : 'Toca els membres per assignar'}
                </Text>
                <View style={styles.memberRow}>
                  {members.map((m) => {
                    const isAssigned = assigned.includes(m.user_id);
                    const memberLabel = getDisplayNameForMember(m);
                    return (
                      <TouchableOpacity
                        key={m.user_id}
                        style={[
                          styles.memberChip,
                          {
                            backgroundColor: isAssigned ? undefined : colors.background,
                            borderColor: colors.border,
                          },
                          isAssigned && styles.memberChipSelected,
                        ]}
                        onPress={() => toggleAssign(item.id, m.user_id)}
                      >
                        <Avatar
                          avatarUrl={m.avatar_url}
                          label={memberLabel}
                          size={26}
                          backgroundColor={isAssigned ? ACCENT : colors.cardBackground}
                          borderColor={isAssigned ? ACCENT : colors.border}
                          textColor={isAssigned ? '#fff' : colors.text}
                        />
                        <Text
                          style={[
                            styles.memberChipText,
                            { color: isAssigned ? '#fff' : colors.text },
                            isAssigned && styles.memberChipTextSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {memberLabel}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })
        )}
        <TouchableOpacity style={styles.addBtn} onPress={addManualItem}>
          <Text style={styles.addBtnText}>+ Afegir producte</Text>
        </TouchableOpacity>

        <View style={[styles.summary, { borderTopColor: colors.border }]}>
          <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Total</Text>
          <Text style={[styles.summaryAmount, { color: colors.text }]}>{displayTotal.toFixed(2)} €</Text>
        </View>
        {splits.length > 0 && (
          <View style={styles.splitsPreview}>
            <Text style={[styles.splitsLabel, { color: colors.secondaryText }]}>Repartiment</Text>
            {splits.map(({ user_id, amount_owed }) => {
              const member = members.find((m) => m.user_id === user_id);
              return (
                <Text key={user_id} style={[styles.splitLine, { color: colors.text }]}>
                  {member ? getDisplayNameForMember(member) : `User-${user_id.slice(0, 5)}`}: {amount_owed.toFixed(2)} €
                </Text>
              );
            })}
          </View>
        )}
        </ScrollView>
      </TouchableWithoutFeedback>

      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.confirmBtn, !canConfirm && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={!canConfirm || saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.confirmBtnText}>Confirmar despesa</Text>
          )}
        </TouchableOpacity>
      </View>
      <ConfirmModal
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        cancelLabel={null}
        confirmLabel="D'acord"
        onCancel={() => setAlertVisible(false)}
        onConfirm={() => {
          setAlertVisible(false);
          if (alertSuccess && groupId) router.replace({ pathname: `/group/${groupId}` } as never);
        }}
        onRequestClose={() => {
          setAlertVisible(false);
          if (alertSuccess && groupId) router.replace({ pathname: `/group/${groupId}` } as never);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: 18, paddingBottom: 100 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  muted: { fontSize: 14, marginBottom: 12 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  itemName: { flex: 1, fontSize: 15, paddingVertical: 6 },
  itemPrice: {
    width: 80,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
    paddingVertical: 6,
    textAlign: 'right',
  },
  cardSub: { fontSize: 12, marginTop: 4 },
  memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  memberChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberChipSelected: { backgroundColor: ACCENT, borderColor: ACCENT },
  memberChipText: { fontSize: 12 },
  memberChipTextSelected: { color: '#fff', fontWeight: '600' },
  addBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  addBtnText: { fontSize: 14, color: ACCENT, fontWeight: '600' },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  summaryLabel: { fontSize: 14 },
  summaryAmount: { fontSize: 18, fontWeight: '700' },
  splitsPreview: { marginTop: 8 },
  splitsLabel: { fontSize: 11, marginBottom: 4, textTransform: 'uppercase' },
  splitLine: { fontSize: 13, marginBottom: 2 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 28,
    borderTopWidth: 1,
  },
  confirmBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
