/**
 * Theme-aware confirmation modal (replaces native Alert for consistent dark/light style).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useThemeColors } from '@/hooks';
import { ACCENT } from '@/theme/colors';

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel?: string | null;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
  loading?: boolean;
  onRequestClose?: () => void;
}

export function ConfirmModal({
  visible,
  title,
  message,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  destructive = false,
  loading = false,
  onRequestClose,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const resolvedCancel = cancelLabel === undefined ? t('alerts.cancel') : cancelLabel;
  const colors = useThemeColors();
  const handleClose = onRequestClose ?? onCancel;

  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <TouchableOpacity
        style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
        activeOpacity={1}
        onPress={handleClose}
      >
        <View
          style={[
            styles.box,
            {
              backgroundColor: colors.cardBackground,
              borderColor: colors.border,
            },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.message, { color: colors.secondaryText }]}>{message}</Text>
          <View style={styles.actions}>
            {resolvedCancel != null && resolvedCancel !== '' && (
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn, { borderColor: colors.border }]}
                onPress={onCancel}
                disabled={loading}
              >
                <Text style={[styles.cancelBtnText, { color: colors.text }]}>{resolvedCancel}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.btn,
                styles.confirmBtn,
                destructive ? { backgroundColor: '#EF4444', borderColor: '#EF4444' } : { backgroundColor: ACCENT, borderColor: ACCENT },
              ]}
              onPress={handleConfirm}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.confirmBtnText}>{confirmLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  box: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    minWidth: 280,
    maxWidth: 340,
    alignSelf: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
  },
  btn: {
    minWidth: 100,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: 'transparent',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600' },
  confirmBtn: {},
  confirmBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
