import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import i18next from 'eslint-plugin-i18next'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    'dist/**',
    'release/**',
    'tmp_release_check/**',
    'tmp_release_check2/**',
    'src.old/**',
    // Local tooling state / generated design bundles (see .gitignore)
    '.claude/**',
    '.design-sync/**',
    '.ds-sync/**',
    'ds-bundle/**',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // Stops untranslated user-facing text from creeping back in. Scoped to the
  // surfaces that are actually migrated — see AGENTS.md "Internationalisation".
  {
    files: [
      'packages/shared/src/components/**/*.{js,jsx}',
      'packages/shared/src/pages/**/*.{js,jsx}',
      'apps/web/src/**/*.{js,jsx}',
    ],
    ignores: [
      // A builder's tool reached only by URL, and fixtures. Both are
      // deliberately untranslated.
      'packages/shared/src/pages/DesignSystemPage.jsx',
      'packages/shared/src/lib/csUpdatesFeed.mock.js',
    ],
    plugins: { i18next },
    rules: {
      // Warn, not error: the rule cannot tell a label from an acronym, a brand
      // name or a unit, and this codebase legitimately renders "CSFloat", "ROI"
      // and "24h" as literals. It is a prompt to check, not a gate.
      'i18next/no-literal-string': ['warn', {
        mode: 'jsx-text-only',
        'should-validate-template': true,
      }],
    },
  },
])
