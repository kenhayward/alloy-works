import { z } from 'zod';

import { languageTagSchema } from '../content/model/document.js';
import { characters, CONTROL, storable } from '../data/primitives.js';
import { definitionIdentity } from '../metadata/definition.js';

/**
 * **A vocabulary** (vocabularies.md; the VO plan, VO-A, VO-B): an environment-wide definition, a named
 * list of permitted values (LIB-020), each labelled by language (LIB-024), optionally described
 * (LIB-054), active, deprecated with its replacement, or retired (LIB-055, LIB-023). A value's `id` is
 * allocated once and takes an axis value key's form, so an axis can draw on it (LIB-022).
 */
export const VOCABULARY_LIMITS = {
  values: 5_000,
  languages: 50,
  label: 500,
  description: 2_000,
} as const;

const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, {
  message: 'A key is a lower-case letter, then letters, digits or underscores',
});

/** Text people read: not blank, at most `max` characters, no control character. */
const text = (what: string, max: number) =>
  storable(what)
    .refine((value) => value.trim() !== '' && characters(value) <= max, {
      message: `${what} is 1 to ${max.toLocaleString('en')} characters`,
    })
    .refine((value) => !CONTROL.test(value), { message: `${what} holds no control character` });

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

const byLanguage = (what: string, max: number) =>
  z
    .array(z.strictObject({ language: languageTagSchema, text: text(what, max) }))
    .max(VOCABULARY_LIMITS.languages)
    .superRefine(onePerLanguage);

/**
 * What an import checks a value by before it builds one (the VO plan, VO-I): a key, as a value's id or
 * a vocabulary's key, and a label or a description as a value holds one.
 */
export const isVocabularyKey = (value: string) => key.safeParse(value).success;
export const holdsVocabularyText = (what: 'label' | 'description', value: string) =>
  (what === 'label'
    ? text('A label', VOCABULARY_LIMITS.label)
    : text('A description', VOCABULARY_LIMITS.description)
  ).safeParse(value).success;

const valueSchema = z.strictObject({
  id: key,
  labels: byLanguage('A label', VOCABULARY_LIMITS.label).min(1),
  descriptions: byLanguage('A description', VOCABULARY_LIMITS.description),
  state: z.enum(['active', 'deprecated', 'retired']),
  /** A deprecated value's replacement, another value of the vocabulary (LIB-055). */
  replacedBy: key.optional(),
});
export type VocabularyValue = z.infer<typeof valueSchema>;

export const vocabularyDefinitionSchema = z
  .strictObject({
    ...definitionIdentity,
    key,
    base: languageTagSchema,
    order: z.enum(['declared', 'label']),
    values: z.array(valueSchema).max(VOCABULARY_LIMITS.values),
  })
  .superRefine((vocabulary, ctx) => {
    const ids = new Map(vocabulary.values.map((each) => [each.id, each]));
    vocabulary.values.forEach((value, n) => {
      if (vocabulary.values.findIndex((each) => each.id === value.id) !== n) {
        ctx.addIssue({
          code: 'custom',
          path: ['values', n, 'id'],
          message: 'Each value has an id of its own',
        });
      }
      if (
        value.labels.length > 0 &&
        !value.labels.some((each) => each.language === vocabulary.base)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['values', n, 'labels'],
          message: 'Each value is labelled in the base language',
        });
      }
      if (value.replacedBy === undefined) return;
      const replacedBy = ['values', n, 'replacedBy'];
      if (value.state !== 'deprecated') {
        ctx.addIssue({
          code: 'custom',
          path: replacedBy,
          message: 'Only a deprecated value is replaced',
        });
        return;
      }
      // Followed to a value nothing replaces: a missing value, the value itself, or a loop refuses.
      const seen = new Set([value.id]);
      for (let next = ids.get(value.replacedBy); ; next = ids.get(next.replacedBy!)) {
        if (next === undefined || seen.has(next.id)) {
          ctx.addIssue({
            code: 'custom',
            path: replacedBy,
            message: 'A replacement is another value of the vocabulary, never a loop',
          });
          return;
        }
        if (next.state !== 'deprecated' || next.replacedBy === undefined) return;
        seen.add(next.id);
      }
    });
  });
export type Vocabulary = z.infer<typeof vocabularyDefinitionSchema>;

export interface VocabularyProblem {
  readonly rule: 'vocabulary_invalid';
  readonly path: string;
  readonly message: string;
}

/** A vocabulary refused, with every problem found. */
export class VocabularyRefused extends Error {
  constructor(readonly problems: readonly VocabularyProblem[]) {
    super(
      `The vocabulary is refused: ${problems.map((each) => each.path || '(the whole)').join(', ')}`,
    );
  }
}

/** The shape every write parses. Throws `VocabularyRefused`. */
export function parseVocabulary(value: unknown): Vocabulary {
  const parsed = vocabularyDefinitionSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new VocabularyRefused(
    parsed.error.issues.map((issue) => ({
      rule: 'vocabulary_invalid',
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

const inLanguage = (
  items: readonly { language: string; text: string }[],
  language: string,
  base: string,
) =>
  (items.find((each) => each.language === language) ?? items.find((each) => each.language === base))
    ?.text;

/** A value's label in `language`, the base language's where it has none (LIB-024). */
export const valueLabel = (vocabulary: Vocabulary, value: VocabularyValue, language: string) =>
  inLanguage(value.labels, language, vocabulary.base)!;

/** A value's description in `language` or the base language, where it has one (LIB-054). */
export const valueDescription = (
  vocabulary: Vocabulary,
  value: VocabularyValue,
  language: string,
): string | undefined => inLanguage(value.descriptions, language, vocabulary.base);

/**
 * Its values in the order they are offered (LIB-053): as declared, or by label in the reader's
 * collation with ties by id, so never what the store returns.
 */
export function valuesInOrder(vocabulary: Vocabulary, language: string): VocabularyValue[] {
  if (vocabulary.order === 'declared') return [...vocabulary.values];
  const collator = new Intl.Collator(language);
  return [...vocabulary.values].sort(
    (a, b) =>
      collator.compare(valueLabel(vocabulary, a, language), valueLabel(vocabulary, b, language)) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * The ids a new version would drop (VO-B; LIB-023): a version keeps every id its predecessor held,
 * retired ones too, so checking against the latest alone suffices.
 */
export const vocabularyChangeRefusals = (
  previous: Vocabulary | undefined,
  next: Vocabulary,
): string[] => {
  if (previous === undefined) return [];
  const kept = new Set(next.values.map((each) => each.id));
  return previous.values.filter((each) => !kept.has(each.id)).map((each) => each.id);
};
