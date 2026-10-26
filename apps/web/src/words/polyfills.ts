// The bundled, versioned locale data every format comes from (the UI plan, UI-A; LOC-038), forced over
// the runtime's own so a browser's ICU never changes what the interface says. Imported first, by
// `main.tsx` and the test setup, before anything formats. The native zone is captured first.
import { nativeTimeZone } from './native.js';

import '@formatjs/intl-getcanonicallocales/polyfill-force.js';
import '@formatjs/intl-locale/polyfill-force.js';
import '@formatjs/intl-pluralrules/polyfill-force.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/ar.js';
import '@formatjs/intl-numberformat/polyfill-force.js';
import '@formatjs/intl-numberformat/locale-data/en.js';
import '@formatjs/intl-numberformat/locale-data/en-GB.js';
import '@formatjs/intl-numberformat/locale-data/ar.js';
import '@formatjs/intl-datetimeformat/polyfill-force.js';
import '@formatjs/intl-datetimeformat/locale-data/en.js';
import '@formatjs/intl-datetimeformat/locale-data/en-GB.js';
import '@formatjs/intl-datetimeformat/locale-data/ar.js';
import '@formatjs/intl-datetimeformat/add-golden-tz.js';
import '@formatjs/intl-relativetimeformat/polyfill-force.js';
import '@formatjs/intl-relativetimeformat/locale-data/en.js';
import '@formatjs/intl-relativetimeformat/locale-data/en-GB.js';
import '@formatjs/intl-relativetimeformat/locale-data/ar.js';
import '@formatjs/intl-listformat/polyfill-force.js';
import '@formatjs/intl-listformat/locale-data/en.js';
import '@formatjs/intl-listformat/locale-data/en-GB.js';
import '@formatjs/intl-listformat/locale-data/ar.js';
import '@formatjs/intl-displaynames/polyfill-force.js';
import '@formatjs/intl-displaynames/locale-data/en.js';
import '@formatjs/intl-displaynames/locale-data/en-GB.js';
import '@formatjs/intl-displaynames/locale-data/ar.js';

const zone = nativeTimeZone();
// The bundled formatter's zone is the runtime's, not UTC (the pre-flight review, F3).
(
  Intl.DateTimeFormat as unknown as { __setDefaultTimeZone?: (zone: string) => void }
).__setDefaultTimeZone?.(zone);
