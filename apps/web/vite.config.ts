import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The canonical version (CLAUDE.md), so About cannot drift from it.
import { version } from '../../version.json';
import { latestEntry } from './src/release-notes.js';

// About's release notes: the changelog's newest entry alone, not its whole history (ADR-0049, AD7).
// Found by walking up from where Vite runs - the package, or the repo root - since a config loaded by
// a module runner has no file URL of its own to resolve against. Nowhere to be found, About has none.
function changelog(): string | null {
  for (let at = process.cwd(); ; at = dirname(at)) {
    const candidate = join(at, 'CHANGELOG.md');
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    if (dirname(at) === at) return null;
  }
}
const found = changelog();
const releaseNotes = found === null ? null : latestEntry(found);

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __RELEASE_NOTES__: JSON.stringify(releaseNotes),
  },
  // The desktop shell loads this build from disk with a file:// URL, so every asset reference
  // has to be relative. An absolute /assets/... path resolves to the filesystem root there.
  base: './',
  // 127.0.0.1, not the default `localhost`: Node 17+ resolves localhost to ::1 first, so the
  // default host binds the IPv6 loopback only and the desktop shell's wait-on never sees the
  // server come up. The shell's DEV_SERVER_URL names this same address, and a test pins them
  // together.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Everything the API owns goes to the service, with the Host header as the browser sent it, so
    // the service resolves the environment from the address in the browser's bar. Open the renderer
    // at http://dev.acme.localhost:5173 and it is the development environment; at another
    // environment's hostname it is that one.
    proxy: { '/v1': { target: 'http://127.0.0.1:8088' } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // A file's first test pays for loading the editor and the page it opens, which on CI's runner has
    // taken past Vitest's five seconds (issue #302): the limit is for a test that hangs, not a slow one.
    testTimeout: 15_000,
    // Pinned rather than left implicit: the default reporter varies by platform, and a run that
    // swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/web.json' },
  },
});
