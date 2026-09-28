import { defineConfig } from 'vitest/config';

/**
 * The pinned Chromium's own tests, which need no stack: run by this workspace's `test` script, and so
 * by `pnpm test` on every machine, so a Playwright upgrade without a new pin fails there and not only
 * in CI's whole-system job. The browser suite proper is `vitest.config.ts`, run by `test:browser`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/chromium-release.test.ts'],
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    // A report of its own, beside the stack suite's `browser.json`, so neither run overwrites the other.
    outputFile: { json: '../../.trace-results/browser-pin.json' },
  },
});
