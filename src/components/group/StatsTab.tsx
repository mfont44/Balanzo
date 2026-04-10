import { usePremium } from '@/context/PremiumContext';
import { useThemeColors } from '@/hooks';
import type { ExpenseWithPayer } from '@/services/expenses';
import type { GroupMemberWithUser } from '@/services/groupService';
import { getMemberDisplayName } from '@/services/groupService';
import { ACCENT } from '@/theme/colors';
import { computeNetBalances, computeSettlements, roundMoney } from '@/utils/calculations';
import { STATS_CATEGORY_COLOR, STATS_CATEGORY_SORT, resolveExpenseCategory, type StatsCategoryKey } from '@/utils/expenseCategoryInference';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Download, FileText, Lock } from 'lucide-react-native';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View, useColorScheme, useWindowDimensions } from 'react-native';
import { BarChart } from 'react-native-gifted-charts/dist/BarChart';
import { PieChart } from 'react-native-gifted-charts/dist/PieChart';

type Props = {
  expenses: ExpenseWithPayer[];
  members: GroupMemberWithUser[];
  currency: string;
  currentUserId?: string;
  groupName?: string;
  styles: any;
};

function getUsernameLabel(member: GroupMemberWithUser): string {
  const raw = (member.username ?? '').trim();
  if (raw) return raw.startsWith('@') ? raw : `@${raw}`;
  return getMemberDisplayName(member);
}

