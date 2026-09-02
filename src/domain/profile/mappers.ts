import type { Tables } from '@/lib/supabase/types';

import type { Profile } from './types';

// The generated Database type widens CHECK-constrained columns to plain
// `string` (Postgres CHECK constraints aren't reflected in generated types
// — see src/lib/supabase/types.ts's header). These narrow back to the
// literal unions the DB actually enforces, falling back to a safe default
// instead of throwing if an unexpected value ever appears.
const SUPPORTED_LANGUAGES: readonly Profile['preferredLanguage'][] = ['en', 'uk'];
const SUPPORTED_COLOR_SCHEMES: readonly Profile['preferredColorScheme'][] = [
  'system',
  'light',
  'dark',
];

function asPreferredLanguage(value: string): Profile['preferredLanguage'] {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
    ? (value as Profile['preferredLanguage'])
    : 'en';
}

function asPreferredColorScheme(value: string): Profile['preferredColorScheme'] {
  return (SUPPORTED_COLOR_SCHEMES as readonly string[]).includes(value)
    ? (value as Profile['preferredColorScheme'])
    : 'system';
}

export function mapProfileRow(row: Tables<'profiles'>): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    preferredLanguage: asPreferredLanguage(row.preferred_language),
    preferredColorScheme: asPreferredColorScheme(row.preferred_color_scheme),
  };
}
