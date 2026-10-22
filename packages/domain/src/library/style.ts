import { z } from 'zod';

import { characters, storable } from '../data/primitives.js';
import { CSL_TYPES, CSL_VARIABLES, type CslItem } from './entry.js';

/**
 * A citation style version (citations.md, "The style"; the CI plan, CI-D): a CSL 1.0.2 file, a name,
 * and `requires`, the variables an entry of each CSL type must hold, since CSL declares none. The shape
 * alone is here; whether `csl` is CSL is the `citations` module's (`@alloy-works/domain/citations`),
 * which holds the processor and so stays out of the renderer.
 */
export const CITATION_STYLE_SCHEMA_VERSION = 1;

/**
 * The longest style file kept: the largest published CSL styles are under half of it, and a request
 * carries it whole, under the service's body limit.
 */
export const STYLE_CHARACTERS_MOST = 400_000;

const variable = z.string().refine((value) => value !== 'type' && CSL_VARIABLES.has(value), {
  message: 'Not a CSL variable',
});

/** What an entry of each type must hold, by CSL type (LIB-012). */
export const requiresSchema = z.partialRecord(
  z.enum(CSL_TYPES),
  z
    .array(variable)
    .max(100)
    .refine((list) => new Set(list).size === list.length, { message: 'A variable is named twice' }),
);
export type Requires = z.infer<typeof requiresSchema>;

export const citationStyleSchema = z.strictObject({
  schemaVersion: z.literal(CITATION_STYLE_SCHEMA_VERSION),
  name: storable('A name').refine(
    (value) => characters(value.trim()) >= 1 && characters(value) <= 200,
    { message: 'A name is 1 to 200 characters' },
  ),
  csl: storable('A style file')
    .min(1)
    .refine((value) => value.length <= STYLE_CHARACTERS_MOST, {
      message: 'A style file is at most 400,000 characters',
    }),
  requires: requiresSchema,
});
export type CitationStyle = z.infer<typeof citationStyleSchema>;

export interface StyleProblem {
  readonly rule: 'style_invalid';
  readonly path: string;
  readonly message: string;
}

/** A style refused, with every problem found. */
export class CitationStyleRefused extends Error {
  constructor(readonly problems: readonly StyleProblem[]) {
    super(`The style is refused: ${problems.map((each) => each.path || '(the whole)').join(', ')}`);
  }
}

/** The shape: what a stored version is read back by. Throws `CitationStyleRefused`. */
export function parseCitationStyle(value: unknown): CitationStyle {
  const parsed = citationStyleSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new CitationStyleRefused(
    parsed.error.issues.map((issue) => ({
      rule: 'style_invalid',
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

/** An entry lacking a variable its style requires for its type (LIB-012). */
export interface EntryIncomplete {
  readonly rule: 'entry_incomplete';
  readonly type: CslItem['type'];
  readonly variable: string;
}

const held = (value: unknown) =>
  value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);

/** The variables `requires` asks of an entry's type that it does not hold, in `requires`' order. */
export function requiredProblems(entry: CslItem, requires: Requires): EntryIncomplete[] {
  return (requires[entry.type] ?? [])
    .filter((each) => !held((entry as Record<string, unknown>)[each]))
    .map((each) => ({ rule: 'entry_incomplete', type: entry.type, variable: each }));
}

/**
 * The three styles every tenant holds (CNT-102), seeded by 0146 under these identifiers, unauthored at
 * 0.1; `file` names its CSL in `SEEDED_STYLE_FILES`.
 */
export const SEEDED_CITATION_STYLES = [
  {
    id: 'a6c1e2f4-3b5d-4e7a-8c9b-1d2e3f4a5b6c',
    version: 'd1f4a7c2-6e8b-4b1d-9f3e-5a7c9e1b3d5f',
    name: 'Harvard',
    file: 'harvard-cite-them-right',
  },
  {
    id: 'b7d2f3a5-4c6e-4f8b-9dac-2e3f4a5b6c7d',
    version: 'e2a5b8d3-7f9c-4c2e-8a4f-6b8d0f2c4e6a',
    name: 'Vancouver',
    file: 'nlm-citation-sequence',
  },
  {
    id: 'c8e3a4b6-5d7f-4a9c-8ebd-3f4a5b6c7d8e',
    version: 'f3b6c9e4-8a0d-4d3f-9b5a-7c9e1a3d5f7b',
    name: 'CSE',
    file: 'cse-name-year',
  },
] as const;

/**
 * What each seeded style requires (CI-D): the variables any of the three needs to point a reader at a
 * source of the common types. A style prints what an entry holds, so this is a floor, not a form.
 */
export const SEEDED_REQUIRES: Requires = {
  'article-journal': ['title', 'container-title'],
  book: ['title'],
  chapter: ['title', 'container-title'],
  'paper-conference': ['title'],
  report: ['title'],
  thesis: ['title'],
  webpage: ['title', 'URL'],
};

/** Harvard, which the default theme names (CI-E). */
export const DEFAULT_CITATION_STYLE = SEEDED_CITATION_STYLES[0];
