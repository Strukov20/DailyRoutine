import type * as EnvModule from './env';

/**
 * env.ts computes `env`/`isSupabaseConfigured` eagerly at module load, so
 * each case here resets the module registry and re-requires with a fresh
 * process.env — the only reliable way to exercise different configurations
 * of a module with load-time side effects. Plain require() (not dynamic
 * import()) is used deliberately: this Babel/CJS Jest setup can't resolve
 * a throwing dynamic import to a rejected promise.
 */
function loadEnvModule(): typeof EnvModule {
  // Must be a real require() so jest.resetModules() can force re-evaluation
  // between test cases — a static import is only ever evaluated once per file.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./env') as typeof EnvModule;
}

describe('env', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reports isSupabaseConfigured=false when no Supabase credentials are set (missing configuration)', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    const { isSupabaseConfigured } = loadEnvModule();

    expect(isSupabaseConfigured).toBe(false);
  });

  it('reports isSupabaseConfigured=true once both Supabase credentials are set', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

    const { isSupabaseConfigured } = loadEnvModule();

    expect(isSupabaseConfigured).toBe(true);
  });

  it('throws a clear error when EXPO_PUBLIC_SUPABASE_URL is not a valid URL', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'not-a-url';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

    expect(() => loadEnvModule()).toThrow(/Invalid environment configuration/);
  });

  it('defaults EXPO_PUBLIC_APP_ENV to "local" when unset', () => {
    delete process.env.EXPO_PUBLIC_APP_ENV;

    const { env } = loadEnvModule();

    expect(env.EXPO_PUBLIC_APP_ENV).toBe('local');
  });

  it('defaults the OAuth config-gate flags to false when unset', () => {
    delete process.env.EXPO_PUBLIC_AUTH_GOOGLE_ENABLED;
    delete process.env.EXPO_PUBLIC_AUTH_APPLE_ENABLED;

    const { env } = loadEnvModule();

    expect(env.EXPO_PUBLIC_AUTH_GOOGLE_ENABLED).toBe(false);
    expect(env.EXPO_PUBLIC_AUTH_APPLE_ENABLED).toBe(false);
  });

  it('enables an OAuth config-gate flag only for the literal string "true"', () => {
    process.env.EXPO_PUBLIC_AUTH_GOOGLE_ENABLED = 'true';
    process.env.EXPO_PUBLIC_AUTH_APPLE_ENABLED = 'yes';

    const { env } = loadEnvModule();

    expect(env.EXPO_PUBLIC_AUTH_GOOGLE_ENABLED).toBe(true);
    expect(env.EXPO_PUBLIC_AUTH_APPLE_ENABLED).toBe(false);
  });
});
