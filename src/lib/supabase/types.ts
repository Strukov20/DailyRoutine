/**
 * Placeholder for the generated Supabase database types.
 *
 * Once migrations exist (see docs/DATA_MODEL.md), replace this file's
 * content with the output of:
 *
 *   npx supabase gen types typescript --project-id <id> > src/lib/supabase/types.ts
 *
 * Keeping an (empty-ish) `Database` type in place now means
 * `createClient<Database>()` and every call site already carries the
 * generic through, so wiring in real types later is a type-def swap, not
 * a call-site rewrite.
 */
export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
