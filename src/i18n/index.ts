import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enAuth from './locales/en/auth.json';
import enCalendar from './locales/en/calendar.json';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enFamily from './locales/en/family.json';
import enNavigation from './locales/en/navigation.json';
import enNotifications from './locales/en/notifications.json';
import enScreens from './locales/en/screens.json';
import enTasks from './locales/en/tasks.json';
import ukAuth from './locales/uk/auth.json';
import ukCalendar from './locales/uk/calendar.json';
import ukCommon from './locales/uk/common.json';
import ukErrors from './locales/uk/errors.json';
import ukFamily from './locales/uk/family.json';
import ukNavigation from './locales/uk/navigation.json';
import ukNotifications from './locales/uk/notifications.json';
import ukScreens from './locales/uk/screens.json';
import ukTasks from './locales/uk/tasks.json';

export const SUPPORTED_LANGUAGES = ['en', 'uk'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

export const defaultNamespace = 'common';

export const resources = {
  en: {
    common: enCommon,
    navigation: enNavigation,
    screens: enScreens,
    auth: enAuth,
    tasks: enTasks,
    errors: enErrors,
    family: enFamily,
    notifications: enNotifications,
    calendar: enCalendar,
  },
  uk: {
    common: ukCommon,
    navigation: ukNavigation,
    screens: ukScreens,
    auth: ukAuth,
    tasks: ukTasks,
    errors: ukErrors,
    family: ukFamily,
    notifications: ukNotifications,
    calendar: ukCalendar,
  },
} as const;

function detectDeviceLanguage(): SupportedLanguage {
  const deviceLocales = Localization.getLocales();
  const match = deviceLocales.find((locale) =>
    SUPPORTED_LANGUAGES.includes(locale.languageCode as SupportedLanguage),
  );
  return (match?.languageCode as SupportedLanguage | undefined) ?? DEFAULT_LANGUAGE;
}

let initialized = false;

export function initI18n(): typeof i18n {
  if (initialized) {
    return i18n;
  }
  initialized = true;

  // i18next's default export legitimately has a `.use()` method — this
  // isn't the unrelated named `use` export the rule below guards against.
  // eslint-disable-next-line import/no-named-as-default-member
  void i18n.use(initReactI18next).init({
    resources,
    lng: detectDeviceLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    defaultNS: defaultNamespace,
    ns: Object.keys(resources[DEFAULT_LANGUAGE]),
    compatibilityJSON: 'v4',
    interpolation: {
      escapeValue: false, // React already escapes output
    },
    returnNull: false,
  });

  return i18n;
}

export default i18n;
