/**
 * Tally.app – Minimalist Light/Dark theme.
 * White / Deep Black + soft Purple/Indigo accent. Thin borders, breathable.
 * Centralized getThemeColors() for consistent light/dark adaptation.
 */

export const ACCENT = '#6366F1'; // soft indigo
export const ACCENT_DARK = '#818CF8';

export const lightColors = {
  background: '#FFFFFF',
  surface: '#FAFAFA',
  text: '#000000',
  textSecondary: '#666666',
  border: '#E0E0E0',
  primary: '#000000',
  tint: ACCENT,
  accent: ACCENT,
} as const;

export const darkColors = {
  background: '#000000',
  surface: '#0F0F0F',
  text: '#FFFFFF',
  textSecondary: '#AAAAAA',
  border: '#222222',
  primary: '#FFFFFF',
  tint: ACCENT_DARK,
  accent: ACCENT_DARK,
} as const;

export type ColorScheme = 'light' | 'dark';

/** Stored preference: can include "system" to follow device setting. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** Card background: light = #F2F2F2 or white; dark = elevated surface. */
const CARD_BG_LIGHT = '#F2F2F2';
const CARD_BG_DARK = '#121212';

/** Theme-aware colors for screens. Use with useThemeColors() hook. */
export function getThemeColors(scheme: ColorScheme) {
  const c = scheme === 'dark' ? darkColors : lightColors;
  const cardBackground = scheme === 'dark' ? CARD_BG_DARK : CARD_BG_LIGHT;
  const secondaryText = c.textSecondary;
  return {
    ...c,
    /** Alias for cardBackground – use for cards, list items, modals. */
    card: cardBackground,
    cardBackground,
    /** Alias for secondaryText – muted labels, hints. */
    secondaryText,
    divider: scheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    /** Contrasting background for secondary buttons (e.g. Manual): light #F0F0F0, dark #121212 */
    buttonSecondaryBg: scheme === 'dark' ? CARD_BG_DARK : '#F0F0F0',
    /** Option row background in modals (e.g. theme picker). */
    optionRowBg: scheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
  };
}

export type ThemeColors = ReturnType<typeof getThemeColors>;
