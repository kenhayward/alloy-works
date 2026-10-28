/**
 * **Where the interface's locale data comes from** (the UI plan, UI-A; LOC-044): plural rules, number,
 * date, list and relative-time formats and display names, CLDR as these FormatJS packages carry it,
 * pinned and bundled, so a change of data is a change of a version here, never a drift in a browser.
 * Time zones are the golden set the date formatter carries. Collation alone is the runtime's: a tab's
 * own sorts are the browser's (LOC-044).
 */
export const LOCALE_DATA = {
  formats: {
    '@formatjs/intl': '6.1.3',
    '@formatjs/intl-datetimeformat': '7.8.1',
    '@formatjs/intl-displaynames': '7.3.15',
    '@formatjs/intl-listformat': '8.3.15',
    '@formatjs/intl-locale': '5.3.12',
    '@formatjs/intl-numberformat': '9.4.3',
    '@formatjs/intl-pluralrules': '6.3.15',
    '@formatjs/intl-relativetimeformat': '12.3.15',
  },
  /** The CLDR release they carry, as FormatJS's own repository pinned it when they were published. */
  cldr: '48.2.0',
} as const;

/** The data's version in a line: the formatter's, and the CLDR release it bundles. */
export const localeDataVersion = (): string =>
  `FormatJS ${LOCALE_DATA.formats['@formatjs/intl']}, date data ${LOCALE_DATA.formats['@formatjs/intl-datetimeformat']}, CLDR ${LOCALE_DATA.cldr}`;
