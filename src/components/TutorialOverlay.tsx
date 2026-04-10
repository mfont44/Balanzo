/**
 * TutorialOverlay – Zero-crash tutorial UI.
 * Uses a full-screen absolutely positioned View (no native Modal) to avoid iOS crashes
 * during navigation. Renders dark backdrop, optional spotlight "hole", and tooltip.
 */

import { useThemeColors } from '@/hooks';
import { Component, useEffect, useState } from 'react';
import {
    Dimensions,
    Keyboard,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export type TargetLayout = { x: number; y: number; width: number; height: number };

export interface TutorialOverlayProps {
  isVisible: boolean;
  title: string;
  message: string;
  onNext: () => void;
  /** Default "Continuar" */
  buttonLabel?: string;
  stepName?: string;
  targetLayout?: TargetLayout | null;
  secondaryButton?: { label: string; onPress: () => void };
  /** Called if overlay fails to mount (Error Boundary); caller should set has_completed_tutorial and hide tour. */
  onFailToMount?: () => void;
}

/** Catches render errors in tour UI and marks tour as seen so app does not crash. */
class TourErrorBoundary extends Component<
  { children: React.ReactNode; onFailToMount?: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError = () => ({ hasError: true });

  componentDidCatch() {
    this.props.onFailToMount?.();
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function TutorialOverlay({
  isVisible,
  title,
  message,
  onNext,
  buttonLabel = 'Continuar',
  targetLayout = null,
  secondaryButton,
  onFailToMount,
}: TutorialOverlayProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [isReady, setIsReady] = useState(false);
  const [tooltipHeight, setTooltipHeight] = useState(0);

  useEffect(() => {
    if (!isVisible) {
      setIsReady(false);
      setTooltipHeight(0);
      return;
    }
    Keyboard.dismiss();
    const timer = setTimeout(() => setIsReady(true), 250);
    return () => clearTimeout(timer);
  }, [isVisible]);

  const hasValidTarget =
    targetLayout != null &&
    typeof targetLayout.width === 'number' &&
    typeof targetLayout.height === 'number' &&
    targetLayout.width > 0 &&
    targetLayout.height > 0;
  const DIM_COLOR = 'rgba(0,0,0,0.6)';

  if (!isVisible || !isReady) return null;

  const hole = hasValidTarget && targetLayout
    ? {
        x: Math.max(0, Math.min(targetLayout.x, SCREEN_WIDTH)),
        y: Math.max(0, Math.min(targetLayout.y, SCREEN_HEIGHT)),
        w: Math.max(0, Math.min(targetLayout.width, SCREEN_WIDTH)),
        h: Math.max(0, Math.min(targetLayout.height, SCREEN_HEIGHT)),
      }
    : null;

  const TOOLTIP_PAD = 12;
  const safeTop = insets.top + TOOLTIP_PAD;
  const safeBottom = SCREEN_HEIGHT - (insets.bottom + TOOLTIP_PAD);

  const tooltipTop = (() => {
    if (!hole || tooltipHeight <= 0) return undefined;
    const targetCenterY = hole.y + hole.h / 2;
    const wantsAbove = targetCenterY > SCREEN_HEIGHT / 2;
    if (wantsAbove) {
      const top = hole.y - tooltipHeight - TOOLTIP_PAD;
      return Math.max(safeTop, top);
    }
    const top = hole.y + hole.h + TOOLTIP_PAD;
    return Math.min(safeBottom - tooltipHeight, Math.max(safeTop, top));
  })();

  return (
    <TourErrorBoundary onFailToMount={onFailToMount}>
      <View style={styles.root} pointerEvents="box-none">
        {/* Transparent hole mask using 4-views approach */}
        {hole ? (
          <>
            <View
              style={[styles.maskPiece, { backgroundColor: DIM_COLOR, top: 0, left: 0, right: 0, height: hole.y }]}
              pointerEvents="none"
            />
            <View
              style={[
                styles.maskPiece,
                { backgroundColor: DIM_COLOR, top: hole.y + hole.h, left: 0, right: 0, bottom: 0 },
              ]}
              pointerEvents="none"
            />
            <View
              style={[
                styles.maskPiece,
                { backgroundColor: DIM_COLOR, top: hole.y, left: 0, width: hole.x, height: hole.h },
              ]}
              pointerEvents="none"
            />
            <View
              style={[
                styles.maskPiece,
                { backgroundColor: DIM_COLOR, top: hole.y, left: hole.x + hole.w, right: 0, height: hole.h },
              ]}
              pointerEvents="none"
            />
            <View
              style={[
                styles.highlight,
                {
                  top: hole.y,
                  left: hole.x,
                  width: hole.w,
                  height: hole.h,
                  borderColor: colors.accent,
                },
              ]}
              pointerEvents="none"
            />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: DIM_COLOR }]} pointerEvents="none" />
        )}

        {/* Tooltip: safe-area padding via insets (no SafeAreaView) */}
        <View
          style={[
            styles.tooltipWrapper,
            {
              paddingHorizontal: 20,
              top: tooltipTop ?? undefined,
              bottom: tooltipTop == null ? insets.bottom + 24 : undefined,
            },
          ]}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.tooltipCard,
              {
                backgroundColor: colors.card ?? colors.cardBackground,
                borderColor: colors.border,
              },
            ]}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h && h !== tooltipHeight) setTooltipHeight(h);
            }}
          >
            <Text style={[styles.tooltipTitle, { color: colors.text }]}>{title}</Text>
            <Text style={[styles.tooltipMessage, { color: colors.textSecondary }]}>{message}</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
              onPress={onNext}
              activeOpacity={0.9}
            >
              <Text style={styles.primaryBtnText}>{buttonLabel}</Text>
            </TouchableOpacity>
            {secondaryButton ? (
              <TouchableOpacity style={styles.secondaryBtn} onPress={secondaryButton.onPress}>
                <Text style={[styles.secondaryBtnText, { color: colors.textSecondary }]}>
                  {secondaryButton.label}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    </TourErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  maskPiece: {
    position: 'absolute',
  },
  highlight: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 12,
  },
  tooltipWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  tooltipCard: {
    width: SCREEN_WIDTH - 40,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  tooltipTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  tooltipMessage: {
    fontSize: 14,
    marginBottom: 16,
  },
  primaryBtn: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 4,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
