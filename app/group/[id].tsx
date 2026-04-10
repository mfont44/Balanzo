import { ConfirmModal } from '@/components/ConfirmModal';
import { BalancesTab } from '@/components/group/BalancesTab';
import { ExpensesTab } from '@/components/group/ExpensesTab';
import GroupDetailSettingsModal from '@/components/group/GroupDetailSettingsModal';
import GroupDetailShareModal from '@/components/group/GroupDetailShareModal';
import { styles } from '@/components/group/groupDetailStyles';
import GroupDetailTourController from '@/components/group/GroupDetailTourController';
import StatsTab from '@/components/group/StatsTab';
import { usePremium } from '@/context/PremiumContext';
import { useThemeColors } from '@/hooks';
import type { ExpenseWithPayer, MemberBalance, Settlement } from '@/services/expenses';
import {
  fetchExpenseItems,
  fetchExpensesForGroup,
  fetchGroup,
  fetchGroupBalances,
  fetchGroupHasStaleParticipants,
} from '@/services/expenses';
import { addMemberToGroup, fetchGroups } from '@/services/groups';
import type { GroupMemberWithUser } from '@/services/groupService';
import { fetchGroupMembers, getMemberDisplayName } from '@/services/groupService';
import { supabase } from '@/services/supabase';
import { useAuthStore, useTourStore } from '@/store';
import { useTourProgressStore } from '@/store/useTourProgressStore';
import type { ExpenseItem, Group } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Lock, Plus, ScanLine, Settings } from 'lucide-react-native';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function getUsernameLabel(member: GroupMemberWithUser): string {
  const raw = (member.username ?? '').trim();
  if (raw) return raw.startsWith('@') ? raw : `@${raw}`;
  return getMemberDisplayName(member);
}

