import { z } from 'zod';

import type { ContentDocument } from '../content/model/document.js';
import { valueTypeSchema, type ValueType } from '../data/columns.js';
import { formatValue } from '../data/format.js';
import { definitionIdentity } from '../metadata/definition.js';
import type { PublishFailure } from '../publishing/failures.js';
import type { ValueFormats } from '../theme/schema.js';

/** A form a context prints a value in (REU-019; the R5 plan, R5-C): what it lays over the formats. */
const formSchema = z.strictObject({
  date: z
    .strictObject({
      order: z.enum(['ymd', 'dmy', 'mdy']).optional(),
      separator: z.enum(['-', '/', '.']).optional(),
      pad: z.boolean().optional(),
    })
    .optional(),
  number: z
    .strictObject({
      group: z.enum(['none', ',', '.', "'", 'U+00A0', 'U+202F']).optional(),
      groupFrom: z.union([z.literal(4), z.literal(5)]).optional(),
    })
    .optional(),
});
export type VariableForm = z.infer<typeof formSchema>;

/**
 * **A variable** (REU-018; R5-A): the environment's, declared once and chosen from a list. `key` is
 * what a content `variable` node names; `sources` where its value may come from, taken in the
 * declared order - the document's parameter set, then its metadata (REU-038; R5-B); `forms` how it
 * prints in a title and in text (R5-C).
 */
export const variableDefinitionSchema = z.strictObject({
  ...definitionIdentity,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  type: valueTypeSchema,
  sources: z
    .strictObject({
      parameter: z.string().min(1).max(64).optional(),
      field: z.string().min(1).max(64).optional(),
    })
    .refine(
      (sources) => sources.parameter !== undefined || sources.field !== undefined,
      'A variable has a source to take its value from',
    ),
  forms: z.strictObject({ title: formSchema.optional(), text: formSchema.optional() }).optional(),
});
export type VariableDefinition = z.infer<typeof variableDefinitionSchema>;

/** Where a value came from, in the order sources are taken (REU-038). */
export type VariableSource = 'parameter' | 'metadata';

/** What a variable resolves from: the referring document's parameters and its own field values. */
export interface VariableContext {
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly values: Readonly<Record<string, unknown>>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Whether a stored value is one this type prints: canonical, and one value, never a list. */
function fits(value: unknown, type: ValueType): value is string | boolean {
  if (type.base === 'boolean') return typeof value === 'boolean';
  if (typeof value !== 'string') return false;
  switch (type.base) {
    case 'text':
      return value !== '';
    case 'integer':
      return /^-?(0|[1-9]\d*)$/.test(value);
    case 'decimal':
      return /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value);
    case 'date':
      return DATE.test(value);
    case 'time':
      return TIME.test(value);
    case 'localDateTime':
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value);
    case 'instant':
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(value);
  }
}

/**
 * A variable's value, and the source that supplied it (REU-016, REU-038; R5-B): its parameter where
 * the document's parameter set holds one, else its field where the document's metadata does; each
 * taken only where it is one value its type prints. Undefined where neither does.
 */
export function resolveVariable(
  definition: VariableDefinition,
  context: VariableContext,
): { readonly value: string | boolean; readonly source: VariableSource } | undefined {
  const { parameter, field } = definition.sources;
  if (parameter !== undefined) {
    const value = context.parameters[parameter];
    if (fits(value, definition.type)) return { value, source: 'parameter' };
  }
  if (field !== undefined) {
    const value = context.values[field];
    if (fits(value, definition.type)) return { value, source: 'metadata' };
  }
  return undefined;
}

/** The document's formats with a context's form laid over them (R5-C). */
function formed(formats: ValueFormats, form: VariableForm | undefined): ValueFormats {
  if (!form) return formats;
  /** Only the members a form names: one it leaves out keeps the document's. */
  const named = <T extends object>(over: T | undefined) =>
    Object.fromEntries(Object.entries(over ?? {}).filter(([, value]) => value !== undefined));
  const number = { ...formats.number, ...named(form.number) } as ValueFormats['number'];
  return {
    ...formats,
    date: { ...formats.date, ...named(form.date) } as ValueFormats['date'],
    // A group that is the decimal separator is never laid over it.
    number: number.group === number.decimal ? formats.number : number,
  };
}

