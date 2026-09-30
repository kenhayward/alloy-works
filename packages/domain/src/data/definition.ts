import { z } from 'zod';

import { storableText } from '../stored/storable.js';
import { valueProblem, compareCanonical, type CanonicalValue } from './canonical.js';
import { valueTypeSchema, type ValueType } from './columns.js';
import { limitCeilings } from './limits.js';
import { MAX_TEXT_VALUE } from './parameters.js';
import { MAX_COLUMNS } from './columns.js';
import { canonicalJson } from '../stored/canonical.js';
import { lexPostgres, longestBinding, RAN_MAX_CHARACTERS } from './sql.js';

/**
 * A query definition version (data.md, "What a query definition version holds"; the D2 plan, task 1):
 * SQL with named markers, the parameters it declares, the columns the author confirmed, a key, an
 * order, whether empty is valid, the limits, and whether it is retired. Its shape is what a stored
 * version is read back by; the checks beyond it are what every write path adds.
 */
export const QUERY_DEFINITION_SCHEMA_VERSION = 1;

/** A parameter's name and a variation's key: lower case, a letter first, as PostgreSQL's names go. */
export const PARAMETER_NAME = /^[a-z][a-z0-9_]{0,62}$/;

/** Any control character: C0, DEL and C1. */
const CONTROL = /\p{Cc}/u;
/** Any control character but a line feed. */
const CONTROL_BUT_LINE_FEED = /(?!\n)\p{Cc}/u;

/**
 * The most a definition may be, in bytes of its canonical JSON's UTF-8: so that one, with the values it
 * is sampled with, always fits a run's request (`RUN_REQUEST_MAX_BYTES`).
 */
export const DEFINITION_MAX_BYTES = 512 * 1024;

const characters = (value: string) => [...value].length;
/** A whole number with its thousands separated by commas, as the product writes one. */
const grouped = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

const storable = (what: string) =>
  z.string().refine(storableText, { message: `${what} holds a character that cannot be stored` });

const name = z.string().regex(PARAMETER_NAME, {
  message: 'A name is a lower-case letter, then up to 62 lower-case letters, digits or underscores',
});

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

/** A name as PostgreSQL holds one: 1 to 63 bytes, no control character, nothing unstorable. */
const sourceName = (what: string) =>
  storable(what)
    .refine((value) => utf8Bytes(value) >= 1 && utf8Bytes(value) <= 63, {
      message: `${what} is 1 to 63 bytes of UTF-8`,
    })
    .refine((value) => !CONTROL.test(value), { message: `${what} holds no control character` });

// A permitted value's text is counted in characters, as a parameter's value is (D2-R), never left to
// how the schema library happens to count a string's length.
const canonicalValue = z.union([
  storable('A value')
    // Published as JSON Schema's maxLength, which counts characters too.
    .max(MAX_TEXT_VALUE)
    .refine((value) => characters(value) <= MAX_TEXT_VALUE, {
      message: 'A value is at most 1,000 characters',
    }),
  z.boolean(),
  z.null(),
]);

const permitted = z.union([
  z.strictObject({ values: z.array(canonicalValue) }),
  z.strictObject({ minimum: canonicalValue.optional(), maximum: canonicalValue.optional() }),
]);

const variation = z
  .array(
    z.strictObject({
      key: name,
      sql: storable('A fragment').refine(
        (value) => characters(value) >= 1 && characters(value) <= 2000,
        { message: 'A fragment is 1 to 2,000 characters' },
      ),
    }),
  )
  .min(1)
  .max(50);

/** A parameter's declaration (DAT-010; the D2 plan's stored-shape check, rows 5 to 7). */
export const parameterSchema = z.strictObject({
  name,
  type: valueTypeSchema,
  required: z.boolean(),
  list: z.boolean(),
  permitted: permitted.optional(),
  variation: variation.optional(),
});

const columnSchema = z.strictObject({
  name: sourceName('A column name'),
  // A source's column by name; a pointer, a header and a letter arrive with D6's sources.
  from: z.strictObject({ column: sourceName('A source column') }),
  // Any type but image, which arrives with D8.
  type: valueTypeSchema,
});

const fetchSchema = z.strictObject({
  // SQL alone in D2; the builder's tree arrives with D4 as an arm, which refuses nothing stored.
  kind: z.literal('sql'),
  text: storable('SQL').refine((value) => characters(value) >= 1 && characters(value) <= 100_000, {
    message: 'SQL is 1 to 100,000 characters',
  }),
});

const limit = (ceiling: number) => z.number().int().min(1).max(ceiling);

const members = {
  schemaVersion: z.literal(QUERY_DEFINITION_SCHEMA_VERSION),
  connection: z.uuid(),
  parameters: z.array(parameterSchema).max(50),
  fetch: fetchSchema,
  columns: z.array(columnSchema).min(1).max(MAX_COLUMNS),
  key: z.array(z.string()).max(32),
  order: z.union([
    z.literal('multiset'),
    z
      .array(
        z.strictObject({
          column: z.string(),
          direction: z.enum(['ascending', 'descending']),
        }),
      )
      .min(1)
      .max(32),
  ]),
  empty: z.enum(['valid', 'invalid']),
  limits: z.strictObject({
    rows: limit(limitCeilings.rows),
    bytes: limit(limitCeilings.bytes),
    seconds: limit(limitCeilings.seconds),
  }),
};

