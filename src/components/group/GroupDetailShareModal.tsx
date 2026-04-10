import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Modal, Platform, Share, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/hooks';
import { styles } from '@/components/group/groupDetailStyles';

type Props = {
  visible: boolean;
  onClose: () => void;
  inviteCodeRaw: string; // trimmed + uppercase, can be empty
  inviteCodeDisplay: string; // '—' fallback
  onShowAlert: (title: string, message: string) => void;
};

export default function GroupDetailShareModal({
  visible,
  onClose,
  inviteCodeRaw,
  inviteCodeDisplay,
  onShowAlert,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  const handleCopyCode = useCallback(async () => {
    const code = inviteCodeRaw?.trim();
    if (!code) return;
    await Clipboard.setStringAsync(code);
    onShowAlert(t('shareGroup.copyTitle'), t('shareGroup.copyMessage'));
  }, [inviteCodeRaw, onShowAlert, t]);

  const handleShareViaApp = useCallback(async () => {
    const code = inviteCodeRaw?.trim() ?? '';
    const shareMessage = t('shareGroup.shareMessage', { code });
    try {
      if (Platform.OS === 'web') {
        await Clipboard.setStringAsync(shareMessage);
        onShowAlert(t('shareGroup.copyTitle'), t('shareGroup.messageCopied'));
        return;
      }

      const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(shareMessage)}`;
      try {
        await Linking.openURL(whatsappUrl);
      } catch {
        await Share.share({
          message: shareMessage,
          title: t('shareGroup.shareDialogTitle'),
        });
      }
    } catch (e) {
      if (e instanceof Error && e.message !== 'User did not share') {
        onShowAlert(
          t('addExpense.errorTitle'),
          e.message || t('shareGroup.whatsappError')
        );
      }
    }
  }, [inviteCodeRaw, onShowAlert, t]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={[styles.modalOverlay, styles.shareModalOverlay]}
        activeOpacity={1}
        onPress={onClose}
      >
        <View
          style={[
            styles.modalContent,
            styles.shareModalContent,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <Text
            style={[styles.modalTitle, styles.shareModalTitle, { color: colors.text }]}
          >
            {t('shareGroup.title')}
          </Text>

          <View style={styles.shareModalCodeRow}>
            <View
              style={[
                styles.shareInviteCodeBox,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text
                style={[styles.shareModalCodeText, { color: colors.text }]}
                selectable
              >
                {inviteCodeDisplay}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.copyCodeIconBtn, { borderColor: colors.border }]}
              onPress={() => {
                // fire-and-forget, this is lightweight
                void handleCopyCode();
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="copy-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.sharePrimaryBtn}
            onPress={() => {
              onClose();
              void handleShareViaApp();
            }}
            activeOpacity={0.85}
          >
            <Ionicons
              name="share-social"
              size={18}
              color="#fff"
              style={styles.sharePrimaryBtnIcon}
            />
            <Text style={styles.sharePrimaryBtnText}>{t('shareGroup.shareWhatsapp')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.shareModalCloseLink}
            onPress={onClose}
          >
            <Text style={styles.modalCloseText}>{t('shareGroup.close')}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

