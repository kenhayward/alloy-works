import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // The desktop shell loads this build from disk with a file:// URL, so every asset reference
  // has to be relative. An absolute /assets/... path resolves to the filesystem root there.
  base: './',
  // 127.0.0.1, not the default `localhost`: Node 17+ resolves localhost to ::1 first, so the
  // default host binds the IPv6 loopback only and the desktop shell's wait-on never sees the
  // server come up. The shell's DEV_SERVER_URL names this same address, and a test pins them
  // together.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
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
