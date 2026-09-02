/**
 * Domain shape for a profile — deliberately decoupled from the Supabase
 * `profiles` row shape (see src/lib/supabase/types.ts) so screens never
 * import database types directly. See docs/ARCHITECTURE.md, "Supabase
 * transport / domain models / UI view models" boundary.
 */
export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  preferredLanguage: 'en' | 'uk';
  preferredColorScheme: 'system' | 'light' | 'dark';
}
