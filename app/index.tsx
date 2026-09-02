import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth/AuthProvider';

/**
 * Entry route. The root layout (app/_layout.tsx) already withholds
 * rendering until the session has been restored, so `status` here is never
 * 'loading' by the time this component mounts.
 */
export default function Index() {
  const { status } = useAuth();

  if (status === 'signed-in') {
    return <Redirect href="/(app)/today" />;
  }

  return <Redirect href="/onboarding" />;
}
