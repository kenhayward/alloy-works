import { z } from 'zod';

import { builderFetchSchema, checkBuilder, type BuilderFetch } from './builder.js';
import { valueProblem, compareCanonical, type CanonicalValue } from './canonical.js';
import { columnTypeSchema, valueTypeSchema, type ValueType } from './columns.js';
import { generatedLength } from './generate.js';
import type { ConnectionSettings } from './connection.js';
import { checkHttpTemplate, httpTemplateSchema } from './http-template.js';
import { jsonPointerSchema } from './json-text.js';
import { limitCeilings } from './limits.js';
import { MAX_COLUMNS } from './columns.js';
import {
  canonicalValueSchema,
  characters,
  CONTROL,
  grouped,
  PARAMETER_NAME,
  parameterName,
  sourceName,
  storable,
  utf8Bytes,
} from './primitives.js';
import { canonicalJson } from '../stored/canonical.js';
import {
  BindingRefused,
  bindPostgres,
  fragmentProblem,
  lexPostgres,
  longestBinding,
  RAN_MAX_CHARACTERS,
  type SqlDefinition,
} from './sql.js';

export { canonicalValueSchema, PARAMETER_NAME };

/**
 * A query definition version (data.md, "What a query definition version holds"; the D2 plan, task 1):
 * SQL with named markers, the parameters it declares, the columns the author confirmed, a key, an
 * order, whether empty is valid, the limits, and whether it is retired. Its shape is what a stored
 * version is read back by; the checks beyond it are what every write path adds.
 */
export const QUERY_DEFINITION_SCHEMA_VERSION = 1;

/** Any control character but a line feed. */
const CONTROL_BUT_LINE_FEED = /(?!\n)\p{Cc}/u;

/**
 * The most a definition may be, in bytes of its canonical JSON's UTF-8: so that one always fits a run's
 * request (`RUN_REQUEST_MAX_BYTES`) with room to spare. The values it is run with are not bounded
 * here: a sample's are held by the service's own body limit, 1 MiB, which the request's limit covers
 * with the connection and its credential beside them.
 */
export const DEFINITION_MAX_BYTES = 512 * 1024;

const name = parameterName;

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

const permitted = z.union([
  z.strictObject({ values: z.array(canonicalValueSchema) }),
  z.strictObject({
    minimum: canonicalValueSchema.optional(),
    maximum: canonicalValueSchema.optional(),
  }),
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

/** A declared column (D2): a dataset version's provenance names its columns by the same shape. */
export const columnSchema = z.strictObject({
  name: sourceName('A column name'),
  // A database's column by name, or a JSON value by a pointer relative to its row (the D6 plan,
  // D6-F); a header and a letter arrive with D6.2's files.
  from: z.union([
    z.strictObject({ column: sourceName('A source column') }),
    z.strictObject({
      pointer: jsonPointerSchema.refine((value) => value !== '', {
        message: 'A column reads a member of its row: its pointer is not empty',
      }),
    }),
  ]),
  // Any of the nine; an image's description is checked against the columns (`checkQueryDefinition`).
  type: columnTypeSchema,
});

/** SQL with its markers, as the SQL fallback writes it (D2-B). */
export const sqlTextSchema = storable('SQL').refine(
  (value) => characters(value) >= 1 && characters(value) <= 100_000,
  { message: 'SQL is 1 to 100,000 characters' },
);

/**
 * An HTTP fetch (DAT-104; the D6 plan, D6-E and D6-F): a request template and the format its rows are
 * read in - JSON at a pointer to an array of objects, with a pointer to a row count it states where
 * it states one (DAT-108), or JSON Lines.
 */
export const httpFetchSchema = z.strictObject({
  kind: z.literal('http'),
  request: httpTemplateSchema,
  format: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('json'),
      rows: jsonPointerSchema,
      count: jsonPointerSchema.optional(),
    }),
    z.strictObject({ kind: z.literal('jsonLines') }),
  ]),
});
export type HttpFetch = z.infer<typeof httpFetchSchema>;

