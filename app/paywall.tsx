import { usePremium } from '@/context/PremiumContext';
import { useThemeColors } from '@/hooks';
import { usePostHog } from 'posthog-react-native';
import { ACCENT } from '@/theme/colors';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageSourcePropType } from 'react-native';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import Purchases, { PACKAGE_TYPE } from 'react-native-purchases';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FALLBACK_PRICE_MONTH = '2,99 €';
const FALLBACK_PRICE_YEAR = '29,99 €';

type StorySlide = {
  id: string;
  placeholderText: string;
  title: string;
  subtitle: string;
  color: string;
  imageSource?: ImageSourcePropType;
};

const STORY_DURATION_MS = 15000;
const STORY_SLIDE_COUNT = 4;
/** Franges negres verticals (fora de la zona de color de cada història). */
const STORY_BLACK_STRIP = 56;

function hasIntroductoryOffer(pkg: PurchasesPackage | null): boolean {
  if (!pkg?.product) return false;
  const intro = (pkg.product as { introPrice?: { periodNumberOfUnits?: number; periodUnit?: string } | null }).introPrice;
  if (!intro) return false;
  const unit = (intro as { periodUnit?: string }).periodUnit ?? '';
  const num = (intro as { periodNumberOfUnits?: number }).periodNumberOfUnits ?? 0;
  return unit.toUpperCase() === 'DAY' && num >= 7;
}

