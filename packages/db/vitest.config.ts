import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Login roles are cluster-wide, so two files bootstrapping them at once would race. Each file
    // has a database of its own; they simply take turns.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default'],
  },
});