// SQL as D2 wrote it, the builder's tree (D4-A), or an HTTP request (D6-E): each arm added refuses
// nothing stored.
const fetchSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sql'), text: sqlTextSchema }),
  builderFetchSchema,
  httpFetchSchema,
]);

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
 * The rules beyond the shape (the D2 plan's stored-shape check, rows 5 to 13, and D2-F; the D4 plan's,
 * rows 2 to 12): names once each; permitted values and ranges canonical in their parameter's type;
 * the key and the order over declared columns, an order total over a key that is not empty; every
 * string already NFC; and the definition at most 512 KiB. Then by the fetch's kind: for SQL, a
 * variation only on a required text parameter that is neither a list nor permitted, its keys once
 * each and its fragments sound, and the SQL lexing whole with every marker outside a quote or a
 * comment, naming a declared parameter of its kind, every parameter used and the longest binding
 * within the bound; for a built query, the builder's rules (`checkBuilder`) and both statements it
 * generates read back whole and within the bound.
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
  const { fetch } = definition;
  if (fetch.kind === 'sql') {
    const longest = longestBinding({ parameters: definition.parameters, fetch });
    if (longest !== undefined && longest > RAN_MAX_CHARACTERS) {
      problem(
        'fetch.text',
        `The SQL binds to at most ${grouped(RAN_MAX_CHARACTERS)} characters with its longest fragments; this binds to ${grouped(longest)}`,
      );
    }
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
    if (parameter.variation !== undefined && fetch.kind === 'sql') {
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
        const unsound = fragmentProblem(each.sql);
        if (unsound !== undefined) problem(`${path}.variation.${index}.sql`, unsound);
      }
    }
  }

  if (fetch.kind === 'sql') {
    const lexed = lexPostgres(fetch.text);
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
      if (problems.length === 0) {
        checkBindings({ parameters: definition.parameters, fetch }, problem);
      }
    }
  } else if (fetch.kind === 'builder') {
    // A built query: the builder's rules, then both statements it generates, once the tree is sound.
    const before = problems.length;
    checkBuilder({ ...definition, fetch }, problem);
    if (problems.length === before) checkGenerated({ ...definition, fetch }, problem);
  } else {
    // An HTTP request: its template's rules against the parameters (D6-E).
    checkHttpTemplate(fetch.request, definition.parameters, problem);
  }

  // A column is read as its fetch reads: a database's by its name, JSON's by a pointer (D6-F).
  const byPointer = fetch.kind === 'http';
  for (const [at, column] of definition.columns.entries()) {
    if ('pointer' in column.from !== byPointer) {
      problem(
        `columns.${at}.from`,
        byPointer
          ? 'A column of an HTTP response is read by a pointer into its row'
          : "A column of a query is read by the query's column name",
      );
    }
  }

  const columns = new Set<string>();
  for (const [at, column] of definition.columns.entries()) {
    if (columns.has(column.name)) problem(`columns.${at}.name`, 'A column is declared once');
    columns.add(column.name);
  }
  // An image takes its description from a declared text column, or is decorative (D8-A, DAT-097).
  for (const [at, column] of definition.columns.entries()) {
    const { type } = column;
    if (type.base !== 'image' || type.description === 'decorative') continue;
    const named = type.description.column;
    if (!definition.columns.some((each) => each.name === named && each.type.base === 'text')) {
      problem(
        `columns.${at}.type.description`,
        `An image's description is a declared text column, and ${named} is not one`,
      );
    }
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

/**
 * Both statements a built query generates, read back whole and within the bound a run reports as
 * what ran (the D4 plan, D4-L, row 12): a tree has no variation, so each is generated exactly.
 */
function checkGenerated(
  definition: Pick<DraftDefinition, 'parameters' | 'columns' | 'order'> & {
    readonly fetch: BuilderFetch;
  },
  problem: (path: string, message: string) => void,
): void {
  let lengths: { shape: number; run: number };
  try {
    lengths = generatedLength(definition);
  } catch (error) {
    if (!(error instanceof BindingRefused)) throw error;
    problem('fetch.query', 'The query does not generate SQL that holds its placeholders');
    return;
  }
  const longest = Math.max(lengths.shape, lengths.run);
  if (longest > RAN_MAX_CHARACTERS) {
    problem(
      'fetch.query',
      `The query generates at most ${grouped(RAN_MAX_CHARACTERS)} characters of SQL; this one generates ${grouped(longest)}`,
    );
  }
}

/**
 * Binds the SQL once, each variation at its first key, and reads it back as the binder does: a check
 * that the binding holds its placeholders. Every fragment is set apart where it is placed and sound on
 * its own (`fragmentProblem`), so the other keys bind as this one does; this costs one binding, in
 * time linear in the definition's size.
 */
function checkBindings(
  definition: SqlDefinition,
  problem: (path: string, message: string) => void,
): void {
  const firsts = Object.fromEntries(
    definition.parameters.map((parameter) => [
      parameter.name,
      parameter.variation?.[0]?.key ?? null,
    ]),
  );
  try {
    bindPostgres(definition, firsts);
  } catch (error) {
    if (!(error instanceof BindingRefused)) throw error;
    problem('fetch.text', 'The SQL does not hold its placeholders where they are written');
  }
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

/**
 * Whether a fetch suits the connection it runs on (the D6 plan's stored-shape check): a query on a
 * database, an HTTP request on an HTTP connection, whose template names no header the connection
 * sends its secret in. Checked on save, on a sample's draft and at each run, against the connection
 * version it runs on.
 */
export function connectionFetchProblems(
  fetch: DraftDefinition['fetch'],
  settings: Pick<ConnectionSettings, 'type' | 'source'>,
): DefinitionProblem[] {
  const problem = (path: string, message: string): DefinitionProblem[] => [
    { rule: 'definition_invalid', path, message },
  ];
  if (fetch.kind === 'http') {
    if (settings.type !== 'http') {
      return problem('fetch', 'An HTTP request is sent on an HTTP connection');
    }
    const secret = (settings.source as { readonly secretHeader: string }).secretHeader;
    const at = fetch.request.headers.findIndex((header) => header.name === secret);
    return at < 0
      ? []
      : problem(
          `fetch.request.headers.${at}.name`,
          'The connection sends its secret in this header, so the template may not name it',
        );
  }
  return settings.type === 'postgres'
    ? []
    : problem('fetch', 'A query, written or built, runs on a database connection');
}
