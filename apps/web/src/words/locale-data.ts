/**
 * **Where the interface's locale data comes from** (the UI plan, UI-A; LOC-038): plural rules, number,
 * date, list and relative-time formats and display names, CLDR as these FormatJS packages carry it,
 * pinned and bundled, so a change of data is a change of a version here, never a drift in a browser.
 * Time zones are the golden set the date formatter carries. Collation alone is the runtime's.
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
} as const;

/** The data's version in a line: the formatter's, which names the CLDR release it bundles with. */
export const localeDataVersion = (): string =>
  `FormatJS ${LOCALE_DATA.formats['@formatjs/intl']}, date data ${LOCALE_DATA.formats['@formatjs/intl-datetimeformat']}`;
