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

/**
 * The return type is the renderer's own PlatformInfo, so a change to the contract fails typecheck
 * here rather than showing up as a wrong value in the window.
 */
export function describePlatform(versions: { electron?: string | undefined }): PlatformInfo {
  return { delivery: 'desktop', runtime: `Electron ${versions.electron ?? '(unknown)'}` };
}
