/**
 * RevenueCat SDK: single configure + serialized operations.
 * Test/public keys: RevenueCat Dashboard → API keys. Avoid parallel logIn + getCustomerInfo (7638 / 429).
 */
import Purchases, { LOG_LEVEL, type CustomerInfo } from 'react-native-purchases';

let configured = false;

/** Serializes all SDK calls that hit the backend (logIn, logOut, getCustomerInfo). */
let opChain: Promise<unknown> = Promise.resolve();

function enqueuePurchasesOp<T>(fn: () => Promise<T>): Promise<T> {
  const next = opChain.then(() => fn());
  opChain = next.then(() => {});
  return next;
}

function isConcurrentFlightError(e: unknown): boolean {
  const s = typeof e === 'object' && e !== null ? JSON.stringify(e) : String(e);
  return (
    s.includes('7638') ||
    s.includes('another request in flight') ||
    s.includes('"code":429') ||
    s.includes('Status code: 429')
  );
}

async function getCustomerInfoWithRetry(): Promise<CustomerInfo> {
  const delaysMs = [0, 300, 700];
  let last: unknown;
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    if (delaysMs[attempt]! > 0) {
      await new Promise<void>((r) => setTimeout(r, delaysMs[attempt]));
    }
    try {
      return await Purchases.getCustomerInfo();
    } catch (e) {
      last = e;
      if (isConcurrentFlightError(e) && attempt < delaysMs.length - 1) continue;
      throw e;
    }
  }
  throw last instanceof Error ? last : new Error('getCustomerInfo failed');
}

export function getRevenueCatPublicApiKey(): string {
  const k = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
  return typeof k === 'string' ? k.trim() : '';
}

/**
 * Idempotent. Returns true if Purchases is configured (or was already).
 */
export function configurePurchasesOnce(): boolean {
  if (configured) return true;
  const apiKey = getRevenueCatPublicApiKey();
  if (!apiKey) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        '[Tally] EXPO_PUBLIC_REVENUECAT_API_KEY is missing. Add it to .env (RevenueCat → API keys → Public API key).'
      );
    }
    return false;
  }
  try {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.VERBOSE);
    Purchases.configure({ apiKey });
    configured = true;
    return true;
  } catch (e) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('[Tally] Purchases.configure failed:', e);
    }
    return false;
  }
}

/**
 * After identity is known: logIn/logOut then fetch customer info — all in one queued op.
 * Use this on session change / Premium bootstrap so nothing races with getCustomerInfo.
 */
export async function syncIdentityAndFetchCustomerInfo(userId: string | null): Promise<CustomerInfo | null> {
  if (!configurePurchasesOnce()) return null;
  try {
    return await enqueuePurchasesOp(async () => {
      if (userId) await Purchases.logIn(userId);
      else await Purchases.logOut();
      return getCustomerInfoWithRetry();
    });
  } catch (e) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[Tally] syncIdentityAndFetchCustomerInfo:', e);
    }
    return null;
  }
}

/**
 * Refresh-only: identity already synced. Queued + retry for 7638.
 */
export async function getCustomerInfoSerialized(): Promise<CustomerInfo> {
  if (!configurePurchasesOnce()) {
    throw new Error('RevenueCat not configured');
  }
  return enqueuePurchasesOp(() => getCustomerInfoWithRetry());
}
