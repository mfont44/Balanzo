import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  ScrollView,
} from 'react-native';
import { useThemeColors } from '@/hooks';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useAppStore } from '@/store';
import { fetchGroupMembers } from '@/services/groupService';
import Avatar from '@/components/Avatar';
import {
  createExpenseWithSplits,
  createExpenseWithCustomSplits,
  createExpenseWithItems,
  updateExpense,
  updateExpenseWithCustomSplits,
  updateExpenseWithItems,
  getExpenseWithSplits,
  fetchExpenseItemsWithAssignments,
} from '@/services/expenses';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { GroupMemberWithUser } from '@/services/groupService';
import { ACCENT } from '@/theme/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DANGER_RED = '#FF453A';

/** Itemized row: unselected participant avatars read clearly “off” vs accent “on”. */
const ITEM_PARTICIPANT_MUTED_LIGHT = {
  background: '#A8A8B0',
  border: '#8E8E93',
  text: '#3C3C43',
} as const;
const ITEM_PARTICIPANT_MUTED_DARK = {
  background: '#252528',
  border: '#636366',
  text: '#8E8E93',
} as const;

/** Local row for itemized split (before save). */
interface ItemRow {
  id: string;
  name: string;
  price: string;
  participantIds: Set<string>;
}

/** Prioritize full_name; if missing, use email prefix (current user); else fallback. */
function getDisplayName(
  member: GroupMemberWithUser,
  currentUserId: string | undefined,
  currentUserEmail: string | undefined,
  unnamedFallback: string
): string {
  const name = (member.full_name ?? '').trim();
  if (name) return name;
  if (member.user_id === currentUserId && currentUserEmail) {
    const prefix = currentUserEmail.split('@')[0];
    if (prefix) return prefix;
  }
  return unnamedFallback;
}

function parseLocaleNumber(value: string): number {
  return parseFloat(String(value).replace(',', '.'));
}

/** Exact 100% total in hundredths, stable order. */
function buildEqualPercentsForUserIds(orderedUserIds: string[]): Record<string, string> {
  const n = orderedUserIds.length;
  if (n === 0) return {};
  const hundredthsTotal = 10000;
  const base = Math.floor(hundredthsTotal / n);
  const rem = hundredthsTotal - base * n;
  const out: Record<string, string> = {};
  orderedUserIds.forEach((id, i) => {
    const h = base + (i < rem ? 1 : 0);
    out[id] = (h / 100).toFixed(2);
  });
  return out;
}

function splitsLookEqual(splits: { amount_owed: number }[]): boolean {
  if (splits.length <= 1) return true;
  const first = splits[0]?.amount_owed ?? 0;
  return splits.every((s) => Math.abs(s.amount_owed - first) < 0.015);
}

function percentsFromSplits(
  splits: { user_id: string; amount_owed: number }[],
  orderedUserIds: string[]
): Record<string, string> {
  let sumAmt = 0;
  for (const id of orderedUserIds) {
    const row = splits.find((s) => s.user_id === id);
    sumAmt += row ? row.amount_owed : 0;
  }
  if (sumAmt <= 0) return buildEqualPercentsForUserIds(orderedUserIds);
  const out: Record<string, string> = {};
  let acc = 0;
  for (let i = 0; i < orderedUserIds.length; i++) {
    const id = orderedUserIds[i];
    const row = splits.find((s) => s.user_id === id);
    const amt = row ? row.amount_owed : 0;
    if (i === orderedUserIds.length - 1) {
      out[id] = (Math.round((100 - acc) * 100) / 100).toFixed(2);
    } else {
      const p = (amt / sumAmt) * 100;
      const r = Math.round(p * 100) / 100;
      out[id] = r.toFixed(2);
      acc += r;
    }
  }
  return out;
}

type SplitMethod = 'equal' | 'percent' | 'itemized';

