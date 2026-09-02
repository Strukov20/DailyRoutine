import { z } from 'zod';

/**
 * Validated, typed access to build-time environment variables.
 *
 * Only `EXPO_PUBLIC_*` variables are readable at runtime (Metro inlines
 * them into the bundle); anything else must go through native config
 * (`app.config.ts`) or a server-side function. Import `env` instead of
 * reading `process.env` directly so a missing/malformed variable fails
 * loudly at startup rather than causing a confusing runtime error deep
 * inside a feature.
 */
const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z
    .string()
    .url('EXPO_PUBLIC_SUPABASE_URL must be a valid URL')
    .optional(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  EXPO_PUBLIC_APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse({
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  });

  if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    throw new Error(
      'Invalid environment configuration. Copy .env.example to .env and check the values.',
    );
  }

  return parsed.data;
}

export const env = loadEnv();

/**
 * True once real Supabase credentials are present. During the foundation
 * phase this is expected to be false — screens should degrade to
 * placeholder/offline states rather than throwing.
 */
export const isSupabaseConfigured = Boolean(
  env.EXPO_PUBLIC_SUPABASE_URL && env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);
