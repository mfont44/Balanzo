/**
 * Bottom-sheet style modal for profile photo actions (change / remove / cancel).
 */

import { useThemeColors } from '@/hooks';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DESTRUCTIVE = '#EF4444';

export type AvatarActionMenuProps = {
  visible: boolean;
  hasAvatar: boolean;
  onClose: () => void;
  onChangePhoto: () => void;
  onRemovePhoto: () => void;
};

export function AvatarActionMenu({
  visible,
  hasAvatar,
  onClose,
  onChangePhoto,
  onRemovePhoto,
}: AvatarActionMenuProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.cardBackground,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.title, { color: colors.text }]}>{t('profile.avatarSheetTitle')}</Text>

          <TouchableOpacity
            style={[styles.row, { backgroundColor: colors.optionRowBg }]}
            onPress={() => {
              onClose();
              onChangePhoto();
            }}
            activeOpacity={0.75}
            accessibilityRole="button"
          >
            <Ionicons name="pencil" size={22} color={colors.accent} />
            <Text style={[styles.rowLabel, { color: colors.text }]}>{t('profile.avatarSheetChange')}</Text>
          </TouchableOpacity>

          {hasAvatar ? (
            <TouchableOpacity
              style={[styles.row, styles.rowDestructive, { backgroundColor: 'rgba(239, 68, 68, 0.08)' }]}
              onPress={() => {
                onClose();
                onRemovePhoto();
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <Ionicons name="trash-outline" size={22} color={DESTRUCTIVE} />
              <Text style={[styles.rowLabel, { color: DESTRUCTIVE }]}>{t('profile.avatarSheetRemove')}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[styles.row, styles.cancelRow, { borderColor: colors.border }]}
            onPress={onClose}
            activeOpacity={0.75}
            accessibilityRole="button"
          >
            <Text style={[styles.cancelLabel, { color: colors.textSecondary }]}>
              {t('profile.avatarSheetCancel')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
      },
      android: { elevation: 16 },
      default: {},
    }),
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 16,
    opacity: 0.6,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  rowDestructive: {
    marginBottom: 10,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  cancelRow: {
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 0,
    gap: 0,
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
