import type { ConfigContext, ExpoConfig } from 'expo/config';

// `app.config.ts` is loaded by a plain `require()` and cannot resolve
// sibling `.ts` modules, so the shared product identity lives in a JSON
// file (also re-exported, typed, from src/config/appInfo.ts for app code).
const APP_INFO = require('./src/config/app-info.json') as {
  productName: string;
  slug: string;
  scheme: string;
  bundleIdentifier: string;
  tagline: string;
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_INFO.productName,
  slug: APP_INFO.slug,
  scheme: APP_INFO.scheme,
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  // FamilyFlow targets iOS and Android only (see docs/PRODUCT.md). Web
  // support would additionally require react-native-web and is not set up.
  platforms: ['ios', 'android'],
  ios: {
    ...config.ios,
    supportsTablet: true,
    bundleIdentifier: APP_INFO.bundleIdentifier,
  },
  android: {
    ...config.android,
    package: APP_INFO.bundleIdentifier,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-asset',
    'expo-secure-store',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: {
          backgroundColor: '#111318',
        },
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/icon.png',
        color: '#4F6BFE',
      },
    ],
    [
      'expo-localization',
      {
        // Supported locales are declared centrally in src/i18n/index.ts.
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    ...config.extra,
  },
});
