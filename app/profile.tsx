import { AvatarActionMenu } from '@/components/AvatarActionMenu';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useSubscription, useThemeColors } from '@/hooks';
import {
  LANGUAGE_STORAGE_KEY,
  type LanguagePreference,
  setLanguagePreference,
} from '@/i18n';
import {
  AVATAR_UPLOAD_ERROR_CODE,
  getProfile,
  getProfileStats,
  pickAvatarFromLibrary,
  removeAvatar,
  uploadAvatar,
} from '@/services/profile';
import { supabase } from '@/services/supabase';
import type { ThemePreference } from '@/store';
import { getDisplayName, useAppStore, useAuthStore } from '@/store';
import { ACCENT } from '@/theme/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  ChevronRight,
  Contrast,
  CreditCard,
  ShieldCheck,
  User,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const SECURITY_GREEN = '#22C55E';

const AVATAR_EDIT_SHADOW = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 3,
  },
  android: { elevation: 4 },
  default: {},
});

function themeLabel(
  pref: ThemePreference,
  t: (key: string) => string
): string {
  if (pref === 'dark') return t('profile.themeValueDark');
  if (pref === 'light') return t('profile.themeValueLight');
  return t('profile.themeValueSystem');
}

function languageLabel(
  pref: LanguagePreference,
  t: (key: string) => string
): string {
  if (pref === 'system') return t('profileScreen.languageSystem');
  if (pref === 'ca') return t('profileScreen.languageCa');
  if (pref === 'es') return t('profileScreen.languageEs');
  return t('profileScreen.languageEn');
}

