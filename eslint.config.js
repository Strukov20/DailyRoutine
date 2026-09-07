// @ts-check
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

module.exports = defineConfig([
  globalIgnores([
    'dist/*',
    '.expo/*',
    'node_modules/*',
    'coverage/*',
    'android/*',
    'ios/*',
    'knowledge/*',
    // Supabase Edge Functions run on Deno, a separate runtime with its own
    // module resolution (npm:/https:// specifiers, a Deno global, no
    // tsconfig.json) — linted/type-checked independently via `deno test`/
    // `deno check`, not this project's Node-oriented ESLint/tsc setup. See
    // docs/DECISIONS.md, "Phase 6."
    'supabase/functions/**',
  ]),
  expoConfig,
  {
    files: ['*.config.js', '*.config.cjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**'],
    rules: {
      'no-console': 'off',
    },
  },
  prettierConfig,
]);
