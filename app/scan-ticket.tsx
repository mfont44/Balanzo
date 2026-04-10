import { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useThemeColors } from '@/hooks';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ACCENT } from '@/theme/colors';

const MOCK_ITEMS = [
  { name: 'Sopar', amount: 20 },
  { name: 'Vi', amount: 10 },
  { name: 'Postres', amount: 5 },
];

type ScreenState = 'camera' | 'processing' | 'result';

export default function ScanTicketScreen() {
  const colors = useThemeColors();
  useLocalSearchParams<{ groupId: string }>(); // reserved for future: pass group when saving scanned items
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<ScreenState>('camera');
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  const handleCapture = async () => {
    if (!cameraRef.current || !permission?.granted) {
      if (!permission?.granted) requestPermission();
      return;
    }
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
      });
      if (photo?.uri) {
        setState('processing');
        setTimeout(() => setState('result'), 2000);
      }
    } catch (e) {
      setAlertMessage(e instanceof Error ? e.message : 'No s\'ha pogut fer la foto.');
      setAlertVisible(true);
    }
  };

  const handleBack = () => {
    router.back();
  };

  if (!permission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.secondaryText }]}>Comprovant permís de càmera...</Text>
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.secondaryText }]}>Cal el permís de càmera per escanejar tiquets.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
          <Text style={styles.primaryBtnText}>Activar càmera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (state === 'processing') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.processingText, { color: colors.text }]}>Processing...</Text>
        </View>
      </View>
    );
  }

  if (state === 'result') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.resultHeader}>
          <Text style={[styles.resultTitle, { color: colors.text }]}>Ítems detectats (simulat)</Text>
          <Text style={[styles.resultSubtitle, { color: colors.secondaryText }]}>Pròximament: assignació tipus Tinder</Text>
        </View>
        <View style={styles.resultList}>
          {MOCK_ITEMS.map((item, i) => (
            <View key={i} style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.resultCardName, { color: colors.text }]}>{item.name}</Text>
              <Text style={styles.resultCardAmount}>{item.amount}€</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleBack}>
          <Text style={styles.primaryBtnText}>Tornar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <CameraView style={styles.camera} ref={cameraRef}>
        <View style={styles.captureBar}>
          <TouchableOpacity
            style={styles.captureBtn}
            onPress={handleCapture}
          >
            <Text style={styles.captureBtnText}>Capture</Text>
          </TouchableOpacity>
        </View>
      </CameraView>
      <ConfirmModal
        visible={alertVisible}
        title="Error"
        message={alertMessage}
        cancelLabel={null}
        confirmLabel="D'acord"
        onCancel={() => setAlertVisible(false)}
        onConfirm={() => setAlertVisible(false)}
        onRequestClose={() => setAlertVisible(false)}
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
  primaryBtn: {
    marginTop: 24,
    alignSelf: 'center',
    backgroundColor: ACCENT,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  camera: { flex: 1 },
  captureBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 14,
  },
  captureBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  processingText: { fontSize: 18, fontWeight: '600' },
  resultHeader: { padding: 20, paddingTop: 60 },
  resultTitle: { fontSize: 22, fontWeight: '700' },
  resultSubtitle: { fontSize: 14, marginTop: 4 },
  resultList: { padding: 20, gap: 12 },
  resultCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  resultCardName: { fontSize: 17, fontWeight: '600' },
  resultCardAmount: { fontSize: 17, fontWeight: '700', color: ACCENT },
});
