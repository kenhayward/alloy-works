import type { PublishedLanguage } from './published.js';

/** A language of two or three letters and, optionally, a region of exactly two: all Typst takes. */
const CARRIED = /^([a-z]{2,3})(?:-([A-Z]{2}))?$/;

/**
 * A BCP 47 tag as the engine can carry it, or `null` where it cannot. Typst takes a language of two or
 * three letters and a region of exactly two, and refuses anything else - `es-419` stops the compile.
 * A tag with a script subtag (`sr-Latn`), a numeric region or a variant is therefore refused by
 * `assemble`, naming the tag, and never shortened to what the engine would take (Ken's answer K,
 * 2026-09-19): `sr-Latn` and `sr-Cyrl` are not the same language to a screen reader, and a shortened
 * tag would tell assistive technology something the author never said.
 */
export function publishedLanguage(tag: string): PublishedLanguage | null {
  const match = CARRIED.exec(tag);
  if (match === null) return null;
  const [, lang = tag, region] = match;
  return { lang, region: region ?? null };
}
