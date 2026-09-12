import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BRIDGE_GLOBAL,
  DEV_SERVER_URL,
  PLATFORM_INFO_CHANNEL,
  describePlatform,
  resolveRendererTarget,
} from './shell.js';

// String.raw so the Windows separators stay literal - the shell must hand Electron the path it was
// given, not a version of it that survived an escaping round trip.
const WINDOWS_INDEX = String.raw`C:\app\web\dist\index.html`;

describe('resolveRendererTarget', () => {
  it('loads the dev server while unpackaged, so a renderer edit hot-reloads in the window', () => {
    expect(
      resolveRendererTarget({
        packaged: false,
        devServerUrl: 'http://localhost:5173',
        rendererIndexHtml: WINDOWS_INDEX,
      }),
    ).toEqual({ kind: 'url', value: 'http://localhost:5173' });
  });

  it('loads the built renderer from disk once packaged', () => {
    expect(
      resolveRendererTarget({
        packaged: true,
        devServerUrl: 'http://localhost:5173',
        rendererIndexHtml: WINDOWS_INDEX,
      }),
    ).toEqual({ kind: 'file', value: WINDOWS_INDEX });
  });

  it('loads the service when it has one, whether packaged or not', () => {
    const location = {
      packaged: true,
      devServerUrl: DEV_SERVER_URL,
      rendererIndexHtml: WINDOWS_INDEX,
      serviceUrl: 'https://dev.acme.example',
    };
    expect(resolveRendererTarget(location)).toEqual({
      kind: 'url',
      value: 'https://dev.acme.example',
    });
    expect(resolveRendererTarget({ ...location, packaged: false })).toEqual({
      kind: 'url',
      value: 'https://dev.acme.example',
    });
  });

  it('falls back to what it did before when it has no service to load', () => {
    expect(
      resolveRendererTarget({
        packaged: true,
        devServerUrl: DEV_SERVER_URL,
        rendererIndexHtml: WINDOWS_INDEX,
      }),
    ).toEqual({ kind: 'file', value: WINDOWS_INDEX });
  });
});

describe('describePlatform', () => {
  it('reports the desktop delivery and the Electron version behind it', () => {
    expect(describePlatform({ electron: '44.3.0' })).toEqual({
      delivery: 'desktop',
      runtime: 'Electron 44.3.0',
    });
  });

  it('does not invent a version it was not given', () => {
    expect(describePlatform({})).toEqual({ delivery: 'desktop', runtime: 'Electron (unknown)' });
  });
});

describe('the bridge contract', () => {
  // Pinned: the renderer reads window.alloyWorks and the preload writes it. A rename on one side
  // with no matching rename on the other is a blank window, not a build error.
  it('names the global the renderer looks for', () => {
    expect(BRIDGE_GLOBAL).toBe('alloyWorks');
  });

  it('namespaces the IPC channel, so an unrelated handler cannot answer it', () => {
    expect(PLATFORM_INFO_CHANNEL).toBe('alloy-works:platform-info');
  });
});

describe('the dev server address', () => {
  it('is the IPv4 loopback, matching what the dev server binds', () => {
    expect(DEV_SERVER_URL).toBe('http://127.0.0.1:5173');
  });

  // The dev script waits for this address before launching Electron. If the two drift apart,
  // wait-on blocks forever and the window never opens - with no error to explain why.
  it('is the address the dev script waits for', () => {
    const packageJson: { scripts: Record<string, string> } = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    );
    const waitOn = /wait-on tcp:(\S+)/.exec(packageJson.scripts.dev ?? '');

    expect(waitOn?.[1]).toBe(new URL(DEV_SERVER_URL).host);
  });
});

describe('the built preload', () => {
  const preload = (): string => readFileSync(join(process.cwd(), 'dist', 'preload.js'), 'utf8');

  // The window is created with sandbox: true, and a sandboxed preload can require `electron` and a
  // few Node built-ins - nothing else. A relative require throws before contextBridge is reached,
  // and the renderer then falls back to the browser bridge without anything reporting a problem.
  // So the preload has to arrive as one self-contained file.
  it('contains no relative require, which the sandbox cannot resolve', () => {
    expect(preload()).not.toMatch(/require\(['"]\.{1,2}[/\\]/);
  });

  // The allowed list for a sandboxed preload is electron, events, timers and url. Anything else
  // - node:path included - throws on load and takes the whole bridge down with it, silently. So
  // the invariant is not "no relative require", it is "nothing but electron".
  it('requires nothing but electron', () => {
    const required = [...preload().matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);

    expect([...new Set(required)]).toEqual(['electron']);
  });

  it('still exposes the bridge under the name the renderer reads', () => {
    expect(preload()).toContain(BRIDGE_GLOBAL);
    expect(preload()).toContain(PLATFORM_INFO_CHANNEL);
  });
});
