import { AvatarActionMenu } from '@/components/AvatarActionMenu';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useThemeColors } from '@/hooks';
import {
  AVATAR_UPLOAD_ERROR_CODE,
  checkUsernameAvailable,
  getProfile,
  pickAvatarFromLibrary,
  removeAvatar,
  updateProfile,
  uploadAvatar,
} from '@/services/profile';
import { useAuthStore } from '@/store';
import { ACCENT } from '@/theme/colors';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ArrowLeft, User } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

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

const COOLDOWN_DAYS = 15;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export default function EditProfileScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [initialUsername, setInitialUsername] = useState<string | null>(null);
  const [lastUsernameChange, setLastUsernameChange] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMenuVisible, setAvatarMenuVisible] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    getProfile(user.id).then((profile) => {
      if (profile) {
        setFullName(profile.full_name ?? '');
        setAvatarUrl(profile.avatar_url?.trim() ? profile.avatar_url : null);
        const u = (profile as { username?: string | null }).username ?? null;
        const uTrim = (u && u.trim()) || null;
        setUsername(uTrim ?? '');
        setInitialUsername(uTrim);
        setLastUsernameChange((profile as { last_username_change?: string | null }).last_username_change ?? null);
      }
      setLoading(false);
    });
  }, [user?.id]);

  const canChangeUsername = (): boolean => {
    if (!lastUsernameChange) return true;
    const then = new Date(lastUsernameChange).getTime();
    return Date.now() - then >= COOLDOWN_DAYS * MS_PER_DAY;
  };

  const daysUntilCanChange = (): number => {
    if (!lastUsernameChange) return 0;
    const then = new Date(lastUsernameChange).getTime();
    const elapsed = Date.now() - then;
    const cooldown = COOLDOWN_DAYS * MS_PER_DAY;
    if (elapsed >= cooldown) return 0;
    return Math.ceil((cooldown - elapsed) / MS_PER_DAY);
  };

  const showAlert = (title: string, message: string) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertVisible(true);
  };

  const pickAndUploadAvatar = async () => {
    if (!user?.id || avatarBusy) return;
    const picked = await pickAvatarFromLibrary();
    if (!picked) return;
    setAvatarBusy(true);
    const { avatar_url, error } = await uploadAvatar(user.id, picked.uri, avatarUrl, picked.mimeType);
    setAvatarBusy(false);
    if (error) {
      if (error.message === AVATAR_UPLOAD_ERROR_CODE.GIF_TOO_LARGE) {
        Alert.alert(t('alerts.errorTitle'), t('profile.avatarImageTooLarge'));
      } else {
        Alert.alert(t('alerts.errorTitle'), t('profile.avatarUpdateFailed'));
      }
      return;
    }
    setAvatarUrl(avatar_url);
  };

  const confirmRemoveAvatar = async () => {
    const currentUrl = avatarUrl?.trim();
    if (!user?.id || avatarBusy || !currentUrl) return;
    setAvatarBusy(true);
    const { error } = await removeAvatar(user.id, currentUrl);
    setAvatarBusy(false);
    if (error) {
      Alert.alert(t('alerts.errorTitle'), t('profile.avatarUpdateFailed'));
      return;
    }
    setAvatarUrl(null);
  };

  const onAvatarPress = () => {
    if (!user?.id || avatarBusy || saving) return;
    if (avatarUrl?.trim()) {
      setAvatarMenuVisible(true);
    } else {
      void pickAndUploadAvatar();
    }
  };

  const handleSave = async () => {
    const name = fullName.trim();
    const newUsername = username.trim();
    if (!name) {
      showAlert(t('editProfile.alertNameRequiredTitle'), t('editProfile.alertNameRequiredMessage'));
      return;
    }
    if (!user?.id) return;

    const hadUsername = Boolean(initialUsername && initialUsername.length > 0);
    const usernameChanged = newUsername !== (initialUsername ?? '');

    if (usernameChanged) {
      if (hadUsername && !canChangeUsername()) {
        const days = daysUntilCanChange();
        showAlert(
          t('editProfile.alertUsernameCooldownTitle'),
          t('editProfile.alertUsernameCooldownMessage', { cooldownDays: COOLDOWN_DAYS, days })
        );
        return;
      }
      const { available, errorMessage } = await checkUsernameAvailable(newUsername, user.id);
      if (!available) {
        showAlert(
          t('editProfile.alertUsernameTakenTitle'),
          errorMessage ?? t('editProfile.alertUsernameTakenMessage')
        );
        return;
      }
    }

    setSaving(true);
    const payload: Parameters<typeof updateProfile>[1] = { full_name: name };
    if (usernameChanged) {
      payload.username = newUsername || null;
      payload.last_username_change = new Date().toISOString();
    }
    const { error } = await updateProfile(user.id, payload);
    setSaving(false);
    if (error) {
      const msg =
        error.message?.includes('unique') || error.message?.includes('username')
          ? t('editProfile.errorUsernameDuplicate')
          : (error.message ?? '');
      showAlert(t('alerts.errorTitle'), msg);
      return;
    }
    router.back();
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={{ flex: 1 }}>
          <View style={[styles.header, { borderColor: colors.border }]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <ArrowLeft size={22} color={colors.text} strokeWidth={2} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>{t('editProfile.title')}</Text>
            <View style={styles.backBtn} />
          </View>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.avatarBlock}>
              <View style={styles.avatarRow}>
                <TouchableOpacity
                  onPress={onAvatarPress}
                  activeOpacity={0.85}
                  disabled={avatarBusy || saving}
                  style={styles.avatarTouchable}
                >
                  {avatarUrl ? (
                    <Image
                      source={{ uri: avatarUrl }}
                      style={[styles.avatar, { backgroundColor: colors.card, borderColor: colors.border }]}
                    />
                  ) : (
                    <View style={[styles.avatarPlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <User size={48} color={colors.textSecondary} strokeWidth={1.5} />
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
            </View>

            <Text style={[styles.label, { color: colors.textSecondary }]}>{t('editProfile.labelName')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              placeholder={t('editProfile.placeholderName')}
              placeholderTextColor={colors.textSecondary}
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              editable={!saving}
            />

            <Text style={[styles.label, { color: colors.textSecondary }]}>{t('editProfile.labelUsername')}</Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.text,
                  opacity: initialUsername && !canChangeUsername() ? 0.7 : 1,
                },
              ]}
              placeholder={t('editProfile.placeholderUsername')}
              placeholderTextColor={colors.textSecondary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!saving && (!initialUsername || canChangeUsername())}
            />
            {initialUsername && !canChangeUsername() && (
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                {t('editProfile.hintUsernameCooldown', { cooldownDays: COOLDOWN_DAYS })}
              </Text>
            )}

            <TouchableOpacity
              style={[styles.submit, saving && styles.submitDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitText}>{t('editProfile.saveButton')}</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </TouchableWithoutFeedback>
      <ConfirmModal
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        cancelLabel={null}
        confirmLabel={t('common.confirmOk')}
        onCancel={() => setAlertVisible(false)}
        onConfirm={() => setAlertVisible(false)}
        onRequestClose={() => setAlertVisible(false)}
      />

      <AvatarActionMenu
        visible={avatarMenuVisible}
        hasAvatar={Boolean(avatarUrl?.trim())}
        onClose={() => setAvatarMenuVisible(false)}
        onChangePhoto={() => void pickAndUploadAvatar()}
        onRemovePhoto={() => void confirmRemoveAvatar()}
      />
    </KeyboardAvoidingView>
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
    paddingTop: 56,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  scroll: { padding: 20, paddingBottom: 40 },
  avatarBlock: {
    alignItems: 'center',
    marginBottom: 28,
  },
  avatarRow: {
    position: 'relative',
    width: 112,
    height: 112,
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
  label: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  hint: {
    fontSize: 12,
    marginTop: -16,
    marginBottom: 20,
  },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 28,
  },
  submit: {
    height: 44,
    borderRadius: 10,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.7 },
  submitText: { fontSize: 14, fontWeight: '600', color: '#fff' },
});
