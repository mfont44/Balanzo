import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CustomerInfo } from 'react-native-purchases';
import { create } from 'zustand';

export const ENTITLEMENT_ID = 'Tally Pro' as const;
const PREMIUM_STORAGE_KEY = '@user_is_premium';

export type SubscriptionSnapshot = {
  isPremium: boolean;
  customerInfo: CustomerInfo | null;
  lastUpdatedAt: number;
};

type SubscriptionState = SubscriptionSnapshot & {
  setCustomerInfo: (info: CustomerInfo | null) => void;
  setIsPremium: (isPremium: boolean) => void;
  checkPremiumStatus: () => Promise<void>;
  reset: () => void;
};

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  isPremium: false,
  customerInfo: null,
  lastUpdatedAt: 0,

  setCustomerInfo: (info) =>
    set(() => {
      const active = info?.entitlements?.active as Record<string, unknown> | undefined;
      const isPremium = Boolean(active && typeof active[ENTITLEMENT_ID] !== 'undefined');
      void AsyncStorage.setItem(PREMIUM_STORAGE_KEY, isPremium ? 'true' : 'false');
      return { customerInfo: info, isPremium, lastUpdatedAt: Date.now() };
    }),

  setIsPremium: (isPremium) => {
    void AsyncStorage.setItem(PREMIUM_STORAGE_KEY, isPremium ? 'true' : 'false');
    set({ isPremium, lastUpdatedAt: Date.now() });
  },

  checkPremiumStatus: async () => {
    const stored = await AsyncStorage.getItem(PREMIUM_STORAGE_KEY);
    const isPremium = stored === 'true';
    set({ isPremium, lastUpdatedAt: Date.now() });
  },

  reset: () => {
    void AsyncStorage.removeItem(PREMIUM_STORAGE_KEY);
    set({ isPremium: false, customerInfo: null, lastUpdatedAt: Date.now() });
  },
}));

