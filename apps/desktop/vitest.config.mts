import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Pinned rather than left implicit: the default reporter varies by platform, and a run that
    // swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default'],
  },
});
