/**
 * Tally.app – Supabase client with secure session persistence.
 * Set in .env: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.
 * Use your sb_publishable_... (anon/public) key from Supabase Dashboard → Settings → API for EXPO_PUBLIC_SUPABASE_ANON_KEY.
 */

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_SB_PUBLISHABLE ?? '';

const isNode =
  typeof process !== 'undefined' &&
  process.versions != null &&
  typeof process.versions.node === 'string';

function createSupabaseClient(): SupabaseClient {
  const storage = isNode
    ? {
        getItem: async (_key: string) => null,
        setItem: async (_key: string, _value: string) => {},
        removeItem: async (_key: string) => {},
      }
    : require('@react-native-async-storage/async-storage').default;

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

if (!supabaseUrl || !supabaseAnonKey) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.error(
      '[Tally] Supabase URL or anon key missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env'
    );
  }
}

export const supabase = createSupabaseClient();
