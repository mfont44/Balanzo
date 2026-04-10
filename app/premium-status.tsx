import { useThemeColors } from '@/hooks';
import { ACCENT } from '@/theme/colors';
import { useRouter } from 'expo-router';
import { ArrowLeft, Sparkles } from 'lucide-react-native';
import Purchases from 'react-native-purchases';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function PremiumStatusScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  const handleManageSubscription = async () => {
    try {
      await Purchases.showManageSubscriptions();
    } catch {
      Alert.alert(
        t('profile.subscriptionManageAlertTitle'),
        t('profile.subscriptionManageAlertMessage'),
        [{ text: t('alerts.ok') }]
      );
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('premiumStatus.backA11y')}
        >
          <ArrowLeft size={22} color={colors.text} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('premiumStatus.screenTitle')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.cardBackground,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.iconRing, { borderColor: `${ACCENT}40` }]}>
            <Sparkles size={36} color={ACCENT} strokeWidth={2} />
          </View>
          <Text style={[styles.headline, { color: colors.text }]}>{t('premiumStatus.headline')}</Text>
          <Text style={[styles.body, { color: colors.secondaryText }]}>{t('premiumStatus.body')}</Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: ACCENT }]}
          onPress={handleManageSubscription}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>{t('premiumStatus.manageButton')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 40,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
  },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
  },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 28,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryBtn: {
    marginTop: 24,
    width: '100%',
    maxWidth: 400,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
