import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Owner rule 8: user feedback must be shown inline or as in-app pop-ups,
      // never through native browser dialogs.
      'no-alert': 'error',
      // Shared modules (providers, hooks, constants) intentionally export more
      // than components; this only affects HMR granularity in development.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
])
