import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The suite's own bound, not the default 5s: on a loaded runner the most CPU-bound test, a
    // refresh of the most values a vocabulary holds, needs its first attempt more than 5s and was
    // recorded as a flake (issue #861). The other suites' configs give themselves the same room.
    testTimeout: 30_000,
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/domain.json' },
  },
});
