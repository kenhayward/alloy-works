import { z } from 'zod';
import { languageTagSchema } from '../content/model/document.js';
import { disallowed } from '../publishing/glyphs.js';
import { storableText } from '../stored/storable.js';

/** The mark's words: storable, and nothing PDF/UA-1 refuses, as a layout's own words are (TRb). */
const noteWords = z
  .string()
  .trim()
  .min(1)
  .refine(storableText, 'The words hold a character that cannot be stored')
  .refine(
    (text) => !Array.from(text, (character) => character.codePointAt(0)!).some(disallowed),
    'The words hold a character a publication refuses',
  );

/**
 * The tenant's translation policy (docs/design/translation.md; the TR plan, TR-J; LOC-017, LOC-036,
 * LOC-037): whether a missing variant falls back to the source, marked, or refuses the publish;
 * whether an out-of-date one publishes or refuses; the words the mark says, by language; and the
 * decision offered first for a returned translation whose source or line moved since it was sent
 * (XL-G; LOC-035), which a person always takes. A document may override its fallback.
 */
export const TRANSLATION_FALLBACKS = ['source', 'refuse'] as const;
export const TRANSLATION_OUT_OF_DATE = ['publish', 'refuse'] as const;
/** Placed for review, accepted as a translation of the version sent, or rejected (LOC-035). */
export const TRANSLATION_CONFLICTS = ['review', 'accept', 'reject'] as const;
/** Whether content goes to machine translation, and to which endpoints (XL-K; LOC-026). */
export const TRANSLATION_MACHINE = ['off', 'inside', 'any'] as const;

/** The most languages a note is given in, and the most characters it says in each. */
export const TRANSLATION_NOTE_LIMITS = { languages: 50, characters: 80 } as const;

export const translationPolicySchema = z.strictObject({
  fallback: z.enum(TRANSLATION_FALLBACKS),
  outOfDate: z.enum(TRANSLATION_OUT_OF_DATE),
  note: z
    .record(languageTagSchema, noteWords.pipe(z.string().max(TRANSLATION_NOTE_LIMITS.characters)))
    .refine(
      (note) => Object.keys(note).length <= TRANSLATION_NOTE_LIMITS.languages,
      `At most ${TRANSLATION_NOTE_LIMITS.languages} languages`,
    ),
  // Absent from a policy stored before XLb, which placed nothing for review: read as the default.
  conflict: z.enum(TRANSLATION_CONFLICTS).default('review'),
  // Absent before XLc, which sent nothing: read as the default, off.
  machine: z.enum(TRANSLATION_MACHINE).default('off'),
});
export type TranslationPolicy = z.infer<typeof translationPolicySchema>;

/**
 * What a tenant starts with (LOC-036): fall back, marked; publish what is out of date; place a
 * conflicted return for review; send nothing to machine translation.
 */
export const DEFAULT_TRANSLATION_POLICY: TranslationPolicy = {
  fallback: 'source',
  outOfDate: 'publish',
  note: {},
  conflict: 'review',
  machine: 'off',
};

/**
 * The words that mark a component published in its source language (TR-J; LOC-037): the note's for
 * the document's language, else for its base language (`fr` for `fr-FR`), else `Untranslated`, with
 * the source's tag.
 */
export function untranslatedNote(
  note: Readonly<Record<string, string>>,
  language: string,
  source: string,
): string {
  const base = language.split('-')[0]!;
  const words = note[language] ?? note[base] ?? 'Untranslated';
  return `${words} (${source})`;
}