function parseExpenseDate(raw: string | undefined): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoDay) {
    return new Date(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3]));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysInclusiveCalendar(min: Date, max: Date): number {
  const a = Date.UTC(min.getFullYear(), min.getMonth(), min.getDate());
  const b = Date.UTC(max.getFullYear(), max.getMonth(), max.getDate());
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function formatAmount(amount: number, currency: string) {
  return `${amount.toFixed(2)} ${currency}`;
}

const SPACING = 24;

function StatsTabImpl({ expenses, members, currency, currentUserId, groupName, styles }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { isPremium } = usePremium();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { width: screenWidth } = useWindowDimensions();

  const statsCurrency = currency ?? 'EUR';

  const realExpenses = useMemo(() => expenses.filter((e) => !e.is_settlement), [expenses]);

  const labelByUserId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) map[m.user_id] = getUsernameLabel(m);
    return map;
  }, [members]);

  const statsPieRadius = Math.min(118, Math.max(88, (screenWidth - 80) * 0.38));

  const groupStats = useMemo(() => {
    const totals: Record<StatsCategoryKey, number> = {
      restauracio: 0,
      supermercat: 0,
      transport: 0,
      activitats: 0,
      allotjament: 0,
      compres: 0,
      altres: 0,
    };

    let sumRaw = 0;
    for (const e of realExpenses) {
      const amt = Number(e.amount) || 0;
      sumRaw += amt;
      totals[resolveExpenseCategory(e)] += amt;
    }

    const rows: { key: StatsCategoryKey; label: string; amount: number; color: string }[] = [];
    for (const key of STATS_CATEGORY_SORT) {
      const amount = roundMoney(totals[key]);
      if (amount > 0) {
        rows.push({
          key,
          label: t(`stats.category.${key}`),
          amount,
          color: STATS_CATEGORY_COLOR[key],
        });
      }
    }

    rows.sort((a, b) => b.amount - a.amount);

    const pieData = rows.map((r) => ({
      value: r.amount,
      color: r.color,
      text: r.label,
    }));

    const totalSpentStats = roundMoney(sumRaw);

    const datesParsed: Date[] = [];
    const byDay: Record<string, number> = {};
    for (const e of realExpenses) {
      const pd = parseExpenseDate(e.date);
      if (!pd) continue;
      datesParsed.push(pd);
      const y = pd.getFullYear();
      const m = String(pd.getMonth() + 1).padStart(2, '0');
      const d = String(pd.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${d}`;
      const amt = Number(e.amount) || 0;
      byDay[key] = (byDay[key] ?? 0) + amt;
    }

    let tripDaysInclusive = 1;
    let dailyAverage = totalSpentStats;
    if (datesParsed.length > 0) {
      const tMin = new Date(Math.min(...datesParsed.map((x) => x.getTime())));
      const tMax = new Date(Math.max(...datesParsed.map((x) => x.getTime())));
      tripDaysInclusive = daysInclusiveCalendar(tMin, tMax);
      dailyAverage = roundMoney(totalSpentStats / tripDaysInclusive);
    }

    const dailyBar: { value: number; label: string; frontColor: string }[] = [];
    if (datesParsed.length > 0) {
      const tMin = new Date(Math.min(...datesParsed.map((x) => x.getTime())));
      const tMax = new Date(Math.max(...datesParsed.map((x) => x.getTime())));
      const cursor = new Date(tMin.getFullYear(), tMin.getMonth(), tMin.getDate());
      const end = new Date(tMax.getFullYear(), tMax.getMonth(), tMax.getDate());

      while (cursor.getTime() <= end.getTime()) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const d = String(cursor.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${d}`;
        const val = roundMoney(byDay[key] ?? 0);
        dailyBar.push({
          value: val,
          label: String(cursor.getDate()),
          frontColor: colors.accent,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const maxDaily = dailyBar.reduce((m, x) => Math.max(m, x.value), 0);
    const barChartMax = Math.max(maxDaily * 1.12, 1);
    const barW = 20;
    const spacing = 7;
    const initialSp = 14;
    const endSp = 20;
    const barChartScrollWidth = Math.max(
      screenWidth - 36,
      initialSp + endSp + dailyBar.length * (barW + spacing)
    );

    const payerTotals: Record<string, number> = {};
    for (const e of realExpenses) {
      const uid = e.paid_by;
      if (!uid) continue;
      payerTotals[uid] = (payerTotals[uid] ?? 0) + (Number(e.amount) || 0);
    }

    const payerRows = Object.entries(payerTotals)
      .map(([userId, raw]) => {
        const amount = roundMoney(raw);
        const payerName = realExpenses.find((x) => x.paid_by === userId)?.payer_name?.trim();
        const label =
          currentUserId === userId
            ? t('stats.you')
            : payerName || labelByUserId[userId] || `User-${userId.slice(0, 5)}`;
        return { userId, label, amount };
      })
      .sort((a, b) => b.amount - a.amount);

    const topPayerMax = payerRows[0]?.amount ?? 1;

    const topThree = [...realExpenses]
      .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
      .slice(0, 3)
      .map((e) => ({
        id: e.id,
        description: (e.description ?? '').trim() || t('stats.noTitle'),
        amount: roundMoney(Number(e.amount) || 0),
      }));

    return {
      totalSpentStats,
      categoryRows: rows,
      pieChartData: pieData,
      tripDaysInclusive,
      dailyAverage,
      dailyBar,
      barChartMax,
      barChartScrollWidth,
      barW,
      spacing,
      initialSp,
      topPayers: payerRows,
      topPayerMax,
      topThreeExpenses: topThree,
      hasSpendDates: datesParsed.length > 0,
    };
  }, [realExpenses, labelByUserId, currentUserId, colors.accent, screenWidth, t]);

  const reconciliation = useMemo(() => {
    const memberIds = members.map((m) => m.user_id);
    const memberLabels = memberIds.map((id) =>
      currentUserId === id ? t('stats.you') : labelByUserId[id] || `User-${id.slice(0, 5)}`
    );

    const rows = realExpenses.map((e) => {
      const amount = roundMoney(Number(e.amount) || 0);
      const split = memberIds.length > 0 ? roundMoney(amount / memberIds.length) : 0;
      const byMember: Record<string, number> = {};
      for (const id of memberIds) {
        byMember[id] = -split;
      }
      if (e.paid_by && byMember[e.paid_by] !== undefined) {
        byMember[e.paid_by] = roundMoney(amount - split);
      }

      const date = parseExpenseDate(e.date);
      const dateLabel = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : '';
      const payer =
        e.payer_name?.trim() ||
        (e.paid_by ? labelByUserId[e.paid_by] || `User-${e.paid_by.slice(0, 5)}` : t('stats.userFallback'));

      return {
        id: e.id,
        dateLabel,
        concept: (e.description ?? '').trim() || t('stats.noTitle'),
        amount,
        payer,
        byMember,
      };
    });

    const totalsByMember: Record<string, number> = {};
    const paidByUser: Record<string, number> = {};
    const owedByUser: Record<string, number> = {};
    for (const id of memberIds) {
      totalsByMember[id] = 0;
      paidByUser[id] = 0;
      owedByUser[id] = 0;
    }

    for (const row of rows) {
      for (const id of memberIds) {
        const value = roundMoney(row.byMember[id] ?? 0);
        totalsByMember[id] = roundMoney((totalsByMember[id] ?? 0) + value);
      }
    }

    for (const e of realExpenses) {
      const amount = roundMoney(Number(e.amount) || 0);
      const split = memberIds.length > 0 ? roundMoney(amount / memberIds.length) : 0;
      for (const id of memberIds) {
        owedByUser[id] = roundMoney((owedByUser[id] ?? 0) + split);
      }
      if (e.paid_by && paidByUser[e.paid_by] !== undefined) {
        paidByUser[e.paid_by] = roundMoney((paidByUser[e.paid_by] ?? 0) + amount);
      }
    }

    const balanceRows = computeNetBalances(
      memberIds.map((id) => ({
        user_id: id,
        total_paid: paidByUser[id] ?? 0,
        total_owed: owedByUser[id] ?? 0,
      })),
      memberIds.map((id) => ({
        user_id: id,
        full_name: currentUserId === id ? t('stats.you') : labelByUserId[id] || `User-${id.slice(0, 5)}`,
      }))
    );
    const settlements = computeSettlements(balanceRows);

    return { memberIds, memberLabels, rows, totalsByMember, settlements };
  }, [members, currentUserId, labelByUserId, realExpenses, t]);

  const handleExportCSV = async () => {
    if (!isPremium) {
      Alert.alert(t('stats.proExportTitle'), t('stats.proExportBody'), [{ text: t('alerts.ok') }]);
      router.push('/paywall' as never);
      return;
    }

    try {
      const escapeCSV = (value: string) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const header = [
        t('stats.csvColDate'),
        t('stats.csvColConcept'),
        t('stats.csvColTotal'),
        t('stats.csvColPaidBy'),
        ...reconciliation.memberLabels,
      ];
      const lines: string[] = [header.map(escapeCSV).join(',')];
      for (const row of reconciliation.rows) {
        const memberCells = reconciliation.memberIds.map((id) => (row.byMember[id] ?? 0).toFixed(2));
        lines.push(
          [row.dateLabel, row.concept, row.amount.toFixed(2), row.payer, ...memberCells]
            .map(escapeCSV)
            .join(',')
        );
      }

      const totalAmount = reconciliation.rows.reduce((acc, r) => acc + r.amount, 0);
      lines.push(
        [
          t('stats.csvTotals'),
          '',
          roundMoney(totalAmount).toFixed(2),
          '',
          ...reconciliation.memberIds.map((id) => (reconciliation.totalsByMember[id] ?? 0).toFixed(2)),
        ]
          .map(escapeCSV)
          .join(',')
      );
      lines.push('');
      lines.push(escapeCSV(t('stats.csvSuggested')));
      lines.push([t('stats.csvWhoPays'), t('stats.csvWhoGets'), t('stats.csvAmount')].map(escapeCSV).join(','));
      for (const s of reconciliation.settlements) {
        lines.push([s.from_name, s.to_name, s.amount.toFixed(2)].map(escapeCSV).join(','));
      }

      if (!FileSystem.cacheDirectory) {
        throw new Error(t('stats.errorTempDir'));
      }
      const fileUri = `${FileSystem.cacheDirectory}Resum_Despeses.csv`;

      await FileSystem.writeAsStringAsync(fileUri, lines.join('\n'), {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert(t('stats.exportCsvSuccessTitle'), t('stats.exportCsvSuccessBody'), [
          { text: t('alerts.ok') },
        ]);
        return;
      }

      await Sharing.shareAsync(fileUri, { mimeType: 'text/csv' });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Export error:', error);
      Alert.alert(t('addExpense.errorTitle'), error instanceof Error ? error.message : t('stats.exportCsvError'), [
        { text: t('alerts.ok') },
      ]);
    }
  };

  const generateHTMLReport = () => {
    const escapeHtml = (value: string) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const generatedDate = new Date();
    const generatedDateLabel = `${generatedDate.getFullYear()}-${String(generatedDate.getMonth() + 1).padStart(2, '0')}-${String(generatedDate.getDate()).padStart(2, '0')}`;

    const headerCols = reconciliation.memberLabels.map((m) => `<th>${escapeHtml(m)}</th>`).join('');
    const matrixRows = reconciliation.rows
      .map((row) => {
        const memberValues = reconciliation.memberIds
          .map((id) => {
            const val = row.byMember[id] ?? 0;
            return `<td class="${val >= 0 ? 'pos' : 'neg'}">${escapeHtml(val.toFixed(2))}</td>`;
          })
          .join('');
        return `
          <tr>
            <td>${escapeHtml(row.dateLabel)}</td>
            <td>${escapeHtml(row.concept)}</td>
            <td class="num">${escapeHtml(row.amount.toFixed(2))}</td>
            <td>${escapeHtml(row.payer)}</td>
            ${memberValues}
          </tr>
        `;
      })
      .join('');
    const totalsCells = reconciliation.memberIds
      .map((id) => {
        const val = reconciliation.totalsByMember[id] ?? 0;
        return `<td class="${val >= 0 ? 'pos' : 'neg'}">${escapeHtml(val.toFixed(2))}</td>`;
      })
      .join('');
    const settlementsRows =
      reconciliation.settlements.length === 0
        ? `<tr><td colspan="3">${escapeHtml(t('stats.htmlNoPendingSettlements'))}</td></tr>`
        : reconciliation.settlements
            .map(
              (s) => `
                <tr>
                  <td>${escapeHtml(s.from_name)}</td>
                  <td>${escapeHtml(s.to_name)}</td>
                  <td class="num">${escapeHtml(s.amount.toFixed(2))}</td>
                </tr>
              `
            )
            .join('');

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { margin:0; padding:20px; background:#f3f4f6; color:#111827; font-family: Arial, Helvetica, sans-serif; }
            .sheet { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:18px; }
            h1 { margin:0 0 4px; font-size:22px; color:#111827; }
            .sub { margin:0 0 14px; color:#6b7280; font-size:12px; }
            h2 { margin:18px 0 8px; font-size:16px; color:#111827; }
            table { width:100%; border-collapse:collapse; }
            th, td { border:1px solid #e5e7eb; padding:7px 8px; font-size:11px; }
            th { background:#f9fafb; text-align:left; }
            .num { text-align:right; }
            .pos { color:#047857; font-weight:700; text-align:right; }
            .neg { color:#b91c1c; font-weight:700; text-align:right; }
            .totals td { background:#f8fafc; font-weight:700; }
            .footer { margin-top:14px; font-size:11px; color:#6b7280; text-align:right; }
          </style>
        </head>
        <body>
          <div class="sheet">
            <h1>${escapeHtml(t('stats.htmlReportTitle', { groupName: groupName ?? t('groupDetail.headerFallbackGroup') }))}</h1>
            <p class="sub">${escapeHtml(t('stats.htmlReportMeta', { date: generatedDateLabel, currency: statsCurrency }))}</p>
            <h2>${escapeHtml(t('stats.htmlMatrixTitle'))}</h2>
            <table>
              <thead>
                <tr>
                  <th>${escapeHtml(t('stats.htmlThDate'))}</th>
                  <th>${escapeHtml(t('stats.htmlThConcept'))}</th>
                  <th>${escapeHtml(t('stats.htmlThTotal'))}</th>
                  <th>${escapeHtml(t('stats.htmlThPaidBy'))}</th>
                  ${headerCols}
                </tr>
              </thead>
              <tbody>
                ${matrixRows || `<tr><td colspan="${4 + reconciliation.memberIds.length}">${escapeHtml(t('stats.htmlNoData'))}</td></tr>`}
                <tr class="totals">
                  <td>${escapeHtml(t('stats.htmlTotals'))}</td>
                  <td></td>
                  <td class="num">${escapeHtml(reconciliation.rows.reduce((acc, r) => acc + r.amount, 0).toFixed(2))}</td>
                  <td></td>
                  ${totalsCells}
                </tr>
              </tbody>
            </table>

            <h2>${escapeHtml(t('stats.htmlSuggestedTitle'))}</h2>
            <table>
              <thead>
                <tr>
                  <th>${escapeHtml(t('stats.htmlWhoPays'))}</th>
                  <th>${escapeHtml(t('stats.htmlWhoGets'))}</th>
                  <th>${escapeHtml(t('stats.htmlAmount'))}</th>
                </tr>
              </thead>
              <tbody>
                ${settlementsRows}
              </tbody>
            </table>
            <div class="footer">${escapeHtml(t('stats.htmlFooter', { date: generatedDateLabel }))}</div>
          </div>
        </body>
      </html>
    `;
  };

  const handleExportPDF = async () => {
    if (!isPremium) {
      Alert.alert(t('stats.proExportTitle'), t('stats.proExportBody'), [{ text: t('alerts.ok') }]);
      router.push('/paywall' as never);
      return;
    }

    try {
      const htmlContent = generateHTMLReport();
      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      await Sharing.shareAsync(uri);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('PDF export error:', error);
      Alert.alert(t('addExpense.errorTitle'), error instanceof Error ? error.message : t('stats.exportPdfError'), [
        { text: t('alerts.ok') },
      ]);
    }
  };

  if (realExpenses.length === 0) {
    return (
      <View style={[styles.tabHorizontalContent, { backgroundColor: colors.background }]}>
        <View style={localStyles.emptyStateContainer}>
          <View
            style={[
              styles.statsEmptyCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
              localStyles.emptyStateCard,
            ]}
          >
            <Ionicons name="stats-chart-outline" size={42} color={colors.secondaryText} />
            <Text style={[styles.statsEmptyTitle, { color: colors.text }]}>{t('stats.emptyTitle')}</Text>
            <Text style={[styles.statsEmptySub, { color: colors.secondaryText }]}>{t('stats.emptySub')}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={[styles.tabHorizontalContent, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.statsTabContent}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEnabled={isPremium}
      >
        <View pointerEvents={isPremium ? 'auto' : 'none'} style={!isPremium ? { opacity: 0.6 } : undefined}>
          <>
              <View style={styles.statsKpiRow}>
                <View
                  style={[
                    styles.statsKpiCard,
                    { backgroundColor: colors.cardBackground, borderColor: colors.border },
                    !isPremium ? { borderWidth: 0 } : null,
                  ]}
                >
                  <Text style={[styles.statsKpiLabel, { color: colors.secondaryText }]}>{t('stats.totalSpent')}</Text>
                  <Text style={[styles.statsKpiValue, { color: colors.text }]}>
                    {formatAmount(groupStats.totalSpentStats, statsCurrency)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statsKpiCard,
                    { backgroundColor: colors.cardBackground, borderColor: colors.border },
                    !isPremium ? { borderWidth: 0 } : null,
                  ]}
                >
                  <Text style={[styles.statsKpiLabel, { color: colors.secondaryText }]}>{t('stats.dailyAverage')}</Text>
                  <Text style={[styles.statsKpiValue, { color: colors.text }]}>
                    {formatAmount(groupStats.dailyAverage, statsCurrency)}
                  </Text>
                  <Text style={[styles.statsKpiHint, { color: colors.secondaryText }]}>
                    {t('stats.daysInPeriod', { count: groupStats.tripDaysInclusive })}
                  </Text>
                </View>
              </View>

              <View style={localStyles.sectionSpacer} />

              <View
                style={[
                  styles.statsSectionCard,
                  localStyles.majorSection,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                  !isPremium ? { borderWidth: 0 } : null,
                ]}
              >
                <Text style={[styles.statsSectionTitle, { color: colors.text }]}>{t('stats.expensesPerDay')}</Text>
                {groupStats.hasSpendDates && groupStats.dailyBar.length > 0 ? (
                  <>
                    <Text style={[styles.statsSectionSub, { color: colors.secondaryText }]}>
                      {t('stats.timelineSub')}
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      nestedScrollEnabled
                      contentContainerStyle={styles.statsBarScrollContent}
                    >
                      <BarChart
                        data={groupStats.dailyBar}
                        width={groupStats.barChartScrollWidth}
                        height={210}
                        maxValue={groupStats.barChartMax}
                        barWidth={groupStats.barW}
                        spacing={groupStats.spacing}
                        initialSpacing={groupStats.initialSp}
                        roundedTop
                        roundedBottom
                        isAnimated
                        animationDuration={1000}
                        backgroundColor="transparent"
                        xAxisColor={colors.border}
                        yAxisColor={colors.border}
                        xAxisLabelTextStyle={{
                          color: colors.text,
                          fontSize: 11,
                          fontWeight: '600',
                        }}
                        yAxisTextStyle={{ color: colors.secondaryText, fontSize: 10 }}
                        rulesColor={colors.divider}
                        rulesThickness={1}
                        rulesType="solid"
                        noOfSections={4}
                        showFractionalValues={false}
                        roundToDigits={0}
                      />
                    </ScrollView>
                  </>
                ) : (
                  <Text style={[styles.statsSectionSub, { color: colors.secondaryText, marginTop: 6 }]}>
                    {t('stats.addDatesHint')}
                  </Text>
                )}
              </View>

              {groupStats.pieChartData.length > 0 ? (
                <>
                  <View style={localStyles.sectionSpacer} />

                  <View
                    style={[
                      styles.statsChartCard,
                      localStyles.majorSection,
                      { backgroundColor: colors.cardBackground, borderColor: colors.border },
                      !isPremium ? { borderWidth: 0 } : null,
                    ]}
                  >
                    <Text style={[styles.statsSectionLabel, { color: colors.secondaryText }]}>
                      {t('stats.distributionCategory')}
                    </Text>
                    <View style={styles.statsChartInner}>
                      <PieChart
                        data={groupStats.pieChartData}
                        donut
                        isAnimated
                        animationDuration={1000}
                        radius={statsPieRadius}
                        innerRadius={statsPieRadius * 0.56}
                        innerCircleColor={colors.cardBackground}
                        showText={false}
                        centerLabelComponent={() => (
                          <View style={styles.statsDonutCenter} pointerEvents="none">
                            <Text style={[styles.statsDonutCenterLabel, { color: colors.secondaryText }]}>
                              {t('stats.donutTotal')}
                            </Text>
                            <Text style={[styles.statsDonutCenterAmount, { color: colors.text }]}>
                              {formatAmount(groupStats.totalSpentStats, statsCurrency)}
                            </Text>
                          </View>
                        )}
                      />
                    </View>
                  </View>

                  <View style={localStyles.sectionSpacer} />

                  <View
                    style={[
                      styles.statsLegendCard,
                      localStyles.majorSection,
                      { backgroundColor: colors.cardBackground, borderColor: colors.border },
                      !isPremium ? { borderWidth: 0 } : null,
                    ]}
                  >
                    {groupStats.categoryRows.map((row: any) => (
                      <View key={row.key} style={styles.statsLegendRow}>
                        <View style={styles.statsLegendLeft}>
                          <View style={[styles.statsLegendDot, { backgroundColor: row.color }]} />
                          <Text style={[styles.statsLegendName, { color: colors.text }]} numberOfLines={1}>
                            {row.label}
                          </Text>
                        </View>
                        <Text style={[styles.statsLegendAmount, { color: colors.text }]}>
                          {formatAmount(row.amount, statsCurrency)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              <View style={localStyles.sectionSpacer} />

              <View
                style={[
                  styles.statsSectionCard,
                  localStyles.majorSection,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                  !isPremium ? { borderWidth: 0 } : null,
                ]}
              >
                <Text style={[styles.statsSectionTitle, { color: colors.text }]}>{t('stats.topPayersTitle')}</Text>
                <Text style={[styles.statsSectionSub, { color: colors.secondaryText }]}>{t('stats.topPayersSub')}</Text>
                {groupStats.topPayers.length === 0 ? (
                  <Text style={[styles.statsHighlightEmpty, { color: colors.secondaryText }]}>
                    {t('stats.topPayersEmpty')}
                  </Text>
                ) : (
                  groupStats.topPayers.map((p: any, idx: number) => {
                    const pct =
                      groupStats.topPayerMax > 0 ? Math.min(100, (p.amount / groupStats.topPayerMax) * 100) : 0;
                    return (
                      <View key={p.userId} style={styles.statsPayerRow}>
                        <View style={styles.statsPayerTopLine}>
                          <Text style={[styles.statsPayerRank, { color: colors.secondaryText }]}>{idx + 1}.</Text>
                          <Text style={[styles.statsPayerName, { color: colors.text }]} numberOfLines={1}>
                            {p.label}
                          </Text>
                          <Text style={[styles.statsPayerAmount, { color: colors.text }]}>
                            {formatAmount(p.amount, statsCurrency)}
                          </Text>
                        </View>
                        <View style={[styles.statsProgressTrack, { backgroundColor: colors.divider }]}>
                          <View
                            style={[
                              styles.statsProgressFill,
                              { width: `${pct}%`, backgroundColor: colors.accent },
                            ]}
                          />
                        </View>
                      </View>
                    );
                  })
                )}
              </View>

              <View style={localStyles.sectionSpacer} />

              <View
                style={[
                  styles.statsSectionCard,
                  localStyles.majorSection,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                  !isPremium ? { borderWidth: 0 } : null,
                ]}
              >
                <Text style={[styles.statsSectionTitle, { color: colors.text }]}>{t('stats.top3Title')}</Text>
                <Text style={[styles.statsSectionSub, { color: colors.secondaryText }]}>{t('stats.top3Sub')}</Text>
                {groupStats.topThreeExpenses.map((ex: any, idx: number) => (
                  <View
                    key={ex.id}
                    style={[
                      styles.statsTopExpenseRow,
                      idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider } : null,
                    ]}
                  >
                    <Text style={[styles.statsTopExpenseRank, { color: colors.secondaryText }]}>{idx + 1}</Text>
                    <View style={styles.statsTopExpenseBody}>
                      <Text style={[styles.statsTopExpenseTitle, { color: colors.text }]} numberOfLines={2}>
                        {ex.description}
                      </Text>
                      <Text style={[styles.statsTopExpenseAmount, { color: colors.text }]}>
                        {formatAmount(ex.amount, statsCurrency)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={localStyles.sectionSpacer} />

              <View style={[localStyles.exportSection, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
                <Text style={[localStyles.exportTitle, { color: colors.text }]}>{t('stats.exportSectionTitle')}</Text>

                <View style={localStyles.exportActionsRow}>
                  <TouchableOpacity
                    onPress={handleExportCSV}
                    activeOpacity={0.85}
                    style={[
                      localStyles.exportButton,
                      localStyles.exportButtonHalf,
                      { borderColor: '#1E3A8A', backgroundColor: '#1E3A8A' },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t('stats.a11yCsv')}
                  >
                    <Download size={18} color="#C7D2FE" strokeWidth={2.3} />
                    <Text style={[localStyles.exportButtonText, { color: '#E5E7EB' }]}>
                      {t('stats.exportCsv')}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleExportPDF}
                    activeOpacity={0.85}
                    style={[
                      localStyles.exportButton,
                      localStyles.exportButtonHalf,
                      { borderColor: '#166534', backgroundColor: '#166534' },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t('stats.a11yPdf')}
                  >
                    <FileText size={18} color="#BBF7D0" strokeWidth={2.3} />
                    <Text style={[localStyles.exportButtonText, { color: '#E5E7EB' }]}>
                      {t('stats.exportPdf')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
          </>
        </View>
      </ScrollView>

      {!isPremium && (
        <View style={styles.statsPaywallOverlay} pointerEvents="auto">
          <BlurView
            tint="dark"
            intensity={45}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFillObject}
          />
          <View
            style={[
              styles.statsPaywallDim,
              {
                backgroundColor: colorScheme === 'dark' ? 'rgba(0,0,0,0.30)' : 'rgba(0,0,0,0.22)',
              },
            ]}
            pointerEvents="none"
          />

          <View
            style={[
              styles.statsPaywallCard,
              {
                backgroundColor: 'rgba(26,26,26,0.9)',
                borderColor: 'rgba(255,255,255,0.15)',
                shadowColor: '#6366F1',
                shadowOffset: { width: 0, height: 12 },
                shadowOpacity: 0.24,
                shadowRadius: 24,
                elevation: 18,
              },
            ]}
          >
            <Lock size={64} color={ACCENT} strokeWidth={2.5} />
            <Text
              style={[
                styles.statsPaywallTitle,
                { color: '#fff' },
              ]}
            >
              {t('stats.paywallTitle')}
            </Text>
            <Text
              style={[
                styles.statsPaywallSubtitle,
                {
                  color: 'rgba(255,255,255,0.84)',
                },
              ]}
            >
              {t('stats.paywallSub')}
            </Text>

            <TouchableOpacity
              style={[styles.statsPaywallPrimaryBtn, { backgroundColor: ACCENT }]}
              onPress={() => router.push('/paywall' as never)}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={t('stats.paywallCtaA11y')}
            >
              <Text style={styles.statsPaywallPrimaryBtnText}>{t('stats.paywallCta')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );
}

export default memo(StatsTabImpl);

const localStyles = StyleSheet.create({
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  emptyStateCard: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
  },
  sectionSpacer: {
    height: SPACING,
  },
  majorSection: {
    marginBottom: SPACING,
  },
  exportSection: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    marginBottom: SPACING,
  },
  exportTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  exportActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  exportButton: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  exportButtonHalf: {
    flex: 1,
  },
  exportButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});

