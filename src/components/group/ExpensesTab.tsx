import type { ExpenseWithPayer } from '@/services/expenses';
import type { ExpenseItem } from '@/types/database';
import { deleteExpense, liquidateOrphanExpenses, resolveGroupExMembers } from '@/services/expenses';
import { useRouter } from 'expo-router';
import React, { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Check, ChevronDown, ChevronUp, MoreVertical } from 'lucide-react-native';
import { useThemeColors } from '@/hooks';
import { Alert } from 'react-native';
import { Pressable } from 'react-native';
import Avatar from '@/components/Avatar';
import { ConfirmModal } from '@/components/ConfirmModal';

type Props = {
  groupId: string;
  currency: string;
  currentUserId?: string;
  isCreator: boolean;
  /** Former members still referenced on expenses (creator resolves via RPC). */
  hasStaleParticipants: boolean;
  expenses: ExpenseWithPayer[];
  expenseItemsByExpenseId: Record<string, ExpenseItem[]>;
  refreshing: boolean;
  onRefresh: () => void;
  onReload: () => void;
  onShowAlert: (title: string, message: string) => void;
  styles: any;
};

function formatAmount(amount: number, currency: string) {
  return `${amount.toFixed(2)} ${currency}`;
}

function sortExpensesByDateDesc(a: ExpenseWithPayer, b: ExpenseWithPayer): number {
  const ta = a.date ? new Date(a.date).getTime() : 0;
  const tb = b.date ? new Date(b.date).getTime() : 0;
  if (tb !== ta) return tb - ta;
  return String(b.id).localeCompare(String(a.id));
}

