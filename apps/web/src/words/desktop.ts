import { parse, TYPE } from '@formatjs/icu-messageformat-parser';

import enGB from './en-GB.json';
import { chosenLanguage, localeOf, INTERFACE_LOCALES } from './locales.js';
import { pseudolocalise } from './pseudo.js';

/**
 * **The desktop shell's own words** (the UI plan, UI-I; LOC-005): its tray and its spelling menu,
 * from the catalogue, for the main process, which bundles this module and nothing of React's. Each is
 * plain text but for a plain `{name}` placeholder, so it is read off its message without formatting.
 */
export const DESKTOP_WORDS = [
  'desktop.show',
  'desktop.connect',
  'desktop.update.check',
  'desktop.update.checking',
  'desktop.update.downloading',
  'desktop.update.restart',
  'desktop.update.title',
  'desktop.update.available',
  'desktop.update.available-detail',
  'desktop.update.download',
  'desktop.update.not-now',
  'desktop.update.ready',
  'desktop.update.ready-detail',
  'desktop.update.restart-now',
  'desktop.update.later',
  'desktop.update.none',
  'desktop.update.failed',
  'desktop.update.ok',
  'desktop.quit',
  'desktop.no-suggestions',
  'desktop.add-to-dictionary',
] as const;
export type DesktopWord = (typeof DESKTOP_WORDS)[number];

/**
 * A message's text, its quoting undone. A desktop word is literal but for a plain `{name}`, kept as it
 * is for the shell to fill (`fill` in apps/desktop/src/shell.ts): the version and the percentage.
 */
const textOf = (message: string): string =>
  parse(message)
    .map((element) =>
      element.type === TYPE.literal
        ? element.value
        : element.type === TYPE.argument
          ? `{${element.value}}`
          : '',
    )
    .join('');

/** The desktop's words in a language, English for one not declared. */
export function desktopWords(tag: string): Readonly<Record<DesktopWord, string>> {
  const locale = localeOf(tag);
  return Object.fromEntries(
    DESKTOP_WORDS.map((key) => [
      key,
      textOf(
        locale.pseudo ? pseudolocalise(enGB[key], locale.tag as 'en-XA' | 'ar-XB') : enGB[key],
      ),
    ]),
  ) as Record<DesktopWord, string>;
}

/**
 * The language the shell starts in, before the renderer says: the system's (`app.getLocale()`)
 * matched against the declared list, as a browser's is.
 */
export const desktopLanguage = (system: string): string => chosenLanguage(null, [system]);

/** Whether what the renderer sent is a declared tag, exactly: all the main process takes. */
export const isInterfaceLanguage = (value: unknown): value is string =>
  typeof value === 'string' && INTERFACE_LOCALES.some((locale) => locale.tag === value);
