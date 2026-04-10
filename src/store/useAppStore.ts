/**
 * Tally.app – Global app store (Zustand).
 * Theme preference (light/dark/system) persisted with AsyncStorage. Default: dark.
 * effectiveTheme is derived in _layout and used by screens for colors.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { ThemePreference, ColorScheme } from '@/theme';

const THEME_STORAGE_KEY = 'TALLY_THEME';

export type { ThemePreference };

interface AppState {
  theme: ThemePreference;
  /** Resolved theme for UI (light or dark). Set by _layout from preference + system. */
  effectiveTheme: ColorScheme;
  /** Group ID from deep link when user was not logged in; join after login. */
  pendingGroupIdFromLink: string | null;
  /** Invite code from deep link when user was not logged in; join after login. */
  pendingInviteCodeFromLink: string | null;
  setTheme: (theme: ThemePreference) => void;
  setEffectiveTheme: (theme: ColorScheme) => void;
  setPendingGroupIdFromLink: (id: string | null) => void;
  setPendingInviteCodeFromLink: (id: string | null) => void;
  toggleTheme: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'dark',
  effectiveTheme: 'dark',
  pendingGroupIdFromLink: null,
  pendingInviteCodeFromLink: null,
  setTheme: (theme) => {
    set({ theme });
    AsyncStorage.setItem(THEME_STORAGE_KEY, theme).catch(() => {});
  },
  setEffectiveTheme: (effectiveTheme) => set({ effectiveTheme }),
  setPendingGroupIdFromLink: (pendingGroupIdFromLink) => set({ pendingGroupIdFromLink }),
  setPendingInviteCodeFromLink: (pendingInviteCodeFromLink) =>
    set({ pendingInviteCodeFromLink }),
  toggleTheme: () =>
    set((state) => {
      const next: ThemePreference = state.theme === 'light' ? 'dark' : 'light';
      AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => {});
      return { theme: next };
    }),
}));

/** Call once on app load to hydrate theme from AsyncStorage. */
export async function hydrateTheme(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      useAppStore.getState().setTheme(stored);
    }
  } catch {
    // keep default dark
  }
}
