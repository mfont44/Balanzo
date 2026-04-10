import i18n from '@/i18n';
import { useAuthStore } from '@/store';
import { ENTITLEMENT_ID } from '@/store/useSubscriptionStore';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import Purchases from 'react-native-purchases';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { supabase } from '@/services/supabase';
import {
  getCustomerInfoSerialized,
  syncIdentityAndFetchCustomerInfo,
} from '@/services/revenueCatPurchases';

type PremiumContextValue = {
  isPremium: boolean;
  customerInfo: CustomerInfo | null;
  loadingPremium: boolean;
  refreshPremiumStatus: () => Promise<void>;
  purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>;
};

const PremiumContext = createContext<PremiumContextValue | undefined>(undefined);

function hasEntitlement(info: CustomerInfo | null): boolean {
  const active = info?.entitlements?.active as Record<string, unknown> | undefined;
  return Boolean(active && typeof active[ENTITLEMENT_ID] !== 'undefined');
}

export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const uid = useAuthStore((s) => s.session?.user?.id ?? null);
  const [isPremium, setIsPremium] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [loadingPremium, setLoadingPremium] = useState(true);
  const premiumStateRef = useRef(false);
  useEffect(() => {
    premiumStateRef.current = isPremium;
  }, [isPremium]);

  /** Queued + retry; avoids RevenueCat 7638 when parallel logIn / getCustomerInfo race. */
  const getCustomerInfoSafe = useCallback(async (): Promise<CustomerInfo> => {
    return getCustomerInfoSerialized();
  }, []);

  const getDbPremiumStatusSafe = useCallback(async (): Promise<boolean> => {
    if (!uid) return false;
    try {
      const { data, error } = await supabase
        .from('users')
        .select('is_premium')
        .eq('id', uid)
        .maybeSingle();
      if (error) {
        console.error('PremiumContext DB premium lookup error:', error);
        return false;
      }
      return Boolean(data?.is_premium);
    } catch (e) {
      console.error('PremiumContext DB premium lookup exception:', e);
      return false;
    }
  }, [uid]);

  const syncPremiumToSupabase = useCallback(
    async (nextIsPremium: boolean) => {
      // Never write "true" unless RevenueCat entitlement is explicitly active.
      if (!nextIsPremium) return;
      if (!uid) return;
      try {
        const { error } = await supabase.rpc('update_premium_status', { p_is_premium: Boolean(nextIsPremium) });
        if (error) {
          console.error('Error sincronitzant Premium a Supabase:', error);
          return;
        }
        console.log('Sincronització Premium OK a la base de dades');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('PremiumContext syncPremiumToSupabase error:', e);
      }
    },
    [uid]
  );

  const refreshPremiumStatus = useCallback(async () => {
    try {
      const [info, dbIsPremium] = await Promise.all([
        getCustomerInfoSafe(),
        getDbPremiumStatusSafe(),
      ]);
      const rcIsPremium = hasEntitlement(info);
      const finalIsPremium = rcIsPremium || dbIsPremium;
      setCustomerInfo(info);
      setIsPremium(finalIsPremium);
      console.log('PremiumContext: Detectat estat premium:', finalIsPremium);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('PremiumContext refresh error:', error);
      // Server-priority fallback: if RevenueCat fails, trust DB state.
      const dbIsPremium = await getDbPremiumStatusSafe();
      setCustomerInfo(null);
      setIsPremium(dbIsPremium);
    }
  }, [getCustomerInfoSafe, getDbPremiumStatusSafe]);

  const purchasePackage = useCallback(async (pkg: PurchasesPackage) => {
    try {
      const result = await Purchases.purchasePackage(pkg);
      const info = result.customerInfo ?? (await getCustomerInfoSafe());
      const unlocked = hasEntitlement(info);
      setCustomerInfo(info);
      setIsPremium(unlocked);
      if (unlocked) {
        // Premium is now authoritative: sync to Supabase immediately.
        await syncPremiumToSupabase(true);
        Alert.alert(i18n.t('alerts.purchaseSuccessTitle'), i18n.t('alerts.purchaseSuccessMessage'), [
          { text: i18n.t('alerts.ok') },
        ]);
        return true;
      }
      Alert.alert(
        i18n.t('alerts.subscriptionValidationFailedTitle'),
        i18n.t('alerts.subscriptionValidationFailedMessage'),
        [{ text: i18n.t('alerts.ok') }]
      );
      setIsPremium(false);
      return false;
    } catch (e: unknown) {
      const err = e as { userCancelled?: boolean; message?: string };
      if (err?.userCancelled === true) {
        setIsPremium(false);
        return false;
      }
      // RevenueCat test/sandbox can throw code 5 when no real store transaction occurs.
      // In this case, re-fetch CustomerInfo and re-sync in case entitlement was already active/restored.
      if (err?.message?.includes('no real transaction occurred')) {
        try {
          const info = await getCustomerInfoSafe();
          const unlocked = hasEntitlement(info);
          console.log('PremiumContext: Detectat estat premium:', unlocked);
          setCustomerInfo(info);
          setIsPremium(unlocked);
          await syncPremiumToSupabase(unlocked);
          if (unlocked) {
            Alert.alert(i18n.t('alerts.purchaseSuccessTitle'), i18n.t('alerts.purchaseSuccessMessage'), [
              { text: i18n.t('alerts.ok') },
            ]);
            return true;
          }
        } catch (refreshErr) {
          console.error('PremiumContext fallback refresh after code 5 failed:', refreshErr);
        }
      }
      Alert.alert(
        i18n.t('paywall.alertPaymentErrorTitle'),
        e instanceof Error ? e.message : i18n.t('paywall.alertPaymentErrorMessage'),
        [{ text: i18n.t('alerts.ok') }]
      );
      setIsPremium(false);
      // eslint-disable-next-line no-console
      console.error('PremiumContext purchase error:', e);
      return false;
    }
  }, [getCustomerInfoSafe, syncPremiumToSupabase]);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const [info, dbIsPremium] = await Promise.all([
          syncIdentityAndFetchCustomerInfo(uid),
          getDbPremiumStatusSafe(),
        ]);
        if (!info) {
          if (mounted) {
            setCustomerInfo(null);
            setIsPremium(dbIsPremium);
          }
          return;
        }
        const rcIsPremium = hasEntitlement(info);
        const finalIsPremium = rcIsPremium || dbIsPremium;
        setCustomerInfo(info);
        setIsPremium(finalIsPremium);
        console.log('PremiumContext: Detectat estat premium:', finalIsPremium);

        // Sync to DB only when RevenueCat is premium and DB appears stale.
        if (rcIsPremium && !dbIsPremium && !premiumStateRef.current) {
          await syncPremiumToSupabase(true);
          if (mounted) setIsPremium(true);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('PremiumContext init error:', error);
        const dbIsPremium = await getDbPremiumStatusSafe();
        if (mounted) setIsPremium(dbIsPremium);
      } finally {
        if (mounted) setLoadingPremium(false);
      }
    };

    init();

    // SDK typings may return `void`; avoid truthiness checks on `void` (TS error).
    const listener: unknown = Purchases.addCustomerInfoUpdateListener((info) => {
      const unlocked = hasEntitlement(info);
      console.log('PremiumContext: Detectat estat premium:', unlocked);
      setCustomerInfo(info);
      setIsPremium(unlocked);
      // Restore/completion: sync only when RevenueCat confirms entitlement is active.
      if (unlocked) void syncPremiumToSupabase(true);
    });

    return () => {
      mounted = false;
      if (
        typeof listener === 'object' &&
        listener !== null &&
        'remove' in listener &&
        typeof (listener as { remove?: unknown }).remove === 'function'
      ) {
        (listener as { remove: () => void }).remove();
      }
    };
  }, [uid, getCustomerInfoSafe, getDbPremiumStatusSafe, syncPremiumToSupabase]);

  const value = useMemo<PremiumContextValue>(
    () => ({
      isPremium,
      customerInfo,
      loadingPremium,
      refreshPremiumStatus,
      purchasePackage,
    }),
    [isPremium, customerInfo, loadingPremium, refreshPremiumStatus, purchasePackage]
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium() {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error('usePremium must be used within PremiumProvider');
  return ctx;
}

