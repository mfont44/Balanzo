import { useThemeColors } from '@/hooks';
import { useAuthStore } from '@/store';
import { ACCENT } from '@/theme/colors';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';

type AuthMode = 'signIn' | 'signUp';

export default function LoginScreen() {
  const colors = useThemeColors();
  const { signIn, signUp } = useAuthStore();

  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  const handleSubmit = async () => {
    setError(null);
    const emailTrimmed = email.trim();

    if (!emailTrimmed) {
      setError('Introdueix el correu electrònic.');
      return;
    }
    if (!password) {
      setError('Introdueix la contrasenya.');
      return;
    }
    if (mode === 'signUp' && password !== confirmPassword) {
      setError('Les contrasenyes no coincideixen.');
      return;
    }

    setLoading(true);
    const fn = mode === 'signUp' ? signUp : signIn;
    const { error: authError } = await fn(emailTrimmed, password);
    setLoading(false);

    if (authError) {
      setError(authError?.message ?? 'S\'ha produït un error.');
      return;
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.text }]}>Tally</Text>
            <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
              Despeses compartides, simple.
            </Text>

            <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[
                styles.modeBtn,
                {
                  backgroundColor: mode === 'signIn' ? colors.accent : colors.cardBackground,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => {
                setMode('signIn');
                setError(null);
              }}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  { color: mode === 'signIn' ? '#fff' : colors.secondaryText },
                ]}
              >
                Iniciar sessió
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeBtn,
                {
                  backgroundColor: mode === 'signUp' ? colors.accent : colors.cardBackground,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => {
                setMode('signUp');
                setError(null);
              }}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  { color: mode === 'signUp' ? '#fff' : colors.secondaryText },
                ]}
              >
                Registrar-me
              </Text>
            </TouchableOpacity>
          </View>

            <View style={styles.form}>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.cardBackground, borderColor: error ? '#EF4444' : colors.border, color: colors.text },
              ]}
              placeholder="Correu electrònic"
              placeholderTextColor={colors.secondaryText}
              value={email}
              onChangeText={(t) => { setEmail(t); clearError(); }}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
            />
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.cardBackground, borderColor: error ? '#EF4444' : colors.border, color: colors.text },
              ]}
              placeholder="Contrasenya"
              placeholderTextColor={colors.secondaryText}
              value={password}
              onChangeText={(t) => { setPassword(t); clearError(); }}
              secureTextEntry={true}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="oneTimeCode"
              editable={!loading}
            />
            {mode === 'signUp' && (
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.cardBackground,
                    borderColor: error && error.includes('coincideixen') ? '#EF4444' : colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder="Confirma la contrasenya"
                placeholderTextColor={colors.secondaryText}
                value={confirmPassword}
                onChangeText={(t) => { setConfirmPassword(t); clearError(); }}
                secureTextEntry={true}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="oneTimeCode"
                editable={!loading}
              />
            )}
            {error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitBtnText}>
                  {mode === 'signUp' ? 'Registrar-me' : 'Iniciar sessió'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 32 },
  content: { paddingHorizontal: 28 },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, textAlign: 'center', marginBottom: 36 },
  modeToggle: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  modeBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeBtnText: { fontSize: 14, fontWeight: '600' },
  form: { gap: 14 },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'System' : undefined,
  },
  errorText: {
    fontSize: 14,
    color: '#EF4444',
    marginTop: 4,
  },
  submitBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
