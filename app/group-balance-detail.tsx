import { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useThemeColors } from '@/hooks';
import { useLocalSearchParams } from 'expo-router';
import { ArrowRightLeft } from 'lucide-react-native';
import { useAuthStore, getDisplayName } from '@/store';
import { fetchGroupMembers, getMemberDisplayName } from '@/services/groupService';
import type { GroupMemberWithUser } from '@/services/groupService';
import {
  fetchGroup,
  fetchExpensesForGroup,
  fetchGroupBalances,
} from '@/services/expenses';
import { roundMoney } from '@/utils/calculations';
import type { Group } from '@/types/database';
import type { ExpenseWithPayer } from '@/services/expenses';
import type { MemberBalance, Settlement } from '@/services/expenses';
import Avatar from '@/components/Avatar';

function getDisplayNameForMember(member: GroupMemberWithUser): string {
  return getMemberDisplayName(member);
}

const GREEN_ACCENT = '#22C55E';
const DISPLAY_SETTLED_THRESHOLD = 0.03;

export default function GroupBalanceDetailScreen() {
  const colors = useThemeColors();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const id = (groupId ?? '') as string;
  const { user, profile } = useAuthStore();
  const currentUserDisplayName = getDisplayName(profile, user?.email);

  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<ExpenseWithPayer[]>([]);
  const [members, setMembers] = useState<GroupMemberWithUser[]>([]);
  const [balances, setBalances] = useState<MemberBalance[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [splits, setSplits] = useState<{ expense_id: string; user_id: string; amount_owed: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const settlementExpenses = expenses.filter((e) => e.is_settlement === true);
  const settlementRows = settlementExpenses.map((se) => {
    const split = splits.find((s) => s.expense_id === se.id);
    const toMember = members.find((m) => m.user_id === split?.user_id);
    const toName =
      split?.user_id === user?.id
        ? 'tu'
        : toMember
          ? getDisplayNameForMember(toMember)
          : split
            ? `User-${split.user_id.slice(0, 5)}`
            : '—';
    const payerLabel =
      se.paid_by === user?.id
        ? 'Tu'
        : (se.payer_name?.trim() || `User-${(se.paid_by ?? '').slice(0, 5)}` || '—');
    return { ...se, to_name: toName, payer_label: payerLabel };
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [g, ex, mems] = await Promise.all([
        fetchGroup(id),
        fetchExpensesForGroup(id),
        fetchGroupMembers(id),
      ]);
      setGroup(g ?? null);
      setExpenses(ex);
      setMembers(mems);
      const memberWithNames = mems.map((m) => ({
        user_id: m.user_id,
        full_name: getDisplayNameForMember(m),
      }));
      if (mems.length > 0) {
        const { balances: b, settlements: s } = await fetchGroupBalances(id, memberWithNames);
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
      setSplits([]);
      setBalances([]);
      setSettlements([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const formatAmount = (amount: number, currency: string) =>
    `${amount.toFixed(2)} ${currency}`;
  const currency = group?.currency ?? 'EUR';
  const activeSettlements = settlements.filter(
    (s) => roundMoney(s.amount) >= DISPLAY_SETTLED_THRESHOLD
  );

  if (!id) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.mutedText, { color: colors.secondaryText }]}>Grup no especificat.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={GREEN_ACCENT} />
      </View>
    );
  }

  return (
    <View style={[styles.screenWrapper, { backgroundColor: colors.background }]}>
      <ScrollView
        style={[styles.scroll, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN_ACCENT} />
      }
    >
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Deutes pendents</Text>
        {activeSettlements.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No hi ha deutes pendents.</Text>
          </View>
        ) : (
          <View style={[styles.settlementsCard, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            {activeSettlements.map((s, i) => (
              <View key={`${s.from_user_id}-${s.to_user_id}-${i}`} style={[styles.settlementRow, { borderBottomColor: colors.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 8 }}>
                  <Avatar
                    avatarUrl={members.find((m) => m.user_id === s.from_user_id)?.avatar_url ?? null}
                    label={s.from_name?.trim() || currentUserDisplayName || `User-${(s.from_user_id ?? '').slice(0, 5)}`}
                    size={24}
                    backgroundColor={colors.cardBackground}
                    borderColor={colors.border}
                    textColor={colors.text}
                  />
                  <Text style={[styles.settlementText, { color: colors.text }]} numberOfLines={1}>
                    {s.from_user_id === user?.id
                      ? currentUserDisplayName
                      : (s.from_name?.trim() || `User-${(s.from_user_id ?? '').slice(0, 5)}`)}{' '}
                    →{' '}
                    {s.to_user_id === user?.id ? 'tu' : (s.to_name?.trim() || `User-${(s.to_user_id ?? '').slice(0, 5)}`)}
                    : {formatAmount(s.amount, currency)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Historial de liquidacions</Text>
        {settlementRows.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>Encara no hi ha liquidacions.</Text>
          </View>
        ) : (
          <View style={styles.settlementHistoryList}>
            {settlementRows.map((row) => (
              <View key={row.id} style={[styles.settlementCard, { backgroundColor: colors.cardBackground, borderColor: GREEN_ACCENT }]}>
                <View style={styles.settlementCardHeader}>
                  <ArrowRightLeft size={20} color={GREEN_ACCENT} strokeWidth={2} />
                  <Text style={styles.settlementCardTitle}>Transferència</Text>
                </View>
                <Text style={styles.settlementCardAmount}>
                  {formatAmount(row.amount, currency)}
                </Text>
                <Text style={[styles.settlementCardDesc, { color: colors.text }]}>
                  {row.payer_label} ha pagat a {row.to_name}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: { flex: 1 },
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: 18, paddingBottom: 40 },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settlementsCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  settlementRow: { paddingVertical: 8, borderBottomWidth: 1 },
  settlementText: { fontSize: 13 },
  emptySection: { paddingVertical: 16, alignItems: 'center' },
  emptyText: { fontSize: 14 },
  settlementHistoryList: { gap: 10 },
  settlementCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  settlementCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  settlementCardTitle: { fontSize: 12, fontWeight: '600', color: GREEN_ACCENT, textTransform: 'uppercase' },
  settlementCardAmount: { fontSize: 15, fontWeight: '700', color: GREEN_ACCENT, marginBottom: 4 },
  settlementCardDesc: { fontSize: 14 },
  mutedText: { fontSize: 14, textAlign: 'center', marginTop: 24 },
});
