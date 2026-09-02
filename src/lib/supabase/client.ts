import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { env, isSupabaseConfigured } from '@/lib/env';
import { createLogger } from '@/lib/logger/logger';

import type { Database } from './types';

const logger = createLogger('supabase');

// A syntactically valid but non-functional placeholder so the client can
// always be constructed during the foundation phase, when no real Supabase
// project is connected yet. Every real request against it will fail fast
// with a network error rather than silently doing nothing.
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_ANON_KEY = 'placeholder-anon-key';

if (!isSupabaseConfigured) {
  logger.warn(
    'Supabase is not configured — using a placeholder client. Set EXPO_PUBLIC_SUPABASE_URL ' +
      'and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env to connect to a real project.',
  );
}

/**
 * App-wide Supabase client. Session persistence uses AsyncStorage (not
 * SecureStore) because Supabase sessions routinely exceed SecureStore's
 * ~2KB per-item limit — this matches Supabase's own React Native guidance.
 * `expo-secure-store` remains available for small, genuinely sensitive
 * values (see src/lib/secureStorage.ts once auth is implemented).
 *
 * flowType is explicitly 'pkce' — supabase-js still defaults to 'implicit'
 * (tokens in a URL *fragment*: `familyflow://confirm#access_token=...`)
 * for backwards compatibility. Every deep-link handler in this app
 * (app/(auth)/confirm.tsx, app/reset-password.tsx, src/lib/auth/oauth.ts)
 * reads a `?code=` *query* param and calls exchangeCodeForSession(code),
 * which only exists under PKCE. Confirmed by testing an actual local
 * signup end to end — without this, GoTrue's confirmation/recovery emails
 * link to a fragment-based redirect these screens can't read at all. See
 * docs/DECISIONS.md.
 */
export const supabase = createClient<Database>(
  env.EXPO_PUBLIC_SUPABASE_URL ?? PLACEHOLDER_URL,
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? PLACEHOLDER_ANON_KEY,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  },
);
