import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BRIDGE_GLOBAL,
  DEV_SERVER_URL,
  PLATFORM_INFO_CHANNEL,
  describePlatform,
  isRenderer,
  isTrustedFrame,
  navigationDecision,
  opensExternally,
  redirectDecision,
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

describe('keeping the window on the renderer (issue #309)', () => {
  const service = { kind: 'url', value: 'https://acme.alloy.example/' } as const;
  const devServer = { kind: 'url', value: DEV_SERVER_URL } as const;
  const file = { kind: 'file', value: WINDOWS_INDEX } as const;

  it('knows the renderer by its origin where it is served, whatever path or fragment it is at', () => {
    expect(isRenderer('https://acme.alloy.example/#/documents/abc', service)).toBe(true);
    expect(isRenderer('https://acme.alloy.example/v1/sign-in/organisation', service)).toBe(true);
    expect(isRenderer(`${DEV_SERVER_URL}/#/components/x`, devServer)).toBe(true);
    expect(isRenderer('https://acme.alloy.example.evil.test/', service)).toBe(false);
    expect(isRenderer('http://acme.alloy.example/', service)).toBe(false);
    expect(isRenderer('https://idp.example/authorize', service)).toBe(false);
  });

  it('knows the renderer by its file where it is loaded from disk, and no other file', () => {
    expect(isRenderer('file:///C:/app/web/dist/index.html#/documents/abc', file)).toBe(true);
    expect(isRenderer('file:///C:/app/web/dist/other.html', file)).toBe(false);
    expect(isRenderer('file:///C:/Windows/win.ini', file)).toBe(false);
    expect(isRenderer('https://acme.alloy.example/', file)).toBe(false);
    // The same path on another host is a network share, never the renderer's own file.
    expect(isRenderer('file://attacker.example/C:/app/web/dist/index.html', file)).toBe(false);
  });

  it('refuses anything that is not an address', () => {
    expect(isRenderer('', service)).toBe(false);
    expect(isRenderer('not a url', service)).toBe(false);
  });

  it('stays on the renderer, and opens a link out of it in the system browser rather than in the window', () => {
    const from = 'https://acme.alloy.example/#/documents/abc';
    expect(navigationDecision('https://acme.alloy.example/#/components/x', from, service)).toEqual({
      allow: true,
    });
    expect(navigationDecision('https://en.wikipedia.org/wiki/Printer', from, service)).toEqual({
      allow: false,
      openExternally: 'https://en.wikipedia.org/wiki/Printer',
    });
    expect(navigationDecision('mailto:ada@example.org', from, service)).toEqual({
      allow: false,
      openExternally: 'mailto:ada@example.org',
    });
    // Nothing the system would run: refused outright.
    for (const url of [
      'file:///C:/Windows/system32/calc.exe',
      'javascript:alert(1)',
      'ms-settings:',
    ]) {
      expect(navigationDecision(url, from, service), url).toEqual({ allow: false });
    }
  });

  it("lets a sign-in that has left the renderer for the provider go on, since the provider's own pages navigate", () => {
    const atProvider = 'https://idp.example/login';
    expect(navigationDecision('https://idp.example/login/submit', atProvider, service)).toEqual({
      allow: true,
    });
    expect(
      navigationDecision(
        'https://acme.alloy.example/v1/sign-in/organisation/callback',
        atProvider,
        service,
      ),
    ).toEqual({ allow: true });
  });

  it('opens only web and mail addresses outside the app, never a file or a scheme the system would run', () => {
    expect(opensExternally('https://example.org/')).toBe(true);
    expect(opensExternally('http://example.org/')).toBe(true);
    expect(opensExternally('mailto:ada@example.org')).toBe(true);
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ms-settings:',
      'smb://share/x',
      '',
    ]) {
      expect(opensExternally(url), url).toBe(false);
    }
  });

  it("answers the bridge for the renderer's own frame alone: no window yet, no frame, or any other address is refused", () => {
    expect(isTrustedFrame('https://acme.alloy.example/#/documents/abc', service)).toBe(true);
    expect(isTrustedFrame('https://acme.alloy.example/', null)).toBe(false);
    expect(isTrustedFrame(undefined, service)).toBe(false);
    expect(isTrustedFrame('https://store.example/bucket/key.pdf', service)).toBe(false);
    expect(isTrustedFrame('file://attacker.example/C:/app/web/dist/index.html', file)).toBe(false);
  });

  it('follows a redirect in the window only where a sign-in began it, or a sign-in is already under way, and opens any other outside', () => {
    const at = 'https://acme.alloy.example/#/';
    // The service's own sign-in route sends the window to the provider, and it goes.
    expect(
      redirectDecision(
        'https://idp.example/authorize?x=1',
        'https://acme.alloy.example/v1/sign-in/organisation',
        at,
        service,
      ),
    ).toEqual({ allow: true });
    // Back from the provider, while the window is off the renderer.
    expect(
      redirectDecision(
        'https://acme.alloy.example/#/',
        'https://idp.example/cb',
        'https://idp.example/login',
        service,
      ),
    ).toEqual({ allow: true });
    // Any other redirect leaving the renderer - an open redirect, a link through a shortener - opens outside.
    expect(
      redirectDecision(
        'https://evil.example/',
        'https://acme.alloy.example/v1/go?to=evil',
        at,
        service,
      ),
    ).toEqual({ allow: false, openExternally: 'https://evil.example/' });
    expect(redirectDecision('https://evil.example/', 'https://bit.example/x', at, service)).toEqual(
      {
        allow: false,
        openExternally: 'https://evil.example/',
      },
    );
    // A redirect that stays on the renderer goes, and one to a scheme the system would run is refused.
    expect(
      redirectDecision(
        'https://acme.alloy.example/#/x',
        'https://acme.alloy.example/v1/x',
        at,
        service,
      ),
    ).toEqual({ allow: true });
    expect(
      redirectDecision(
        'file:///C:/Windows/win.ini',
        'https://acme.alloy.example/v1/x',
        at,
        service,
      ),
    ).toEqual({ allow: false });
  });
});
