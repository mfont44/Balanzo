import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

import ca from './locales/ca.json';
import en from './locales/en.json';
import es from './locales/es.json';

export const LANGUAGE_STORAGE_KEY = 'TALLY_LANGUAGE';

/** Stored value: explicit locale or `system` to follow device. */
export type LanguagePreference = 'system' | 'ca' | 'es' | 'en';

/** Same resolution as initial i18n init: device ca/es, else English. */
export function getDeviceResolvedLanguage(): string {
  const deviceLanguageCode = getLocales()[0]?.languageCode ?? 'en';
  return deviceLanguageCode === 'ca' || deviceLanguageCode === 'es' ? deviceLanguageCode : 'en';
}

function resolveLanguageFromStorage(stored: string | null): string {
  if (stored === 'ca' || stored === 'es' || stored === 'en') {
    return stored;
  }
  return getDeviceResolvedLanguage();
}

const initialLng = getDeviceResolvedLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    ca: { translation: ca },
    es: { translation: es },
    en: { translation: en },
  },
  lng: initialLng,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

/** Call once on app load (e.g. next to hydrateTheme) to apply saved language preference. */
export async function hydrateLanguage(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    const lng = resolveLanguageFromStorage(stored);
    await i18n.changeLanguage(lng);
  } catch {
    // keep current i18n language
  }
}

/** Persist preference and switch i18n. Use `system` to follow device language. */
export async function setLanguagePreference(pref: LanguagePreference): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, pref);
    if (pref === 'system') {
      await i18n.changeLanguage(getDeviceResolvedLanguage());
    } else {
      await i18n.changeLanguage(pref);
    }
  } catch {
    // ignore persistence failures
  }
}

export default i18n;
