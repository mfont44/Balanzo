import type { ExpenseWithPayer } from '@/services/expenses';
import {
  createSettlementExpense,
  markGroupExpensesSettledWhenFullySquare,
  settleAllGroupExpenses,
} from '@/services/expenses';
import { supabase } from '@/services/supabase';
import type { GroupMemberWithUser } from '@/services/groupService';
import { getMemberDisplayName } from '@/services/groupService';
import type { Settlement } from '@/services/expenses';
import { roundMoney } from '@/utils/calculations';
import { DISPLAY_SETTLED_THRESHOLD } from '@/utils/calculations';
import { ACCENT } from '@/theme/colors';
import { useThemeColors } from '@/hooks';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Avatar from '@/components/Avatar';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Ionicons } from '@expo/vector-icons';

// NOTE: This component intentionally focuses on the “Balanços / Historial” tab only.
// It owns the History bottom-sheet UI and the settlement “Liquidar” cards.

type HistoryItem = {
  id: string;
  dateLabel: string;
  payerUserId: string;
  payerLabel: string;
  toLabel: string;
  amountText: string;
};

type Props = {
  groupId: string;
  currency: string;
  currentUserId?: string;
  members: GroupMemberWithUser[];
  expenses: ExpenseWithPayer[];
  settlements: Settlement[];
  measureRefForCurrentStep: () => void;
  tourStep: string;
  tourGroupId: string | null;
  groupIdForTour: string;
  historyBtnRef: React.RefObject<View | null>;
  debtsListRef: React.RefObject<View | null>;
  onReload: () => void;
  onShowAlert: (title: string, message: string) => void;
  styles: any;
};

function getUsernameLabel(member: GroupMemberWithUser): string {
  const raw = (member.username ?? '').trim();
  if (raw) return raw.startsWith('@') ? raw : `@${raw}`;
  return getMemberDisplayName(member);
}

