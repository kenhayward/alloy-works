import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The tests that need no stack run in `pnpm test` from vitest.pin.config.ts instead.
    exclude: [...configDefaults.exclude, 'src/chromium-release.test.ts', 'src/undecided.test.ts'],
    // Signed in once for the run, in the browser through the stand-in's own page, and in Node for the
    // fixtures the tests make through the API (the W13 plan's B-B and B-C).
    globalSetup: ['src/testing/setup.ts'],
    // One file at a time: the budgets W13.3 adds want a quiet machine, and every file drives the one
    // stack (B-F).
    fileParallelism: false,
    // A browser, a page and a round trip to the stack per act: seconds, not milliseconds.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/browser.json' },
  },
});