/** A query definition version's shape: what a stored version is read back by. */
export const queryDefinitionSchema = z.strictObject({
  ...members,
  title,
  description,
  retired: z.boolean(),
});

/**
 * What a sample runs (D2-I): a definition as it is being written, its columns declared, but not yet
 * titled, described or saved - the whole shape but those three.
 */
export const draftDefinitionSchema = z.strictObject(members);

export type QueryDefinition = z.infer<typeof queryDefinitionSchema>;
export type DraftDefinition = z.infer<typeof draftDefinitionSchema>;
export type Parameter = z.infer<typeof parameterSchema>;
export type Column = z.infer<typeof columnSchema>;
export type { CanonicalValue, ValueType };

export interface DefinitionProblem {
  readonly rule: 'definition_invalid';
  readonly path: string;
  readonly message: string;
}

/** A definition refused, with every problem found. */
export class DefinitionRefused extends Error {
  constructor(readonly problems: readonly DefinitionProblem[]) {
    super(
      `The query definition is refused: ${problems.map((each) => each.path || '(the whole)').join(', ')}`,
    );
  }
}

function shaped<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new DefinitionRefused(
    parsed.error.issues.map((issue) => ({
      rule: 'definition_invalid',
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

/** The shape alone: what a stored version is read back by. Throws `DefinitionRefused`. */
export function parseQueryDefinition(value: unknown): QueryDefinition {
  return shaped(queryDefinitionSchema, value);
}

/** The bases a range may be declared for: numbers and the four times. */
const RANGED = new Set<ValueType['base']>([
  'integer',
  'decimal',
  'date',
  'time',
  'localDateTime',
  'instant',
]);

/** Every string a value holds, with its path. */
function* strings(value: unknown, path: string[] = []): Generator<[string, string]> {
  if (typeof value === 'string') yield [path.join('.'), value];
  else if (Array.isArray(value)) {
    for (const [at, member] of value.entries()) yield* strings(member, [...path, String(at)]);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, member] of Object.entries(value)) yield* strings(member, [...path, key]);
  }
}

/**
 * The rules beyond the shape (the D2 plan's stored-shape check, rows 5 to 13, and D2-F): names once
 * each; permitted values and ranges canonical in their parameter's type; a variation only on a
 * required text parameter that is neither a list nor permitted, its keys once each and its fragments
 * lexing whole with no marker; the SQL lexing whole with every marker outside a quote or a comment,
 * naming a declared parameter of its kind, and every parameter used; the key and the order over
 * declared columns, an order total over a key that is not empty; and every string already NFC.
 */
export function checkQueryDefinition(
  definition: DraftDefinition & { readonly title?: string; readonly description?: string },
): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];
  const problem = (path: string, message: string) =>
    problems.push({ rule: 'definition_invalid', path, message });

  // Every definition that passes can be run: it fits a run's request, and what it binds to can be
  // reported as what ran.
  const size = utf8Bytes(canonicalJson(definition));
  if (size > DEFINITION_MAX_BYTES) {
    problem(
      '',
      `A definition is at most 512 KiB (${grouped(DEFINITION_MAX_BYTES)} bytes); this one is ${grouped(size)}`,
    );
  }
  const longest = longestBinding(definition);
  if (longest !== undefined && longest > RAN_MAX_CHARACTERS) {
    problem(
      'fetch.text',
      `The SQL binds to at most ${grouped(RAN_MAX_CHARACTERS)} characters with its longest fragments; this binds to ${grouped(longest)}`,
    );
  }

  // Every string, already composed: a digest canonicalises to NFC, and would not tell two spellings of
  // one SQL text apart, where the source does (D2-F).
  for (const [path, text] of strings(definition)) {
    if (text.normalize('NFC') !== text) {
      problem(
        path,
        'Text is written composed (NFC); a decomposed literal is written with U& escapes',
      );
    }
  }

  const byName = new Map<string, Parameter>();
  for (const [at, parameter] of definition.parameters.entries()) {
    const path = `parameters.${at}`;
    if (byName.has(parameter.name)) problem(`${path}.name`, 'A parameter is declared once');
    else byName.set(parameter.name, parameter);
    checkPermitted(parameter, path, problem);
    if (parameter.variation !== undefined) {
      const { type, required, list } = parameter;
      if (type.base !== 'text' || !required || list || parameter.permitted !== undefined) {
        problem(
          `${path}.variation`,
          'A variation is declared on a required text parameter that is not a list and has no permitted values',
        );
      }
      const keys = new Set<string>();
      for (const [index, each] of parameter.variation.entries()) {
        if (keys.has(each.key)) problem(`${path}.variation.${index}.key`, 'A key is declared once');
        keys.add(each.key);
        const lexed = lexPostgres(each.sql);
        if (!Array.isArray(lexed)) {
          problem(`${path}.variation.${index}.sql`, `${lexed.problem} (line ${lexed.line})`);
        } else if (lexed.some((piece) => piece.kind !== 'text')) {
          problem(`${path}.variation.${index}.sql`, 'A fragment holds no marker');
        }
      }
    }
  }

  const lexed = lexPostgres(definition.fetch.text);
  if (!Array.isArray(lexed)) {
    problem('fetch.text', `${lexed.problem} (line ${lexed.line})`);
  } else {
    const used = new Set<string>();
    for (const piece of lexed) {
      if (piece.kind === 'text') continue;
      const parameter = byName.get(piece.name);
      const marker = piece.kind === 'value' ? `{{${piece.name}}}` : `{{#${piece.name}}}`;
      if (!parameter) problem('fetch.text', `The marker ${marker} names no declared parameter`);
      else if ((piece.kind === 'variation') !== (parameter.variation !== undefined)) {
        problem(
          'fetch.text',
          piece.kind === 'variation'
            ? `The marker ${marker} names a parameter that declares no variation`
            : `The marker ${marker} names a variation, which is placed with {{#${piece.name}}}`,
        );
      } else used.add(piece.name);
    }
    for (const [at, parameter] of definition.parameters.entries()) {
      if (!used.has(parameter.name) && byName.get(parameter.name) === parameter) {
        problem(`parameters.${at}`, `No marker uses the parameter ${parameter.name}`);
      }
    }
  }

  const columns = new Set<string>();
  for (const [at, column] of definition.columns.entries()) {
    if (columns.has(column.name)) problem(`columns.${at}.name`, 'A column is declared once');
    columns.add(column.name);
  }
  const key = new Set<string>();
  for (const [at, name] of definition.key.entries()) {
    if (!columns.has(name)) problem(`key.${at}`, `The key names ${name}, which is not a column`);
    else if (key.has(name)) problem(`key.${at}`, 'A key column is named once');
    key.add(name);
  }
  if (definition.order !== 'multiset') {
    const ordered = new Set<string>();
    for (const [at, each] of definition.order.entries()) {
      if (!columns.has(each.column)) {
        problem(`order.${at}.column`, `The order names ${each.column}, which is not a column`);
      } else if (ordered.has(each.column)) {
        problem(`order.${at}.column`, 'A column is ordered by once');
      }
      ordered.add(each.column);
    }
    if (definition.key.length === 0) {
      problem(
        'order',
        'An order is total only over a key: declare one, or check the rows as a multiset',
      );
    } else if (definition.key.some((name) => !ordered.has(name))) {
      problem('order', 'An order includes every key column, so that it is total');
    }
  }
  return problems;
}

