import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
} from 'react-native';
import { useSubscription, useThemeColors } from '@/hooks';
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';
import { useAuthStore } from '@/store';
import { createGroup } from '@/services/groups';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ACCENT } from '@/theme/colors';
import { DEFAULT_CURRENCY } from '@/utils/constants';
import { fetchGroups } from '@/services/groups';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';

const CURRENCIES = ['EUR', 'USD'];
const FREE_GROUP_LIMIT = 3;

export default function CreateGroupScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const posthog = usePostHog();
  const { user } = useAuthStore();
  const { isPremium } = useSubscription();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [saving, setSaving] = useState(false);
  const [groupsCount, setGroupsCount] = useState<number>(0);
  const [checkingLimit, setCheckingLimit] = useState(true);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    const loadOwned = async () => {
      if (!user?.id) {
        if (mounted) {
          setGroupsCount(0);
          setCheckingLimit(false);
        }
        return;
      }
      try {
        const groups = await fetchGroups(user.id);
        if (mounted) setGroupsCount(groups.length);
      } catch {
        if (mounted) setGroupsCount(0);
      } finally {
        if (mounted) setCheckingLimit(false);
      }
    };
    loadOwned();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const isAtFreeLimit = useMemo(() => !isPremium && groupsCount >= FREE_GROUP_LIMIT, [isPremium, groupsCount]);

  const showAlert = (title: string, message: string) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertVisible(true);
  };

  const handleSave = async () => {
    if (isAtFreeLimit) {
      Alert.alert(t('groups.limitReachedTitle'), t('groups.limitReachedMessage'), [
        {
          text: t('groups.seePremium'),
          onPress: () => router.push('/paywall' as never),
        },
      ]);
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      showAlert(t('createGroup.alertTitle'), t('createGroup.enterName'));
      return;
    }
    if (!user?.id) {
      showAlert(t('createGroup.alertTitle'), t('createGroup.mustSignIn'));
      return;
    }
    setSaving(true);
    try {
      await createGroup({
        name: trimmed,
        currency,
        createdBy: user.id,
      });
      posthog.capture('group_created');
      router.back();
    } catch (e: unknown) {
      const err = e as { message?: string; details?: string; hint?: string; code?: string };
      const message =
        err?.message ??
        err?.details ??
        err?.hint ??
        (e instanceof Error ? e.message : t('createGroup.createFailedGeneric'));
      console.error('[Tally] Create group error:', e);
      showAlert(t('createGroup.alertTitle'), message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.content}>
          <View style={[styles.topRow, { paddingTop: insets.top }]}>
            <TouchableOpacity
              style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.back()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('profile.back')}
            >
              <ArrowLeft size={22} color={colors.text} strokeWidth={2} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
          </View>

          <Text style={[styles.label, { color: colors.secondaryText }]}>{t('createGroup.groupNameLabel')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            placeholder={t('createGroup.groupNamePlaceholder')}
            placeholderTextColor={colors.textSecondary}
            value={name}
            onChangeText={setName}
            editable={!saving}
            autoCapitalize="words"
          />

          <Text style={[styles.label, { marginTop: 24, color: colors.textSecondary }]}>
            {t('createGroup.currencyLabel')}
          </Text>
          <View style={styles.currencyRow}>
            {CURRENCIES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[
                  styles.currencyBtn,
                  { borderColor: colors.border, backgroundColor: colors.card },
                  currency === c && styles.currencyBtnActive,
                ]}
                onPress={() => setCurrency(c)}
                disabled={saving}
              >
                <Text
                  style={[
                    styles.currencyBtnText,
                    { color: colors.text },
                    currency === c && styles.currencyBtnTextActive,
                  ]}
                >
                  {c}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[
              styles.saveBtn,
              (saving || checkingLimit) && styles.saveBtnDisabled,
              isAtFreeLimit && { backgroundColor: colors.buttonSecondaryBg, borderColor: colors.border, borderWidth: 1 },
            ]}
            onPress={handleSave}
            disabled={saving || checkingLimit}
          >
            {saving || checkingLimit ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={[styles.saveBtnText, isAtFreeLimit && { color: colors.text }]}>
                {t('createGroup.createButton')}
              </Text>
            )}
          </TouchableOpacity>

          {!isPremium && !checkingLimit && isAtFreeLimit && (
            <Text style={[styles.limitText, { color: colors.secondaryText }]}>
              {t('createGroup.limitReached')}
            </Text>
          )}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingTop: 0,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 0,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  currencyRow: {
    flexDirection: 'row',
    gap: 10,
  },
  currencyBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  currencyBtnActive: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
  },
  currencyBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  currencyBtnTextActive: {
    color: ACCENT,
  },
  saveBtn: {
    marginTop: 28,
    height: 44,
    borderRadius: 12,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.7,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  limitText: {
    marginTop: 14,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
});
