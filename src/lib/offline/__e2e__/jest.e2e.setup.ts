/**
 * Runs before every module import in an __e2e__ test file (Jest's
 * `setupFiles`, executed before the test framework and before the test
 * file's own imports) — injects the real local Supabase stack's URL/anon
 * key into `process.env` so `@/lib/supabase/client`'s module-scope
 * `createClient(...)` call (evaluated the moment any test file first
 * imports it) picks up real, working credentials instead of the
 * placeholder client. LOCAL SUPABASE ONLY — the same safety check every
 * scripts/e2e-*.sh script already makes, ported to TypeScript: refuses to
 * run against anything but 127.0.0.1/localhost.
 */
// This project's tsconfig deliberately restricts ambient types to just
// "jest" (see tsconfig.json), so `@types/node`'s `child_process` module
// declaration isn't loaded — a plain `require()` (already typed via the
// same mechanism every other jest.mock factory in this codebase relies on)
// sidesteps that without touching the shared tsconfig for one Node-only
// test-tooling file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execSync } = require('child_process');

// jest.mock factories must stay a require() here (not a top-level import) —
// module.exports isn't hoisted the way an ES import would be, and this
// file itself runs as a CommonJS setup script under ts-jest/babel-jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

interface SupabaseStatus {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

const LOCAL_URL_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost)(:[0-9]+)?(\/.*)?$/;

function readLocalSupabaseStatus(): SupabaseStatus {
  const raw = execSync('npx supabase status -o json', { encoding: 'utf-8' });
  const status = JSON.parse(raw) as SupabaseStatus;
  if (!status.API_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
    throw new Error(
      "Could not read API_URL/ANON_KEY/SERVICE_ROLE_KEY from 'supabase status' — is the local stack running? (npm run supabase:start)",
    );
  }
  if (!LOCAL_URL_PATTERN.test(status.API_URL)) {
    throw new Error(`Refusing to run: API_URL '${status.API_URL}' is not localhost/127.0.0.1.`);
  }
  return status;
}

const status = readLocalSupabaseStatus();

process.env.EXPO_PUBLIC_SUPABASE_URL = status.API_URL;
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.EXPO_PUBLIC_APP_ENV = 'local';
// Test-only: the service role key never ships in the app itself (see
// src/lib/supabase/client.ts's own comment) — only this e2e setup, which
// never runs on-device, uses it, exclusively to create/delete disposable
// test accounts the same way scripts/e2e-*.sh already do via curl.
process.env.E2E_SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
process.env.E2E_SUPABASE_URL = status.API_URL;