function checkPermitted(
  parameter: Parameter,
  path: string,
  problem: (path: string, message: string) => void,
): void {
  const { permitted, type } = parameter;
  if (permitted === undefined) return;
  const canonical = (value: CanonicalValue) => value !== null && valueProblem(type, value) === null;
  if ('values' in permitted) {
    const { values } = permitted;
    if (values.length < 1 || values.length > 200) {
      problem(`${path}.permitted.values`, 'Permitted values are 1 to 200');
    }
    for (const [at, value] of values.entries()) {
      if (!canonical(value)) {
        problem(
          `${path}.permitted.values.${at}`,
          "A permitted value is written in its type's canonical form",
        );
      }
    }
    if (new Set(values.map((value) => JSON.stringify(value))).size !== values.length) {
      problem(`${path}.permitted.values`, 'A permitted value is named once');
    }
    return;
  }
  const { minimum, maximum } = permitted;
  if (!RANGED.has(type.base)) {
    problem(`${path}.permitted`, 'A range is declared for a number, a date or a time');
    return;
  }
  if (minimum === undefined && maximum === undefined) {
    problem(`${path}.permitted`, 'A range has a minimum, a maximum or both');
    return;
  }
  let bounded = true;
  for (const [end, value] of [
    ['minimum', minimum],
    ['maximum', maximum],
  ] as const) {
    if (value !== undefined && !canonical(value)) {
      problem(`${path}.permitted.${end}`, `A ${end} is written in its type's canonical form`);
      bounded = false;
    }
  }
  if (
    bounded &&
    minimum !== undefined &&
    maximum !== undefined &&
    compareCanonical(type, minimum, maximum) > 0
  ) {
    problem(`${path}.permitted`, 'A minimum is no more than its maximum');
  }
}

/** The shape, then the checks: what every write path parses a version by. Throws `DefinitionRefused`. */
export function parseQueryDefinitionForWrite(value: unknown): QueryDefinition {
  const definition = parseQueryDefinition(value);
  const problems = checkQueryDefinition(definition);
  if (problems.length > 0) throw new DefinitionRefused(problems);
  return definition;
}

/** A draft by its shape, then the same checks: what a sample takes. Throws `DefinitionRefused`. */
export function parseDraftDefinition(value: unknown): DraftDefinition {
  const draft = shaped(draftDefinitionSchema, value);
  const problems = checkQueryDefinition(draft);
  if (problems.length > 0) throw new DefinitionRefused(problems);
  return draft;
}
