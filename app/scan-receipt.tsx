import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { analyzeReceipt, AI_ERROR_QUOTA, AI_ERROR_INVALID_RESULT } from '@/services/aiService';
import { useThemeColors } from '@/hooks';
import { usePostHog } from 'posthog-react-native';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ACCENT } from '@/theme/colors';

const MAX_IMAGE_SIZE = 1024;

export default function ScanReceiptScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const posthog = usePostHog();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [analyzing, setAnalyzing] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertTwoButtons, setAlertTwoButtons] = useState(false);

  const scanErrorContent = (msg: string, fallbackBody: string) => {
    if (msg === AI_ERROR_QUOTA) {
      return { title: t('scanReceipt.quotaTitle'), body: t('scanReceipt.quotaBody') };
    }
    if (msg === AI_ERROR_INVALID_RESULT) {
      return { title: t('scanReceipt.invalidReceiptTitle'), body: t('scanReceipt.invalidReceiptBody') };
    }
    return {
      title: t('scanReceipt.errorTitle'),
      body: (msg || fallbackBody) + t('scanReceipt.manualSuffix'),
    };
  };

  const getBase64ForUri = async (uri: string): Promise<string> => {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: MAX_IMAGE_SIZE } }],
        {
          compress: 0.8,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        }
      );
      if (manipulated.base64) return manipulated.base64;
    } catch {
      // fallback: read file as base64 without resize
    }
    return FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  };

  const goToManualEntry = () => {
    if (groupId) {
      router.replace({ pathname: '/add-expense', params: { groupId } } as never);
    }
  };

  const runAnalysisAndNavigate = async (base64: string) => {
    if (!groupId) {
      setAlertTitle(t('scanReceipt.errorTitle'));
      setAlertMessage(t('scanReceipt.missingGroupId'));
      setAlertTwoButtons(false);
      setAlertVisible(true);
      return;
    }
    setAnalyzing(true);
    try {
      const result = await analyzeReceipt(base64);
      setAnalyzing(false);
      const hasItems = result.items != null && result.items.length > 0;
      posthog.capture('expense_added', { method: 'ai_scan' });
      router.replace({
        pathname: '/add-expense',
        params: {
          groupId,
          fromScan: '1',
          description: result.store,
          amount: String(result.total),
          ...(hasItems ? { scannedItems: JSON.stringify(result.items) } : {}),
        },
      } as never);
    } catch (e) {
      setAnalyzing(false);
      const msg = e instanceof Error ? e.message : '';
      const { title, body } = scanErrorContent(msg, t('scanReceipt.readFailed'));
      setAlertTitle(title);
      setAlertMessage(body);
      setAlertTwoButtons(true);
      setAlertVisible(true);
    }
  };

  const handleCapture = async () => {
    if (!cameraRef.current || !permission?.granted) {
      if (!permission?.granted) requestPermission();
      return;
    }
    if (!groupId) {
      setAlertTitle(t('scanReceipt.errorTitle'));
      setAlertMessage(t('scanReceipt.missingGroupId'));
      setAlertTwoButtons(false);
      setAlertVisible(true);
      return;
    }
    setAnalyzing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
      });
      const uri = photo?.uri;
      if (!uri) {
        setAnalyzing(false);
        setAlertTitle(t('scanReceipt.errorTitle'));
        setAlertMessage(t('scanReceipt.photoSaveFailed'));
        setAlertTwoButtons(false);
        setAlertVisible(true);
        return;
      }
      const base64 = await getBase64ForUri(uri);
      await runAnalysisAndNavigate(base64);
    } catch (e) {
      setAnalyzing(false);
      const msg = e instanceof Error ? e.message : '';
      const { title, body } = scanErrorContent(msg, t('scanReceipt.readFailed'));
      setAlertTitle(title);
      setAlertMessage(body);
      setAlertTwoButtons(true);
      setAlertVisible(true);
    }
  };

  const handlePickFromGallery = async () => {
    if (!groupId) {
      setAlertTitle(t('scanReceipt.errorTitle'));
      setAlertMessage(t('scanReceipt.missingGroupId'));
      setAlertTwoButtons(false);
      setAlertVisible(true);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setAlertTitle(t('scanReceipt.permissionGalleryTitle'));
      setAlertMessage(t('scanReceipt.permissionGalleryBody'));
      setAlertTwoButtons(false);
      setAlertVisible(true);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    try {
      const base64 = await getBase64ForUri(uri);
      await runAnalysisAndNavigate(base64);
    } catch (e) {
      setAnalyzing(false);
      const msg = e instanceof Error ? e.message : '';
      const { title, body } = scanErrorContent(msg, t('scanReceipt.readImageFailed'));
      setAlertTitle(title);
      setAlertMessage(body);
      setAlertTwoButtons(true);
      setAlertVisible(true);
    }
  };

  if (!permission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.secondaryText }]}>{t('scanReceipt.checkingPermission')}</Text>
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.secondaryText }]}>{t('scanReceipt.needCamera')}</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>{t('scanReceipt.enableCamera')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <CameraView style={styles.camera} ref={cameraRef} />
      <View style={styles.captureBar} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.galleryBtn, { borderColor: colors.text }]}
          onPress={handlePickFromGallery}
          disabled={analyzing}
        >
          <Text style={[styles.galleryBtnText, { color: colors.text }]}>{t('scanReceipt.importGallery')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.captureBtn}
          onPress={handleCapture}
          disabled={analyzing}
        >
          <Text style={styles.captureBtnText}>{t('scanReceipt.capture')}</Text>
        </TouchableOpacity>
      </View>

      {/* Shown for the full analysis (Gemini and, if used, Groq fallback) until result or error */}
      <Modal visible={analyzing} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.accent} style={styles.spinner} />
            <Text style={[styles.overlayText, { color: colors.text }]}>{t('scanReceipt.analyzing')}</Text>
          </View>
        </View>
      </Modal>
      <ConfirmModal
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        cancelLabel={alertTwoButtons ? t('scanReceipt.back') : null}
        confirmLabel={alertTwoButtons ? t('scanReceipt.enterManually') : t('common.confirmOk')}
        onCancel={() => {
          setAlertVisible(false);
          if (alertTwoButtons) router.back();
        }}
        onConfirm={() => {
          setAlertVisible(false);
          if (alertTwoButtons) goToManualEntry();
        }}
        onRequestClose={() => {
          setAlertVisible(false);
          if (alertTwoButtons) router.back();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 48,
    paddingHorizontal: 24,
  },
  btn: {
    marginTop: 24,
    alignSelf: 'center',
    backgroundColor: ACCENT,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  btnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  camera: { flex: 1 },
  captureBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  galleryBtn: {
    backgroundColor: 'transparent',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
  },
  galleryBtnText: { fontSize: 15, fontWeight: '600' },
  captureBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 14,
  },
  captureBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
    padding: 36,
    alignItems: 'center',
    minWidth: 280,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  spinner: { marginBottom: 4 },
  overlayText: {
    marginTop: 20,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
});
