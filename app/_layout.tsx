import { hydrateLanguage } from '@/i18n';
import { DarkTheme as NavDarkTheme, DefaultTheme as NavLightTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, useColorScheme } from 'react-native';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getProfile, isProfileComplete } from '@/services/profile';
import { hydrateTheme, useAppStore, useAuthStore } from '@/store';
import { useTourStore } from '@/store/useTourStore';
import type { ColorScheme } from '@/theme';
import { darkColors, lightColors } from '@/theme';
import { TourHost } from '@/components/TourHost';
import { PremiumProvider } from '@/context/PremiumContext';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

const POSTHOG_API_KEY = 'phc_PaXyZhJGL0rS1UShEUHHjVNgxzFvFI0M03OiwGPdAQl';
const POSTHOG_HOST = 'https://eu.i.posthog.com';

/** Syncs Supabase session to PostHog identify / reset (logout only). */
function PostHogAuthSync() {
  const posthog = usePostHog();
  const session = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const uid = session?.user?.id ?? null;
    const email = session?.user?.email;
    if (uid) {
      posthog.identify(uid, { ...(email ? { email } : {}) });
      prevUserIdRef.current = uid;
    } else if (prevUserIdRef.current !== null) {
      posthog.reset();
      prevUserIdRef.current = null;
    }
  }, [isLoading, session?.user?.id, session?.user?.email, posthog]);

  return null;
}

const LightTheme = {
  ...NavLightTheme,
  colors: {
    ...NavLightTheme.colors,
    primary: lightColors.primary,
    background: lightColors.background,
    card: lightColors.surface,
    text: lightColors.text,
    border: lightColors.border,
    notification: lightColors.primary,
  },
};

