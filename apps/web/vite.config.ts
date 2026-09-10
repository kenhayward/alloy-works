import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // The desktop shell loads this build from disk with a file:// URL, so every asset reference
  // has to be relative. An absolute /assets/... path resolves to the filesystem root there.
  base: './',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // Pinned rather than left implicit: the default reporter varies by platform, and a run that
    // swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default'],
  },
});
