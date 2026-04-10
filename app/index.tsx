import { useThemeColors } from '@/hooks';
import Avatar from '@/components/Avatar';
import { fetchUnsettledExpenseTotalsByGroupIds } from '@/services/expenses';
import type { GroupWithMemberCount } from '@/services/groups';
import { fetchGroups } from '@/services/groups';
import { getProfile, isProfileComplete } from '@/services/profile';
import { getDisplayName, useAuthStore } from '@/store';
import { useTourOverlayStore } from '@/store/useTourOverlayStore';
import { useTourProgressStore } from '@/store/useTourProgressStore';
import { useTourStore } from '@/store/useTourStore';
import { ACCENT } from '@/theme/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, UsersRound } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    ActivityIndicator,
    FlatList,
    InteractionManager,
    Keyboard,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import type { TargetLayout } from '../src/components/TutorialOverlay';

/** Highlight padding: -4 on x/y, +8 on width/height so the frame breathes. */
const HIGHLIGHT_PAD_X = 6;
const HIGHLIGHT_PAD_WH = 10;

/** Once true (AsyncStorage), never show the Grand Tour (Home) prompt or overlays again. */
const getGroupTutorialStorageKey = (userId: string) => `@has_seen_home_tour:${userId}`;
/** Transient key: user completed "create group" step and must continue with first group card step. */
const getPendingGroupCardKey = (userId: string) => `@home_tour_pending_group_card:${userId}`;

type GroupListItem = GroupWithMemberCount & { unsettled_expenses_total: number };

