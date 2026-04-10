import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useThemeColors } from '@/hooks';
import { supabase } from '@/services/supabase';
import { leaveGroup } from '@/services/groups';
import { styles } from '@/components/group/groupDetailStyles';

type Props = {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  isCreator: boolean;
  currentUserId?: string;
  membersCount: number;
  onShowAlert: (title: string, message: string) => void;
};

export default function GroupDetailSettingsModal({
  visible,
  onClose,
  groupId,
  isCreator,
  currentUserId,
  membersCount,
  onShowAlert,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  const [deleting, setDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const handleDeleteGroup = useCallback(() => {
    if (!isCreator) return;
    Alert.alert(
      t('settingsGroup.deleteConfirmTitle'),
      t('settingsGroup.deleteConfirmMessage'),
      [
        { text: t('alerts.cancel'), style: 'cancel' },
        {
          text: t('expenses.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleting(true);
              await supabase.from('groups').delete().eq('id', groupId);
              onClose();
              router.replace('/');
            } catch (e) {
              onShowAlert(
                t('addExpense.errorTitle'),
                e instanceof Error ? e.message : t('settingsGroup.deleteFailed')
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  }, [groupId, isCreator, onClose, onShowAlert, router, t]);

  const handleLeaveGroup = useCallback(async () => {
    if (!currentUserId) return;
    try {
      setIsLeaving(true);
      const { error } = await leaveGroup(groupId, currentUserId);
      onClose();
      if (error) {
        onShowAlert(t('addExpense.errorTitle'), error.message);
        return;
      }
      router.replace('/');
    } catch (e) {
      onShowAlert(t('addExpense.errorTitle'), e instanceof Error ? e.message : t('settingsGroup.leaveFailed'));
    } finally {
      setIsLeaving(false);
    }
  }, [currentUserId, groupId, onClose, onShowAlert, router, t]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View
          style={[
            styles.modalContent,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            {t('settingsGroup.title')}
          </Text>
          <Text style={[styles.mutedText, { color: colors.textSecondary }]}>
            {t('settingsGroup.membersCount', { count: membersCount })}
          </Text>

          {isCreator ? (
            <TouchableOpacity
              style={styles.deleteGroupBtn}
              onPress={handleDeleteGroup}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Text style={[styles.deleteGroupText, { color: '#fff' }]}>
                  {t('settingsGroup.deleteGroup')}
                </Text>
              )}
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.leaveGroupBtn, { borderColor: colors.border }]}
                onPress={handleLeaveGroup}
                disabled={isLeaving}
              >
                {isLeaving ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={[styles.leaveGroupBtnText, { color: colors.text }]}>
                    {t('settingsGroup.leaveGroup')}
                  </Text>
                )}
              </TouchableOpacity>
              <Text style={[styles.mutedText, { color: colors.textSecondary }]}>
                {t('settingsGroup.onlyCreatorDeletes')}
              </Text>
            </>
          )}

          <TouchableOpacity
            style={styles.modalCloseBtn}
            onPress={onClose}
          >
            <Text style={styles.modalCloseText}>{t('settingsGroup.close')}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

