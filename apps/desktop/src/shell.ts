import type { PlatformInfo } from '@alloy-works/web/platform' with { 'resolution-mode': 'import' };

/**
 * Pure decisions the shell makes, kept out of main.ts so they can be tested without booting
 * Electron. main.ts is the thin layer that calls Electron with what these return.
 *
 * This is the ONLY module the preload imports, and it is bundled into the preload as a result.
 * A sandboxed preload may require `electron`, `events`, `timers` and `url` - nothing else - so
 * **this file must not import a Node built-in**, `node:path` included. Anything that needs one
 * belongs in a main-process-only module such as icons.ts. The bundle is checked by a test.
 */

/**
 * The address the dev server binds and the shell waits for, pinned to the IPv4 loopback.
 *
 * Not `localhost`: Node 17+ resolves it to the IPv6 loopback first, so a Vite server left on the
 * default host binds ::1 only and anything waiting on 127.0.0.1 waits forever. The dev script
 * waits here before launching Electron, and that hang produces no error at all - just a window
 * that never opens. One literal address, agreed by a test, rather than three spellings resolved
 * independently by Vite, wait-on and Chromium.
 */
export const DEV_SERVER_URL = 'http://127.0.0.1:5173';

/** The global the preload writes and the renderer reads. */
export const BRIDGE_GLOBAL = 'alloyWorks';

/**
 * Every channel is namespaced and enumerated. There is deliberately no general "call this from the
 * renderer" bridge: each channel is a named capability with a handler that validates its own
 * arguments in the main process.
 */
export const PLATFORM_INFO_CHANNEL = 'alloy-works:platform-info';

export type RendererTarget =
  | { readonly kind: 'url'; readonly value: string }
  | { readonly kind: 'file'; readonly value: string };

export interface RendererLocation {
  readonly packaged: boolean;
  readonly devServerUrl: string;
  readonly rendererIndexHtml: string;
  /**
   * The environment this window is for. A session is a cookie belonging to the service's own
   * address, and a window loading a file from disk can hold none, so when there is a service the
   * window loads it (ADR-0022).
   */
  readonly serviceUrl?: string | undefined;
}

export function resolveRendererTarget(location: RendererLocation): RendererTarget {
  if (location.serviceUrl) return { kind: 'url', value: location.serviceUrl };
  return location.packaged
    ? { kind: 'file', value: location.rendererIndexHtml }
    : { kind: 'url', value: location.devServerUrl };
}

/** A path on disk as the `file:` address a window shows for it, written without `node:url`, which the preload cannot require. */
function fileAddress(path: string): string {
  const forward = path.split(String.fromCharCode(92)).join('/');
  return encodeURI(forward.startsWith('/') ? `file://${forward}` : `file:///${forward}`);
}

/**
 * Whether an address is the renderer itself (issue #309): served, its origin; loaded from disk, its
 * own file, whatever fragment the renderer's routing is at. Anything else - another site, another
 * file, something that is not an address - is not, and is refused the bridge and the window.
 */
export function isRenderer(url: string, target: RendererTarget): boolean {
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    return false;
  }
  if (target.kind === 'url') {
    try {
      return address.origin === new URL(target.value).origin;
    } catch {
      return false;
    }
  }
  if (address.protocol !== 'file:') return false;
  // `file://host/path` is a network share, whatever its path: the renderer's file has no host.
  if (address.host !== '') return false;
  const own = new URL(fileAddress(target.value));
  return decodeURI(address.pathname) === decodeURI(own.pathname);
}

/** An address the system may open outside the app: the web and mail, never a file or a scheme it would run. */
export function opensExternally(url: string): boolean {
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export type NavigationDecision =
  { readonly allow: true } | { readonly allow: false; readonly openExternally?: string };

/**
 * What the window does when a page asks to go to `url` from `from` (issue #309). The renderer stays
 * the renderer: a link out of it opens in the system browser, never in the window that holds the
 * bridge, and anything the system would run is refused. A sign-in that has already left the
 * renderer for the identity provider goes on, since the provider's own pages navigate - its forms
 * post, its steps follow each other - and the bridge refuses whatever page it is on (`isRenderer`).
 */
export function navigationDecision(
  url: string,
  from: string,
  target: RendererTarget,
): NavigationDecision {
  if (isRenderer(url, target)) return { allow: true };
  if (!isRenderer(from, target)) return { allow: true };
  return opensExternally(url) ? { allow: false, openExternally: url } : { allow: false };
}

/**
 * Whether an IPC call's frame is the renderer's own (issue #309): refused before the first window has
 * worked out where the renderer is, where the frame has gone, and from any other address - a page the
 * window was taken to, or a frame inside the renderer showing a stored file.
 */
export function isTrustedFrame(url: string | undefined, target: RendererTarget | null): boolean {
  return target !== null && url !== undefined && isRenderer(url, target);
}

/** Where the service's sign-in routes live: each sends the window on to the identity provider. */
export const SIGN_IN_PATH = '/v1/sign-in/';

/**
 * What the window does when a navigation that asked for `requested` is redirected to `url`, the
 * window still showing `from` (issue #309). A sign-in's redirects go: one the service's own sign-in
 * route began, which sends the window to the provider, and any while the window is already off the
 * renderer in a sign-in. Any other redirect is a navigation like another - an open redirect, a link
 * through a shortener - and leaving the renderer opens it in the system browser.
 */
export function redirectDecision(
  url: string,
  requested: string,
  from: string,
  target: RendererTarget,
): NavigationDecision {
  if (isRenderer(url, target)) return { allow: true };
  if (!isRenderer(from, target)) return { allow: true };
  if (isRenderer(requested, target) && new URL(requested).pathname.startsWith(SIGN_IN_PATH)) {
    return { allow: true };
  }
  return opensExternally(url) ? { allow: false, openExternally: url } : { allow: false };
}

/**
 * The return type is the renderer's own PlatformInfo, so a change to the contract fails typecheck
 * here rather than showing up as a wrong value in the window.
 */
export function describePlatform(versions: { electron?: string | undefined }): PlatformInfo {
  return { delivery: 'desktop', runtime: `Electron ${versions.electron ?? '(unknown)'}` };
}