export default function GroupDetailScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const navigation = useNavigation();
  const router = useRouter();

  const { id, fromLink } = useLocalSearchParams<{ id: string; fromLink?: string }>();
  const groupId = id ?? '';

  const { user, profile, loadProfile } = useAuthStore();
  const { isPremium } = usePremium();

  const tourStep = useTourProgressStore((s) => s.step);
  const tourGroupId = useTourProgressStore((s) => s.groupId);
  const setTourStep = useTourProgressStore((s) => s.setStep);
  const hasSeenTour = useTourStore((s) => s.hasSeenTour);

  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<ExpenseWithPayer[]>([]);
  const [members, setMembers] = useState<GroupMemberWithUser[]>([]);
  const [balances, setBalances] = useState<MemberBalance[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [expenseItemsByExpenseId, setExpenseItemsByExpenseId] = useState<Record<string, ExpenseItem[]>>({});
  const [hasStaleParticipants, setHasStaleParticipants] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);

  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const [joinFromLinkConfirmVisible, setJoinFromLinkConfirmVisible] = useState(false);
  const [joinFromLinkLoading, setJoinFromLinkLoading] = useState(false);

  const { width: screenWidth } = useWindowDimensions();
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const tabScrollRef = useRef<ScrollView | null>(null);

  // Grand Tour targets (measured by GroupDetailTourController)
  const headerMenuRef = useRef<View | null>(null);
  const expensesTabRef = useRef<View | null>(null);
  const balancesTabRef = useRef<View | null>(null);
  const statsTabRef = useRef<View | null>(null);

  const addExpenseBtnRef = useRef<View | null>(null);
  const debtsListRef = useRef<View | null>(null);
  const historyBtnRef = useRef<View | null>(null);
  const shareRef = useRef<View | null>(null);

  const measureRefForCurrentStepImplRef = useRef<(() => void) | null>(null);
  const measureRefForCurrentStep = useCallback(() => {
    measureRefForCurrentStepImplRef.current?.();
  }, []);

  const showAlert = useCallback((title: string, message: string) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertVisible(true);
  }, []);

  useEffect(() => {
    if (user?.id && !profile) loadProfile(user.id);
  }, [loadProfile, profile, user?.id]);

  useEffect(() => {
    if (!groupId) return;
    const uid = user?.id ?? null;
    if (!uid) return;

    // Keep local/legacy behaviour compatible:
    // - old key: @has_seen_group_tour
    // - new key: tour_seen:${userId}
    let cancelled = false;
    const run = async () => {
      try {
        // If we already know it was seen, avoid unnecessary writes.
        if (hasSeenTour === true) return;
        const legacy = await AsyncStorage.getItem('@has_seen_group_tour');
        const legacySeen = legacy === '1' || legacy === 'true';

        const newKey = `tour_seen:${uid}`;
        const storeSeen = await AsyncStorage.getItem(newKey);
        const storeWasSeen = storeSeen === '1' || storeSeen === 'true';

        if (cancelled) return;
        if (!legacySeen && !storeWasSeen && tourStep === 'none') {
          setTourStep('group_share', { groupId });
        }
      } catch {
        // Ignore storage failures; never block UI.
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [groupId, setTourStep, tourStep, user?.id, hasSeenTour]);

  const load = useCallback(async () => {
    if (!groupId) return;

    try {
      const [g, ex, mems] = await Promise.all([
        fetchGroup(groupId),
        fetchExpensesForGroup(groupId),
        fetchGroupMembers(groupId),
      ]);

      setGroup(g ?? null);

      let expensesToUse = ex ?? [];
      let membersToUse = mems;

      let stale = false;
      if (membersToUse.length > 0) {
        stale = await fetchGroupHasStaleParticipants(groupId, membersToUse.map((m) => m.user_id));
      }

      setExpenses(expensesToUse);
      setMembers(membersToUse);
      setHasStaleParticipants(stale);

      const realEx = expensesToUse.filter((e) => !e.is_settlement);
      const itemMap: Record<string, ExpenseItem[]> = {};
      await Promise.all(
        realEx.map(async (e) => {
          const items = await fetchExpenseItems(e.id);
          if (items.length > 0) itemMap[e.id] = items;
        })
      );
      setExpenseItemsByExpenseId(itemMap);

      const memberWithNames = membersToUse.map((m) => ({
        user_id: m.user_id,
        full_name: getUsernameLabel(m),
      }));

      if (membersToUse.length > 0) {
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
      setExpenseItemsByExpenseId({});
      setHasStaleParticipants(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId, user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (!groupId) return;
      const loadTimeout = setTimeout(() => load(), 150);
      return () => clearTimeout(loadTimeout);
    }, [groupId, load])
  );

  const autoJoinFromLinkDone = useRef(false);
  useEffect(() => {
    if (fromLink !== '1' || !group || !user?.id || autoJoinFromLinkDone.current) return;

    const isMember = members.some((m) => m.user_id === user.id);
    if (isMember) {
      autoJoinFromLinkDone.current = true;
      return;
    }

    if (joinFromLinkConfirmVisible) return;

    (async () => {
      if (!isPremium) {
        try {
          const myGroups = await fetchGroups(user.id);
          if (myGroups.length >= 3) {
            Alert.alert(t('groups.limitReachedTitle'), t('groups.limitReachedMessage'), [
              {
                text: t('groups.seePremium'),
                onPress: () => router.push('/paywall' as never),
              },
            ]);
            autoJoinFromLinkDone.current = true;
            return;
          }
        } catch {
          // If the limit check fails, fall through to current behaviour.
        }
      }

      setJoinFromLinkConfirmVisible(true);
    })();
  }, [fromLink, group, groupId, load, members, user?.id, joinFromLinkConfirmVisible]);

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
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const clampTabIndex = (idx: number) => Math.max(0, Math.min(2, idx));

  const handleSelectTab = useCallback(
    (idx: number) => {
      const next = clampTabIndex(idx);
      setActiveTabIndex(next);
      tabScrollRef.current?.scrollTo({ x: screenWidth * next, y: 0, animated: true });
    },
    [screenWidth]
  );

  const handleTabMomentumEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const x = e.nativeEvent?.contentOffset?.x ?? 0;
      const idx = Math.round(x / screenWidth);
      setActiveTabIndex(clampTabIndex(idx));
    },
    [screenWidth]
  );

  // UX: if the Grand Tour ends (tourStep returns to 'none'), return the user to the main tab.
  const tourWasActiveRef = useRef(false);
  useEffect(() => {
    if (tourStep !== 'none' && tourStep?.startsWith('group_')) {
      tourWasActiveRef.current = true;
      return;
    }
    if (tourStep === 'none' && tourWasActiveRef.current) {
      tourWasActiveRef.current = false;
      handleSelectTab(0);
    }
  }, [handleSelectTab, tourStep]);

  const isCreator = !!(group && user?.id && group.created_by === user.id);

  const statsTabStyles = useMemo(() => {
    if (activeTabIndex !== 2) return styles;
    return {
      ...styles,
      statsTabContent: { ...styles.statsTabContent, paddingBottom: 40 },
    };
  }, [activeTabIndex]);

  useLayoutEffect(() => {
    const headerTitleText = group ? group.name : t('groupDetail.headerFallbackGroup');

    const resetTourDev = async () => {
      if (!__DEV__) return;
      try {
        await AsyncStorage.removeItem('@has_seen_group_tour');
        if (user?.id) await AsyncStorage.removeItem(`tour_seen:${user.id}`);
      } catch {
        // ignore
      }
           setTourStep('group_share', { groupId });
      // eslint-disable-next-line no-console
      console.log('Tutorial resetejat');
    };

    navigation.setOptions({
      headerTitle: () => (
        <TouchableOpacity
          activeOpacity={1}
          onLongPress={() => void resetTourDev()}
          style={{ paddingHorizontal: 8 }}
        >
          <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '600', color: colors.text }}>
            {headerTitleText}
          </Text>
        </TouchableOpacity>
      ),
      headerShown: true,
      headerStyle: { backgroundColor: colors.background },
      headerTintColor: colors.text,
      headerShadowVisible: false,
      headerTitleStyle: { fontSize: 17, fontWeight: '600', color: colors.text },
      headerRight: () => (
        <View
          ref={headerMenuRef}
          style={styles.headerRightRow}
          pointerEvents="box-none"
          onLayout={() => {
            if (tourStep === 'group_share' && tourGroupId === groupId) {
              measureRefForCurrentStep();
            }
          }}
        >
          <View
            ref={shareRef}
            collapsable={false}
          >
            <TouchableOpacity
              onPress={() => setShareModalVisible(true)}
              style={[styles.headerRightBtn, { backgroundColor: colors.cardBackground }]}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
              activeOpacity={0.7}
              accessible
              accessibilityRole="button"
              accessibilityLabel={t('groupDetail.shareA11y')}
            >
              <Ionicons name="share-social-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => setSettingsVisible(true)}
            style={[styles.headerRightBtn, { backgroundColor: colors.cardBackground }]}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            activeOpacity={0.7}
            accessible
            accessibilityRole="button"
            accessibilityLabel={t('groupDetail.settingsA11y')}
          >
            <Settings size={20} color={colors.text} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [
    colors.background,
    colors.cardBackground,
    colors.text,
    group,
    groupId,
    navigation,
    measureRefForCurrentStep,
    tourGroupId,
    tourStep,
    user?.id,
    setTourStep,
    t,
  ]);

  const inviteCodeRaw = (group?.invite_code?.trim() ?? '').toUpperCase();
  const inviteCodeDisplay = inviteCodeRaw || '—';

  if (!groupId) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.secondaryText }]}>{t('groupDetail.groupNotFound')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.inner}>
        <GroupDetailTourController
          groupId={groupId}
          headerMenuRef={headerMenuRef}
          expensesTabRef={expensesTabRef}
          balancesTabRef={balancesTabRef}
          statsTabRef={statsTabRef}
          addExpenseBtnRef={addExpenseBtnRef}
          debtsListRef={debtsListRef}
          historyBtnRef={historyBtnRef}
          measureRefForCurrentStepImplRef={measureRefForCurrentStepImplRef}
          onSelectTab={handleSelectTab}
        />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <>
          <View style={[styles.segmentedWrap, { backgroundColor: colors.background }]}>
            <View
              style={[
                styles.segmentedPill,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <TouchableOpacity
                  ref={expensesTabRef}
                  collapsable={false}
                  style={[styles.segmentBtn, activeTabIndex === 0 && styles.segmentBtnActive]}
                onPress={() => handleSelectTab(0)}
                activeOpacity={0.9}
              >
                <Text
                  style={[
                    styles.segmentText,
                    activeTabIndex === 0 ? styles.segmentTextActive : { color: colors.secondaryText },
                  ]}
                >
                  {t('groupDetail.tabExpenses')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                  ref={balancesTabRef}
                  collapsable={false}
                  style={[styles.segmentBtn, activeTabIndex === 1 && styles.segmentBtnActive]}
                onPress={() => handleSelectTab(1)}
                activeOpacity={0.9}
              >
                <Text
                  style={[
                    styles.segmentText,
                    activeTabIndex === 1 ? styles.segmentTextActive : { color: colors.secondaryText },
                  ]}
                >
                  {t('groupDetail.tabBalances')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                  ref={statsTabRef}
                  collapsable={false}
                  style={[styles.segmentBtn, activeTabIndex === 2 && styles.segmentBtnActive]}
                onPress={() => handleSelectTab(2)}
                activeOpacity={0.9}
              >
                <Text
                  style={[
                    styles.segmentText,
                    activeTabIndex === 2 ? styles.segmentTextActive : { color: colors.secondaryText },
                  ]}
                >
                  {t('groupDetail.tabStats')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            ref={tabScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.tabHorizontal}
            contentContainerStyle={{ flexGrow: 1 }}
            onMomentumScrollEnd={handleTabMomentumEnd}
            scrollEventThrottle={16}
          >
            <View style={{ width: screenWidth }}>
                <ExpensesTab
                  groupId={groupId}
                  currency={group?.currency ?? 'EUR'}
                  currentUserId={user?.id}
                  isCreator={isCreator}
                  hasStaleParticipants={hasStaleParticipants}
                  expenses={expenses}
                  expenseItemsByExpenseId={expenseItemsByExpenseId}
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                  onReload={load}
                  onShowAlert={showAlert}
                  styles={styles}
                />
            </View>

            <View style={{ width: screenWidth }}>
                <BalancesTab
                  groupId={groupId}
                  currency={group?.currency ?? 'EUR'}
                  currentUserId={user?.id}
                  members={members}
                  expenses={expenses}
                  settlements={settlements}
                  measureRefForCurrentStep={measureRefForCurrentStep}
                  tourStep={tourStep}
                  tourGroupId={tourGroupId}
                  groupIdForTour={groupId}
                  debtsListRef={debtsListRef}
                  historyBtnRef={historyBtnRef}
                  onReload={load}
                  onShowAlert={showAlert}
                  styles={styles}
                />
                    </View>

              <View style={{ width: screenWidth, flex: 1, position: 'relative' }}>
                <StatsTab
                  expenses={expenses}
                  members={members}
                  currency={group?.currency ?? 'EUR'}
                  currentUserId={user?.id}
                  groupName={group?.name}
                  styles={statsTabStyles}
                />
            </View>
          </ScrollView>
        </>
      )}

        {activeTabIndex !== 2 && (
      <View
            ref={addExpenseBtnRef}
        collapsable={false}
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom > 0 ? insets.bottom : 20,
            paddingTop: 12,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.bottomBtn,
            { backgroundColor: colors.buttonSecondaryBg, borderColor: colors.border },
          ]}
          onPress={() =>
            router.push({ pathname: '/add-expense', params: { groupId } } as never)
          }
        >
          <Plus size={18} color={colors.text} strokeWidth={2.5} />
          <Text style={[styles.bottomBtnText, { color: colors.text }]}>{t('groupDetail.bottomManual')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.bottomBtn,
            { backgroundColor: colors.accent, borderColor: colors.accent },
          ]}
          onPress={() => {
            if (!isPremium) {
              router.push('/paywall' as never);
              return;
            }
            router.push({ pathname: '/scan-receipt', params: { groupId } } as never);
          }}
        >
          {!isPremium ? (
            <Lock size={18} color="#fff" strokeWidth={2} />
          ) : (
            <ScanLine size={18} color="#fff" strokeWidth={2} />
          )}
              <Text style={[styles.bottomBtnText, { color: '#fff' }]}>{t('groupDetail.bottomScanAI')}</Text>
        </TouchableOpacity>
      </View>
        )}

        <GroupDetailSettingsModal
        visible={settingsVisible}
          onClose={() => setSettingsVisible(false)}
          groupId={groupId}
          isCreator={isCreator}
          currentUserId={user?.id}
          membersCount={members.length}
          onShowAlert={showAlert}
        />

        <GroupDetailShareModal
        visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          inviteCodeRaw={inviteCodeRaw}
          inviteCodeDisplay={inviteCodeDisplay}
          onShowAlert={showAlert}
        />

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

      <ConfirmModal
        visible={joinFromLinkConfirmVisible}
        title="Vols unir-te al grup?"
        message="Aquesta acció unirà el teu usuari al grup."
        confirmLabel={t('joinGroup.joinButton')}
        onCancel={() => {
          autoJoinFromLinkDone.current = true;
          setJoinFromLinkConfirmVisible(false);
          setJoinFromLinkLoading(false);
        }}
        onConfirm={async () => {
          setJoinFromLinkLoading(true);
          autoJoinFromLinkDone.current = true;
          setJoinFromLinkConfirmVisible(false);
          try {
            await addMemberToGroup(groupId, user.id);
            load();
          } finally {
            setJoinFromLinkLoading(false);
          }
        }}
        loading={joinFromLinkLoading}
        destructive={false}
      />
      </View>
    </View>
  );
}

