import { z } from 'zod';

import { MAXIMUM_OUTLINE_DEPTH } from './outline.js';

/**
 * How one part of a number is written. Alphabetic is bijective base 26 - `z` is followed by `aa`, as a
 * spreadsheet's columns are - and roman is written for 1 to 3999 and in decimal past it, so every
 * counter has a spelling and `formatCounter` is total. Zero, which only a prefix padded past the
 * sections that exist can hold, is `0` in every format.
 */
export const numberFormatSchema = z.enum([
  'decimal',
  'lowerAlpha',
  'upperAlpha',
  'lowerRoman',
  'upperRoman',
]);
export type NumberFormat = z.infer<typeof numberFormatSchema>;

const outlineDepth = z.number().int().min(1).max(MAXIMUM_OUTLINE_DEPTH);

/**
 * One sequence's rule in one matter (structure.md, "The scheme").
 *
 * - `label` is the word a caption's number is rendered with - "Figure" - and may be empty. STR-024
 *   makes it the layout's; until a layout exists, the default scheme below supplies it.
 * - `format` writes the parts of a number from the top, the last repeating: `['upperAlpha', 'decimal']`
 *   is "A", "A.1", "A.1.2". For the section sequence the parts are the section counters; for any other,
 *   the prefix's parts are written by the **section** rule's formats and the sequence's own counter by
 *   this rule's last one.
 * - `restartAt` restarts the counter whenever a numbered node at that depth or above is entered (STR-015);
 *   `null` never restarts it.
 * - `prefix` writes the section number to that depth before the counter - "2.4" is chapter 2's fourth
 *   figure - and `null` writes none.
 * - `separator` joins the parts of a section number, and a prefix to its counter.
 */
export const numberingRuleSchema = z.strictObject({
  label: z.string(),
  format: z.array(numberFormatSchema).min(1),
  restartAt: outlineDepth.nullable(),
  prefix: outlineDepth.nullable(),
  separator: z.string(),
});
export type NumberingRule = z.infer<typeof numberingRuleSchema>;

/** Every sequence has a rule in each matter: an appendix numbers in its own scheme (STR-016). */
export const sequenceRulesSchema = z.strictObject({
  body: numberingRuleSchema,
  appendix: numberingRuleSchema,
});

/** The five sequences a scheme always has (STR-014, CNT-041). A layout may declare more. */
export const REQUIRED_SEQUENCES = ['section', 'figure', 'table', 'equation', 'footnote'] as const;

/**
 * A numbering scheme: an open map from a sequence's name to its rules. **Not stored anywhere** - the
 * product's default below is a value in code, and a layout's will be a value PUB reads from the layout
 * artifact (STR-013) - so nothing here is a shape a later rule could find already written.
 *
 * `id` names the scheme so that anything keyed by the inputs to a numbering (STR-031) can key by it.
 * The section sequence's `restartAt` and `prefix` are `null`: a section number is the counter stack
 * itself, so it neither restarts nor takes a prefix.
 */
export const numberingSchemeSchema = z
  .strictObject({
    id: z.string().min(1),
    sequences: z.record(z.string().min(1), sequenceRulesSchema),
  })
  .refine(
    (scheme) => REQUIRED_SEQUENCES.every((name) => Object.hasOwn(scheme.sequences, name)),
    'A scheme numbers sections, figures, tables, equations and footnotes',
  )
  .refine((scheme) => {
    const section = scheme.sequences['section'];
    return (
      section === undefined ||
      [section.body, section.appendix].every(
        (rule) => rule.restartAt === null && rule.prefix === null,
      )
    );
  }, 'A section number is its counter stack, so the section sequence neither restarts nor takes a prefix')
  .refine(
    (scheme) =>
      Object.entries(scheme.sequences).every(([name, rules]) => {
        // Every sequence but section (checked above) and footnote: a house style routinely
        // restarts footnotes per chapter with no prefix, and its labels are meant to repeat.
        if (name === 'section' || name === 'footnote') return true;
        return [rules.body, rules.appendix].every(
          (rule) =>
            rule.restartAt === null || (rule.prefix !== null && rule.prefix >= rule.restartAt),
        );
      }),
    'A rule that restarts must prefix with the section number down to at least the depth it ' +
      'restarts at, or two restarts of its counter could print the same label',
  );
export type NumberingScheme = z.infer<typeof numberingSchemeSchema>;

const caption = (label: string) => ({
  body: { label, format: ['decimal'], restartAt: 1, prefix: 1, separator: '.' },
  appendix: { label, format: ['decimal'], restartAt: 1, prefix: 1, separator: '.' },
});

const continuous = (label: string) => ({
  label,
  format: ['decimal'],
  restartAt: null,
  prefix: null,
  separator: '.',
});

/**
 * **The product's default scheme** (structure.md, "The scheme", design decision E): decimal sections,
 * figures and tables prefixed with their chapter and restarting with it, equations continuous,
 * footnotes continuous, and appendices in upper alphabetic - "Appendix A" is `A`, its sections `A.1`,
 * its figures `Figure A.1`, and its equations `Equation A.1`, restarting per appendix. It is what every
 * document numbers against until PUB gives a layout a scheme of its own (STR-013, PUB-011), and PUB
 * replaces it without the engine changing.
 */
export const defaultNumberingScheme: NumberingScheme = numberingSchemeSchema.parse({
  id: 'default/1',
  sequences: {
    section: {
      body: continuous(''),
      appendix: { ...continuous(''), format: ['upperAlpha', 'decimal'] },
    },
    figure: caption('Figure'),
    table: caption('Table'),
    equation: {
      body: continuous('Equation'),
      appendix: { ...continuous('Equation'), restartAt: 1, prefix: 1 },
    },
    footnote: { body: continuous(''), appendix: continuous('') },
  },
});

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

function roman(value: number): string {
  if (value < 1 || value > 3999) return String(value);
  let rest = value;
  let written = '';
  for (const [size, letters] of ROMAN) {
    while (rest >= size) {
      written += letters;
      rest -= size;
    }
  }
  return written;
}

function alphabetic(value: number): string {
  let rest = value;
  let written = '';
  while (rest > 0) {
    rest -= 1;
    written = String.fromCharCode(97 + (rest % 26)) + written;
    rest = Math.floor(rest / 26);
  }
  return written;
}

/** One counter, written in one format. Total: every non-negative integer has a spelling. */
export function formatCounter(value: number, format: NumberFormat): string {
  if (value === 0) return '0';
  switch (format) {
    case 'decimal':
      return String(value);
    case 'lowerAlpha':
      return alphabetic(value);
    case 'upperAlpha':
      return alphabetic(value).toUpperCase();
    case 'lowerRoman':
      return roman(value);
    case 'upperRoman':
      return roman(value).toUpperCase();
  }
}

/** The parts of a number, each in the format for its place - the last format repeating. */
export function formatParts(parts: readonly number[], rule: NumberingRule): string[] {
  return parts.map((part, index) =>
    formatCounter(part, rule.format[Math.min(index, rule.format.length - 1)] ?? 'decimal'),
  );
}