export default function ProfileScreen() {
  const { t } = useTranslation();
  const menuItems = useMemo(
    (): { key: string; label: string; route: string | null; icon: typeof User }[] => [
      { key: 'edit', label: t('profile.menuEditProfile'), route: '/edit-profile', icon: User },
      { key: 'security', label: t('profile.menuSecurity'), route: null, icon: ShieldCheck },
      { key: 'subscription', label: t('profile.menuSubscription'), route: null, icon: CreditCard },
    ],
    [t]
  );
  const router = useRouter();
  const { user, signOut } = useAuthStore();
  const [profile, setProfile] = useState<{
    full_name?: string;
    avatar_url?: string | null;
    is_pro?: boolean;
    age?: number | null;
    why_using_tally?: string | null;
  } | null>(null);
  const [stats, setStats] = useState<{
    groupsCount: number;
    expensesCount: number;
    friendsCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [themeModal, setThemeModal] = useState(false);
  const [languageModal, setLanguageModal] = useState(false);
  const [languagePref, setLanguagePref] = useState<LanguagePreference>('system');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMenuVisible, setAvatarMenuVisible] = useState(false);
  const { isPremium } = useSubscription();
  const themePreference = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const colors = useThemeColors();
  const tc = {
    bg: colors.background,
    text: colors.text,
    muted: colors.secondaryText,
    card: colors.cardBackground,
    divider: colors.divider,
    optionRowBg: colors.optionRowBg,
  };

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([getProfile(user.id), getProfileStats(user.id)]).then(([p, s]) => {
      setProfile(p ?? null);
      setStats(s ?? null);
      setLoading(false);
    });
  }, [user?.id]);

  useEffect(() => {
    void AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((s) => {
      if (s === 'ca' || s === 'es' || s === 'en' || s === 'system') {
        setLanguagePref(s);
      }
    });
  }, []);

  const handleLogout = async () => {
    await signOut();
    router.replace('/login');
  };

  const pickAndUploadAvatar = async () => {
    if (!user?.id || avatarBusy) return;
    const picked = await pickAvatarFromLibrary();
    if (!picked) return;
    setAvatarBusy(true);
    const { avatar_url, error } = await uploadAvatar(
      user.id,
      picked.uri,
      profile?.avatar_url,
      picked.mimeType
    );
    setAvatarBusy(false);
    if (error) {
      if (error.message === AVATAR_UPLOAD_ERROR_CODE.GIF_TOO_LARGE) {
        Alert.alert(t('alerts.errorTitle'), t('profile.avatarImageTooLarge'));
      } else {
        Alert.alert(t('alerts.errorTitle'), t('profile.avatarUpdateFailed'));
      }
      return;
    }
    setProfile((p) => (p ? { ...p, avatar_url } : p));
  };

  const confirmRemoveAvatar = async () => {
    const currentUrl = profile?.avatar_url?.trim();
    if (!user?.id || avatarBusy || !currentUrl) return;
    setAvatarBusy(true);
    const { error } = await removeAvatar(user.id, currentUrl);
    setAvatarBusy(false);
    if (error) {
      Alert.alert(t('alerts.errorTitle'), t('profile.avatarUpdateFailed'));
      return;
    }
    setProfile((p) => (p ? { ...p, avatar_url: null } : p));
  };

  const onAvatarPress = () => {
    if (!user?.id || avatarBusy) return;
    if (profile?.avatar_url?.trim()) {
      setAvatarMenuVisible(true);
    } else {
      void pickAndUploadAvatar();
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t('profile.deleteAccountAlertTitle'),
      t('profile.deleteAccountAlertMessage'),
      [
        { text: t('alerts.cancel'), style: 'cancel' },
        {
          text: t('alerts.delete'),
          style: 'destructive',
          onPress: async () => {
            setDeleteLoading(true);
            try {
              const { error } = await supabase.rpc('delete_user_account');
              if (error) throw new Error(error.message);
              await supabase.auth.signOut();
              router.replace('/login');
            } catch (e) {
              const raw = e instanceof Error ? e.message : '';
              const blockedDelete =
                raw.includes('DELETE_ACCOUNT_BLOCKED_FINANCES') ||
                raw.includes('expense_splits_user_id_fkey') ||
                raw.includes('expense_item_assignments_user_id_fkey');
              Alert.alert(
                t('alerts.errorTitle'),
                blockedDelete
                  ? t('profile.deleteAccountBlockedFinances')
                  : raw || t('profile.deleteAccountErrorFallback'),
                [{ text: t('alerts.ok') }]
              );
            } finally {
              setDeleteLoading(false);
            }
          },
        },
      ]
    );
  };

  const displayName = getDisplayName(
    profile ? { full_name: profile.full_name ?? '' } : null,
    user?.email
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: tc.bg }]}>
        <ActivityIndicator size="small" color={ACCENT} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: tc.bg }]}>
      <View style={[styles.header, { borderBottomColor: tc.divider }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ArrowLeft size={22} color={tc.text} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: tc.text }]}>{t('profile.screenTitle')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Top section: centered avatar + name */}
        <View style={styles.topSection}>
          <View style={styles.avatarRow}>
            <TouchableOpacity
              onPress={onAvatarPress}
              activeOpacity={0.85}
              disabled={avatarBusy}
              style={styles.avatarTouchable}
            >
              {profile?.avatar_url?.trim() ? (
                <Image
                  source={{ uri: profile.avatar_url as string }}
                  style={[styles.avatar, { backgroundColor: tc.card, borderColor: tc.divider }]}
                />
              ) : (
                <View style={[styles.avatarPlaceholder, { backgroundColor: tc.card, borderColor: tc.divider }]}>
                  <User size={48} color={tc.muted} strokeWidth={1.5} />
                </View>
              )}
              <View
                style={[
                  styles.avatarEditBadge,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                  AVATAR_EDIT_SHADOW,
                ]}
                pointerEvents="none"
              >
                <Ionicons name="pencil" size={13} color={colors.primary} />
              </View>
            </TouchableOpacity>
            {avatarBusy && (
              <View style={[styles.avatarUploadOverlay, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            )}
          </View>
          <View style={styles.nameBlock}>
            <Text style={[styles.displayName, { color: tc.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            {profile?.is_pro && (
              <View style={styles.proBadge}>
                <Text style={styles.proBadgeText}>{t('profile.proMemberBadge')}</Text>
              </View>
            )}
          </View>
        </View>

        {/* StatsBar: Grups, Despeses, Amics in dark cards */}
        <View style={styles.statsBar}>
          <View style={[styles.statCard, { backgroundColor: tc.card }]}>
            <Text style={[styles.statValue, { color: tc.text }]}>{stats?.groupsCount ?? 0}</Text>
            <Text style={[styles.statLabel, { color: tc.muted }]}>{t('profile.statGroups')}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: tc.card }]}>
            <Text style={[styles.statValue, { color: tc.text }]}>{stats?.expensesCount ?? 0}</Text>
            <Text style={[styles.statLabel, { color: tc.muted }]}>{t('profile.statExpenses')}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: tc.card }]}>
            <Text style={[styles.statValue, { color: tc.text }]}>{stats?.friendsCount ?? 0}</Text>
            <Text style={[styles.statLabel, { color: tc.muted }]}>{t('profile.statFriends')}</Text>
          </View>
        </View>

        {/* Settings menu with icons and chevrons */}
        <View style={[styles.menu, { backgroundColor: tc.card }]}>
          {menuItems.map((item, index) => {
            const isSecurity = item.key === 'security';
            const isSubscription = item.key === 'subscription';
            const isNavigable = item.route != null || isSubscription;
            const iconColor = isSecurity ? SECURITY_GREEN : isNavigable ? tc.text : tc.muted;
            const labelColor = isSecurity ? SECURITY_GREEN : isNavigable ? tc.text : tc.muted;
            return (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.menuRow,
                  index < menuItems.length - 1 && [styles.menuRowBorder, { borderBottomColor: tc.divider }],
                ]}
                onPress={() => {
                  if (isSubscription) {
                    if (isPremium) {
                      router.push('/premium-status' as never);
                    } else {
                      router.push('/paywall' as never);
                    }
                    return;
                  }
                  if (item.route != null) router.push(item.route as never);
                }}
                disabled={item.route == null && !isSubscription}
                activeOpacity={0.7}
              >
                <View style={styles.menuLeft}>
                  <View style={styles.menuIconWrap}>
                    <item.icon size={20} color={iconColor} strokeWidth={2} />
                  </View>
                  <Text style={[styles.menuLabel, { color: labelColor }]}>
                    {item.label}
                  </Text>
                </View>
                {!isSecurity && isNavigable && (
                  <ChevronRight size={20} color={tc.muted} strokeWidth={2} />
                )}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.menuRow, styles.menuRowBorder, { borderBottomColor: tc.divider }]}
            onPress={() => setThemeModal(true)}
            activeOpacity={0.7}
          >
            <View style={styles.menuLeft}>
              <View style={styles.menuIconWrap}>
                <Contrast size={20} color={tc.text} strokeWidth={2} />
              </View>
              <Text style={[styles.menuLabel, { color: tc.text }]}>{t('profile.themeMenuLabel')}</Text>
            </View>
            <View style={styles.menuRightWithLabel}>
              <Text style={[styles.themeValueLabel, { color: tc.muted }]}>{themeLabel(themePreference, t)}</Text>
              <ChevronRight size={20} color={tc.muted} strokeWidth={2} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setLanguageModal(true)}
            activeOpacity={0.7}
          >
            <View style={styles.menuLeft}>
              <View style={styles.menuIconWrap}>
                <Ionicons name="globe-outline" size={20} color={tc.text} />
              </View>
              <Text style={[styles.menuLabel, { color: tc.text }]}>{t('profileScreen.language')}</Text>
            </View>
            <View style={styles.menuRightWithLabel}>
              <Text style={[styles.themeValueLabel, { color: tc.muted }]}>
                {languageLabel(languagePref, t)}
              </Text>
              <ChevronRight size={20} color={tc.muted} strokeWidth={2} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Tancar sessió: secondary button */}
        <TouchableOpacity style={[styles.logoutBtn, { borderColor: tc.divider }]} onPress={() => setLogoutConfirmVisible(true)} activeOpacity={0.8}>
          <Text style={[styles.logoutBtnText, { color: tc.text }]}>{t('profile.logoutButton')}</Text>
        </TouchableOpacity>

        {/* Eliminar compte: red text link at bottom */}
        <TouchableOpacity
          style={styles.deleteRow}
          onPress={handleDeleteAccount}
          activeOpacity={0.8}
          disabled={deleteLoading}
        >
          {deleteLoading ? (
            <ActivityIndicator size="small" color="#EF4444" />
          ) : (
            <Text style={styles.deleteRowText}>{t('profile.deleteAccountButton')}</Text>
          )}
        </TouchableOpacity>

        <View style={styles.bottomSpace} />
      </ScrollView>

      <ConfirmModal
        visible={logoutConfirmVisible}
        title={t('profile.logoutConfirmTitle')}
        message={t('profile.logoutConfirmMessage')}
        cancelLabel={t('alerts.cancel')}
        confirmLabel={t('profile.logoutConfirmButton')}
        onCancel={() => setLogoutConfirmVisible(false)}
        onConfirm={async () => {
          setLogoutConfirmVisible(false);
          await handleLogout();
        }}
        onRequestClose={() => setLogoutConfirmVisible(false)}
      />

      <AvatarActionMenu
        visible={avatarMenuVisible}
        hasAvatar={Boolean(profile?.avatar_url?.trim())}
        onClose={() => setAvatarMenuVisible(false)}
        onChangePhoto={() => void pickAndUploadAvatar()}
        onRemovePhoto={() => void confirmRemoveAvatar()}
      />

      <Modal
        visible={themeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setThemeModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setThemeModal(false)}
        >
          <View style={[styles.modalContent, styles.themeModalContent, { backgroundColor: tc.card, borderColor: tc.divider }]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.modalTitle, { color: tc.text }]}>{t('profile.themeModalTitle')}</Text>
            <Text style={[styles.modalBody, { marginBottom: 16, color: tc.muted }]}>
              {t('profile.themeModalSubtitle')}
            </Text>
            {(['dark', 'light', 'system'] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.themeOptionRow,
                  { backgroundColor: tc.optionRowBg },
                  themePreference === option && styles.themeOptionRowActive,
                ]}
                onPress={() => {
                  setTheme(option);
                  setThemeModal(false);
                }}
              >
                <Text
                  style={[
                    styles.themeOptionText,
                    { color: tc.text },
                    themePreference === option && styles.themeOptionTextActive,
                  ]}
                >
                  {option === 'dark'
                    ? t('profile.themeOptionDark')
                    : option === 'light'
                      ? t('profile.themeOptionLight')
                      : t('profile.themeOptionSystem')}
                </Text>
                {themePreference === option && (
                  <View style={styles.themeOptionCheck}>
                    <Text style={styles.themeOptionCheckText}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.modalCloseBtn, { marginTop: 8 }]}
              onPress={() => setThemeModal(false)}
            >
              <Text style={styles.modalCloseText}>{t('profileScreen.close')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={languageModal}
        transparent
        animationType="fade"
        onRequestClose={() => setLanguageModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setLanguageModal(false)}
        >
          <View
            style={[styles.modalContent, styles.themeModalContent, { backgroundColor: tc.card, borderColor: tc.divider }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: tc.text }]}>{t('profileScreen.language')}</Text>
            <Text style={[styles.modalBody, { marginBottom: 16, color: tc.muted }]}>
              {t('profileScreen.languageModalSubtitle')}
            </Text>
            {(['system', 'ca', 'es', 'en'] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.themeOptionRow,
                  { backgroundColor: tc.optionRowBg },
                  languagePref === option && styles.themeOptionRowActive,
                ]}
                onPress={async () => {
                  await setLanguagePreference(option);
                  setLanguagePref(option);
                  setLanguageModal(false);
                }}
              >
                <Text
                  style={[
                    styles.themeOptionText,
                    { color: tc.text },
                    languagePref === option && styles.themeOptionTextActive,
                  ]}
                >
                  {option === 'system'
                    ? t('profileScreen.languageSystem')
                    : option === 'ca'
                      ? t('profileScreen.languageCa')
                      : option === 'es'
                        ? t('profileScreen.languageEs')
                        : t('profileScreen.languageEn')}
                </Text>
                {languagePref === option && (
                  <View style={styles.themeOptionCheck}>
                    <Text style={styles.themeOptionCheckText}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.modalCloseBtn, { marginTop: 8 }]}
              onPress={() => setLanguageModal(false)}
            >
              <Text style={styles.modalCloseText}>{t('profileScreen.close')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingBottom: 48,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  topSection: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  avatarRow: {
    position: 'relative',
    width: 112,
    height: 112,
    marginBottom: 16,
  },
  avatarTouchable: {
    width: 112,
    height: 112,
  },
  avatarEditBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 56,
  },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
  },
  avatarPlaceholder: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameBlock: { alignItems: 'center' },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  proBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderWidth: 1,
    borderColor: ACCENT,
  },
  proBadgeText: { fontSize: 12, fontWeight: '600', color: ACCENT },
  statsBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    marginBottom: 32,
    alignSelf: 'stretch',
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 11, marginTop: 4 },
  menu: {
    alignSelf: 'stretch',
    marginHorizontal: 24,
    paddingHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 4,
  },
  menuRowBorder: {
    borderBottomWidth: 1,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuIconWrap: {
    marginRight: 12,
    width: 28,
    alignItems: 'center',
  },
  menuLabel: { fontSize: 15, fontWeight: '500' },
  menuLabelMuted: {},
  menuRightWithLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  themeValueLabel: { fontSize: 14, marginRight: 2 },
  logoutBtn: {
    marginTop: 8,
    width: '100%',
    maxWidth: 340,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  logoutBtnText: { fontSize: 15, fontWeight: '600' },
  deleteRow: {
    marginTop: 28,
    paddingVertical: 16,
    alignItems: 'center',
  },
  deleteRowText: { fontSize: 14, fontWeight: '500', color: '#EF4444' },
  bottomSpace: { height: 24 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
  },
  modalTitle: { fontSize: 17, fontWeight: '600', marginBottom: 12 },
  modalBody: { fontSize: 14, marginBottom: 16 },
  modalCloseBtn: { alignItems: 'center' },
  modalCloseText: { fontSize: 14, fontWeight: '600', color: ACCENT },
  themeModalContent: { minWidth: 280 },
  themeOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  themeOptionRowActive: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
  },
  themeOptionText: { fontSize: 15, fontWeight: '500' },
  themeOptionTextActive: { color: ACCENT, fontWeight: '600' },
  themeOptionCheck: { width: 24, alignItems: 'flex-end' },
  themeOptionCheckText: { fontSize: 16, fontWeight: '700', color: ACCENT },
});