export default function AddExpenseScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const {
    groupId,
    description: paramDescription,
    amount: paramAmount,
    expenseId: paramExpenseId,
    paidBy: paramPaidBy,
    scannedItems: paramScannedItems,
    fromScan: paramFromScan,
  } = useLocalSearchParams<{
    groupId: string;
    description?: string;
    amount?: string;
    expenseId?: string;
    paidBy?: string;
    scannedItems?: string;
    /** Set when navigating from AI receipt scan so we do not double-count expense_added. */
    fromScan?: string;
  }>();
  const router = useRouter();
  const posthog = usePostHog();
  const { user } = useAuthStore();
  const effectiveTheme = useAppStore((s) => s.effectiveTheme);
  const itemParticipantMuted = effectiveTheme === 'dark' ? ITEM_PARTICIPANT_MUTED_DARK : ITEM_PARTICIPANT_MUTED_LIGHT;
  const expenseId = paramExpenseId ?? undefined;
  const isItemized = (m: SplitMethod) => m === 'itemized';

  const [description, setDescription] = useState(paramDescription ?? '');
  const [amount, setAmount] = useState(paramAmount ?? '');
  const [paidBy, setPaidBy] = useState<string>((paramPaidBy || user?.id) ?? '');
  const [splitMethod, setSplitMethod] = useState<SplitMethod>('equal');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<GroupMemberWithUser[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingExpense, setLoadingExpense] = useState(!!expenseId);
  const [saving, setSaving] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [participantsExpanded, setParticipantsExpanded] = useState(false);
  const [percentByUserId, setPercentByUserId] = useState<Record<string, string>>({});

  const loadMembers = useCallback(() => {
    if (!groupId) return;
    setLoadingMembers(true);
    if (expenseId) setLoadingExpense(true);
    fetchGroupMembers(groupId).then((list) => {
      setMembers(list);
      if (!expenseId) {
        setSelectedIds((prev) => (prev.size ? prev : new Set(list.map((m) => m.user_id))));
        const first = list[0];
        if (first && !paramPaidBy) setPaidBy(first.user_id);
        const uid = user?.id;
        if (uid && list.some((m) => m.user_id === uid)) setPaidBy(uid);
        if (paramScannedItems && list.length > 0) {
          try {
            const parsed = JSON.parse(paramScannedItems) as Array<{ name?: string; price?: number }>;
            if (Array.isArray(parsed) && parsed.length > 0) {
              const allMemberIds = new Set(list.map((m) => m.user_id));
              setItems(
                parsed.map((row, i) => ({
                  id: `item-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
                  name: typeof row.name === 'string' ? row.name : '',
                  price: typeof row.price === 'number' ? String(row.price) : '',
                  participantIds: new Set(allMemberIds),
                }))
              );
            }
          } catch {
            // ignore invalid JSON
          }
        }
        setLoadingMembers(false);
        return;
      }
      Promise.all([getExpenseWithSplits(expenseId), fetchExpenseItemsWithAssignments(expenseId)]).then(
        ([data, itemsWithAssignments]) => {
          if (data) {
            const { expense, splits } = data;
            setDescription(expense.description ?? '');
            setAmount(String(expense.amount ?? ''));
            setPaidBy(expense.paid_by ?? user?.id ?? '');
            if (itemsWithAssignments.length > 0) {
              setSplitMethod('itemized');
              setItems(
                itemsWithAssignments.map((row, i) => ({
                  id: `item-${row.id}-${i}`,
                  name: row.name,
                  price: String(row.price),
                  participantIds: new Set(row.participant_user_ids),
                }))
              );
            } else {
              const splitUsers = splits.map((s) => s.user_id);
              setSelectedIds(new Set(splitUsers));
              const orderedIds = list.map((m) => m.user_id).filter((id) => splitUsers.includes(id));
              if (splitsLookEqual(splits)) {
                setSplitMethod('equal');
                setPercentByUserId({});
              } else {
                setSplitMethod('percent');
                setPercentByUserId(percentsFromSplits(splits, orderedIds));
              }
            }
          }
          setLoadingExpense(false);
          setLoadingMembers(false);
        }
      ).catch(() => {
        setLoadingExpense(false);
        setLoadingMembers(false);
      });
    }).catch(() => setLoadingMembers(false));
  }, [groupId, user?.id, expenseId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useFocusEffect(
    useCallback(() => {
      if (groupId) loadMembers();
    }, [groupId, loadMembers])
  );

  const toggleSelected = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        if (next.size <= 1) return prev;
        next.delete(userId);
      } else next.add(userId);
      if (splitMethod === 'percent') {
        const ordered = members.map((m) => m.user_id).filter((id) => next.has(id));
        queueMicrotask(() => setPercentByUserId(buildEqualPercentsForUserIds(ordered)));
      }
      return next;
    });
  };

  const addItemRow = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: '',
        price: '',
        participantIds: new Set(members.map((m) => m.user_id)),
      },
    ]);
  };

  const updateItemRow = (id: string, updates: Partial<Pick<ItemRow, 'name' | 'price'>>) => {
    setItems((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...updates } : row))
    );
  };

  const removeItemRow = (id: string) => {
    setItems((prev) => prev.filter((row) => row.id !== id));
  };

  const toggleItemParticipant = (itemId: string, userId: string) => {
    setItems((prev) =>
      prev.map((row) => {
        if (row.id !== itemId) return row;
        const next = new Set(row.participantIds);
        if (next.has(userId)) {
          if (next.size <= 1) return row;
          next.delete(userId);
        } else next.add(userId);
        return { ...row, participantIds: next };
      })
    );
  };

  /** UUIDs for equal split: checked members that are still in the group. Deduped and trimmed. */
  const getMemberUserIds = (): string[] => {
    const memberSet = new Set(members.map((m) => m.user_id));
    const raw = [...selectedIds].filter((id) => {
      const t = typeof id === 'string' ? id.trim() : '';
      return Boolean(t && memberSet.has(t));
    });
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of raw) {
      const t = typeof id === 'string' ? id.trim() : '';
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  };

  const switchToEqualSplit = () => {
    setSplitMethod('equal');
    setSelectedIds(new Set(members.map((m) => m.user_id)));
    setPercentByUserId({});
    setParticipantsExpanded(false);
  };

  const switchToPercentSplit = () => {
    const wasItemized = splitMethod === 'itemized';
    setSplitMethod('percent');
    setSelectedIds((prev) => {
      const base = wasItemized
        ? new Set(members.map((m) => m.user_id))
        : prev.size > 0
          ? prev
          : new Set(members.map((m) => m.user_id));
      const ordered = members.map((m) => m.user_id).filter((id) => base.has(id));
      queueMicrotask(() => setPercentByUserId(buildEqualPercentsForUserIds(ordered)));
      return base;
    });
    setParticipantsExpanded(false);
  };

  const redistributePercentsEqually = () => {
    const ordered = members.map((m) => m.user_id).filter((id) => selectedIds.has(id));
    setPercentByUserId(buildEqualPercentsForUserIds(ordered));
  };

  const showAlert = (title: string, message: string) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertVisible(true);
  };

  const captureManualExpenseAddedIfNew = useCallback(() => {
    if (expenseId) return;
    if (paramFromScan === '1') return;
    posthog.capture('expense_added', { method: 'manual' });
  }, [expenseId, paramFromScan, posthog]);

  /** Percent mode: require sum 100% and every selected participant > 0% before save. */
  const percentSplitBlocksSave = useMemo(() => {
    if (splitMethod !== 'percent') return false;
    const ordered = members.map((m) => m.user_id).filter((id) => selectedIds.has(id));
    if (ordered.length === 0) return true;
    let sumPct = 0;
    for (const id of ordered) {
      const p = parseLocaleNumber(percentByUserId[id] ?? '0');
      if (!Number.isFinite(p) || p <= 0) return true;
      sumPct += p;
    }
    return Math.abs(sumPct - 100) > 0.02;
  }, [splitMethod, members, selectedIds, percentByUserId]);

  /** Build p_items for RPC: no total/amount_owed calculated here; DB does all math. */
  const buildItemizedPayload = (): Array<{ name: string; price: number; participant_user_ids: string[] }> => {
    if (isItemized(splitMethod) && items.length === 0) {
      const totalPrice = parseFloat(amount.replace(',', '.'));
      if (Number.isNaN(totalPrice) || totalPrice <= 0) return [];
      const allIds = members.map((m) => m.user_id);
      return [{ name: t('addExpense.generalItemName'), price: Math.round(totalPrice * 100) / 100, participant_user_ids: allIds }];
    }
    if (isItemized(splitMethod) && items.length > 0) {
      return items
        .filter((r) => r.name.trim() && parseFloat(String(r.price).replace(',', '.')) > 0)
        .map((r) => ({
          name: r.name.trim(),
          price: Math.round(parseFloat(String(r.price).replace(',', '.')) * 100) / 100,
          participant_user_ids: [...r.participantIds],
        }));
    }
    return [];
  };

  const handleSave = async () => {
    const trimmed = description.trim();
    if (!groupId) {
      showAlert(t('addExpense.errorTitle'), t('addExpense.missingGroup'));
      return;
    }
    if (!trimmed) {
      showAlert(t('addExpense.errorTitle'), t('addExpense.missingDescription'));
      return;
    }

    // Itemized: always use RPC create_expense_with_items (no amount_owed/total calculated in frontend)
    if (isItemized(splitMethod)) {
      const p_items = buildItemizedPayload();
      if (p_items.length === 0) {
        showAlert(
          t('addExpense.errorTitle'),
          items.length === 0 ? t('addExpense.itemizedNeedValidTotal') : t('addExpense.itemizedNeedLine')
        );
        return;
      }
      for (let i = 0; i < p_items.length; i++) {
        if (p_items[i].participant_user_ids.length === 0) {
          showAlert(t('addExpense.errorTitle'), t('addExpense.itemizedNeedAssignee', { name: p_items[i].name }));
          return;
        }
      }
      setSaving(true);
      try {
        if (expenseId) {
          await updateExpenseWithItems(expenseId, {
            description: trimmed,
            paidBy,
            items: p_items,
          });
        } else {
          await createExpenseWithItems({
            groupId,
            paidBy,
            description: trimmed,
            items: p_items,
          });
          captureManualExpenseAddedIfNew();
        }
        await router.back();
      } catch (e) {
        console.error('[Tally] itemized save error:', e);
        const msg = e instanceof Error ? e.message : t('addExpense.saveFailed');
        showAlert(t('addExpense.errorTitle'), msg);
      } finally {
        setSaving(false);
      }
      return;
    }

    // Non-itemized: equal or percentage split
    const num = parseFloat(amount.replace(',', '.'));
    const memberUserIds = getMemberUserIds();
    if (Number.isNaN(num) || num <= 0) {
      showAlert(t('addExpense.errorTitle'), t('addExpense.invalidAmount'));
      return;
    }
    if (memberUserIds.length === 0) {
      showAlert(
        t('addExpense.errorTitle'),
        members.length === 0 ? t('addExpense.needMembersGeneric') : t('addExpense.needMembersSplit')
      );
      return;
    }

      if (splitMethod === 'percent') {
        let sumPct = 0;
        for (const id of memberUserIds) {
          const p = parseLocaleNumber(percentByUserId[id] ?? '0');
          if (!Number.isFinite(p) || p <= 0) {
            showAlert(t('addExpense.errorTitle'), t('addExpense.percentEachPositive'));
            return;
          }
          sumPct += p;
        }
        if (Math.abs(sumPct - 100) > 0.02) {
          showAlert(t('addExpense.errorTitle'), t('addExpense.percentSumMustBe100'));
          return;
        }
      const splits = memberUserIds.map((user_id) => ({
        user_id,
        amount_owed: (num * (parseLocaleNumber(percentByUserId[user_id] ?? '0') || 0)) / 100,
      }));
      setSaving(true);
      try {
        if (expenseId) {
          await updateExpenseWithCustomSplits(expenseId, {
            paidBy,
            amount: num,
            description: trimmed,
            splits,
          });
        } else {
          await createExpenseWithCustomSplits({
            groupId,
            paidBy,
            amount: num,
            description: trimmed,
            splits,
          });
          captureManualExpenseAddedIfNew();
        }
        await router.back();
      } catch (e) {
        console.error('[Tally] Expense save error:', e);
        showAlert(t('addExpense.errorTitle'), e instanceof Error ? e.message : t('addExpense.saveFailed'));
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      if (expenseId) {
        await updateExpense(expenseId, {
          paidBy,
          amount: num,
          description: trimmed,
          memberUserIds,
        });
      } else {
        await createExpenseWithSplits({
          groupId,
          paidBy,
          amount: num,
          description: trimmed,
          memberUserIds,
        });
        captureManualExpenseAddedIfNew();
      }
      await router.back();
    } catch (e) {
      console.error('[Tally] Expense save error:', e);
      showAlert(t('addExpense.errorTitle'), e instanceof Error ? e.message : t('addExpense.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.topRow, { paddingTop: insets.top }]}>
            <TouchableOpacity
              style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.back()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('profile.back')}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>{t('addExpense.description')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            placeholder={t('addExpense.descriptionPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            value={description}
            onChangeText={setDescription}
            editable={!saving}
          />

          <Text style={[styles.label, { marginTop: 20, color: colors.textSecondary }]}>{t('addExpense.split')}</Text>
          <View style={styles.splitRowThree}>
                <TouchableOpacity
                  style={[styles.splitBtnThree, { backgroundColor: colors.card, borderColor: colors.border }, splitMethod === 'equal' && styles.splitBtnActive]}
                  onPress={switchToEqualSplit}
                  disabled={saving}
                >
                  <Text style={[styles.splitBtnText, { color: colors.text }, splitMethod === 'equal' && styles.splitBtnTextActive]} numberOfLines={1}>
                    {t('addExpense.splitEqual')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.splitBtnThree, { backgroundColor: colors.card, borderColor: colors.border }, splitMethod === 'percent' && styles.splitBtnActive]}
                  onPress={switchToPercentSplit}
                  disabled={saving}
                >
                  <Text style={[styles.splitBtnText, { color: colors.text }, splitMethod === 'percent' && styles.splitBtnTextActive]} numberOfLines={1}>
                    {t('addExpense.splitPercent')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.splitBtnThree, { backgroundColor: colors.card, borderColor: colors.border }, splitMethod === 'itemized' && styles.splitBtnActive]}
                  onPress={() => setSplitMethod('itemized')}
                  disabled={saving}
                >
                  <Text style={[styles.splitBtnText, { color: colors.text }, splitMethod === 'itemized' && styles.splitBtnTextActive]} numberOfLines={1}>
                    {t('addExpense.splitItemized')}
                  </Text>
                </TouchableOpacity>
              </View>

          {(expenseId || !isItemized(splitMethod)) && (
            <>
              <Text style={[styles.label, { marginTop: 20, color: colors.textSecondary }]}>{t('addExpense.amount')}</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                placeholder="0.00"
                placeholderTextColor={colors.textSecondary}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                editable={!saving}
              />
            </>
          )}

          {isItemized(splitMethod) && (
            <View style={styles.itemizedSection}>
              <View style={styles.itemizedHeader}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>{t('addExpense.itemList')}</Text>
                <TouchableOpacity onPress={addItemRow} disabled={saving} style={styles.addItemBtn}>
                  <Text style={[styles.addItemBtnText, { color: ACCENT }]}>{t('addExpense.addRow')}</Text>
                </TouchableOpacity>
              </View>
              {items.length === 0 ? (
                <>
                  <Text style={[styles.itemizedHint, { color: colors.textSecondary }]}>
                    {t('addExpense.itemizedHint')}
                  </Text>
                  <Text style={[styles.label, { marginTop: 12, color: colors.textSecondary }]}>
                    {t('addExpense.generalTotal')}
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, marginTop: 6 }]}
                    placeholder="0.00"
                    placeholderTextColor={colors.textSecondary}
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    editable={!saving}
                  />
                </>
              ) : (
                items.map((row) => (
                  <View key={row.id} style={[styles.itemRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.itemRowInputs}>
                      <TextInput
                        style={[styles.itemInputName, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                        placeholder={t('addExpense.itemNamePlaceholder')}
                        placeholderTextColor={colors.textSecondary}
                        value={row.name}
                        onChangeText={(t) => updateItemRow(row.id, { name: t })}
                        editable={!saving}
                      />
                      <TextInput
                        style={[styles.itemInputPrice, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                        placeholder="0.00"
                        placeholderTextColor={colors.textSecondary}
                        value={row.price}
                        onChangeText={(t) => updateItemRow(row.id, { price: t })}
                        keyboardType="decimal-pad"
                        editable={!saving}
                      />
                      <TouchableOpacity
                        style={styles.removeItemBtn}
                        onPress={() => removeItemRow(row.id)}
                        disabled={saving}
                        hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="trash-outline" size={18} color={DANGER_RED} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.itemParticipants}>
                      {members.map((m) => {
                        const isIn = row.participantIds.has(m.user_id);
                        const memberLabel =
                          getDisplayName(m, user?.id, user?.email, t('addExpense.unnamedUser')) || '?';
                        return (
                          <TouchableOpacity
                            key={m.user_id}
                            style={[styles.participantChip, !isIn && styles.participantChipUnselected]}
                            onPress={() => toggleItemParticipant(row.id, m.user_id)}
                            disabled={saving}
                          >
                            <Avatar
                              avatarUrl={m.avatar_url}
                              label={memberLabel}
                              size={32}
                              backgroundColor={isIn ? ACCENT : itemParticipantMuted.background}
                              borderColor={isIn ? ACCENT : itemParticipantMuted.border}
                              textColor={isIn ? '#fff' : itemParticipantMuted.text}
                            />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))
              )}
              <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>{t('addExpense.total')}</Text>
                <Text style={[styles.totalValue, { color: colors.text }]}>
                  {items.length > 0
                    ? `${items.reduce((s, r) => s + (parseFloat(String(r.price).replace(',', '.')) || 0), 0).toFixed(2)} €`
                    : `${(parseFloat(amount.replace(',', '.')) || 0).toFixed(2)} €`}
                </Text>
              </View>
            </View>
          )}

        {!isItemized(splitMethod) &&
          (() => {
            const equalSplitIds = getMemberUserIds();
            const n = equalSplitIds.length;
            const totalNum = parseFloat(amount.replace(',', '.'));
            const perStr =
              n > 0 && Number.isFinite(totalNum) && totalNum > 0
                ? (totalNum / n).toFixed(2)
                : null;
            const totalMembers = members.length;
            const everyoneIn = totalMembers > 0 && n === totalMembers;
            const summaryLine =
              totalMembers === 0
                ? ''
                : everyoneIn
                  ? t('addExpense.splitSummaryAll', { count: n })
                  : t('addExpense.splitSummaryPartial', { selected: n, total: totalMembers });
            const sumPct = equalSplitIds.reduce(
              (acc, id) => acc + (parseLocaleNumber(percentByUserId[id] ?? '0') || 0),
              0
            );
            const detailLine =
              splitMethod === 'percent'
                ? summaryLine
                  ? `${summaryLine} · ${t('addExpense.percentSumShort', { sum: sumPct.toFixed(2) })}`
                  : t('addExpense.percentSumShort', { sum: sumPct.toFixed(2) })
                : perStr != null && summaryLine
                  ? `${summaryLine} · ${t('addExpense.perPerson', { amount: perStr })}`
                  : summaryLine;
            return (
              <View style={styles.participantsSection}>
                <Text style={[styles.label, { marginTop: 16, color: colors.textSecondary }]}>
                  {t('addExpense.splitParticipantsLabel')}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.participantsDisclosure,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                  onPress={() => setParticipantsExpanded((open) => !open)}
                  disabled={saving || totalMembers === 0}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: participantsExpanded }}
                  accessibilityLabel={t('addExpense.splitParticipantsLabel')}
                >
                  <View style={styles.participantsDisclosureText}>
                    <Text style={[styles.participantsDisclosureSummary, { color: colors.text }]} numberOfLines={2}>
                      {detailLine || t('addExpense.splitSummaryEmpty')}
                    </Text>
                  </View>
                  <Ionicons
                    name={participantsExpanded ? 'chevron-up' : 'chevron-down'}
                    size={22}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
                {participantsExpanded && totalMembers > 0 && (
                  <View style={styles.participantsExpanded}>
                    <Text style={[styles.participantsHintShort, { color: colors.textSecondary }]}>
                      {splitMethod === 'percent'
                        ? t('addExpense.splitParticipantsHintPercent')
                        : t('addExpense.splitParticipantsHint')}
                    </Text>
                    {splitMethod === 'equal' ? (
                      members.map((m) => {
                        const isIn = selectedIds.has(m.user_id);
                        const label =
                          getDisplayName(m, user?.id, user?.email, t('addExpense.unnamedUser')) || '?';
                        return (
                          <TouchableOpacity
                            key={m.user_id}
                            style={[
                              styles.splitMemberListRow,
                              {
                                backgroundColor: colors.card,
                                borderColor: isIn ? ACCENT : colors.border,
                              },
                              isIn && styles.splitMemberListRowSelected,
                            ]}
                            onPress={() => toggleSelected(m.user_id)}
                            disabled={saving}
                            activeOpacity={0.75}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isIn }}
                            accessibilityLabel={label}
                          >
                            <Avatar
                              avatarUrl={m.avatar_url}
                              label={label}
                              size={32}
                              backgroundColor={isIn ? ACCENT : colors.card}
                              borderColor={isIn ? ACCENT : colors.border}
                              textColor={isIn ? '#fff' : colors.text}
                            />
                            <Text
                              style={[styles.splitMemberListName, { color: colors.text }]}
                              numberOfLines={1}
                            >
                              {label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })
                    ) : (
                      <View style={styles.percentSection}>
                        <TouchableOpacity
                          onPress={redistributePercentsEqually}
                          disabled={saving}
                          style={styles.percentEqualBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={[styles.percentEqualBtnText, { color: ACCENT }]}>
                            {t('addExpense.percentRedistributeEqual')}
                          </Text>
                        </TouchableOpacity>
                        {members.map((m) => {
                          const isIn = selectedIds.has(m.user_id);
                          const label =
                            getDisplayName(m, user?.id, user?.email, t('addExpense.unnamedUser')) || '?';
                          return (
                            <View
                              key={m.user_id}
                              style={[
                                styles.percentMemberListRow,
                                {
                                  backgroundColor: colors.card,
                                  borderColor: isIn ? ACCENT : colors.border,
                                },
                                isIn && styles.splitMemberListRowSelected,
                              ]}
                            >
                              <TouchableOpacity
                                style={styles.splitMemberRowLead}
                                onPress={() => toggleSelected(m.user_id)}
                                disabled={saving}
                                activeOpacity={0.75}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isIn }}
                                accessibilityLabel={label}
                              >
                                <Avatar
                                  avatarUrl={m.avatar_url}
                                  label={label}
                                  size={32}
                                  backgroundColor={isIn ? ACCENT : colors.card}
                                  borderColor={isIn ? ACCENT : colors.border}
                                  textColor={isIn ? '#fff' : colors.text}
                                />
                                <Text
                                  style={[styles.splitMemberListName, { color: colors.text }]}
                                  numberOfLines={1}
                                >
                                  {label}
                                </Text>
                              </TouchableOpacity>
                              {isIn ? (
                                <>
                                  <TextInput
                                    style={[
                                      styles.percentInputCompact,
                                      {
                                        backgroundColor: colors.background,
                                        borderColor: colors.border,
                                        color: colors.text,
                                      },
                                    ]}
                                    value={percentByUserId[m.user_id] ?? ''}
                                    onChangeText={(txt) =>
                                      setPercentByUserId((prev) => ({ ...prev, [m.user_id]: txt }))
                                    }
                                    keyboardType="decimal-pad"
                                    editable={!saving}
                                    placeholder="0"
                                    placeholderTextColor={colors.textSecondary}
                                  />
                                  <Text style={[styles.percentSuffix, { color: colors.textSecondary }]}>
                                    %
                                  </Text>
                                </>
                              ) : (
                                <View style={styles.percentInputSlot}>
                                  <Text style={[styles.percentInputMuted, { color: colors.textSecondary }]}>
                                    —
                                  </Text>
                                </View>
                              )}
                            </View>
                          );
                        })}
                        <Text
                          style={[
                            styles.percentSumFooter,
                            {
                              color:
                                Math.abs(sumPct - 100) <= 0.02 ? colors.textSecondary : DANGER_RED,
                            },
                          ]}
                        >
                          {t('addExpense.percentSumFooter', { sum: sumPct.toFixed(2) })}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })()}

        <Text style={[styles.label, { marginTop: 20, color: colors.textSecondary }]}>{t('addExpense.paidBy')}</Text>
        {loadingMembers ? (
          <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: 10 }} />
        ) : (
          <View style={styles.memberList}>
            {members.map((m) => (
              <TouchableOpacity
                key={m.user_id}
                style={[
                  styles.memberChip,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  paidBy === m.user_id && styles.memberChipActive,
                ]}
                onPress={() => setPaidBy(m.user_id)}
                disabled={saving}
              >
                {(() => {
                  const memberLabel =
                    getDisplayName(m, user?.id, user?.email, t('addExpense.unnamedUser')) || '?';
                  const isActive = paidBy === m.user_id;
                  return (
                    <>
                      <Avatar
                        avatarUrl={m.avatar_url}
                        label={memberLabel}
                        size={24}
                        backgroundColor={isActive ? ACCENT : colors.card}
                        borderColor={isActive ? ACCENT : colors.border}
                        textColor={isActive ? '#fff' : colors.text}
                      />
                      <Text
                        style={[
                          styles.memberChipText,
                          { color: colors.text },
                          isActive && styles.memberChipTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {memberLabel}
                      </Text>
                    </>
                  );
                })()}
              </TouchableOpacity>
            ))}
          </View>
        )}

          <TouchableOpacity
            style={[styles.saveBtn, (saving || percentSplitBlocksSave) && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving || percentSplitBlocksSave}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>{expenseId ? t('addExpense.saveChanges') : t('addExpense.saveExpense')}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </TouchableWithoutFeedback>
      <ConfirmModal
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        cancelLabel={null}
        confirmLabel={t('common.confirmOk')}
        onCancel={() => setAlertVisible(false)}
        onConfirm={() => setAlertVisible(false)}
        onRequestClose={() => setAlertVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 36 },
  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 11, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  splitRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  splitRowThree: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  splitBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitBtnThree: {
    flex: 1,
    minWidth: '28%',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitBtnActive: { borderColor: ACCENT, backgroundColor: 'rgba(99, 102, 241, 0.15)' },
  splitBtnText: { fontSize: 13, fontWeight: '600' },
  splitBtnTextActive: { color: ACCENT },
  participantsSection: { marginTop: 0 },
  participantsDisclosure: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  participantsDisclosureText: { flex: 1, paddingRight: 8 },
  participantsDisclosureSummary: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  participantsExpanded: { marginTop: 8 },
  participantsHintShort: { fontSize: 11, marginBottom: 6, lineHeight: 15 },
  percentSection: { marginTop: 4 },
  percentEqualBtn: { alignSelf: 'flex-start', marginBottom: 10 },
  percentEqualBtnText: { fontSize: 13, fontWeight: '600' },
  splitMemberListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  splitMemberListRowSelected: { backgroundColor: 'rgba(99, 102, 241, 0.08)' },
  splitMemberListName: { flex: 1, fontSize: 14, fontWeight: '600', minWidth: 0 },
  splitMemberRowLead: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  percentMemberListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  percentInputCompact: {
    width: 76,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 14,
    textAlign: 'right',
  },
  percentInputSlot: {
    width: 94,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 4,
  },
  percentInputMuted: { fontSize: 16, fontWeight: '600' },
  percentSuffix: { fontSize: 14, fontWeight: '600', width: 18 },
  percentSumFooter: { fontSize: 12, fontWeight: '600', marginTop: 6 },
  memberList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  memberChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  memberChipActive: { borderColor: ACCENT, backgroundColor: 'rgba(99, 102, 241, 0.15)' },
  memberChipText: { fontSize: 13, fontWeight: '600' },
  memberChipTextActive: { color: ACCENT },
  saveBtn: {
    marginTop: 28,
    height: 44,
    borderRadius: 12,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  itemizedToggle: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  itemizedToggleActive: { borderColor: ACCENT, backgroundColor: 'rgba(99, 102, 241, 0.15)' },
  itemizedToggleText: { fontSize: 14, fontWeight: '600' },
  itemizedToggleTextActive: { color: ACCENT },
  itemizedSection: { marginTop: 16 },
  itemizedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  addItemBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  addItemBtnText: { fontSize: 13, fontWeight: '600' },
  itemizedHint: { fontSize: 12, marginBottom: 12 },
  itemRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  itemRowInputs: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  itemInputName: { flex: 1, height: 40, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, fontSize: 14 },
  itemInputPrice: { width: 80, height: 40, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, fontSize: 14 },
  itemParticipants: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  participantChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  /** Photos/initials look clearly inactive vs selected accent. */
  participantChipUnselected: { opacity: 0.48 },
  participantChipText: { fontSize: 11, fontWeight: '600' },
  removeItemBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 2,
    minWidth: 36,
    minHeight: 40,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTopWidth: 1 },
  totalLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  totalValue: { fontSize: 16, fontWeight: '700' },
});
