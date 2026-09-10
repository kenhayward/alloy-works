/**
 * The one seam between the renderer and whatever is hosting it. The renderer is identical in both
 * deliveries; everything that differs between a browser tab and an Electron window arrives through
 * this interface, so nothing above it has to ask which one it is running in.
 *
 * Deliberately free of DOM types: the Electron shell imports this file too, and typechecks against
 * it, so a change here that the shell does not satisfy fails the build instead of producing a
 * window that renders the wrong thing.
 */
export interface PlatformInfo {
  readonly delivery: 'web' | 'desktop';
  readonly runtime: string;
}

export interface PlatformBridge {
  getPlatformInfo(): Promise<PlatformInfo>;
}