const DarkTheme = {
  ...NavDarkTheme,
  colors: {
    ...NavDarkTheme.colors,
    primary: darkColors.primary,
    background: darkColors.background,
    card: darkColors.surface,
    text: darkColors.text,
    border: darkColors.border,
    notification: darkColors.primary,
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const themePreference = useAppStore((s) => s.theme);
  const setEffectiveTheme = useAppStore((s) => s.setEffectiveTheme);
  const systemScheme = useColorScheme();
  const effectiveTheme: ColorScheme =
    themePreference === 'system' ? (systemScheme ?? 'dark') : themePreference;
  const themeObject = effectiveTheme === 'dark' ? DarkTheme : LightTheme;
  const router = useRouter();

  useEffect(() => {
    hydrateTheme();
    void hydrateLanguage();
  }, []);

  useEffect(() => {
    setEffectiveTheme(effectiveTheme);
  }, [effectiveTheme, setEffectiveTheme]);

  const segments = useSegments();
  const { session, isLoading, initialize } = useAuthStore();
  const pendingGroupIdFromLink = useAppStore((s) => s.pendingGroupIdFromLink);
  const setPendingGroupIdFromLink = useAppStore((s) => s.setPendingGroupIdFromLink);
  const pendingInviteCodeFromLink = useAppStore((s) => s.pendingInviteCodeFromLink);
  const setPendingInviteCodeFromLink = useAppStore((s) => s.setPendingInviteCodeFromLink);
  const hydrateTourForUser = useTourStore((s) => s.hydrateForUser);

  useEffect(() => {
    const unsubscribe = initialize();
    return unsubscribe;
  }, [initialize]);

  /**
   * iOS-stable boot queue
   * - Prevents router.replace/push from firing concurrently with heavy native init (RevenueCat) or large state updates.
   * - Ensures ordering: auth resolved -> layout ready -> purchases configured -> route set -> afterInteractions.
   */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((fn: () => Promise<void> | void) => {
    queue.current = queue.current
      .then(async () => {
        await fn();
      })
      .catch(() => {
        // swallow to keep the queue alive
      });
  }, []);

  const [layoutReady, setLayoutReady] = useState(false);
  useEffect(() => {
    // Mark layout ready on next tick after first paint.
    const t = setTimeout(() => setLayoutReady(true), 0);
    return () => clearTimeout(t);
  }, []);

  // Deep link handling: tallyapp://group/ID — open app and join group
  useEffect(() => {
    const getGroupIdFromUrl = (url: string): string | null => {
      const match = url.match(/group\/([^/?#]+)/);
      const id = match?.[1];
      return id ? id.trim() : null;
    };

    const getInviteCodeFromUrl = (url: string): string | null => {
      try {
        // Expected: tallyapp://join?code=ABCDEF
        const u = new URL(url);
        const raw = u.searchParams.get('code');
        if (!raw) return null;
        const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        return normalized.length > 0 ? normalized : null;
      } catch {
        // Fallback regex (in case URL parsing fails in some runtimes)
        const match = url.match(/[?&]code=([^&#]+)/i);
        if (!match?.[1]) return null;
        const normalized = match[1].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        return normalized.length > 0 ? normalized : null;
      }
    };

    const handleIncomingUrl = (url: string | null) => {
      if (!url) return;
      // Prefer join deep links (destructive actions) to avoid mixing up intents.
      const inviteCode = getInviteCodeFromUrl(url);
      if (inviteCode) {
        setPendingInviteCodeFromLink(inviteCode);
        setPendingGroupIdFromLink(null);
        return;
      }

      const id = getGroupIdFromUrl(url);
      if (!id) return;
      setPendingGroupIdFromLink(id);
    };

    Linking.getInitialURL().then(handleIncomingUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleIncomingUrl(url));
    return () => sub.remove();
  }, [session, setPendingGroupIdFromLink, setPendingInviteCodeFromLink]);

  const profileCheckDone = useRef(false);

  // Require email to be verified before entering app when Supabase "Confirm email" is enabled
  const isEmailVerified = (): boolean => {
    const at = session?.user?.email_confirmed_at;
    if (at === undefined) return true; // backward compat: no confirm required
    return Boolean(at && String(at).length > 0);
  };

  const desiredRoute = useMemo(() => {
    // Keep this pure: it should compute the desired pathname without performing side effects.
    if (isLoading) return null;
    if (!session) return '/login';
    if (!isEmailVerified()) return '/login';

    // If we have a deep link group pending, go there after login.
    if (pendingInviteCodeFromLink)
      return {
        pathname: '/join-group',
        params: { code: pendingInviteCodeFromLink },
      } as never;
    if (pendingGroupIdFromLink) return { pathname: `/group/${pendingGroupIdFromLink}`, params: { fromLink: '1' } } as never;
    return '/' as const;
  }, [isLoading, session, pendingGroupIdFromLink, pendingInviteCodeFromLink]);

  useEffect(() => {
    if (isLoading) return;
    if (!layoutReady) return;

    // Hydrate tour state as soon as we have a stable user id.
    const uid = session?.user?.id ?? null;
    if (uid) {
      enqueue(() => hydrateTourForUser(uid));
    }

    enqueue(async () => {
      // Profile gate: never run concurrently with navigation.
      if (uid && !profileCheckDone.current) {
        profileCheckDone.current = true;
        try {
          const p = await getProfile(uid);
          if (p && !isProfileComplete(p)) {
            router.replace('/complete-profile');
            return;
          }
        } catch {
          profileCheckDone.current = false;
        }
      }

      // Navigation resolver: only `app/_layout.tsx` performs post-auth redirects.
      const onLoginScreen = segments[0] === 'login';
      const onCompleteProfileScreen = segments[0] === 'complete-profile';

      if (!session) {
        profileCheckDone.current = false;
        if (!onLoginScreen) router.replace('/login');
        return;
      }
      if (!isEmailVerified()) {
        profileCheckDone.current = false;
        if (!onLoginScreen) router.replace('/login');
        return;
      }

      // If profile incomplete, ensure we're on complete-profile
      if (uid) {
        try {
          const p = await getProfile(uid);
          if (p && !isProfileComplete(p)) {
            if (!onCompleteProfileScreen) router.replace('/complete-profile');
            return;
          }
        } catch {
          // If profile fetch fails, do not bounce routes.
        }
      }

      // Otherwise go to desired route.
      if (desiredRoute) {
        // Clear pending deep link after applying it.
        const hasDeepLink = Boolean(pendingInviteCodeFromLink || pendingGroupIdFromLink);
        if (pendingInviteCodeFromLink) setPendingInviteCodeFromLink(null);
        if (pendingGroupIdFromLink) setPendingGroupIdFromLink(null);
        if (hasDeepLink || onLoginScreen || onCompleteProfileScreen) {
          router.replace(desiredRoute as never);
        }
      }
    });
  }, [
    isLoading,
    layoutReady,
    session,
    segments,
    desiredRoute,
    pendingGroupIdFromLink,
    setPendingGroupIdFromLink,
    pendingInviteCodeFromLink,
    setPendingInviteCodeFromLink,
    enqueue,
    router,
    hydrateTourForUser,
  ]);

  const headerBg = themeObject.colors.background;
  const headerFg = themeObject.colors.text;

  return (
    <PostHogProvider
      apiKey={POSTHOG_API_KEY}
      options={{
        host: POSTHOG_HOST,
        captureAppLifecycleEvents: false,
      }}
      autocapture={false}
    >
      <PostHogAuthSync />
      <SafeAreaProvider>
        <PremiumProvider>
          <ThemeProvider value={themeObject}>
            <View style={{ flex: 1 }}>
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: headerBg },
                  headerTintColor: headerFg,
                  headerTitleStyle: { color: headerFg },
                  headerShadowVisible: false,
                  contentStyle: { backgroundColor: headerBg },
                }}
              >
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="login" options={{ headerShown: false }} />
                <Stack.Screen
                  name="complete-profile"
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="profile"
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="edit-profile"
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="premium-status"
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="create-group"
                  options={{
                    title: 'Nou grup',
                    presentation: 'modal',
                    headerShown: false,
                    headerStyle: { backgroundColor: headerBg },
                    headerTintColor: headerFg,
                  }}
                />
                <Stack.Screen
                  name="add-expense"
                  options={{
                    title: 'Afegir despesa',
                    presentation: 'modal',
                    headerShown: false,
                    headerStyle: { backgroundColor: headerBg },
                    headerTintColor: headerFg,
                  }}
                />
                <Stack.Screen
                  name="scan-ticket"
                  options={{
                    title: 'Escanejar tiquet',
                    headerStyle: { backgroundColor: headerBg },
                    headerTintColor: headerFg,
                  }}
                />
                <Stack.Screen
                  name="scan-receipt"
                  options={{
                    title: 'Escanejar tiquet',
                    headerStyle: { backgroundColor: headerBg },
                    headerTintColor: headerFg,
                  }}
                />
                <Stack.Screen
                  name="group-balance-detail"
                  options={{
                    title: 'Estat de comptes i Historial',
                    headerStyle: { backgroundColor: headerBg },
                    headerTintColor: headerFg,
                  }}
                />
                <Stack.Screen
                  name="group/assign-items"
                  options={{
                    title: 'Repartir productes',
                    headerStyle: { backgroundColor: headerBg },
                    headerTintColor: headerFg,
                  }}
                />
                <Stack.Screen
                  name="paywall"
                  options={{
                    title: 'Premium',
                    headerShown: false,
                    headerStyle: { backgroundColor: headerBg },
                    headerTintColor: headerFg,
                  }}
                />
              </Stack>

              {/* Keep overlay mounted at absolute root container so pageY aligns with top: 0 */}
              <TourHost />
            </View>
          </ThemeProvider>
        </PremiumProvider>
      </SafeAreaProvider>
    </PostHogProvider>
  );
}
