import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Platform-free: the readers run in the renderer today and on the server when import arrives,
    // so they are tested with no DOM in the room (content-model.md, "Where the code lives").
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/readers.json' },
  },
});
