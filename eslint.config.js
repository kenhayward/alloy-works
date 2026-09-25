import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      // Spike build output, on the same terms as dist: a bundle nobody wrote.
      'spikes/**/out/**',
    ],
  },
  js.configs.recommended,
  {
    // This spike's programs are throwaway and outside CI, and they are .mjs, which the block below
    // does not match. Some run in a browser and some in node, so they get both. Scoped to this spike
    // rather than to spikes/**, because another one declares `document` itself and a blanket global
    // collides with it.
    files: ['spikes/editor-framework/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // The Word measurements' probes: throwaway, outside CI, node programs run by hand on Windows.
    files: ['spikes/word-measure/**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The renderer runs in a browser, in both deliveries. It never sees Node globals -
    // anything it needs from the host arrives across the platform bridge.
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
