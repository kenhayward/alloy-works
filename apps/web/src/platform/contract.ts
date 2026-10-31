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
  /** The environment the desktop app is connected to, its origin, where it has one (ADM-051). */
  readonly connectedTo?: string;
}

/** Why an address was not connected to (the DR plan, DR-C), each worded on the Connect to screen. */
export type ConnectRefusal =
  | 'malformed'
  | 'scheme'
  | 'insecure'
  | 'credentials'
  | 'unreachable'
  | 'no-environment'
  | 'not-alloy-works';

/** What connecting to an address came to: the window is on its way there, or why not. */
export type ConnectResult =
  | { readonly kind: 'connected'; readonly origin: string }
  | { readonly kind: 'refused'; readonly reason: ConnectRefusal };

export interface PlatformBridge {
  getPlatformInfo(): Promise<PlatformInfo>;
  /**
   * Whether a page the service shows - a publication's HTML - can be opened in a new tab, which
   * carries the session (the HT plan, HT-N): the browser's. The desktop's new windows open in the
   * system browser, which has none, so it offers such a page to save alone.
   */
  readonly opensServedPages: boolean;
  /**
   * The languages the spelling checker checks against: the base languages of the components open
   * (CNT-178). The desktop shell sets the dictionaries Electron has for them - except on macOS, whose
   * system checker chooses its own; the browser checks with its own dictionaries, which a page cannot
   * choose, so its bridge sets nothing. Tags in the shape the stored model takes them, at most eight.
   */
  setSpellCheckLanguages(languages: readonly string[]): Promise<void>;
  /**
   * The interface's language, one declared tag, as it turns to it (the UI plan, UI-I): the desktop
   * shell words its tray and its spelling menu in it. The browser has neither, so its bridge does
   * nothing.
   */
  setInterfaceLanguage(language: string): Promise<void>;
  /**
   * Connects the desktop app to the environment at `address`, kept for its next start, and loads it
   * (ADM-051). Only the desktop's Connect to screen has it: the browser is at an address already.
   * Unreachable or refused, the window stays and the result says why.
   */
  connectTo?(address: string): Promise<ConnectResult>;
}
