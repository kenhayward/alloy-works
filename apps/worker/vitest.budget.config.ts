import { defineConfig } from 'vitest/config';

/**
 * The warm range preview's budget alone (CNT-186; the R22 plan, R22-C): one file, on its own, so what
 * it measures is the machine and not the suite beside it. CI runs it after the worker suite, on its
 * reference runner; `pnpm test` runs it with the rest elsewhere.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/range-preview-budget.test.ts'],
    fileParallelism: false,
    globalSetup: ['src/testing/database-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/worker-budget.json' },
  },
});
