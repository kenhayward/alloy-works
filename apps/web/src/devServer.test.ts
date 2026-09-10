import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';

import viteConfig from '../vite.config.js';

const server = (viteConfig as UserConfig).server;

describe('the dev server address', () => {
  // Vite's default host is `localhost`, which Node 17+ resolves to the IPv6 loopback first - so the
  // server binds to ::1 only, and anything waiting on 127.0.0.1 waits forever. The desktop shell
  // waits on it before launching Electron, and a hang there produces no error at all. Pin the
  // address instead of relying on `localhost` resolving the same way in Vite, wait-on and Chromium.
  it('binds the IPv4 loopback explicitly, not localhost', () => {
    expect(server?.host).toBe('127.0.0.1');
  });

  it('binds the port the desktop shell expects', () => {
    expect(server?.port).toBe(5173);
  });

  it('fails rather than silently moving to another port', () => {
    expect(server?.strictPort).toBe(true);
  });
});
