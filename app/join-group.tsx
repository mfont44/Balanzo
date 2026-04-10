import { useEffect, useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '@/store';
import { joinGroupByCode, fetchGroups } from '@/services/groups';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ACCENT } from '@/theme/colors';

const CODE_LENGTH = 6;
const FREE_GROUP_LIMIT = 3;

function isInvalidInviteCodeError(e: unknown): boolean {
  const err = e as { message?: string; code?: string };
  const msg = (err?.message ?? '').toLowerCase();
  if (msg.includes('invalid invite')) return true;
  // Postgres `raise exception` for bad/missing code (see join_group_by_code migration).
  if (err?.code === '22023') return true;
  return false;
}

export default function JoinGroupScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const { isPremium } = useSubscription();
  const { code: deepLinkCode } = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [checkingLimit, setCheckingLimit] = useState(true);
  const [groupsCount, setGroupsCount] = useState(0);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [joinConfirmVisible, setJoinConfirmVisible] = useState(false);
  const [joinCodeToConfirm, setJoinCodeToConfirm] = useState<string | null>(null);
  const [joinConfirmLoading, setJoinConfirmLoading] = useState(false);

  const normalizedCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);

  // Prefill invite code from deep link (never auto-joins; user must confirm).
  useEffect(() => {
    if (!deepLinkCode) return;
    const normalized = String(deepLinkCode)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, CODE_LENGTH);
    if (!normalized) return;
    setCode((prev) => (prev.trim().length > 0 ? prev : normalized));
  }, [deepLinkCode]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!user?.id) {
        if (mounted) {
          setGroupsCount(0);
          setCheckingLimit(false);
        }
        return;
      }
      try {
        const myGroups = await fetchGroups(user.id);
        if (mounted) setGroupsCount(myGroups.length);
      } catch {
        if (mounted) setGroupsCount(0);
      } finally {
        if (mounted) setCheckingLimit(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const showAlert = (title: string, message: string) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertVisible(true);
  };

  const handleJoin = async () => {
    if (normalizedCode.length !== CODE_LENGTH) {
      showAlert(t('joinGroup.invalidCodeTitle'), t('joinGroup.invalidCodeMessage'));
      return;
    }
    if (!user?.id) {
      showAlert(t('joinGroup.errorTitle'), t('joinGroup.mustSignIn'));
      return;
    }

    // Deep links / user flows must never trigger destructive actions invisibly.
    setJoinCodeToConfirm(normalizedCode);
    setJoinConfirmVisible(true);
  };

  const confirmJoin = async () => {
    if (!joinCodeToConfirm) return;

    // App-level premium gating (client-side) before performing the destructive join action.
    if (!isPremium && !checkingLimit && groupsCount >= FREE_GROUP_LIMIT) {
      setJoinConfirmVisible(false);
      Alert.alert(t('groups.limitReachedTitle'), t('groups.limitReachedMessage'), [
        {
          text: t('groups.seePremium'),
          onPress: () => router.push('/paywall' as never),
        },
      ]);
      return;
    }

    setJoining(true);
    setJoinConfirmLoading(true);
    try {
      const groupId = await joinGroupByCode(joinCodeToConfirm);
      setJoinConfirmVisible(false);
      router.replace(`/group/${groupId}` as never);
    } catch (e) {
      setJoinConfirmVisible(false);
      if (isInvalidInviteCodeError(e)) {
        showAlert(t('joinGroup.wrongCodeTitle'), t('joinGroup.wrongCodeMessage'));
      } else {
        const err = e as Error;
        showAlert(t('joinGroup.errorTitle'), err?.message ?? t('joinGroup.genericError'));
      }
    } finally {
      setJoinConfirmLoading(false);
      setJoining(false);
      setJoinCodeToConfirm(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]}>{t('joinGroup.title')}</Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
            {t('joinGroup.subtitle')}
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            placeholder="ABC123"
            placeholderTextColor={colors.secondaryText}
            value={code}
            onChangeText={(t) => setCode(t.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH))}
            editable={!joining}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={CODE_LENGTH}
          />
          <TouchableOpacity
            style={[styles.btn, joining && styles.btnDisabled]}
            onPress={handleJoin}
            disabled={joining || joinConfirmVisible || checkingLimit || normalizedCode.length !== CODE_LENGTH}
            activeOpacity={0.8}
          >
            {joining ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.btnText}>{t('joinGroup.joinButton')}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            disabled={joining}
          >
            <Text style={[styles.backBtnText, { color: colors.accent }]}>{t('joinGroup.back')}</Text>
          </TouchableOpacity>
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

      <ConfirmModal
        visible={joinConfirmVisible}
        title={t('joinGroup.confirmTitle')}
        message={t('joinGroup.confirmMessage')}
        confirmLabel={t('joinGroup.joinButton')}
        onCancel={() => {
          setJoinConfirmVisible(false);
          setJoinCodeToConfirm(null);
        }}
        onConfirm={() => confirmJoin()}
        loading={joinConfirmLoading}
        destructive={false}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, padding: 24, paddingTop: 48 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 20,
    letterSpacing: 4,
    marginBottom: 20,
  },
  btn: {
    backgroundColor: ACCENT,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  backBtn: { marginTop: 16, alignItems: 'center' },
  backBtnText: { fontSize: 16, fontWeight: '600', color: ACCENT },
});
