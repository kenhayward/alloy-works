import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Building the whole OpenAPI document takes a quarter of a second here and seven on CI's runner
    // beside every other suite, past the five-second default (#710): it grows with every route, so
    // the limit is set for the document rather than for a test.
    testTimeout: 30_000,
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/api-contract.json' },
  },
});
