import { defineConfig } from 'vitest/config';

/**
 * The tests that need no stack: the rule that refuses to run the suite at anything it was not pointed
 * at. Run by this workspace's `test` script, and so by `pnpm test` on every machine. The whole-system
 * suite proper is `vitest.config.ts`, run by `test:e2e`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/targets.test.ts'],
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    // A report of its own, beside the stack suite's `e2e.json`, so neither run overwrites the other.
    outputFile: { json: '../../.trace-results/e2e-pin.json' },
  },
});
