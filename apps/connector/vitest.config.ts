import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // A connection test answers no sooner than the connect timeout, five seconds (D1-L).
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One file at a time. The files share one source and CI's two CPUs, and several measure time: a
    // failure answering no sooner than the connect timeout, a deadline, a limit cancelled at the
    // source. Run beside a 100 MiB value and a CPU-bound statement, an unknown host's lookup passed
    // its deadline and a run of twenty refreshes passed a minute.
    fileParallelism: false,
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/connector.json' },
  },
});
