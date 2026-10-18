import { z } from 'zod';

import { CONTROL, characters, parameterName, storable } from '../data/primitives.js';
import { ROUTED_PURPOSES } from './endpoint.js';

/**
 * A prompt version (generation.md, "Prompts"; the G4 plan, G4-A to G4-D): its instructions, the
 * context it declares, the output it writes and the models it accepts. Nothing undeclared reaches a
 * model (GEN-003): the instructions name the document's parameters only where the context declares
 * them. The shape is what a stored version is read back by; `checkPrompt` is what every write adds.
 */
export const PROMPT_SCHEMA_VERSION = 1;

/** Any control character but a line feed. */
const CONTROL_BUT_LINE_FEED = /(?!\n)\p{Cc}/u;

/** The most instructions may be, in characters. */
export const INSTRUCTIONS_MAX = 20_000;

/** A model's identifier, as its provider spells it, as an endpoint's is. */
const MODEL = /^[\x21-\x7e]{1,200}$/;

/** A parameter's place in the instructions: `{{name}}`, spaces inside the braces allowed. */
const PLACE = /\{\{\s*([^{}]*?)\s*\}\}/g;

const title = storable('A title')
  .refine((value) => characters(value) >= 1 && characters(value) <= 200, {
    message: 'A title is 1 to 200 characters',
  })
  .refine((value) => value === value.trim(), { message: 'A title has no space before or after it' })
  .refine((value) => !CONTROL.test(value), { message: 'A title holds no control character' });

const description = storable('A description')
  .refine((value) => characters(value) <= 2000, {
    message: 'A description is at most 2,000 characters',
  })
  .refine((value) => !CONTROL_BUT_LINE_FEED.test(value), {
    message: 'A description holds no control character but a line feed',
  });

const instructions = storable('Instructions')
  .refine((value) => value.trim() !== '' && characters(value) <= INSTRUCTIONS_MAX, {
    message: 'Instructions are 1 to 20,000 characters, not all space',
  })
  .refine((value) => !CONTROL_BUT_LINE_FEED.test(value), {
    message: 'Instructions hold no control character but a line feed',
  });

/** The value a field source matches: what a metadata field holds, or one member of a list it holds. */
const fieldValue = z.union([
  storable('A value').refine((value) => characters(value) >= 1 && characters(value) <= 1000, {
    message: 'A value is 1 to 1,000 characters',
  }),
  z.number().finite(),
  z.boolean(),
]);

/**
 * One source of context (G4-C; GEN-002, GEN-056): the part a prompt runs on, the parts of the section
 * holding it, or every part of the document; the components related to the part's by one type, one
 * way; the document's parts whose field holds a value; the document's values for named parameters.
 */
export const contextSourceSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('outline'), scope: z.enum(['part', 'section', 'document']) }),
  z.strictObject({
    source: z.literal('related'),
    type: z.uuid(),
    direction: z.enum(['out', 'in']),
  }),
  z.strictObject({ source: z.literal('field'), field: z.uuid(), value: fieldValue }),
  z.strictObject({
    source: z.literal('parameters'),
    names: z
      .array(parameterName)
      .min(1)
      .max(50)
      .refine((each) => new Set(each).size === each.length, 'Each parameter once'),
  }),
]);
export type ContextSource = z.infer<typeof contextSourceSchema>;

export const promptSchema = z.strictObject({
  schemaVersion: z.literal(PROMPT_SCHEMA_VERSION),
  title,
  description,
  instructions,
  context: z.array(contextSourceSchema).min(1).max(16),
  /** The component type of the part it writes the text of, or null for any (G4-B; GEN-004). */
  output: z.strictObject({ componentType: z.uuid().nullable() }),
  /** The purpose its runs route by, and the models it accepts (G4-D; GEN-005). */
  models: z.strictObject({
    purpose: z.enum(ROUTED_PURPOSES).exclude(['embedding']),
    accepts: z
      .array(
        z.string().regex(MODEL, { message: "A model is its provider's identifier, with no space" }),
      )
      .min(1)
      .max(16)
      .refine((each) => new Set(each).size === each.length, 'Each model once'),
  }),
});
export type Prompt = z.infer<typeof promptSchema>;

export interface PromptProblem {
  readonly rule: 'prompt_invalid';
  readonly path: string;
  readonly message: string;
}

/** A prompt refused, with every problem found. */
export class PromptRefused extends Error {
  constructor(readonly problems: readonly PromptProblem[]) {
    super(
      `The prompt is refused: ${problems.map((each) => each.path || '(the whole)').join(', ')}`,
    );
  }
}

/** The shape alone: what a stored version is read back by. Throws `PromptRefused`. */
export function parsePrompt(value: unknown): Prompt {
  const parsed = promptSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new PromptRefused(
    parsed.error.issues.map((issue) => ({
      rule: 'prompt_invalid',
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

/** The parameters a prompt's context declares, in the order declared. */
export function declaredParameters(prompt: Pick<Prompt, 'context'>): string[] {
  return prompt.context.flatMap((each) => (each.source === 'parameters' ? each.names : []));
}

/** The names the instructions place, each once, in the order first placed. */
export function placedParameters(text: string): string[] {
  return [...new Set([...text.matchAll(PLACE)].map((match) => match[1]!))];
}

/**
 * The checks beyond the shape (GEN-003): every place in the instructions names a declared parameter,
 * a parameter is declared once, and a source is declared once.
 */
export function checkPrompt(prompt: Prompt): PromptProblem[] {
  const problems: PromptProblem[] = [];
  const declared = declaredParameters(prompt);
  for (const name of placedParameters(prompt.instructions)) {
    if (!declared.includes(name)) {
      problems.push({
        rule: 'prompt_invalid',
        path: 'instructions',
        message: `{{${name}}} names no parameter the context declares`,
      });
    }
  }
  const twice = declared.filter((name, at) => declared.indexOf(name) !== at);
  for (const name of new Set(twice)) {
    problems.push({
      rule: 'prompt_invalid',
      path: 'context',
      message: `The parameter ${name} is declared twice`,
    });
  }
  const seen = new Set<string>();
  prompt.context.forEach((each, at) => {
    if (each.source === 'parameters') return;
    const key = JSON.stringify(each);
    if (seen.has(key)) {
      problems.push({
        rule: 'prompt_invalid',
        path: `context.${at}`,
        message: 'This source is declared twice',
      });
    }
    seen.add(key);
  });
  if (prompt.context.filter((each) => each.source === 'outline').length > 1) {
    problems.push({
      rule: 'prompt_invalid',
      path: 'context',
      message: 'One outline source at most: the part, its section or the whole document',
    });
  }
  return problems;
}

/** The shape, then the checks: what every write path parses a version by. Throws `PromptRefused`. */
export function parsePromptForWrite(value: unknown): Prompt {
  const prompt = parsePrompt(value);
  const problems = checkPrompt(prompt);
  if (problems.length > 0) throw new PromptRefused(problems);
  return prompt;
}

/**
 * The instructions with each place filled by its parameter's value as text, a list's members joined by
 * a comma and a space. A place whose parameter the document holds no value for is left empty.
 */
export function placeParameters(
  text: string,
  values: Readonly<Record<string, string | boolean | readonly (string | boolean)[]>>,
  /** How a value is written where it is placed: as itself, or wrapped as data by a run. */
  written: (name: string, value: string) => string = (_, value) => value,
): string {
  return text.replace(PLACE, (_, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined) return '';
    return written(name, Array.isArray(value) ? value.map(String).join(', ') : String(value));
  });
}
