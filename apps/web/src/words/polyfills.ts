// The bundled, versioned locale data every format comes from (the UI plan, UI-A; LOC-038), forced over
// the runtime's own so a browser's ICU never changes what the interface says. Imported first, by
// `main.tsx` and the test setup, before anything formats. The native zone is captured first. English
// is bundled; another language's data loads when it is chosen (`loadLocaleData`). Intl.Locale and
// getCanonicalLocales are the runtime's own: every supported runtime has them, and they format nothing.
import { nativeTimeZone } from './native.js';

import '@formatjs/intl-pluralrules/polyfill-force.js';
// Plural rules are by language alone: `en` serves `en-GB`.
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-numberformat/polyfill-force.js';
import '@formatjs/intl-numberformat/locale-data/en-GB.js';
import '@formatjs/intl-datetimeformat/polyfill-force.js';
import '@formatjs/intl-datetimeformat/locale-data/en-GB.js';
import '@formatjs/intl-datetimeformat/add-golden-tz.js';
import '@formatjs/intl-relativetimeformat/polyfill-force.js';
import '@formatjs/intl-relativetimeformat/locale-data/en-GB.js';
import '@formatjs/intl-listformat/polyfill-force.js';
import '@formatjs/intl-listformat/locale-data/en-GB.js';
import '@formatjs/intl-displaynames/polyfill-force.js';
import '@formatjs/intl-displaynames/locale-data/en-GB.js';

const zone = nativeTimeZone();
// The bundled formatter's zone is the runtime's, not UTC (the pre-flight review, F3).
(
  Intl.DateTimeFormat as unknown as { __setDefaultTimeZone?: (zone: string) => void }
).__setDefaultTimeZone?.(zone);

/** The CLDR locales whose data is bundled, and those loaded as they are first chosen. */
const loaded = new Set(['en-GB']);

/** Loads a language's locale data before anything is formatted in it (the pre-flight review, F12). */
export async function loadLocaleData(formats: string): Promise<void> {
  if (loaded.has(formats)) return;
  if (formats === 'ar') {
    await Promise.all([
      import('@formatjs/intl-pluralrules/locale-data/ar.js'),
      import('@formatjs/intl-numberformat/locale-data/ar.js'),
      import('@formatjs/intl-datetimeformat/locale-data/ar.js'),
      import('@formatjs/intl-relativetimeformat/locale-data/ar.js'),
      import('@formatjs/intl-listformat/locale-data/ar.js'),
      import('@formatjs/intl-displaynames/locale-data/ar.js'),
    ]);
  }
  loaded.add(formats);
}
