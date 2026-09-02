import { Redirect } from 'expo-router';

/**
 * Entry route. Full authentication (session persistence, real redirect
 * based on a signed-in user) is out of scope for this foundation phase —
 * see docs/ROADMAP.md. For now this always sends new visitors to the
 * onboarding placeholder, which links onward to the auth placeholder.
 */
export default function Index() {
  return <Redirect href="/onboarding" />;
}
