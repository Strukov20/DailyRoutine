import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { addLocalDays, dayBoundsUtcFor } from '@/domain/calendar/dateUtils';
import { useFamilyConflicts } from '@/domain/conflicts/hooks';
import { useActiveFamily } from '@/domain/family/hooks';
import { usePendingAssignments } from '@/domain/tasks/hooks';
import { useAppTheme } from '@/theme';

/** Section 15's own "bounded range" for the badge, matching the Conflict Center screen's own window — a tab badge that disagreed with what tapping it shows would be worse than no badge. */
const CONFLICT_BADGE_WINDOW_DAYS = 7;

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
  // In-app assignment awareness (Section 11) — no push notifications this
  // phase, so a tab badge is the only signal that something needs a
  // response. Deliberately just a count, not a snapshot of *which* tasks —
  // that detail lives in the Family board's "Awaiting your response"
  // section, which is where a tap on this badge actually leads.
  const pendingAssignmentsQuery = usePendingAssignments();
  const pendingCount = pendingAssignmentsQuery.data?.length ?? 0;

  // Conflict Center entry-point badge (Section 15) — same bounded
  // today..+7-day window the Conflict Center screen itself queries, so the
  // badge count never disagrees with what tapping through actually shows.
  const activeFamilyQuery = useActiveFamily();
  const familyId = activeFamilyQuery.activeFamily?.id ?? null;
  const todayBounds = dayBoundsUtcFor(new Date());
  const upcomingBounds = dayBoundsUtcFor(addLocalDays(new Date(), CONFLICT_BADGE_WINDOW_DAYS));
  const conflictsQuery = useFamilyConflicts(familyId, todayBounds.startUtc, upcomingBounds.endUtc);
  const conflictCount = conflictsQuery.data?.length ?? 0;

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
      <Tabs.Screen name="today" options={{ title: t('today'), tabBarButtonTestID: 'tab-today' }} />
      <Tabs.Screen
        name="calendar"
        options={{
          title: t('calendar'),
          tabBarBadge: conflictCount > 0 ? conflictCount : undefined,
          tabBarButtonTestID: 'tab-calendar',
        }}
      />
      <Tabs.Screen name="inbox" options={{ title: t('inbox'), tabBarButtonTestID: 'tab-inbox' }} />
      <Tabs.Screen
        name="family"
        options={{
          title: t('family'),
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarButtonTestID: 'tab-family',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t('profile'), tabBarButtonTestID: 'tab-profile' }}
      />
    </Tabs>
  );
}
