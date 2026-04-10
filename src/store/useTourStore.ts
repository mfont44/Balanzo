import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { getProfile, updateProfile } from '@/services/profile';

const storageKey = (userId: string) => `tour_seen:${userId}`;

export type TourSeenSource = 'local' | 'remote' | 'default';

type TourState = {
  /** null = unknown (still hydrating) */
  hasSeenTour: boolean | null;
  source: TourSeenSource;
  lastHydratedUserId: string | null;
  hydrateForUser: (userId: string) => Promise<void>;
  markSeen: (userId: string) => Promise<void>;
  reset: () => void;
};

export const useTourStore = create<TourState>((set, get) => ({
  hasSeenTour: null,
  source: 'default',
  lastHydratedUserId: null,

  hydrateForUser: async (userId: string) => {
    if (!userId) return;
    if (get().lastHydratedUserId === userId && get().hasSeenTour !== null) return;

    set({ hasSeenTour: null, source: 'default', lastHydratedUserId: userId });

    try {
      const local = await AsyncStorage.getItem(storageKey(userId));
      if (local === '1') {
        set({ hasSeenTour: true, source: 'local' });
        return;
      }
    } catch {
      // ignore local read failures; we'll fall back to remote
    }

    try {
      const profile = await getProfile(userId);
      const remoteSeen = Boolean((profile as { has_completed_tutorial?: boolean | null } | null)?.has_completed_tutorial);
      set({ hasSeenTour: remoteSeen, source: 'remote' });
      try {
        await AsyncStorage.setItem(storageKey(userId), remoteSeen ? '1' : '0');
      } catch {
        // ignore persistence failures
      }
    } catch {
      set({ hasSeenTour: false, source: 'default' });
    }
  },

  markSeen: async (userId: string) => {
    if (!userId) return;
    set({ hasSeenTour: true, source: 'local' });
    try {
      await AsyncStorage.setItem(storageKey(userId), '1');
    } catch {
      // ignore
    }
    try {
      await updateProfile(userId, { has_completed_tutorial: true });
    } catch {
      // ignore (offline)
    }
  },

  reset: () => set({ hasSeenTour: null, source: 'default', lastHydratedUserId: null }),
}));

