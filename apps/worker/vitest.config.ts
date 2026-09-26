import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The login roles set once for the run, so each file prepares only its own database and the
    // files run side by side; and one veraPDF kept warm for the run (src/testing/verapdf-server.ts),
    // not one started per check.
    globalSetup: ['src/testing/database-setup.ts', 'src/testing/verapdf-setup.ts'],
    // `maxWorkers` is left to vitest, which takes one fewer than the machine's cores: three on CI's
    // four. The suite was measured at three before the files were let run side by side.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/worker.json' },
  },
});
