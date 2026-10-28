import { CONTENT_LANGUAGES } from './content-languages.js';

/** The scripts the default theme sets (STY-075), and so the scripts a declared language is written in. */
export const DECLARED_SCRIPTS = ['Latn', 'Grek', 'Cyrl', 'Hebr', 'Arab'] as const;
export type DeclaredScript = (typeof DECLARED_SCRIPTS)[number];

/** A declared content language (the TE plan, TE-E; LOC-044): its tag, script, direction and plurals. */
export interface ContentLanguage {
  readonly tag: string;
  readonly script: DeclaredScript;
  readonly direction: 'ltr' | 'rtl';
  /** CLDR's cardinal plural categories for it, in CLDR's order. */
  readonly plurals: readonly string[];
}

/** What the list is derived from: the pinned CLDR's available locales, exemplars and plurals. */
export interface CldrInputs {
  readonly cldr: string;
  readonly available: readonly string[];
  /** Each locale's main exemplar set, as CLDR writes it. */
  readonly exemplars: Readonly<Record<string, string>>;
  /** Cardinal plural categories by CLDR's key, `und` the root's. */
  readonly plurals: Readonly<Record<string, readonly string[]>>;
}

const SCRIPT_PATTERNS: Readonly<Record<DeclaredScript, RegExp>> = {
  Latn: /\p{Script=Latin}/u,
  Grek: /\p{Script=Greek}/u,
  Cyrl: /\p{Script=Cyrillic}/u,
  Hebr: /\p{Script=Hebrew}/u,
  Arab: /\p{Script=Arabic}/u,
};
const SHARED = /[\p{Script=Common}\p{Script=Inherited}]/u;
const BACKSLASH = String.fromCharCode(92);

/**
 * The code points of an exemplar set as CLDR writes one: `[a b {ch} x-z]`, a backslash escaping the
 * next character or starting `\uXXXX`. Enough for CLDR's exemplars, not every UnicodeSet.
 */
export function exemplarCodePoints(set: string): Set<number> {
  const chars = [...set.trim().replace(/^\[/, '').replace(/\]$/, '')];
  const found = new Set<number>();
  let at = 0;
  // One character, escapes read.
  const next = (): number => {
    const char = chars[at++]!;
    if (char !== BACKSLASH) return char.codePointAt(0)!;
    if (chars[at] === 'u') {
      const hex = chars.slice(at + 1, at + 5).join('');
      at += 5;
      return Number.parseInt(hex, 16);
    }
    return chars[at++]!.codePointAt(0)!;
  };
  while (at < chars.length) {
    const char = chars[at]!;
    if (/\s/u.test(char)) {
      at += 1;
    } else if (char === '{') {
      at += 1;
      while (at < chars.length && chars[at] !== '}') found.add(next());
      at += 1;
    } else {
      const first = next();
      if (chars[at] === '-' && at + 1 < chars.length) {
        at += 1;
        const last = next();
        for (let each = first; each <= last; each += 1) found.add(each);
      } else {
        found.add(first);
      }
    }
  }
  return found;
}

/** The one declared script a set's letters are in, shared characters aside; undefined for none or two. */
function scriptOfCharacters(codePoints: ReadonlySet<number>): DeclaredScript | undefined {
  const scripts = new Set<string>();
  for (const codePoint of codePoints) {
    const char = String.fromCodePoint(codePoint);
    if (SHARED.test(char)) continue;
    scripts.add(DECLARED_SCRIPTS.find((script) => SCRIPT_PATTERNS[script].test(char)) ?? 'other');
  }
  const [only] = scripts;
  return scripts.size === 1 && only !== 'other' ? (only as DeclaredScript) : undefined;
}

/**
 * The declared content languages (TE-E; LOC-044): every available locale that is a language, or a
 * language in a script, written in a declared script (its tag's, else its exemplars'; never likely
 * subtags), whose every exemplar character `covered` answers for. Ordered by tag.
 */
export function deriveContentLanguages(
  inputs: CldrInputs,
  covered: (codePoint: number) => boolean,
): { readonly cldr: string; readonly languages: readonly ContentLanguage[] } {
  const languages: ContentLanguage[] = [];
  for (const tag of inputs.available) {
    const [language, script, ...rest] = tag.split('-');
    if (language === 'root' || language === 'und' || rest.length > 0) continue;
    if (script !== undefined && !/^[A-Z][a-z]{3}$/.test(script)) continue;
    const set = inputs.exemplars[tag];
    if (set === undefined) continue;
    const codePoints = exemplarCodePoints(set);
    const written =
      script === undefined
        ? scriptOfCharacters(codePoints)
        : DECLARED_SCRIPTS.find((each) => each === script);
    if (written === undefined || ![...codePoints].every(covered)) continue;
    languages.push({
      tag,
      script: written,
      direction: written === 'Hebr' || written === 'Arab' ? 'rtl' : 'ltr',
      plurals: inputs.plurals[tag] ??
        inputs.plurals[language!] ??
        inputs.plurals['und'] ?? ['other'],
    });
  }
  languages.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  return { cldr: inputs.cldr, languages };
}

/** content-languages.ts as the generator writes it. */
export function renderContentLanguages(list: {
  readonly cldr: string;
  readonly languages: readonly ContentLanguage[];
}): string {
  const rows = list.languages
    .map(
      (each) =>
        `  { tag: '${each.tag}', script: '${each.script}', direction: '${each.direction}', plurals: [${each.plurals.map((one) => `'${one}'`).join(', ')}] },`,
    )
    .join('\n');
  return `// Generated by \`pnpm --filter @alloy-works/domain generate:languages\` from the pinned CLDR and the
// default theme's faces: never edited by hand. declared-languages.test.ts regenerates and compares it.

import type { ContentLanguage } from './declared-languages.js';

/** The CLDR release the list is made from: \`cldr-core\` and \`cldr-misc-full\` at this version. */
export const CONTENT_LANGUAGES_CLDR = '${list.cldr}';

/** The declared content languages (the TE plan, TE-E; LOC-044), by tag. */
export const CONTENT_LANGUAGES: readonly ContentLanguage[] = [
${rows}
];
`;
}

/**
 * The declared language a well-formed tag is in (LOC-044): its language and script, else its language
 * alone, any case; undefined for one outside the list, which is still admitted (CNT's rule).
 */
export function declaredLanguageOf(tag: string): ContentLanguage | undefined {
  const [language, second] = tag.toLowerCase().split('-');
  if (!language) return undefined;
  const script =
    second !== undefined && second.length === 4
      ? second[0]!.toUpperCase() + second.slice(1)
      : undefined;
  const alone = CONTENT_LANGUAGES.find((each) => each.tag === language);
  if (script === undefined) return alone;
  // `en-Latn` is `en`, whose script is Latin; `sr-Latn` is a language of its own.
  return (
    CONTENT_LANGUAGES.find((each) => each.tag === `${language}-${script}`) ??
    (alone?.script === script ? alone : undefined)
  );
}
