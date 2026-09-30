import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // A connection test answers no sooner than the connect timeout, five seconds (D1-L).
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/connector.json' },
  },
});