function BalancesTabImpl({
  groupId,
  currency,
  currentUserId,
  members,
  expenses,
  settlements,
  measureRefForCurrentStep,
  tourStep,
  tourGroupId,
  groupIdForTour,
  historyBtnRef,
  debtsListRef,
  onReload,
  onShowAlert,
  styles,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [settlingAllDebts, setSettlingAllDebts] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [settleConfirm, setSettleConfirm] = useState<null | {
    fromUserId: string;
    toUserId: string;
    amount: number;
    fromLabel: string;
    toLabel: string;
  }>(null);

  const labelByUserId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) map[m.user_id] = getUsernameLabel(m);
    return map;
  }, [members]);
  const memberByUserId = useMemo(() => {
    const map: Record<string, GroupMemberWithUser> = {};
    for (const m of members) map[m.user_id] = m;
    return map;
  }, [members]);

  const activeSettlements = useMemo(
    () => settlements.filter((s) => roundMoney(s.amount) >= DISPLAY_SETTLED_THRESHOLD),
    [settlements]
  );

  const debtCards = useMemo(() => activeSettlements.filter((s) => s.from_user_id !== s.to_user_id), [activeSettlements]);

  const formatDebtAmount = (amount: number) => `${amount.toFixed(2)} ${currency}`;

  useEffect(() => {
    if (!historyModalVisible) return;

    let cancelled = false;
    const run = async () => {
      setHistoryLoading(true);
      try {
        const settlementExpenses = expenses
          .filter((e) => (e as ExpenseWithPayer).is_settlement === true)
          .slice()
          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

        if (settlementExpenses.length === 0) {
          if (!cancelled) setHistoryItems([]);
          return;
        }

        const ids = settlementExpenses.map((e) => e.id);
        const { data: splitRows } = await supabase
          .from('expense_splits')
          .select('expense_id, user_id, amount_owed')
          .in('expense_id', ids);

        const splitsByExpenseId: Record<string, { user_id: string; amount_owed: number }[]> = {};
        for (const s of (splitRows ?? []) as { expense_id: string; user_id: string; amount_owed: number }[]) {
          if (!splitsByExpenseId[s.expense_id]) splitsByExpenseId[s.expense_id] = [];
          splitsByExpenseId[s.expense_id]!.push({ user_id: s.user_id, amount_owed: Number(s.amount_owed) });
        }

        const items: HistoryItem[] = settlementExpenses.map((se) => {
          const payerId = se.paid_by ?? '';
          const toSplit = splitsByExpenseId[se.id]?.[0];
          const toUserId = toSplit?.user_id ?? '';

          const payerLabel =
            payerId === currentUserId
              ? t('stats.you')
              : se.payer_name?.trim() || labelByUserId[payerId] || `User-${payerId.slice(0, 5)}`;

          const toLabel =
            toUserId === currentUserId
              ? t('balances.recipientYou')
              : labelByUserId[toUserId] || `User-${toUserId.slice(0, 5)}`;

          const dateRaw = se.date ?? '';
          const dateLabel = dateRaw ? new Date(dateRaw).toLocaleDateString() : '';

          return {
            id: se.id,
            dateLabel,
            payerUserId: payerId,
            payerLabel,
            toLabel,
            amountText: formatDebtAmount(roundMoney(se.amount)),
          };
        });

        if (!cancelled) setHistoryItems(items);
      } catch {
        if (!cancelled) setHistoryItems([]);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [historyModalVisible, expenses, labelByUserId, currency, currentUserId, t]);

  const handleMarkAsPaid = async (fromUserId: string, toUserId: string, amount: number) => {
    if (!groupId) return;
    const key = `${fromUserId}-${toUserId}`;
    setSettlingId(key);
    try {
      await createSettlementExpense({ groupId, fromUserId, toUserId, amount });
      const memberWithNames = members.map((m) => ({
        user_id: m.user_id,
        full_name: getUsernameLabel(m),
      }));
      await markGroupExpensesSettledWhenFullySquare(groupId, memberWithNames);
      onReload();
    } catch (e) {
      onShowAlert(t('addExpense.errorTitle'), e instanceof Error ? e.message : t('balances.markPaidError'));
    } finally {
      setSettlingId(null);
    }
  };

  const handleSettleAllDebts = useCallback(() => {
    if (!groupId || settlingAllDebts) return;
    Alert.alert(t('groupDetail.settleDebtsConfirmTitle'), t('groupDetail.settleDebtsConfirmMessage'), [
      { text: t('alerts.cancel'), style: 'cancel' },
      {
        text: t('groupDetail.settleDebtsConfirm'),
        style: 'default',
        onPress: () => {
          void (async () => {
            setSettlingAllDebts(true);
            try {
              await settleAllGroupExpenses(groupId);
              await Promise.resolve(onReload());
            } catch (e) {
              const msg = e instanceof Error ? e.message : t('groupDetail.settleDebtsError');
              Alert.alert(t('alerts.errorTitle'), msg);
            } finally {
              setSettlingAllDebts(false);
            }
          })();
        },
      },
    ]);
  }, [groupId, onReload, settlingAllDebts, t]);

  return (
    <>
      <ScrollView
        style={styles.tabHorizontalContent}
        contentContainerStyle={styles.tab1Content}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.tab1HeaderRow}>
          <View style={{ flex: 1 }} />
          <View
            ref={historyBtnRef}
            collapsable={false}
            onLayout={() => {
              if (tourStep === 'group_history_btn' && tourGroupId === groupIdForTour) {
                measureRefForCurrentStep();
              }
            }}
          >
            <TouchableOpacity
              style={[
                styles.historyPill,
                { backgroundColor: colors.buttonSecondaryBg, borderColor: colors.border },
              ]}
              onPress={() => setHistoryModalVisible(true)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('balances.historyA11y')}
            >
              <Text style={[styles.historyPillText, { color: colors.text }]}>{t('balances.historyPill')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ marginBottom: 14 }}>
          <TouchableOpacity
            style={[
              styles.settleDebtsOutlineBtn,
              {
                borderColor: colors.border,
                backgroundColor: colors.cardBackground,
                opacity: settlingAllDebts ? 0.65 : 1,
              },
            ]}
            onPress={handleSettleAllDebts}
            disabled={settlingAllDebts}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={t('groupDetail.settleDebtsA11y')}
          >
            {settlingAllDebts ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons name="scale-outline" size={20} color={colors.text} />
            )}
            <Text style={[styles.settleDebtsOutlineBtnText, { color: colors.text }]}>
              {t('groupDetail.settleDebtsButton')}
            </Text>
          </TouchableOpacity>
        </View>

        {debtCards.length === 0 ? (
          <View
            ref={debtsListRef}
            collapsable={false}
            onLayout={() => {
              if (tourStep === 'group_debts_list' && tourGroupId === groupIdForTour) {
                measureRefForCurrentStep();
              }
            }}
            style={[
              styles.emptySuccessCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.emptySuccessTitle, { color: colors.text }]}>
              {t('balances.emptySettled')}
            </Text>
          </View>
        ) : (
          <View
            ref={debtsListRef}
            collapsable={false}
            onLayout={() => {
              if (tourStep === 'group_debts_list' && tourGroupId === groupIdForTour) {
                measureRefForCurrentStep();
              }
            }}
            style={styles.debtList}
          >
            {debtCards.map((s, idx) => {
              const fromMember = members.find((m) => m.user_id === s.from_user_id);
              const toMember = members.find((m) => m.user_id === s.to_user_id);
              const fromLabel =
                fromMember && getUsernameLabel(fromMember)
                  ? getUsernameLabel(fromMember)
                  : s.from_name?.trim() || `User-${(s.from_user_id ?? '').slice(0, 5)}`;

              const toLabel =
                toMember && getUsernameLabel(toMember)
                  ? getUsernameLabel(toMember)
                  : s.to_name?.trim() || `User-${(s.to_user_id ?? '').slice(0, 5)}`;

              const rowId = `${s.from_user_id}-${s.to_user_id}`;
              const isSettling = settlingId === rowId;
              const amount = roundMoney(s.amount);
              const amountText = currency === 'EUR' ? `${amount.toFixed(2)}€` : `${amount.toFixed(2)} ${currency}`;

              return (
                <View key={`${rowId}-${idx}`} style={styles.debtCard}>
                  <View
                    style={[
                      styles.debtCardInner,
                      { backgroundColor: colors.cardBackground, borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.debtTopRow}>
                      <View style={{ flex: 1, marginRight: 12, flexDirection: 'row', alignItems: 'center', columnGap: 8 }}>
                        <Avatar
                          avatarUrl={fromMember?.avatar_url ?? null}
                          label={fromLabel}
                          size={28}
                          backgroundColor={colors.cardBackground}
                          borderColor={colors.border}
                          textColor={colors.text}
                        />
                        <Text style={[styles.debtParticipantsText, { color: colors.text, flex: 0 }]} numberOfLines={1}>
                          {fromLabel}
                        </Text>
                        <Text style={[styles.debtParticipantsText, { color: colors.secondaryText, flex: 0 }]}>{'->'}</Text>
                        <Avatar
                          avatarUrl={toMember?.avatar_url ?? null}
                          label={toLabel}
                          size={28}
                          backgroundColor={colors.cardBackground}
                          borderColor={colors.border}
                          textColor={colors.text}
                        />
                        <Text style={[styles.debtParticipantsText, { color: colors.text, flex: 0 }]} numberOfLines={1}>
                          {toLabel}
                        </Text>
                      </View>
                      <Text style={[styles.debtAmountRight, { color: colors.accent }]} numberOfLines={1}>
                        {amountText}
                      </Text>
                    </View>

                    <View style={styles.debtActionRow}>
                      <View
                        ref={idx === 0 ? debtsListRef : undefined}
                        collapsable={false}
                        onLayout={() => {
                          if (idx !== 0) return;
                          if (tourStep === 'group_debts_list' && tourGroupId === groupIdForTour) {
                            measureRefForCurrentStep();
                          }
                        }}
                        style={{ flex: 1 }}
                      >
                        <TouchableOpacity
                          style={[
                            styles.debtSettleBtn,
                            { backgroundColor: colors.accent, borderColor: colors.accent, opacity: isSettling ? 0.7 : 1 },
                          ]}
                          onPress={() => {
                            if (settleConfirm) return;
                            setSettleConfirm({
                              fromUserId: s.from_user_id,
                              toUserId: s.to_user_id,
                              amount: roundMoney(s.amount),
                              fromLabel,
                              toLabel,
                            });
                          }}
                          disabled={isSettling || Boolean(settleConfirm)}
                          activeOpacity={0.85}
                        >
                          {isSettling ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={styles.debtSettleBtnText}>{t('balances.settleBtn')}</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={historyModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.historyModalOverlay}
          activeOpacity={1}
          onPress={() => setHistoryModalVisible(false)}
        >
          <View
            style={[
              styles.historySheet,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.historyHeaderRow}>
              <Text style={[styles.historyTitle, { color: colors.text }]}>{t('balances.historyTitle')}</Text>
            </View>

            <ScrollView style={styles.historyList} contentContainerStyle={styles.historyListContent}>
              {historyLoading ? (
                <View style={{ paddingVertical: 18 }}>
                  <ActivityIndicator size="small" color={colors.accent} />
                </View>
              ) : historyItems.length === 0 ? (
                <View style={{ paddingVertical: 18 }}>
                  <Text style={[styles.historyEmptyText, { color: colors.secondaryText }]}>
                    {t('balances.historyEmpty')}
                  </Text>
                </View>
              ) : (
                historyItems.map((row) => (
                  <View
                    key={row.id}
                    style={[
                      styles.historyRow,
                      { borderColor: colors.divider, backgroundColor: colors.cardBackground },
                    ]}
                  >
                    <Text style={[styles.historyDateText, { color: colors.textSecondary }]}>{row.dateLabel}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 8 }}>
                      <Avatar
                        avatarUrl={memberByUserId[row.payerUserId]?.avatar_url ?? null}
                        label={row.payerLabel}
                        size={22}
                        backgroundColor={colors.cardBackground}
                        borderColor={colors.border}
                        textColor={colors.text}
                      />
                      <Text style={[styles.historySentenceText, { color: colors.text, flex: 1 }]} numberOfLines={2}>
                        {t('balances.historyLineBefore', { payer: row.payerLabel })}
                        <Text style={{ color: ACCENT, fontWeight: '800' }}>{row.amountText}</Text>
                        {t('balances.historyLineAfter', { to: row.toLabel })}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.historyCloseBtn, { backgroundColor: colors.buttonSecondaryBg, borderColor: colors.border }]}
              onPress={() => setHistoryModalVisible(false)}
              activeOpacity={0.9}
            >
              <Text style={[styles.historyCloseBtnText, { color: colors.text }]}>{t('balances.historyClose')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <ConfirmModal
        visible={settleConfirm != null}
        title={t('balances.settleConfirmTitle')}
        message={t('balances.settleConfirmMessage', { from: settleConfirm?.fromLabel ?? '', to: settleConfirm?.toLabel ?? '' })}
        confirmLabel={t('balances.settleBtn')}
        onCancel={() => setSettleConfirm(null)}
        onConfirm={async () => {
          if (!settleConfirm) return;
          const { fromUserId, toUserId, amount } = settleConfirm;
          setSettleConfirm(null);
          await handleMarkAsPaid(fromUserId, toUserId, amount);
        }}
        loading={false}
        destructive={false}
        onRequestClose={() => setSettleConfirm(null)}
      />
    </>
  );
}

export const BalancesTab = memo(BalancesTabImpl);

