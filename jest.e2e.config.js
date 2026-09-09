/** @type {import('jest').Config} */
// Phase 9, Section 20 — a separate Jest project for the offline-queue
// integration suite (src/lib/offline/__e2e__/), which drives the real
// production offline-queue code (never a test-only reimplementation)
// against a live local Supabase stack, not mocked. Deliberately not part
// of the default `npm run test`/`npm run verify` run — like every other
// e2e:* script in this repo, it needs `npm run supabase:start` first and
// is invoked explicitly via `npm run e2e:offline`.
//
// Deliberately does NOT use the `jest-expo` preset the rest of this repo's
// tests share: that preset's own setupFiles (inherited from
// @react-native/jest-preset) install a React Native `fetch`/XHR polyfill
// that silently resolves every real request with an undefined status/body
// under Jest (no native networking module exists here) — confirmed
// directly (a plain `fetch()` against the local stack came back with
// `res.status === undefined`) before settling on this fix. This suite
// renders no RN component and needs a real, working network stack, so it
// uses a plain babel-jest transform (the project's own babel.config.js)
// and Node's genuine, unpatched global `fetch` instead.
module.exports = {
  testEnvironment: 'node',
  transform: {
    '\\.[jt]sx?$': 'babel-jest',
  },
  // babel-preset-expo's inline-env-vars plugin rewrites every
  // `process.env.EXPO_PUBLIC_*` read (src/lib/env.ts) into an import of
  // this real-but-ES-module file — normally resolved by Metro, not
  // CommonJS/Jest, so it needs an explicit carve-out from the default
  // "don't transform node_modules" rule to become requirable here too.
  transformIgnorePatterns: ['node_modules/(?!(expo/virtual)/)'],
  setupFiles: ['./src/lib/offline/__e2e__/jest.e2e.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['<rootDir>/src/lib/offline/__e2e__/**/*.e2e.test.ts'],
  testTimeout: 30000,
};
