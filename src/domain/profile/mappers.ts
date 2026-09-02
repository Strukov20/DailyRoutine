import type { Tables } from '@/lib/supabase/types';

import type { Profile } from './types';

export function mapProfileRow(row: Tables<'profiles'>): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    preferredLanguage: row.preferred_language,
    preferredColorScheme: row.preferred_color_scheme,
  };
}
