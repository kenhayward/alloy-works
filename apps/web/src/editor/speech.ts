import type * as SpeechRuleEngine from 'speech-rule-engine/mjs/index.js';

/**
 * An equation's alternative, written for the author by the speech rule engine (equations 1, ruling R7;
 * publishing.md's EQ-D), pinned at 4.1.4, its newest release that is not a release candidate.
 *
 * **Loaded the first time it is asked for, and never before.** The engine and each language's rules
 * are several hundred kilobytes apiece; a component that never has an equation typed into it never
 * loads any of them. The engine comes by a dynamic `import()`, which the build makes a file of its
 * own, and each language's rules likewise.
 *
 * **Its languages come from the product's own built files, never a CDN.** Left to itself, in a browser
 * the engine fetches its rules from `cdn.jsdelivr.net`, the moment it is loaded - a request to a third
 * party carrying nothing of the author's, but one the product never makes, and one that fails offline
 * and in the desktop application's `file://` window. The engine's supported way round it is a
 * **custom loader**, given as the global `SREfeature` before the engine is loaded, since it sets itself
 * up (and asks for its base rules and English) as soon as it is: set later, through `setupEngine`,
 * the loader would miss those. Ours answers each language from `LOCALES`, a fixed table of the
 * engine's own rule files, imported as text (`?raw`), so every one of them is in the build and nothing
 * is fetched at all - there is no address in it to fetch from.
 */

/**
 * The engine's rule files, by the name it asks for them by: `base`, which it always loads first, and
 * one per language it speaks. Written out, not built from a pattern, so that the build finds each
 * one, and so that a language the engine asks for which is not here is refused rather than looked for.
 */
const LOCALES: Readonly<Record<string, () => Promise<{ default: string }>>> = {
  base: () => import('speech-rule-engine/lib/mathmaps/base.json?raw'),
  af: () => import('speech-rule-engine/lib/mathmaps/af.json?raw'),
  ca: () => import('speech-rule-engine/lib/mathmaps/ca.json?raw'),
  da: () => import('speech-rule-engine/lib/mathmaps/da.json?raw'),
  de: () => import('speech-rule-engine/lib/mathmaps/de.json?raw'),
  en: () => import('speech-rule-engine/lib/mathmaps/en.json?raw'),
  es: () => import('speech-rule-engine/lib/mathmaps/es.json?raw'),
  fr: () => import('speech-rule-engine/lib/mathmaps/fr.json?raw'),
  hi: () => import('speech-rule-engine/lib/mathmaps/hi.json?raw'),
  it: () => import('speech-rule-engine/lib/mathmaps/it.json?raw'),
  ko: () => import('speech-rule-engine/lib/mathmaps/ko.json?raw'),
  nb: () => import('speech-rule-engine/lib/mathmaps/nb.json?raw'),
  nn: () => import('speech-rule-engine/lib/mathmaps/nn.json?raw'),
  sv: () => import('speech-rule-engine/lib/mathmaps/sv.json?raw'),
};

/**
 * The languages the engine speaks, by ISO 639 code, each of which is its primary language subtag in
 * BCP 47: Afrikaans, Catalan, Danish, German, English, Spanish, French, Hindi, Italian, Korean,
 * Norwegian Bokmål, Norwegian Nynorsk and Swedish. The engine's other two rule sets are not languages
 * an alternative is written in: `euro`, shared rules for European languages, and `nemeth`, braille.
 */
export const SPOKEN_LANGUAGES: readonly string[] = Object.keys(LOCALES).filter(
  (each) => each !== 'base',
);

/**
 * The engine's language for a component's base language, or null where it has none: the tag's
 * primary language subtag, whatever its region or script, since the engine has one set of rules per
 * language. `no`, Norwegian as its macrolanguage, is Bokmål, the written form a tag of `no` means in
 * practice.
 */
export function speechLanguage(tag: string): string | null {
  const primary = /^([A-Za-z]{2,3})(?:-|$)/.exec(tag)?.[1]?.toLowerCase();
  if (primary === undefined) return null;
  const language = primary === 'no' ? 'nb' : primary;
  return SPOKEN_LANGUAGES.includes(language) ? language : null;
}

/** A language's rules, as the text of their file; refused for a name that is not in the table. */
async function loadLocale(locale: string): Promise<string> {
  const load = Object.hasOwn(LOCALES, locale) ? LOCALES[locale] : undefined;
  if (load === undefined) throw new Error(`The speech rule engine has no rules for ${locale}.`);
  return (await load()).default;
}

type Engine = typeof SpeechRuleEngine;

let loading: Promise<Engine> | null = null;

/**
 * The engine, loaded once. Its ES module build, not its bundle: the bundle carries the engine's own
 * copies of the XML libraries it uses in Node, which a browser does without. `engineReady` waits for
 * the setup it starts itself - its base rules and English, which it keeps as the fallback for any
 * rule another language lacks - through the loader above.
 */
function engine(): Promise<Engine> {
  loading ??= (async () => {
    (globalThis as { SREfeature?: unknown }).SREfeature = { custom: loadLocale };
    const loaded = await import('speech-rule-engine/mjs/index.js');
    await loaded.engineReady();
    return loaded;
  })();
  return loading;
}

/**
 * Each request after the one before it: the engine is one object with one language set at a time, so
 * two requests in two languages interleaved would each be answered in whichever was set last.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Words for `mathml`, spoken in the language of `tag`, or null where the engine does not speak it.
 *
 * Clearspeak, the engine's style for speech written to be read by a listener rather than dictated, in
 * every language that has it; MathSpeak, the engine's other style, in Catalan, Danish and Spanish,
 * which have only that, as the engine chooses for itself.
 */
export function describeEquation(mathml: string, tag: string): Promise<string | null> {
  const locale = speechLanguage(tag);
  if (locale === null) return Promise.resolve(null);
  const spoken = queue.then(async () => {
    const sre = await engine();
    await sre.setupEngine({ locale, domain: 'clearspeak', modality: 'speech' });
    const words = sre.toSpeech(mathml).trim();
    return words === '' ? null : words;
  });
  queue = spoken.catch(() => undefined);
  return spoken;
}