/** One printed variable, as the publish records it (REU-038; R5-E). */
export interface PrintedVariable {
  readonly node: string;
  readonly block: string | null;
  readonly key: string;
  readonly source: VariableSource;
  readonly value: string | boolean;
  readonly printed: string;
}

type Printer = (
  key: string,
  block: string | null,
) => { readonly text: string } | { readonly failure: PublishFailure };

function printer(
  node: string,
  definitions: ReadonlyMap<string, VariableDefinition>,
  context: VariableContext,
  formats: ValueFormats,
  context_: 'title' | 'text',
  printed: PrintedVariable[],
): Printer {
  return (key, block) => {
    const definition = definitions.get(key);
    const resolved = definition && resolveVariable(definition, context);
    if (!definition || !resolved) {
      return {
        failure: { stage: 'bind', code: 'variable_unresolved', node, block, detail: key },
      };
    }
    const text = formatValue(
      resolved.value,
      definition.type,
      formed(formats, definition.forms?.[context_]),
    );
    printed.push({
      node,
      block,
      key,
      source: resolved.source,
      value: resolved.value,
      printed: text,
    });
    return { text };
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every value inside, each `variable` node replaced as `replace` says. */
function replaced(value: unknown, replace: (key: string) => unknown): unknown {
  if (Array.isArray(value)) {
    return value.flatMap((member) => {
      if (isRecord(member) && member['type'] === 'variable' && typeof member['name'] === 'string') {
        const instead = replace(member['name']);
        return instead === undefined ? [] : [instead];
      }
      return [replaced(member, replace)];
    });
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, member]) => [name, replaced(member, replace)]),
    );
  }
  return value;
}

/**
 * Each variable in an occurrence's text printed in its text form (REU-017, REU-019; R5-C to R5-E): a
 * run of plain text, as a binding's value is, and recorded; or, where it does not resolve, nothing
 * printed and the publish failed `variable_unresolved` by node, block and key - never its name, never
 * blank.
 */
export function printVariables(
  node: string,
  content: ContentDocument,
  definitions: ReadonlyMap<string, VariableDefinition>,
  context: VariableContext,
  formats: ValueFormats,
): {
  readonly content: ContentDocument;
  readonly printed: readonly PrintedVariable[];
  readonly failures: readonly PublishFailure[];
} {
  const printed: PrintedVariable[] = [];
  const failures: PublishFailure[] = [];
  const print = printer(node, definitions, context, formats, 'text', printed);
  const blocks = content.content.map((block) =>
    replaced(block, (key) => {
      const answer = print(key, block.id);
      if ('failure' in answer) {
        failures.push(answer.failure);
        return undefined;
      }
      return { type: 'text', value: answer.text, marks: [] };
    }),
  );
  return {
    content: { ...content, content: blocks as ContentDocument['content'] },
    printed,
    failures,
  };
}

/** A section title's variables printed in its title form (REU-019), as `printVariables` prints text. */
export function printTitleVariables<Title extends readonly unknown[]>(
  node: string,
  title: Title,
  definitions: ReadonlyMap<string, VariableDefinition>,
  context: VariableContext,
  formats: ValueFormats,
): {
  readonly title: Title;
  readonly printed: readonly PrintedVariable[];
  readonly failures: readonly PublishFailure[];
} {
  const printed: PrintedVariable[] = [];
  const failures: PublishFailure[] = [];
  const print = printer(node, definitions, context, formats, 'title', printed);
  const next = replaced(title, (key) => {
    const answer = print(key, null);
    if ('failure' in answer) {
      failures.push(answer.failure);
      return undefined;
    }
    return { type: 'text', value: answer.text, marks: [] };
  }) as unknown as Title;
  return { title: next, printed, failures };
}