function formatDashboardUnsettledAmount(amount: number, currency: string, language: string | undefined) {
  const base = (language ?? 'en').split(/[-_]/)[0]?.toLowerCase() ?? 'en';
  const loc = base === 'ca' ? 'ca-ES' : base === 'es' ? 'es-ES' : 'en-GB';
  const n = Math.round(amount * 100) / 100;
  return `${n.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function DashboardScreen() {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, profile, loadProfile } = useAuthStore();
  const markTourSeen = useTourStore((s) => s.markSeen);
  const resetTourStore = useTourStore((s) => s.reset);
  const showTourOverlay = useTourOverlayStore((s) => s.show);
  const hideTourOverlay = useTourOverlayStore((s) => s.hide);
  const setTourStep = useTourProgressStore((s) => s.setStep);
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Gate: only show tour after root layout is measured (avoids iOS Modal crash). */
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  /** true = profile passed isProfileComplete (onboarding done); false or null = no tutorial until then */
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  /** 'create' = no groups, show create CTA; 'group_card' = has groups, show tooltip on first card; null = done or skipped */
  const [tutorialStage, setTutorialStage] = useState<'create' | 'group_card' | null>(null);
  const [homeTourMode, setHomeTourMode] = useState<'empty' | 'populated' | null>(null);
  const [tutorialTargetLayout, setTutorialTargetLayout] = useState<TargetLayout | null>(null);
  /** null = storage not read yet; false = may show tutorial; true = never show again */
  const [hasSeenGroupTutorial, setHasSeenGroupTutorial] = useState<boolean | null>(null);
  const firstCardRef = useRef<View>(null);
  const createGroupBtnRef = useRef<View>(null);

  useEffect(() => {
    if (user?.id && !profile) loadProfile(user.id);
  }, [user?.id, profile, loadProfile]);

  const displayName = getDisplayName(profile, user?.email);

  const loadGroups = useCallback(async () => {
    if (!user?.id) {
      setGroups([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const list = await fetchGroups(user.id);
      if (list.length === 0) {
        setGroups([]);
        return;
      }
      let totals: Record<string, number> = {};
      try {
        totals = await fetchUnsettledExpenseTotalsByGroupIds(list.map((g) => g.id));
      } catch {
        totals = {};
      }
      setGroups(
        list.map((g) => ({
          ...g,
          unsettled_expenses_total: totals[g.id] ?? 0,
        }))
      );
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadGroups();
  }, [user?.id, loadGroups]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id && !loading) loadGroups();
    }, [user?.id, loadGroups, loading])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadGroups();
  };

  // Resolve onboarding status with full profile so we never show tutorial before complete-profile is done.
  useEffect(() => {
    if (!user?.id || !profile) {
      setOnboardingComplete(null);
      return;
    }
    let cancelled = false;
    getProfile(user.id).then((fullProfile) => {
      if (!cancelled) setOnboardingComplete(isProfileComplete(fullProfile));
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, profile]);

  // Load @has_seen_home_tour once per logged-in user.
  useEffect(() => {
    if (!user?.id) {
      setHasSeenGroupTutorial(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const v = await AsyncStorage.getItem(getGroupTutorialStorageKey(user.id));
        if (cancelled) return;
        setHasSeenGroupTutorial(v === 'true');
      } catch {
        if (!cancelled) setHasSeenGroupTutorial(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // After flag is saved, only dismiss the "create group" overlay — never tear down an active group_card tour.
  useEffect(() => {
    if (hasSeenGroupTutorial !== true) return;
    setTutorialStage((prev) => (prev === 'create' ? null : prev));
  }, [hasSeenGroupTutorial]);

  // Leaving empty state: drop create-stage spotlight so the 1-group prompt can run cleanly.
  useEffect(() => {
    if (groups.length !== 0) {
      setTutorialStage((s) => (s === 'create' ? null : s));
    }
  }, [groups.length]);

  // Resume phase 2 when coming back from "create group" and first group is now available.
  // This fixes the race where focus-check runs before groups refresh completes.
  useEffect(() => {
    if (!user?.id) return;
    if (!profile || onboardingComplete !== true) return;
    if (!isLayoutReady) return;
    if (loading) return;
    if (groups.length === 0) return;
    if (tutorialStage === 'group_card') return;
    if (hasSeenGroupTutorial === true) return;

    let cancelled = false;
    void (async () => {
      try {
        const pending = await AsyncStorage.getItem(getPendingGroupCardKey(user.id));
        if (cancelled) return;
        const shouldResume = pending === 'true' || pending === '1';
        if (!shouldResume) return;

        setHomeTourMode('populated');
        setTourStep('dashboard_open_first_group');
        setTutorialStage('group_card');
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    profile,
    onboardingComplete,
    isLayoutReady,
    loading,
    groups.length,
    tutorialStage,
    hasSeenGroupTutorial,
    setTourStep,
  ]);

  // Re-check tour trigger every time Home gains focus.
  // Expo Router keeps tabs mounted in memory, so focus is the reliable trigger.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      // Strict timing guard: wait exactly 500ms so UI/refs are mounted.
      const timeoutId = setTimeout(async () => {
        if (!user?.id) return;
        if (!profile || onboardingComplete !== true) return;
        if (!isLayoutReady) return;
        if (loading) return;
        if (tutorialStage !== null) return; // don't override an active stage

        try {
          const v = await AsyncStorage.getItem(getGroupTutorialStorageKey(user.id));
          if (cancelled) return;
          const seen = v === 'true' || v === '1';
          setHasSeenGroupTutorial(seen);
          if (seen) return;
        } catch {
          if (cancelled) return;
          setHasSeenGroupTutorial(false);
        }

        if (cancelled) return;
        let pendingGroupCard = false;
        try {
          const p = await AsyncStorage.getItem(getPendingGroupCardKey(user.id));
          pendingGroupCard = p === 'true' || p === '1';
        } catch {
          pendingGroupCard = false;
        }

        if (groups.length > 0 && pendingGroupCard) {
          setHomeTourMode('populated');
          setTourStep('dashboard_open_first_group');
          setTutorialStage('group_card');
          return;
        }

        setHomeTourMode(groups.length === 0 ? 'empty' : 'populated');
        setTourStep('dashboard_create');
        setTutorialStage('create');
      }, 500);

      return () => {
        cancelled = true;
        clearTimeout(timeoutId);
      };
    }, [
      user?.id,
      profile,
      onboardingComplete,
      isLayoutReady,
      loading,
      groups.length,
      homeTourMode,
      tutorialStage,
      setTourStep,
    ])
  );

  useEffect(() => {
    if (tutorialStage !== null) Keyboard.dismiss();
  }, [tutorialStage]);

  const handleFirstCardLayout = useCallback(() => {
    if (tutorialStage !== 'group_card' || groups.length === 0) return;
    firstCardRef.current?.measure((_x, _y, w, h, pageX, pageY) => {
      if (w <= 0 || h <= 0) return;
      setTutorialTargetLayout({
        x: pageX - HIGHLIGHT_PAD_X,
        y: pageY - HIGHLIGHT_PAD_X,
        width: w + HIGHLIGHT_PAD_WH,
        height: h + HIGHLIGHT_PAD_WH,
      });
    });
  }, [tutorialStage, groups.length]);

  const handleCreateButtonLayout = useCallback(() => {
    if (tutorialStage !== 'create') return;
    createGroupBtnRef.current?.measure((_x, _y, w, h, pageX, pageY) => {
      if (w <= 0 || h <= 0) return;
      setTutorialTargetLayout({
        x: pageX - HIGHLIGHT_PAD_X,
        y: pageY - HIGHLIGHT_PAD_X,
        width: w + HIGHLIGHT_PAD_WH,
        height: h + HIGHLIGHT_PAD_WH,
      });
    });
  }, [tutorialStage]);

  useEffect(() => {
    if (tutorialStage === 'group_card' && groups.length > 0) {
      const raf = requestAnimationFrame(() => handleFirstCardLayout());
      return () => cancelAnimationFrame(raf);
    }
    if (tutorialStage === 'create') {
      const task = InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(() => handleCreateButtonLayout());
      });
      return () => task.cancel();
    }

    setTutorialTargetLayout(null);
    return undefined;
  }, [tutorialStage, groups.length, handleFirstCardLayout, handleCreateButtonLayout]);

  const handleSkipTour = useCallback(async () => {
    setTutorialStage(null);
    hideTourOverlay();
    setTutorialTargetLayout(null);
    setHasSeenGroupTutorial(true);
    if (!user?.id) return;
    try {
      await AsyncStorage.setItem(getGroupTutorialStorageKey(user.id), 'true');
    } catch {
      // ignore
    }
    try {
      await markTourSeen(user.id);
      await loadProfile(user.id);
    } catch {
      await loadProfile(user.id);
    }
  }, [hideTourOverlay, user?.id, loadProfile, markTourSeen]);

  const completeHomeTourNow = useCallback(async () => {
    setTutorialStage(null);
    setHomeTourMode(null);
    hideTourOverlay();
    setTutorialTargetLayout(null);
    setHasSeenGroupTutorial(true);
    resetTourStore();
    if (user?.id) {
      try {
        await AsyncStorage.setItem(getGroupTutorialStorageKey(user.id), 'true');
        await AsyncStorage.removeItem(getPendingGroupCardKey(user.id));
      } catch {
        // ignore
      }
      try {
        await markTourSeen(user.id);
      } catch {
        // ignore
      }
    }
  }, [hideTourOverlay, markTourSeen, resetTourStore, user?.id]);

  const handleTourFailToMount = useCallback(() => {
    void completeHomeTourNow();
    if (user?.id) {
      loadProfile(user.id);
    }
  }, [completeHomeTourNow, user?.id, loadProfile]);

  const resetHomeTourDev = useCallback(async () => {
    if (!__DEV__) return;
    if (!user?.id) return;
    try {
      await AsyncStorage.removeItem(getGroupTutorialStorageKey(user.id));
      await AsyncStorage.removeItem(getPendingGroupCardKey(user.id));
    } catch {
      // ignore
    }
    hideTourOverlay();
    setTutorialTargetLayout(null);
    resetTourStore();
    setHasSeenGroupTutorial(false);
    setHomeTourMode(groups.length === 0 ? 'empty' : 'populated');
    setTourStep(groups.length === 0 ? 'dashboard_create' : 'dashboard_open_first_group');
    setTutorialStage(groups.length === 0 ? 'create' : 'group_card');
  }, [groups.length, hideTourOverlay, resetTourStore, setTourStep, user?.id]);

  const handleCreateGroupPress = useCallback(async () => {
    const uid = user?.id;
    // If user is in step 1 (create) with no groups yet, continue tour later with group-card step.
    if (tutorialStage === 'create' && groups.length === 0) {
      setTutorialStage(null);
      hideTourOverlay();
      setTutorialTargetLayout(null);
      setHomeTourMode('populated');
      setTourStep('dashboard_open_first_group');
      if (uid) {
        try {
          await AsyncStorage.setItem(getPendingGroupCardKey(uid), 'true');
        } catch {
          // ignore
        }
      }
      router.push('/create-group' as never);
      return;
    }

    await completeHomeTourNow();
    router.push('/create-group' as never);
  }, [completeHomeTourNow, groups.length, hideTourOverlay, router, setTourStep, tutorialStage, user?.id]);

  const handleOpenGroupPress = useCallback(
    (groupId: string) => {
      if (tutorialStage === 'group_card' || hasSeenGroupTutorial === false) {
        void completeHomeTourNow();
      }
      router.push(`/group/${groupId}`);
    },
    [completeHomeTourNow, hasSeenGroupTutorial, router, tutorialStage]
  );

  // Render tour via root TourHost (never inside screens).
  useEffect(() => {
    if (!user?.id) {
      hideTourOverlay();
      return;
    }
    if (tutorialStage === null) {
      hideTourOverlay();
      return;
    }

    if (tutorialStage === 'create') {
      showTourOverlay({
        visible: true,
        title: t('dashboard.tourCreateTitle'),
        message: t('dashboard.tourCreateMessage'),
        buttonLabel: t('dashboard.tourCreatePrimary'),
        targetLayout: tutorialTargetLayout ?? null,
        secondaryButton: { label: t('dashboard.tourCreateLater'), onPress: handleSkipTour },
        onFailToMount: handleTourFailToMount,
        onNext: () => {
          if (homeTourMode === 'populated' && groups.length > 0) {
            setTourStep('dashboard_open_first_group');
            setTutorialStage('group_card');
            return;
          }
          // Empty-state phase 1: go create a group, then continue with group-card step.
          setTutorialStage(null);
          hideTourOverlay();
          setTutorialTargetLayout(null);
          setHomeTourMode('populated');
          setTourStep('dashboard_open_first_group');
          void AsyncStorage.setItem(getPendingGroupCardKey(user.id), 'true');
          router.push('/create-group' as never);
        },
      });
      return;
    }

    // group_card
    showTourOverlay({
      visible: true,
      title: t('dashboard.tourGroupCardTitle'),
      message: t('dashboard.tourGroupCardMessage'),
      buttonLabel: t('dashboard.tourGroupCardContinue'),
      targetLayout: tutorialTargetLayout ?? undefined,
      onFailToMount: handleTourFailToMount,
      onNext: () => {
        void completeHomeTourNow();
        const firstGroup = groups[0];
        if (!firstGroup) return;
        // Phase 2 (Grand Tour): start in-group tour at Step 1 (header menu).
        setTourStep('group_share', { groupId: firstGroup.id });
        InteractionManager.runAfterInteractions(() => {
          setTimeout(() => router.push(`/group/${firstGroup.id}` as never), 0);
        });
      },
    });
  }, [
    user?.id,
    tutorialStage,
    tutorialTargetLayout,
    groups,
    homeTourMode,
    showTourOverlay,
    hideTourOverlay,
    handleSkipTour,
    completeHomeTourNow,
    handleTourFailToMount,
    router,
    setTourStep,
    t,
  ]);

  // Safety net: always hide Home overlay when screen loses focus/unmounts.
  useFocusEffect(
    useCallback(() => {
      return () => {
        hideTourOverlay();
      };
    }, [hideTourOverlay])
  );

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
      onLayout={() => setIsLayoutReady(true)}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text
            style={[styles.greeting, { color: colors.text }]}
            onLongPress={() => void resetHomeTourDev()}
          >
            {t('dashboard.greeting', { name: displayName })}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.profileBtn}
          onPress={() => router.push('/profile' as never)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Avatar
            avatarUrl={profile?.avatar_url ?? null}
            label={displayName}
            size={40}
            backgroundColor={colors.card}
            borderColor={colors.border}
            textColor={colors.text}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {!loading && groups.length > 0 && (
          <View style={styles.groupsTitleWrap}>
            <Text style={[styles.groupsTitle, { color: colors.text }]}>{t('groups.title')}</Text>
          </View>
        )}
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.empty}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <UsersRound size={64} color={colors.accent} strokeWidth={1.5} />
            </View>
            <Text style={[styles.emptyText, { color: colors.text }]}>{t('dashboard.emptyTitle')}</Text>
            <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
              {t('dashboard.emptySubtitle')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={groups}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.accent}
              />
            }
            renderItem={({ item, index }) => (
              <View style={styles.cardWrapper}>
                <View
                  ref={index === 0 ? firstCardRef : undefined}
                  collapsable={false}
                  onLayout={index === 0 ? handleFirstCardLayout : undefined}
                  style={{ alignSelf: 'stretch' }}
                >
                  <TouchableOpacity
                  style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => handleOpenGroupPress(item.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.cardLeft}>
                    <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.cardMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {t('dashboard.members', { count: item.member_count })} ·{' '}
                      {formatDashboardUnsettledAmount(item.unsettled_expenses_total, item.currency, i18n.language)}
                    </Text>
                  </View>
                  <ChevronRight size={22} color={colors.textSecondary} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}
      </View>

      {/* App-wide bottom actions (kept consistent with in-group bottom bar) */}
      <View
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
        <View
          ref={createGroupBtnRef}
          collapsable={false}
          style={{ flex: 1 }}
          onLayout={() => {
            if (tutorialStage === 'create') handleCreateButtonLayout();
          }}
        >
          <TouchableOpacity
            style={[styles.bottomBtn, styles.bottomBtnAccent]}
            onPress={handleCreateGroupPress}
            activeOpacity={0.85}
          >
            <Text style={[styles.bottomBtnText, styles.bottomBtnTextDark]}>{t('dashboard.createNewGroup')}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[
            styles.bottomBtn,
            { backgroundColor: colors.buttonSecondaryBg, borderColor: colors.border },
          ]}
          onPress={() => router.push('/join-group' as never)}
          activeOpacity={0.85}
        >
          <Text style={[styles.bottomBtnText, { color: colors.accent }]}>{t('dashboard.joinGroup')}</Text>
        </TouchableOpacity>
      </View>

      {/* Tour is rendered at root via `src/tour/TourHost.tsx` */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  greeting: {
    fontSize: 18,
    fontWeight: '700',
  },
  email: {
    fontSize: 12,
    marginTop: 2,
  },
  profileBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 10,
  },
  primaryActionBtn: {
    flex: 1,
    backgroundColor: ACCENT,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryActionBtn: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  groupsTitleWrap: {
    marginBottom: 14,
    marginTop: 8,
  },
  groupsTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 140,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 140,
  },
  emptyIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtext: {
    fontSize: 13,
    marginBottom: 24,
    textAlign: 'center',
  },
  createFirstBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    minWidth: 180,
    alignItems: 'center',
  },
  createFirstText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  listContent: {
    paddingBottom: 140,
  },
  cardWrapper: {
    marginBottom: 14,
    position: 'relative',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 20,
    minHeight: 96,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  cardLeft: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 26,
  },
  cardMeta: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    padding: 12,
    paddingBottom: 24,
    gap: 12,
    borderTopWidth: 1,
  },
  bottomBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 2,
  },
  bottomBtnAccent: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  bottomBtnText: { fontSize: 16, fontWeight: '600' },
  bottomBtnTextDark: { color: '#fff' },
});
