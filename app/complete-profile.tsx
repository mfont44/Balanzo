import { ConfirmModal } from '@/components/ConfirmModal';
import { useThemeColors } from '@/hooks';
import { updateProfile } from '@/services/profile';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const STEPS = 2;

export default function CompleteProfileScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, loadProfile } = useAuthStore();
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: step,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [step, slideAnim]);

  const progress = ((step + 1) / STEPS) * 100;

  const canNextStep1 =
    username.trim().length > 0 &&
    !usernameError &&
    !checkingUsername &&
    fullName.trim().length > 0;

  const showAlert = (title: string, message: string) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertVisible(true);
  };

  const checkUsernameAvailability = async (raw: string) => {
    const value = raw.trim();
    if (!value) {
      setUsernameError(null);
      return;
    }
    // If the user already owns this username, allow it.
    if (user?.id) {
      // We don't have profile.username loaded yet; rely on server-side unique check at submit.
    }
    setCheckingUsername(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('username', value)
        .limit(1)
        .maybeSingle();

      if (error) {
        // On error, don't block, but surface a generic message.
        setUsernameError(t('profile.usernameValidateFailed'));
      } else if (data && (!user || data.id !== user.id)) {
        setUsernameError(t('profile.usernameTaken'));
      } else {
        setUsernameError(null);
      }
    } finally {
      setCheckingUsername(false);
    }
  };

  const handleNext = () => {
    Keyboard.dismiss();
    if (step === 0) {
      setStep(1);
      return;
    }
    if (step === 1 && !canNextStep1) {
      showAlert(t('profile.alertRequiredTitle'), t('profile.alertRequiredMessage'));
      return;
    }
    if (step === STEPS - 1) {
      submitProfile();
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS - 1));
  };

  const submitProfile = async () => {
    const safeUsername = username.trim();
    const name = fullName.trim();
    if (!user?.id || !safeUsername || !name) return;
    setSaving(true);
    try {
      // Final defensive check to reduce race conditions on unique username.
      await checkUsernameAvailability(safeUsername);
      if (usernameError) {
        setSaving(false);
        return;
      }

      const { error } = await updateProfile(user.id, {
        username: safeUsername,
        full_name: name,
      });
      if (error) {
        const message =
          error.message.includes('unique') || error.message.includes('username')
            ? t('profile.usernameTakenSubmit')
            : t('profile.registrationFailed');
        setUsernameError(
          error.message.includes('unique') || error.message.includes('username')
            ? t('profile.usernameTaken')
            : usernameError
        );
        setAlertTitle(t('profile.errorTitle'));
        setAlertMessage(message);
        setAlertVisible(true);
        setSaving(false);
        return;
      }
      await loadProfile(user.id);
      setSaving(false);
      router.replace({ pathname: '/', params: { tutorial: '1' } } as never);
    } catch (e) {
      setSaving(false);
      setAlertTitle(t('profile.errorTitle'));
      setAlertMessage(t('profile.registrationFailedNetwork'));
      setAlertVisible(true);
    }
  };

  const handleBack = () => {
    Keyboard.dismiss();
    if (step > 0) setStep((s) => s - 1);
  };

  const dismissKeyboard = () => Keyboard.dismiss();

  return (
    <View style={styles.wrapper}>
      <TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
        <KeyboardAvoidingView
          style={[styles.container, { backgroundColor: colors.background }]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <View style={[styles.outer, { paddingTop: insets.top }]}>
          {/* Premium Dark: clear progress bar at top */}
          <View style={[styles.progressWrap, { backgroundColor: colors.border }]}>
            <View style={[styles.progressBg, { backgroundColor: colors.border }]} />
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progress}%`,
                  backgroundColor: colors.accent,
                },
              ]}
            />
          </View>

          <View style={styles.sliderWrap}>
            <Animated.View
              style={[
                styles.slideRow,
                {
                  transform: [
                    {
                      translateX: slideAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -SCREEN_WIDTH],
                      }),
                    },
                  ],
                },
              ]}
            >
              {/* PAGE 0 – Welcome */}
              <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
                <Text style={[styles.stepOverline, { color: colors.secondaryText }]}>
                  {t('profile.brandName')}
                </Text>
                <Text style={[styles.welcomeTitle, { color: colors.text }]}>
                  {t('profile.welcomeTitle')}
                </Text>
                <Text style={[styles.welcomeSubtitle, { color: colors.secondaryText }]}>
                  {t('profile.welcomeSubtitle')}
                </Text>
                <TouchableOpacity
                  style={[styles.primaryCta, { backgroundColor: colors.accent }]}
                  onPress={() => handleNext()}
                  activeOpacity={0.9}
                  disabled={saving}
                >
                  <Text style={styles.primaryCtaText}>{t('profile.startCta')}</Text>
                </TouchableOpacity>
              </View>

              {/* PAGE 1 – Identity */}
              <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>{t('profile.basicsTitle')}</Text>
                <Text style={[styles.stepSubtitle, { color: colors.secondaryText }]}>
                  {t('profile.basicsSubtitle')}
                </Text>
                <View style={styles.identityRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>
                      {t('profile.usernameLabel')}
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        { backgroundColor: colors.cardBackground, borderColor: colors.border, color: colors.text },
                      ]}
                      placeholder={t('profile.usernamePlaceholder')}
                      placeholderTextColor={colors.secondaryText}
                      value={username}
                      onChangeText={(text) => {
                        setUsername(text);
                        if (usernameError) setUsernameError(null);
                      }}
                      onBlur={() => checkUsernameAvailability(username)}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!saving}
                    />
                  </View>
                </View>
                {usernameError ? (
                  <Text style={styles.errorTextInline}>{usernameError}</Text>
                ) : null}
                <View style={styles.identityRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>
                      {t('profile.fullNameLabel')}
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        { backgroundColor: colors.cardBackground, borderColor: colors.border, color: colors.text },
                      ]}
                      placeholder={t('profile.fullNamePlaceholder')}
                      placeholderTextColor={colors.secondaryText}
                      value={fullName}
                      onChangeText={setFullName}
                      autoCapitalize="words"
                      editable={!saving}
                    />
                  </View>
                </View>
                <Text style={[styles.stepSubtitle, { color: colors.secondaryText, marginTop: 16 }]}>
                  {t('profile.profileNoteLater')}
                </Text>
              </View>
            </Animated.View>
          </View>

          {step > 0 && (
            <View
              style={[
                styles.footer,
                {
                  borderTopColor: colors.border,
                  paddingBottom: insets.bottom > 0 ? insets.bottom : 20,
                  paddingTop: 12,
                },
              ]}
            >
              <TouchableOpacity style={styles.backBtn} onPress={handleBack} disabled={saving}>
                <Text style={[styles.backBtnText, { color: colors.secondaryText }]}>{t('profile.back')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.nextBtn,
                  { backgroundColor: colors.accent },
                  ((step === 1 && !canNextStep1) || saving) && styles.nextBtnDisabled,
                ]}
                onPress={handleNext}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.nextBtnText}>
                    {step === STEPS - 1 ? t('profile.saveAndContinue') : t('profile.continue')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
          </View>
        </KeyboardAvoidingView>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  container: { flex: 1 },
  outer: { flex: 1 },
  progressWrap: {
    height: 4,
    width: '100%',
    overflow: 'hidden',
  },
  progressBg: {
    ...StyleSheet.absoluteFillObject,
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
  },
  sliderWrap: { flex: 1, overflow: 'hidden' },
  slideRow: {
    flexDirection: 'row',
    flex: 1,
  },
  slide: {
    paddingHorizontal: 28,
    paddingTop: 32,
    justifyContent: 'flex-start',
  },
  stepOverline: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  welcomeTitle: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 12,
  },
  welcomeSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 32,
  },
  primaryCta: {
    marginTop: 8,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  primaryCtaText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 14,
    marginBottom: 28,
  },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  errorTextInline: {
    marginTop: 6,
    fontSize: 13,
    color: '#EF4444',
  },
  identityRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  fieldLabel: {
    fontSize: 12,
    marginBottom: 6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
    paddingHorizontal: 28,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  backBtn: { paddingVertical: 12, paddingHorizontal: 8 },
  backBtnText: { fontSize: 15, fontWeight: '500' },
  nextBtn: {
    minWidth: 140,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextBtnDisabled: { opacity: 0.5 },
  nextBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
