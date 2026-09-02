// Silences noisy native-module warnings that are expected in the Jest/jsdom
// environment (no real device), so real regressions stand out in test output.
// jest.mock factories run before ES module imports are hoisted, so the
// mock implementation must stay a require() rather than an import.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-reanimated/mock');
});
