import { z } from 'zod';

import { CONTROL, characters, storable } from '../data/primitives.js';

/**
 * A prompt library version (generation.md, "Prompts"; the G4 plan, G4-F and G4-G): a name and the
 * prompts it lists, by identity. Each runs at its latest approved version, read where it runs, so a
 * library floats; a template names exactly one (TPL-061), the empty default where it names none
 * (TPL-071).
 */
export const PROMPT_LIBRARY_SCHEMA_VERSION = 1;

/** The most prompts a library lists. */
export const LIBRARY_PROMPTS_MAX = 200;

/** Every tenant's empty library, seeded by 0124: what a template naming none binds. */
export const DEFAULT_PROMPT_LIBRARY_ID = 'c3f1b0a2-5d7e-4f6a-9b8c-2e4d6f8a0b1c';

const name = storable('A name')
  .refine((value) => characters(value) >= 1 && characters(value) <= 120, {
    message: 'A name is 1 to 120 characters',
  })
  .refine((value) => value === value.trim(), { message: 'A name has no space before or after it' })
  .refine((value) => !CONTROL.test(value), { message: 'A name holds no control character' });

export const promptLibrarySchema = z.strictObject({
  schemaVersion: z.literal(PROMPT_LIBRARY_SCHEMA_VERSION),
  name,
  prompts: z
    .array(z.uuid())
    .max(LIBRARY_PROMPTS_MAX)
    .refine((each) => new Set(each).size === each.length, 'Each prompt once'),
});
export type PromptLibrary = z.infer<typeof promptLibrarySchema>;

export interface LibraryProblem {
  readonly rule: 'library_invalid';
  readonly path: string;
  readonly message: string;
}

/** A library refused, with every problem found. */
export class LibraryRefused extends Error {
  constructor(readonly problems: readonly LibraryProblem[]) {
    super(
      `The library is refused: ${problems.map((each) => each.path || '(the whole)').join(', ')}`,
    );
  }
}

/** The shape: what a stored version is read back by and every write takes. Throws `LibraryRefused`. */
export function parsePromptLibrary(value: unknown): PromptLibrary {
  const parsed = promptLibrarySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new LibraryRefused(
    parsed.error.issues.map((issue) => ({
      rule: 'library_invalid',
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}
