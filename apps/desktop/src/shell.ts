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

/**
 * The spelling checker's languages (CNT-178, W-K): the renderer asks for the base languages of the
 * components open, and the main process sets the dictionaries Electron has for them. One channel,
 * one argument, checked in the main process.
 */
export const SPELL_CHECK_LANGUAGES_CHANNEL = 'alloy-works:spell-check-languages';

/**
 * The most tags one request may carry. A window has few components open at once, and fewer languages
 * among them; a request longer than this is not one the renderer makes.
 */
export const MOST_SPELL_CHECK_LANGUAGES = 8;

/**
 * A language tag in the shape the stored model takes one (`languageTagSchema` in packages/domain, which
 * this module may not import): a language, then a script, a region and variants, each optional. No
 * extension and no private use, which no dictionary is chosen by.
 */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/;

/** Longer than any tag a dictionary could answer to, and than any the renderer sends. */
const LONGEST_TAG = 35;

/**
 * What the renderer sent, as a list of tags, or null where it is anything else: not an array, too
 * long, or holding anything that is not a tag in that shape. The whole request is refused rather than
 * the odd tag dropped, since the renderer sends only tags the stored model has already admitted.
 */
export function spellCheckRequest(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MOST_SPELL_CHECK_LANGUAGES) return null;
  const tags: string[] = [];
  for (const each of value as readonly unknown[]) {
    if (typeof each !== 'string' || each.length > LONGEST_TAG || !LANGUAGE_TAG.test(each)) {
      return null;
    }
    tags.push(each);
  }
  return tags;
}

/**
 * The usual dictionary of a language Chromium has no dictionary for without a region. English has
 * none of its own, and American English is the one every build carries; any other language not named
 * here tries its own country's, `de-DE` for `de`.
 */
const USUAL_REGION: Readonly<Record<string, string>> = { en: 'US' };

/**
 * The dictionaries to check against, from those Electron has (`availableSpellCheckerLanguages`), for
 * the languages asked for: each tag's own where there is one; else its language on its own (`fr` for
 * `fr-CA`); else its language's usual dictionary (`en-US` for `en-GB`, `de-DE` for `de-AT`); else the
 * first dictionary of its language there is. A language with none is dropped. Compared regardless of
 * case, and answered as Electron spells them, each once, in the order asked.
 */
export function spellCheckerLanguages(
  requested: readonly string[],
  available: readonly string[],
): string[] {
  const find = (tag: string) => available.find((each) => each.toLowerCase() === tag.toLowerCase());
  const chosen: string[] = [];
  for (const tag of requested) {
    const language = (tag.split('-')[0] ?? tag).toLowerCase();
    const usual = `${language}-${USUAL_REGION[language] ?? language.toUpperCase()}`;
    const dictionary =
      find(tag) ??
      find(language) ??
      find(usual) ??
      available.find((each) => each.toLowerCase().startsWith(`${language}-`));
    if (dictionary !== undefined && !chosen.includes(dictionary)) chosen.push(dictionary);
  }
  return chosen;
}

/** What the main process does with a request on the spelling channel. */
export type SpellCheckerChoice =
  | { readonly kind: 'refused' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'set'; readonly languages: readonly string[] };

/**
 * The whole decision, for main.ts to carry out: a malformed request is refused, and logged there
 * without its content; macOS is left to the system's checker, which chooses its own languages and
 * where Electron's `setSpellCheckerLanguages` does nothing; a request that maps to no dictionary leaves
 * the dictionaries as they are, since setting none would switch checking off; anything else sets them.
 */
export function spellCheckerChoice(
  value: unknown,
  available: readonly string[],
  platform: string,
): SpellCheckerChoice {
  const requested = spellCheckRequest(value);
  if (requested === null) return { kind: 'refused' };
  if (platform === 'darwin') return { kind: 'unchanged' };
  const languages = spellCheckerLanguages(requested, available);
  return languages.length === 0 ? { kind: 'unchanged' } : { kind: 'set', languages };
}

/** The most suggestions the menu offers. */
const MOST_SUGGESTIONS = 5;

/** One item of the window's spelling menu, as main.ts turns it into Electron's. */
export type SpellingMenuItem =
  | { readonly kind: 'replace'; readonly label: string; readonly text: string }
  | { readonly kind: 'none'; readonly label: string }
  | { readonly kind: 'separator' }
  | { readonly kind: 'add'; readonly label: string; readonly word: string };

/**
 * The window's context menu over a misspelled word (W-K): its suggestions, each replacing the word, or
 * a line saying there are none; then **Add to dictionary**. Nothing where no word is misspelled, and
 * then no menu opens, as none did before. What it reads is the `context-menu` event's own `params`.
 */
export function spellingMenu(params: {
  readonly misspelledWord: string;
  readonly dictionarySuggestions: readonly string[];
}): SpellingMenuItem[] {
  const word = params.misspelledWord;
  if (word === '') return [];
  const suggestions = params.dictionarySuggestions.slice(0, MOST_SUGGESTIONS);
  return [
    ...(suggestions.length === 0
      ? [{ kind: 'none', label: 'No suggestions' } as const]
      : suggestions.map((text) => ({ kind: 'replace', label: text, text }) as const)),
    { kind: 'separator' },
    { kind: 'add', label: 'Add to dictionary', word },
  ];
}

/**
 * The window's ground before the renderer paints, so a dark system never flashes a light window:
 * tokens.css's --bg for the theme Auto resolves to (ADR-0046, LG-C). A person who chose a theme
 * other than the system's sees it from the renderer's first paint; the shell is never told.
 */
export function windowBackground(systemPrefersDark: boolean): string {
  return systemPrefersDark ? '#0d1217' : '#f4f6f8';
}
