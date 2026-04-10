import { useAppStore } from '@/store';
import { getThemeColors } from '@/theme/colors';

/** Returns theme-aware colors (background, text, card, etc.) for the current effective theme. */
export function useThemeColors() {
  const effectiveTheme = useAppStore((s) => s.effectiveTheme);
  return getThemeColors(effectiveTheme);
}
