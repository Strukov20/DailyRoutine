import { Redirect } from 'expo-router';

/**
 * Safety-net route for familyflow://auth-callback (see
 * src/lib/auth/oauth.ts). In the normal path, expo-web-browser's
 * openAuthSessionAsync intercepts this URL directly and the OS never
 * actually navigates here. This route only matters if the OS delivers the
 * redirect as a real deep link instead (e.g. the browser session was
 * dismissed and reopened) — in that case there is nothing left to do but
 * send the user back to the entry route, which re-evaluates auth status.
 */
export default function AuthCallbackScreen() {
  return <Redirect href="/" />;
}
