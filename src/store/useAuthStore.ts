/**
 * Tally.app – Auth state (Zustand).
 * Session + profile from public.users so UI can show full_name everywhere.
 */

import { ensurePublicUserFromAuthUser, getProfile } from '@/services/profile';
import { supabase } from '@/services/supabase';
import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

export interface AuthProfile {
  full_name: string;
  avatar_url?: string | null;
  /** When true, first-run tutorial will not show again. */
  has_completed_tutorial?: boolean;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  isLoading: boolean;
  setSession: (session: Session | null) => void;
  setUser: (user: User | null) => void;
  setProfile: (profile: AuthProfile | null) => void;
  setLoading: (loading: boolean) => void;
  loadProfile: (userId: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  initialize: () => () => void;
}

/** Display name for current user: full_name from DB, else email local part, never generic "Usuari". */
export function getDisplayName(profile: AuthProfile | null, email: string | undefined): string {
  const name = profile?.full_name?.trim();
  if (name) return name;
  if (email) return email.split('@')[0];
  return '—';
}

export const useAuthStore = create<AuthState>((set, get) => {
  const syncPublicUserAndProfile = async (session: Session | null) => {
    const u = session?.user;
    if (!u) return;
    const { error } = await ensurePublicUserFromAuthUser(u);
    if (error) console.error('[Tally] ensurePublicUserFromAuthUser:', error);
    await get().loadProfile(u.id);
  };

  return {
  session: null,
  user: null,
  profile: null,
  isLoading: true,

  setSession: (session) => set({ session }),
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setLoading: (isLoading) => set({ isLoading }),

  loadProfile: async (userId: string) => {
    const p = await getProfile(userId);
    set({
      profile: p
        ? {
            full_name: p.full_name ?? '',
            avatar_url: p.avatar_url ?? null,
            has_completed_tutorial: (p as { has_completed_tutorial?: boolean }).has_completed_tutorial ?? false,
          }
        : null,
    });
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ?? null };
  },

  signUp: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error ?? null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null });
  },

  initialize: () => {
    set({ isLoading: true });

    void supabase.auth.getSession().then(async ({ data: { session } }) => {
      set({ session, user: session?.user ?? null, isLoading: false });
      if (session?.user) await syncPublicUserAndProfile(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        user: session?.user ?? null,
        profile: null,
      });
      if (session?.user) void syncPublicUserAndProfile(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  },
};
});
