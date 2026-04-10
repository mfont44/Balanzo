import { usePremium } from '@/context/PremiumContext';
import type { CustomerInfo } from 'react-native-purchases';

type SubscriptionState = {
  isPremium: boolean;
  loading: boolean;
  customerInfo: CustomerInfo | null;
  error: string | null;
};

/**
 * Subscription snapshot for UI. Uses the same merged RevenueCat + DB `users.is_premium`
 * logic as PremiumProvider, so premium gates (e.g. group limits) stay in sync with the profile.
 */
export function useSubscription(): SubscriptionState {
  const { isPremium, customerInfo, loadingPremium } = usePremium();
  return {
    isPremium,
    loading: loadingPremium,
    customerInfo,
    error: null,
  };
}
