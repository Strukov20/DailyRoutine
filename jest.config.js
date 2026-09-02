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
  testPathIgnorePatterns: ['/node_modules/', '/knowledge/'],
};
