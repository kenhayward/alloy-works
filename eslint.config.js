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
      // The pinned tools each fetch script unpacks, git-ignored: Chromium's among them carries
      // scripts of its own, which nobody here wrote.
      '**/.tools/**',
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
  {
    // The data connector spike's harness: throwaway, outside CI, node programs run in its own
    // containers. Its rules are set after the presets, below.
    files: ['spikes/data-connectors/**/*.mjs'],
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
  {
    // The data connector spike's findings rest on its programs as they ran, so the rules that would
    // ask for an edit to one - an ignored error, a leftover variable, a NUL searched for on purpose -
    // are off here rather than the code changed after the measurement. Last, so no preset turns
    // them back on.
    files: ['spikes/data-connectors/**/*.mjs'],
    rules: {
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'no-control-regex': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
