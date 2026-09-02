import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAppTheme } from '@/theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const TAB_ICONS: Record<string, IconName> = {
  today: 'calendar-today',
  calendar: 'calendar-month',
  inbox: 'tray-full',
  family: 'account-group',
  profile: 'account-circle',
};

/**
 * Primary tab navigation (Today, Calendar, Inbox, Family, Profile — see
 * docs/PRODUCT.md, "MVP navigation"). Not session-guarded yet: a real
 * `useSession()` check redirecting unauthenticated users back to
 * `/(auth)/sign-in` is part of the authentication phase, not this
 * foundation (see docs/ROADMAP.md).
 */
export default function AppTabsLayout() {
  const { t } = useTranslation('navigation');
  const theme = useAppTheme();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outline,
        },
        tabBarIcon: ({ color, size }) => (
          <MaterialCommunityIcons
            name={TAB_ICONS[route.name] ?? 'circle'}
            color={color}
            size={size}
          />
        ),
      })}
    >
      <Tabs.Screen name="today" options={{ title: t('today') }} />
      <Tabs.Screen name="calendar" options={{ title: t('calendar') }} />
      <Tabs.Screen name="inbox" options={{ title: t('inbox') }} />
      <Tabs.Screen name="family" options={{ title: t('family') }} />
      <Tabs.Screen name="profile" options={{ title: t('profile') }} />
    </Tabs>
  );
}
