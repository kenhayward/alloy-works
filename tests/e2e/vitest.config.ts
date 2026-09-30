import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The test that needs no stack runs in `pnpm test` from vitest.pin.config.ts instead.
    exclude: [...configDefaults.exclude, 'src/targets.test.ts'],
    // Refuses the run before any request when a target is unset: the suite has no defaults (#363).
    globalSetup: ['src/refuse-unset-targets.ts'],
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/e2e.json' },
  },
});