function ExpensesTabImpl({
  groupId,
  currency,
  currentUserId,
  isCreator,
  hasStaleParticipants,
  expenses,
  expenseItemsByExpenseId,
  refreshing,
  onRefresh,
  onReload,
  onShowAlert,
  styles,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const isDarkTheme = colors.background === '#000000';
  /** Subtle settled cue: brand accent on the edge, not loud green. */
  const settledEdgeColor = isDarkTheme ? 'rgba(129, 140, 248, 0.55)' : 'rgba(99, 102, 241, 0.48)';

  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);
  const [expenseMenuExpenseId, setExpenseMenuExpenseId] = useState<string | null>(null);
  const [isLiquidating, setIsLiquidating] = useState(false);
  const [liquidateOrphansConfirmVisible, setLiquidateOrphansConfirmVisible] = useState(false);
  const [staleRedistributeConfirmVisible, setStaleRedistributeConfirmVisible] = useState(false);
  const [staleForgiveConfirmVisible, setStaleForgiveConfirmVisible] = useState(false);
  const [isStaleResolving, setIsStaleResolving] = useState(false);

  const realExpenses = useMemo(() => expenses.filter((e) => !e.is_settlement), [expenses]);
  const orphanExpenses = useMemo(
    () => realExpenses.filter((e) => (e as { paid_by?: string | null }).paid_by == null),
    [realExpenses]
  );

  const unsettledExpenses = useMemo(() => {
    const rows = realExpenses.filter((e) => e.is_settled !== true);
    return [...rows].sort(sortExpensesByDateDesc);
  }, [realExpenses]);

  const settledExpenses = useMemo(() => {
    const rows = realExpenses.filter((e) => e.is_settled === true);
    return [...rows].sort(sortExpensesByDateDesc);
  }, [realExpenses]);

  const renderExpenseCard = (item: ExpenseWithPayer) => {
    const itemizedItems = expenseItemsByExpenseId[item.id];
    const hasItemized = itemizedItems && itemizedItems.length > 0;
    const expanded = expandedExpenseId === item.id;
    const isSettled = !!(item.is_settled === true);

    return (
      <Pressable
        key={item.id}
        style={[
          styles.card,
          {
            backgroundColor: isSettled ? colors.optionRowBg : colors.cardBackground,
            borderColor: colors.border,
          },
          isSettled && styles.cardSettledEdge,
          isSettled && { borderLeftColor: settledEdgeColor },
        ]}
        onPress={() => setExpandedExpenseId(expanded ? null : item.id)}
        accessibilityHint={isSettled ? t('expenses.settledBadge') : undefined}
      >
        <View style={styles.cardHeaderRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.cardHeaderMain}>
              <Text
                style={[
                  styles.cardDesc,
                  {
                    color: colors.text,
                    opacity: isSettled ? 0.82 : 1,
                    fontWeight: isSettled ? '500' : '600',
                  },
                ]}
                numberOfLines={1}
              >
                {item.description}
              </Text>
              {isSettled ? (
                <View style={{ opacity: 0.72, marginLeft: 4 }}>
                  <Check size={16} color={colors.accent} strokeWidth={2.5} />
                </View>
              ) : null}
              {hasItemized && (
                <View style={styles.cardChevron}>
                  {expanded ? (
                    <ChevronUp size={16} color={colors.secondaryText} />
                  ) : (
                    <ChevronDown size={16} color={colors.secondaryText} />
                  )}
                </View>
              )}
            </View>
          </View>
          <TouchableOpacity
            style={[styles.cardMenuBtn, { backgroundColor: colors.cardBackground }]}
            onPress={(e) => {
              e?.stopPropagation?.();
              setExpenseMenuExpenseId(item.id);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MoreVertical size={18} color={colors.text} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {expanded && hasItemized ? (
          <View style={[styles.itemizedList, { borderTopColor: colors.border }]}>
            {itemizedItems.map((line) => (
              <View key={line.id} style={styles.itemizedRow}>
                <Text style={[styles.itemizedRowName, { color: colors.text }]} numberOfLines={1}>
                  {line.name}
                </Text>
                <Text style={[styles.itemizedRowPrice, { color: colors.secondaryText }]}>
                  {formatAmount(line.price, currency)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text
          style={[
            styles.cardAmount,
            {
              color: colors.accent,
              opacity: isSettled ? 0.86 : 1,
            },
          ]}
        >
          {formatAmount(item.amount, currency)}
        </Text>
        <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', columnGap: 8 }}>
          <Avatar
            avatarUrl={item.payer_avatar_url}
            label={
              item.payer_name?.trim() ||
              (item.paid_by ? `User-${item.paid_by.slice(0, 5)}` : '') ||
              t('expenses.inactiveUser')
            }
            size={24}
            backgroundColor={colors.cardBackground}
            borderColor={colors.border}
            textColor={colors.text}
          />
          <Text style={[styles.cardPayer, { color: colors.secondaryText, marginTop: 0, flexShrink: 1 }]}>
            {t('expenses.paidBy', {
              payer:
                item.payer_name?.trim() ||
                (item.paid_by ? `User-${item.paid_by.slice(0, 5)}` : '') ||
                t('expenses.inactiveUser'),
            })}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <>
      <ScrollView
        style={[styles.scroll, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {isCreator && orphanExpenses.length > 0 && (
          <View style={[styles.orphanBanner, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            <Text style={[styles.orphanBannerText, { color: colors.text }]}>{t('expenses.orphanBanner')}</Text>
            <TouchableOpacity
              style={[styles.orphanBannerBtn, { backgroundColor: colors.accent }]}
              onPress={() => {
                if (!currentUserId || !groupId) return;
                if (isLiquidating) return;
                setLiquidateOrphansConfirmVisible(true);
              }}
              disabled={isLiquidating || liquidateOrphansConfirmVisible}
            >
              {isLiquidating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.orphanBannerBtnText}>{t('expenses.liquidateOrphans')}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {!isCreator && hasStaleParticipants && (
          <View style={[styles.orphanBanner, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            <Text style={[styles.orphanBannerText, { color: colors.text }]}>
              {t('expenses.stalePendingCreatorBanner')}
            </Text>
          </View>
        )}

        {isCreator && hasStaleParticipants && (
          <View style={[styles.orphanBanner, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            <Text style={[styles.orphanBannerText, { color: colors.text }]}>{t('expenses.staleMemberBanner')}</Text>
            <View style={styles.staleBannerBtnsRow}>
              <TouchableOpacity
                style={[styles.staleBannerBtn, { backgroundColor: colors.accent }]}
                onPress={() => {
                  if (!groupId || isStaleResolving) return;
                  setStaleRedistributeConfirmVisible(true);
                }}
                disabled={isStaleResolving || staleRedistributeConfirmVisible || staleForgiveConfirmVisible}
              >
                {isStaleResolving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.staleBannerBtnText}>{t('expenses.staleRedistribute')}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.staleBannerBtn, styles.staleBannerBtnOutline, { borderColor: colors.border }]}
                onPress={() => {
                  if (!groupId || isStaleResolving) return;
                  setStaleForgiveConfirmVisible(true);
                }}
                disabled={isStaleResolving || staleRedistributeConfirmVisible || staleForgiveConfirmVisible}
              >
                {isStaleResolving ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={[styles.staleBannerBtnOutlineText, { color: colors.text }]}>
                    {t('expenses.staleForgive')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>{t('expenses.sectionTitle')}</Text>

        {realExpenses.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: colors.text }]}>{t('expenses.emptyTitle')}</Text>
            <Text style={[styles.emptySubtext, { color: colors.secondaryText }]}>
              {t('expenses.emptySub')}
            </Text>
            <TouchableOpacity
              style={[styles.emptyBtn, { backgroundColor: colors.accent }]}
              onPress={() => router.push({ pathname: '/add-expense', params: { groupId } } as never)}
            >
              <Text style={[styles.emptyBtnText, { color: '#fff' }]}>{t('expenses.emptyBtn')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.expenseList}>
            {unsettledExpenses.map((item) => renderExpenseCard(item))}
            {settledExpenses.length > 0 ? (
              <>
                <View style={styles.expenseTimelineDivider} accessible accessibilityLabel={t('expenses.settledSectionTitle')}>
                  <View style={[styles.expenseTimelineDividerLine, { backgroundColor: colors.divider }]} />
                  <Text
                    style={[styles.expenseTimelineDividerLabel, { color: colors.secondaryText }]}
                    numberOfLines={2}
                  >
                    {t('expenses.settledSectionTitle')}
                  </Text>
                  <View style={[styles.expenseTimelineDividerLine, { backgroundColor: colors.divider }]} />
                </View>
                {settledExpenses.map((item) => renderExpenseCard(item))}
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      <ConfirmModal
        visible={liquidateOrphansConfirmVisible}
        title={t('expenses.liquidateOrphansConfirmTitle')}
        message={t('expenses.liquidateOrphansConfirmMessage')}
        confirmLabel={t('expenses.liquidateOrphans')}
        onCancel={() => setLiquidateOrphansConfirmVisible(false)}
        onConfirm={async () => {
          if (!currentUserId || !groupId) return;
          setIsLiquidating(true);
          try {
            const { error } = await liquidateOrphanExpenses(groupId, currentUserId);
            if (error) {
              onShowAlert(t('addExpense.errorTitle'), error.message);
              return;
            }
            onReload();
          } finally {
            setIsLiquidating(false);
            setLiquidateOrphansConfirmVisible(false);
          }
        }}
        loading={isLiquidating}
        destructive={false}
        onRequestClose={() => setLiquidateOrphansConfirmVisible(false)}
      />

      <ConfirmModal
        visible={staleRedistributeConfirmVisible}
        title={t('expenses.staleRedistributeConfirmTitle')}
        message={t('expenses.staleRedistributeConfirmMessage')}
        confirmLabel={t('expenses.staleRedistribute')}
        onCancel={() => setStaleRedistributeConfirmVisible(false)}
        onConfirm={async () => {
          if (!groupId) return;
          setIsStaleResolving(true);
          try {
            const { error } = await resolveGroupExMembers(groupId, 'redistribute');
            if (error) {
              onShowAlert(t('addExpense.errorTitle'), error.message);
              return;
            }
            setStaleRedistributeConfirmVisible(false);
            onReload();
          } finally {
            setIsStaleResolving(false);
          }
        }}
        loading={isStaleResolving}
        destructive={false}
        onRequestClose={() => !isStaleResolving && setStaleRedistributeConfirmVisible(false)}
      />

      <ConfirmModal
        visible={staleForgiveConfirmVisible}
        title={t('expenses.staleForgiveConfirmTitle')}
        message={t('expenses.staleForgiveConfirmMessage')}
        confirmLabel={t('expenses.staleForgive')}
        onCancel={() => setStaleForgiveConfirmVisible(false)}
        onConfirm={async () => {
          if (!groupId) return;
          setIsStaleResolving(true);
          try {
            const { error } = await resolveGroupExMembers(groupId, 'forgive');
            if (error) {
              onShowAlert(t('addExpense.errorTitle'), error.message);
              return;
            }
            setStaleForgiveConfirmVisible(false);
            onReload();
          } finally {
            setIsStaleResolving(false);
          }
        }}
        loading={isStaleResolving}
        destructive
        onRequestClose={() => !isStaleResolving && setStaleForgiveConfirmVisible(false)}
      />

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
          <View
            style={[
              styles.expenseMenuBottomSheet,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
            onStartShouldSetResponder={() => true}
          >
            {expenseMenuExpenseId && (() => {
              const item = realExpenses.find((e) => e.id === expenseMenuExpenseId);
              if (!item) return null;

              return (
                <>
                  <TouchableOpacity
                    style={[styles.expenseMenuItem, { borderColor: colors.border }]}
                    onPress={() => {
                      const id = expenseMenuExpenseId;
                      setExpenseMenuExpenseId(null);
                      if (!id) return;
                      router.push({ pathname: '/add-expense', params: { groupId, expenseId: id } } as never);
                    }}
                  >
                    <Text style={[styles.expenseMenuItemText, { color: colors.text }]}>{t('expenses.edit')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.expenseMenuItem,
                      styles.expenseMenuItemDanger,
                      { borderColor: colors.border },
                    ]}
                    onPress={() => {
                      const id = expenseMenuExpenseId;
                      setExpenseMenuExpenseId(null);
                      if (!id) return;
                      Alert.alert(t('expenses.deleteExpenseTitle'), t('expenses.deleteExpenseMessage'), [
                        { text: t('alerts.cancel'), style: 'cancel' },
                        {
                          text: t('expenses.delete'),
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              await deleteExpense(id);
                              onReload();
                            } catch (e) {
                              onShowAlert(
                                t('addExpense.errorTitle'),
                                e instanceof Error ? e.message : t('expenses.deleteError')
                              );
                            }
                          },
                        },
                      ]);
                    }}
                  >
                    <Text style={styles.expenseMenuItemTextDanger}>{t('expenses.delete')}</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

export const ExpensesTab = memo(ExpensesTabImpl);

