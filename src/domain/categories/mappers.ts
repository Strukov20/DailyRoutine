import type { Tables } from '@/lib/supabase/types';

import type { Category } from './types';

export function mapCategoryRow(row: Tables<'categories'>): Category {
  return {
    id: row.id,
    familyId: row.family_id,
    name: row.name,
    colorToken: row.color_token,
    isSystem: row.is_system,
  };
}
