import { z } from 'zod';

import { languageTagSchema } from '../content/model/document.js';
import { characters, CONTROL, storable } from '../data/primitives.js';

/**
 * A term version (terms.md, "The term"; the TM plan, TM-A): its labels and abbreviation per language,
 * a base language labelled, a definition, and broader, narrower and related terms of its space by
 * identity, stated and never inferred (LIB-025, LIB-027). Its standing is its workflow's, not here.
 */
export const TERM_SCHEMA_VERSION = 1;

/** The most labels, definitions and related terms a term holds, each list bounded. */
export const TERM_LIMITS = {
  languages: 50,
  label: 500,
  alternatives: 50,
  abbreviation: 40,
  definition: 10_000,
  relations: 200,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Text people read: not blank, at most `max` characters, no control character. */
const text = (what: string, max: number) =>
  storable(what)
    .refine((value) => value.trim() !== '' && characters(value) <= max, {
      message: `${what} is 1 to ${max.toLocaleString('en')} characters`,
    })
    .refine((value) => !CONTROL.test(value), { message: `${what} holds no control character` });

const termId = z.string().regex(UUID, { message: 'A related term is named by its identity' });

/** Each term once in a list. */
const relations = z
  .array(termId)
  .max(TERM_LIMITS.relations)
  .superRefine((ids, ctx) =>
    ids.forEach((id, n) => {
      if (ids.indexOf(id) !== n) {
        ctx.addIssue({ code: 'custom', path: [n], message: 'A term is named once' });
      }
    }),
  );

/** Each language once in a list. */
const onePerLanguage = <T extends { language: string }>(
  items: readonly T[],
  ctx: z.RefinementCtx,
) =>
  items.forEach((item, n) => {
    if (items.findIndex((each) => each.language === item.language) !== n) {
      ctx.addIssue({ code: 'custom', path: [n, 'language'], message: 'Each language once' });
    }
  });

const labelSchema = z.strictObject({
  language: languageTagSchema,
  preferred: text('A preferred label', TERM_LIMITS.label),
  alternatives: z
    .array(text('An alternative label', TERM_LIMITS.label))
    .max(TERM_LIMITS.alternatives),
  abbreviation: text('An abbreviation', TERM_LIMITS.abbreviation).optional(),
});
export type TermLabel = z.infer<typeof labelSchema>;

export const termSchema = z
  .strictObject({
    schemaVersion: z.literal(TERM_SCHEMA_VERSION),
    base: languageTagSchema,
    labels: z.array(labelSchema).min(1).max(TERM_LIMITS.languages).superRefine(onePerLanguage),
    definition: z
      .array(
        z.strictObject({
          language: languageTagSchema,
          text: text('A definition', TERM_LIMITS.definition),
        }),
      )
      .max(TERM_LIMITS.languages)
      .superRefine(onePerLanguage),
    broader: relations,
    narrower: relations,
    related: relations,
    /** A deprecated term's replacement, a term of the same space (LIB-018). */
    replacedBy: termId.optional(),
  })
  .superRefine((term, ctx) => {
    if (!term.labels.some((each) => each.language === term.base)) {
      ctx.addIssue({ code: 'custom', path: ['base'], message: 'The base language has a label' });
    }
  });
export type Term = z.infer<typeof termSchema>;

export interface TermProblem {
  readonly rule: 'term_invalid';
  readonly path: string;
  readonly message: string;
}

/** A term refused, with every problem found. */
export class TermRefused extends Error {
  constructor(readonly problems: readonly TermProblem[]) {
    super(`The term is refused: ${problems.map((each) => each.path || '(the whole)').join(', ')}`);
  }
}

/** The shape: what a stored version is read back by, and every write parses. Throws `TermRefused`. */
export function parseTerm(value: unknown): Term {
  const parsed = termSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new TermRefused(
    parsed.error.issues.map((issue) => ({
      rule: 'term_invalid',
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

/** The label in a language, else the base language's (LIB-050). */
export const termLabel = (term: Term, language: string): TermLabel =>
  term.labels.find((each) => each.language === language) ??
  term.labels.find((each) => each.language === term.base)!;

/** Whether a tag is one a term's language may be: well-formed BCP 47, as written conventionally. */
export const isLanguageTag = (tag: string): boolean => languageTagSchema.safeParse(tag).success;