export default function PaywallScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  /** Full window (same values as Dimensions.get('window')); updates on rotation. */
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const posthog = usePostHog();
  const { purchasePackage, refreshPremiumStatus } = usePremium();

  const storySlides = useMemo(
    (): StorySlide[] => [
      {
        id: 'slide-1',
        placeholderText: t('paywall.story1Short'),
        title: t('paywall.story1Title'),
        subtitle: t('paywall.story1Subtitle'),
        color: '#8B5CF6',
        imageSource: require('../assets/images/paywall/Icones-scan-IA.png'),
      },
      {
        id: 'slide-2',
        placeholderText: t('paywall.story2Short'),
        title: t('paywall.story2Title'),
        subtitle: t('paywall.story2Subtitle'),
        color: '#06B6D4',
        imageSource: require('../assets/images/paywall/Icones-unlimited-groups.png'),
      },
      {
        id: 'slide-3',
        placeholderText: t('paywall.story3Short'),
        title: t('paywall.story3Title'),
        subtitle: t('paywall.story3Subtitle'),
        color: '#22C55E',
        imageSource: require('../assets/images/paywall/Icones-statistics.png'),
      },
      {
        id: 'slide-4',
        placeholderText: t('paywall.story4Short'),
        title: t('paywall.story4Title'),
        subtitle: t('paywall.story4Subtitle'),
        color: '#6366F1',
        imageSource: require('../assets/images/paywall/Icones-cloud.png'),
      },
    ],
    [t]
  );

  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [annualPackage, setAnnualPackage] = useState<PurchasesPackage | null>(null);
  const [monthlyPackage, setMonthlyPackage] = useState<PurchasesPackage | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<'annual' | 'monthly'>('annual');
  const [showCheckout, setShowCheckout] = useState(false);
  const checkoutOpacity = useRef(new Animated.Value(0)).current;
  const closeButton = (
    <TouchableOpacity
      style={[
        styles.topRightCloseBtn,
        { backgroundColor: colors.card, borderColor: colors.border },
        !showCheckout ? { top: insets.top + 10, zIndex: 55 } : null,
      ]}
      onPress={() => router.back()}
      hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
      accessibilityRole="button"
      accessibilityLabel={t('paywall.closeA11y')}
    >
      <X size={22} color={colors.text} strokeWidth={2.2} />
    </TouchableOpacity>
  );

  // --- Instagram-stories style feature slider ---
  const scrollRef = useRef<ScrollView | null>(null);
  const [sliderWidth, setSliderWidth] = useState(0);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const activeStoryIndexRef = useRef(0);

  const pausedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTsRef = useRef(0);
  const elapsedRef = useRef(0);
  const [storyProgress, setStoryProgress] = useState<number[]>(() => Array(STORY_SLIDE_COUNT).fill(0));

  useEffect(() => {
    activeStoryIndexRef.current = activeStoryIndex;
  }, [activeStoryIndex]);

  const clearStoryTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  function scrollToStoryIndex(index: number) {
    if (!scrollRef.current || sliderWidth <= 0) return;
    scrollRef.current.scrollTo({ x: sliderWidth * index, y: 0, animated: true });
  }

  function goToStoryIndex(index: number, resetProgress: boolean) {
    const clamped = Math.max(0, Math.min(STORY_SLIDE_COUNT - 1, index));
    activeStoryIndexRef.current = clamped;
    setActiveStoryIndex(clamped);

    if (resetProgress) {
      elapsedRef.current = 0;
      setStoryProgress(storySlides.map((_, idx) => (idx < clamped ? 1 : 0)));
    }

    scrollToStoryIndex(clamped);

    // Only restart autoplay if the user isn't holding to pause.
    if (resetProgress && !pausedRef.current) {
      startStoryTimer();
    }
  }

  const goToCheckout = useCallback(() => {
    clearStoryTimer();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowCheckout(true);
  }, []);

  function startStoryTimer() {
    clearStoryTimer();
    startTsRef.current = Date.now();
    const currentIndex = activeStoryIndexRef.current;

    intervalRef.current = setInterval(() => {
      const elapsed = elapsedRef.current + (Date.now() - startTsRef.current);
      const p = Math.min(1, elapsed / STORY_DURATION_MS);

      setStoryProgress((prev) => {
        const next = [...prev];
        next[currentIndex] = p;
        return next;
      });

      if (p >= 1) {
        clearStoryTimer();
        elapsedRef.current = 0;

        const nextIndex = currentIndex + 1;
        if (nextIndex < STORY_SLIDE_COUNT) {
          pausedRef.current = false;
          goToStoryIndex(nextIndex, true);
        } else {
          setStoryProgress((prev) => {
            const next = [...prev];
            next[currentIndex] = 1;
            return next;
          });
          goToCheckout();
        }
      }
    }, 50);
  }

  const pauseStoryTimer = () => {
    if (pausedRef.current) return;
    if (!intervalRef.current) return;
    pausedRef.current = true;
    clearStoryTimer();

    const elapsed = elapsedRef.current + (Date.now() - startTsRef.current);
    elapsedRef.current = elapsed;

    const currentIndex = activeStoryIndexRef.current;
    const p = Math.min(1, elapsed / STORY_DURATION_MS);
    setStoryProgress((prev) => {
      const next = [...prev];
      next[currentIndex] = p;
      return next;
    });
  };

  const resumeStoryTimer = () => {
    if (!pausedRef.current) return;
    if (sliderWidth <= 0) return;
    pausedRef.current = false;
    startStoryTimer();
  };

  useEffect(() => {
    if (showCheckout) return;
    if (winW > 0) setSliderWidth(winW);
  }, [showCheckout, winW]);

  useEffect(() => {
    if (sliderWidth <= 0 || showCheckout) return;

    pausedRef.current = false;
    elapsedRef.current = 0;
    activeStoryIndexRef.current = 0;
    setActiveStoryIndex(0);
    setStoryProgress(Array(STORY_SLIDE_COUNT).fill(0));

    scrollToStoryIndex(0);
    startStoryTimer();

    return () => clearStoryTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderWidth, showCheckout]);

  useEffect(() => {
    if (!showCheckout) {
      checkoutOpacity.setValue(0);
      return;
    }
    Animated.timing(checkoutOpacity, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [showCheckout, checkoutOpacity]);

  const handleStoryPress = (e: unknown) => {
    if (sliderWidth <= 0) return;
    const touch = e as { nativeEvent?: { locationX?: number } };
    const x = touch?.nativeEvent?.locationX ?? 0;
    const left = x < sliderWidth / 2;

    const currentIndex = activeStoryIndexRef.current;
    if (left) {
      if (currentIndex > 0) goToStoryIndex(currentIndex - 1, true);
      return;
    }

    if (currentIndex === STORY_SLIDE_COUNT - 1) {
      setStoryProgress((prev) => {
        const next = [...prev];
        next[currentIndex] = 1;
        return next;
      });
      goToCheckout();
      return;
    }

    goToStoryIndex(currentIndex + 1, true);
  };

  useEffect(() => {
    void refreshPremiumStatus();
  }, [refreshPremiumStatus]);

  useEffect(() => {
    if (!loading) {
      posthog.capture('paywall_viewed');
    }
  }, [loading, posthog]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const offerings = await Purchases.getOfferings();
        if (!mounted) return;
        const current = offerings?.current ?? null;
        if (!current) {
          if (mounted) {
            setAnnualPackage(null);
            setMonthlyPackage(null);
          }
          return;
        }
        const annual = current.annual ?? current.availablePackages?.find((p) => p.packageType === PACKAGE_TYPE.ANNUAL) ?? null;
        const monthly = current.monthly ?? current.availablePackages?.find((p) => p.packageType === PACKAGE_TYPE.MONTHLY) ?? null;
        if (mounted) {
          setAnnualPackage(annual ?? null);
          setMonthlyPackage(monthly ?? null);
        }
      } catch (e) {
        if (mounted) {
          setAnnualPackage(null);
          setMonthlyPackage(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedPackage = selectedPlan === 'annual' ? annualPackage : monthlyPackage;

  const annualPriceString = useMemo(() => {
    const s = annualPackage?.product?.priceString;
    return typeof s === 'string' && s.trim().length > 0 ? s.trim() : FALLBACK_PRICE_YEAR;
  }, [annualPackage]);

  const annualMonthlyEquivalent = useMemo(() => {
    const s = (annualPackage?.product as { pricePerMonthString?: string } | undefined)?.pricePerMonthString;
    return typeof s === 'string' && s.trim().length > 0 ? s.trim() : null;
  }, [annualPackage]);

  const monthlyPriceString = useMemo(() => {
    const s = monthlyPackage?.product?.priceString;
    return typeof s === 'string' && s.trim().length > 0 ? s.trim() : FALLBACK_PRICE_MONTH;
  }, [monthlyPackage]);

  const savingsPercent = useMemo(() => {
    if (!annualPackage?.product || !monthlyPackage?.product) return 45;
    const annualPrice = (annualPackage.product as { price?: number }).price ?? 29.99;
    const monthlyPrice = (monthlyPackage.product as { price?: number }).price ?? 2.99;
    if (monthlyPrice <= 0) return 45;
    const fullYearMonthly = monthlyPrice * 12;
    const pct = Math.round((1 - annualPrice / fullYearMonthly) * 100);
    return Math.max(0, Math.min(99, pct));
  }, [annualPackage, monthlyPackage]);

  const hasTrial = useMemo(
    () => hasIntroductoryOffer(annualPackage) || Boolean(annualPackage),
    [annualPackage]
  );

  const ctaLabel = useMemo(() => {
    if (selectedPlan === 'annual') return t('paywall.ctaStartTrial');
    return t('paywall.ctaSubscribeMonthly', { price: monthlyPriceString });
  }, [selectedPlan, monthlyPriceString, t]);

  const handlePurchase = async () => {
    const pkg = selectedPackage;
    if (!pkg) {
      Alert.alert(t('paywall.alertPremiumTitle'), t('paywall.alertPremiumUnavailable'), [
        { text: t('alerts.ok') },
      ]);
      return;
    }
    setPurchasing(true);
    try {
      const ok = await purchasePackage(pkg);
      if (ok) {
        posthog.capture('premium_purchased');
        router.back();
      }
    } catch (e: unknown) {
      const err = e as { userCancelled?: boolean };
      if (err?.userCancelled === true) return;
      Alert.alert(
        t('paywall.alertPaymentErrorTitle'),
        e instanceof Error ? e.message : t('paywall.alertPaymentErrorMessage'),
        [{ text: t('alerts.ok') }]
      );
    } finally {
      setPurchasing(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingRoot, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={[styles.loadingText, { color: colors.secondaryText }]}>{t('paywall.loadingOptions')}</Text>
      </View>
    );
  }

  if (!showCheckout) {
    const pageW = sliderWidth > 0 ? sliderWidth : winW;
    const letterboxMarginTop = insets.top + STORY_BLACK_STRIP;
    const letterboxMarginBottom = insets.bottom + STORY_BLACK_STRIP;
    const letterboxInnerH = winH - letterboxMarginTop - letterboxMarginBottom;
    const storyIconSize = Math.floor(
      Math.min(
        winW * 0.96,
        letterboxInnerH * 0.68,
        letterboxInnerH - 148,
        540
      )
    );
    const storyProgressTop = letterboxMarginTop + 12;

    return (
      <View style={[styles.container, { backgroundColor: '#000' }]}>
        <View style={[styles.storyImmersiveRoot, { width: winW, height: winH }]}>
          {/* Barra de progrés sobre la zona de color (alineada amb el letterbox), per sobre del ScrollView. */}
          <View
            style={[
              styles.storyProgressOverlay,
              {
                top: storyProgressTop,
                left: 14,
                right: 14,
                paddingTop: 0,
                paddingHorizontal: 0,
              },
            ]}
            pointerEvents="none"
          >
            <View style={styles.storyProgressRow}>
              {storySlides.map((slide, idx) => {
                const filled =
                  idx < activeStoryIndex
                    ? 1
                    : idx === activeStoryIndex
                      ? storyProgress[idx] ?? 0
                      : 0;
                return (
                  <View key={slide.id} style={[styles.storyProgressOuter, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                    <View
                      style={[
                        styles.storyProgressFill,
                        {
                          backgroundColor: '#fff',
                          width: `${Math.round(filled * 100)}%`,
                        },
                      ]}
                    />
                  </View>
                );
              })}
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            style={[styles.storyScrollAbsolute, { width: winW, height: winH }]}
            contentContainerStyle={{
              width: pageW * STORY_SLIDE_COUNT,
              height: winH,
            }}
          >
            {storySlides.map((slide) => {
              return (
                <Pressable
                  key={slide.id}
                  style={[
                    styles.storyPageFullscreen,
                    {
                      width: pageW,
                      height: winH,
                      borderWidth: 0,
                      backgroundColor: '#000',
                    },
                  ]}
                  onPressIn={pauseStoryTimer}
                  onPressOut={resumeStoryTimer}
                  onPress={handleStoryPress}
                >
                  <View
                    style={[
                      styles.storyLetterbox,
                      {
                        backgroundColor: slide.color,
                        marginTop: letterboxMarginTop,
                        marginBottom: letterboxMarginBottom,
                      },
                    ]}
                  >
                    <View style={styles.storySlideInner}>
                      {/* Icona centrada verticalment a la meitat superior; text a sota. */}
                      <View style={styles.storySlideColumn}>
                        <View style={styles.storySlideIconBand}>
                          {slide.imageSource ? (
                            <View style={[styles.storyArtIconWrap, { maxHeight: storyIconSize }]}>
                              <Image source={slide.imageSource} style={styles.storyArtIcon} resizeMode="contain" />
                            </View>
                          ) : (
                            <View style={[styles.storyArtCircle, { borderColor: 'rgba(255,255,255,0.35)' }]}>
                              <Text style={styles.storyArtPlaceholderLight}>{slide.placeholderText}</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.storySlideTextBand}>
                          <View style={styles.storyTextOverlay}>
                            <Text style={styles.storyTitleFullscreen}>{slide.title}</Text>
                            <Text style={styles.storySubtitleFullscreen}>{slide.subtitle}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          {closeButton}
        </View>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, { backgroundColor: colors.background, opacity: checkoutOpacity }]}>
      <SafeAreaView style={styles.checkoutSafe} edges={['top', 'bottom']}>
        <View style={styles.checkoutHeader}>
          <View style={styles.checkoutHeaderSpacer} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.checkoutScrollContent,
            { paddingTop: Math.max(28, Math.round(winH * 0.06)) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.checkoutHeroTitle, { color: colors.text }]}>{t('paywall.heroTitle')}</Text>
          <Text style={[styles.checkoutHeroSub, { color: colors.secondaryText }]}>
            {t('paywall.heroSubtitle')}
          </Text>

          <Text style={[styles.planSectionTitle, styles.planSectionTitleBelowHero, { color: colors.text }]}>
            {t('paywall.choosePlan')}
          </Text>

          <View style={styles.planCardsRow}>
            <TouchableOpacity
              style={[
                styles.planCard,
                { backgroundColor: colors.card, borderColor: colors.border },
                selectedPlan === 'annual' && styles.planCardSelected,
                selectedPlan === 'annual' && { borderColor: ACCENT, backgroundColor: 'rgba(99, 102, 241, 0.08)' },
              ]}
              onPress={() => setSelectedPlan('annual')}
              activeOpacity={0.85}
            >
              <View style={styles.planCardHeader}>
                <View style={styles.planCardTitleRow}>
                  <Text style={[styles.planCardTitle, { color: colors.text }]}>{t('paywall.planAnnual')}</Text>
                  {hasTrial && (
                    <View style={styles.trialBadge}>
                      <Text style={styles.trialBadgeText}>{t('paywall.trialBadge')}</Text>
                    </View>
                  )}
                  <View style={styles.recomanatBadge}>
                    <Text style={styles.recomanatText}>{t('paywall.recommendedBadge')}</Text>
                  </View>
                </View>
                <View style={styles.estalviaBadge}>
                  <Text style={styles.estalviaText}>
                    {t('paywall.savePercent', { percent: savingsPercent })}
                  </Text>
                </View>
              </View>
              <Text style={[styles.planPriceAnnualMain, { color: colors.text }]}>
                {annualMonthlyEquivalent
                  ? t('paywall.annualHeadlinePerMonth', { price: annualMonthlyEquivalent })
                  : t('paywall.annualPrice', { price: annualPriceString })}
              </Text>
              {annualMonthlyEquivalent ? (
                <Text style={[styles.planAnnualTotalLine, { color: colors.secondaryText }]}>
                  {t('paywall.annualPrice', { price: annualPriceString })}
                </Text>
              ) : null}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.planCard,
                styles.planCardMonthly,
                { backgroundColor: colors.card, borderColor: colors.border },
                selectedPlan === 'monthly' && styles.planCardSelected,
                selectedPlan === 'monthly' && { borderColor: ACCENT, backgroundColor: 'rgba(99, 102, 241, 0.08)' },
              ]}
              onPress={() => setSelectedPlan('monthly')}
              activeOpacity={0.85}
            >
              <Text style={[styles.planCardTitle, { color: colors.text }]}>{t('paywall.planMonthly')}</Text>
              <Text style={[styles.planPrice, { color: colors.text }]}>
                {t('paywall.monthlyPrice', { price: monthlyPriceString })}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.ctaBtn, purchasing && styles.ctaBtnDisabled]}
            onPress={handlePurchase}
            disabled={purchasing}
            activeOpacity={0.85}
          >
            {purchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaBtnText}>{ctaLabel}</Text>
            )}
          </TouchableOpacity>

          <Text style={[styles.footerCopy, { color: colors.secondaryText }]}>{t('paywall.footerCopy')}</Text>

          <TouchableOpacity style={styles.skipLinkWrap} onPress={() => router.back()} activeOpacity={0.7}>
            <Text style={[styles.skipLinkText, { color: colors.secondaryText }]}>{t('paywall.notNow')}</Text>
          </TouchableOpacity>

          <View style={styles.bottomSpace} />
        </ScrollView>
      </SafeAreaView>
      {closeButton}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 14 },
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 24,
  },
  storyImmersiveRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'visible',
  },
  storyProgressOverlay: {
    position: 'absolute',
    zIndex: 40,
  },
  storyScrollAbsolute: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 10,
  },
  storyPageFullscreen: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 0,
    overflow: 'visible',
  },
  storyLetterbox: {
    flex: 1,
    marginHorizontal: 0,
    borderRadius: 0,
    overflow: 'visible',
  },
  storySlideInner: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    overflow: 'visible',
  },
  storySlideColumn: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 0,
    justifyContent: 'center',
    transform: [{ translateY: -30 }],
  },
  /** Icona + text en bloc centrat verticalment (paddingTop lleuger per la barra de progrés). */
  storySlideIconBand: {
    width: '100%',
    minHeight: 0,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
    paddingBottom: 18,
  },
  storySlideTextBand: {
    width: '100%',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 0,
  },
  storyArtCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  storyArtPlaceholderLight: {
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    color: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 12,
  },
  storyTextOverlay: {
    alignItems: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 340,
    paddingHorizontal: 8,
  },
  storyTitleFullscreen: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 34,
  },
  storySubtitleFullscreen: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    lineHeight: 22,
  },
  checkoutSafe: {
    flex: 1,
    width: '100%',
  },
  topRightCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkoutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 4,
  },
  checkoutHeaderSpacer: { flex: 1 },
  checkoutCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkoutScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingBottom: 36,
  },
  checkoutHeroTitle: {
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 34,
    marginBottom: 10,
  },
  checkoutHeroSub: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 12,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 16,
  },
  titleLarge: {
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 34,
  },
  storyWrap: {
    marginBottom: 16,
    width: '100%',
    height: 440,
  },
  storyProgressRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  storyProgressOuter: {
    height: 2,
    borderRadius: 999,
    overflow: 'hidden',
    flex: 1,
  },
  storyProgressFill: {
    height: '100%',
  },
  storyScroll: {
    width: '100%',
    flex: 1,
  },
  storyPage: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 0,
    overflow: 'hidden',
  },
  storyArt: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  storyArtIconWrap: {
    width: '130%',
    maxWidth: '130%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  storyArtIcon: {
    width: '100%',
    height: '100%',
  },
  storyArtPlaceholder: {
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  storyTextBlock: {
    paddingTop: 10,
  },
  storyTitle: {
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 6,
  },
  storySubtitle: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.95,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 8,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  title: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  benefitGrid: {
    marginBottom: 16,
  },
  benefitRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  benefitCell: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 70,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  benefitCellLeft: {
    marginRight: 6,
  },
  benefitIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  benefitLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
    textAlign: 'center',
  },
  benefitSubtext: {
    fontSize: 10,
    opacity: 0.85,
    textAlign: 'center',
  },
  trialSection: {
    marginBottom: 16,
  },
  trialSectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  trialFootnote: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 8,
  },
  trustBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  trustBarText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  trialStepper: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  trialStepperLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  trialStepperDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  trialStepperLineSeg: {
    flex: 1,
    height: 2,
    marginHorizontal: 6,
  },
  trialStepperLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
    marginTop: 10,
  },
  trialStepperLabel: {
    flex: 1,
    fontSize: 10,
    textAlign: 'center',
    marginHorizontal: 4,
  },
  planSection: {
    marginBottom: 16,
  },
  planSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  planSectionTitleBelowHero: {
    marginTop: 4,
    marginBottom: 12,
  },
  planCardsRow: {
    flexDirection: 'column',
    gap: 12,
  },
  planCard: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flex: 0,
  },
  planCardMonthly: {
    marginBottom: 0,
    padding: 12,
  },
  planCardSelected: {
    borderWidth: 2,
  },
  planCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  planCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  planCardTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  trialBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  trialBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#22C55E',
  },
  recomanatBadge: {
    backgroundColor: ACCENT,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  recomanatText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#fff',
  },
  estalviaBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  estalviaText: {
    fontSize: 8,
    fontWeight: '700',
    color: '#22C55E',
  },
  planPrice: {
    fontSize: 14,
    fontWeight: '800',
  },
  planPriceAnnualMain: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  planAnnualTotalLine: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
    opacity: 0.95,
  },
  planSubtext: {
    fontSize: 11,
    marginTop: 1,
  },
  ctaBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  ctaBtnDisabled: {
    opacity: 0.8,
  },
  ctaBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  footerCopy: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  skipLinkWrap: {
    alignSelf: 'center',
    paddingVertical: 6,
  },
  skipLinkText: {
    fontSize: 12,
    textDecorationLine: 'underline',
    opacity: 0.7,
  },
  bottomSpace: {
    height: 16,
  },
});
