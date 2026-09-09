/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['./src/test/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // transformIgnorePatterns is intentionally left to the jest-expo preset —
  // it is maintained per-SDK-version and already covers every RN/Expo
  // package that ships untranspiled source (including standard-navigation,
  // pulled in transitively by expo-router).
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  // supabase/functions runs on Deno (npm:/https:// specifiers, a Deno
  // global) — its own deno test suite, not Jest. See docs/DECISIONS.md,
  // "Phase 6."
  // __e2e__ suites (Phase 9's offline-queue integration test) need a live
  // local Supabase stack and run via their own `jest.e2e.config.js` +
  // `npm run e2e:offline` — never picked up by the default `npm test`.
  testPathIgnorePatterns: ['/node_modules/', '/knowledge/', '/supabase/functions/', '/__e2e__/'],
};
