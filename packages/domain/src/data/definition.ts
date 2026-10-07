import { z } from 'zod';

import { builderFetchSchema, checkBuilder, type BuilderFetch } from './builder.js';
import { valueProblem, compareCanonical, type CanonicalValue } from './canonical.js';
import { columnTypeSchema, valueTypeSchema, type ValueType } from './columns.js';
import { generatedLength } from './generate.js';
import type { ConnectionSettings } from './connection.js';
import { checkFileCondition, fileConditionSchema } from './file-filter.js';
import { checkHttpTemplate, httpTemplateSchema } from './http-template.js';
import { jsonPointerSchema } from './json-text.js';
import { limitCeilings } from './limits.js';
import { MAX_COLUMNS } from './columns.js';
import { checkObjectKey, objectKeySchema } from './s3.js';
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

/** A CSV header a column is read by: 1 to 200 characters, no control character. */
const headerName = storable('A header').refine(
  (value) => characters(value) >= 1 && characters(value) <= 200 && !CONTROL.test(value),
  { message: 'A header is 1 to 200 characters, no control character' },
);

/**
 * A sheet's name as a workbook holds one: 1 to 31 characters, no control character and none of the
 * six a workbook refuses in a sheet's name.
 */
const sheetName = storable('A sheet').refine(
  (value) =>
    characters(value) >= 1 &&
    characters(value) <= 31 &&
    !CONTROL.test(value) &&
    !/[:\\/?*[\]]/.test(value),
  { message: 'A sheet is named in 1 to 31 characters, none of them : \\ / ? * [ or ]' },
);

/** A field's index from its letter, as a spreadsheet names a column: A is 0, Z 25, AA 26. */
export function letterIndex(letter: string): number {
  let index = 0;
  for (const character of letter) index = index * 26 + (character.charCodeAt(0) - 64);
  return index - 1;
}

/** A field's letter from its index: the inverse of `letterIndex`. */
export function indexLetter(index: number): string {
  let letter = '';
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letter = String.fromCharCode(65 + ((rest - 1) % 26)) + letter;
  }
  return letter;
}

/** A declared column (D2): a dataset version's provenance names its columns by the same shape. */
export const columnSchema = z.strictObject({
  name: sourceName('A column name'),
  // A database's column by name, a JSON value by a pointer relative to its row, or a CSV field by
  // its header or its letter (the D6 plan, D6-F).
  from: z.union([
    z.strictObject({ column: sourceName('A source column') }),
    z.strictObject({
      pointer: jsonPointerSchema.refine((value) => value !== '', {
        message: 'A column reads a member of its row: its pointer is not empty',
      }),
    }),
    z.strictObject({ header: headerName }),
    z.strictObject({
      letter: z.string().regex(/^[A-Z]{1,3}$/, {
        message: 'A letter names a field as a spreadsheet does: A to ZZZ',
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
 * The formats a response or an object is read in, whatever carried it (the D6 plan, D6-F): JSON at a
 * pointer to an array of objects, with a pointer to a row count it states where it states one
 * (DAT-108); JSON Lines; or CSV, its delimiter named, whether its first record is a header, and its
 * convention for null - an unquoted empty field, or never (D6-H); or XLSX, the one sheet read by its
 * name and whether its first row is a header (D6-I).
 */
export const dataFormatSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('json'),
    rows: jsonPointerSchema,
    count: jsonPointerSchema.optional(),
  }),
  z.strictObject({ kind: z.literal('jsonLines') }),
  z.strictObject({
    kind: z.literal('csv'),
    delimiter: z.enum(['comma', 'semicolon', 'tab', 'pipe']),
    headerRow: z.boolean(),
    null: z.enum(['empty', 'never']),
  }),
  z.strictObject({ kind: z.literal('xlsx'), sheet: sheetName, headerRow: z.boolean() }),
]);
export type DataFormat = z.infer<typeof dataFormatSchema>;

/**
 * An HTTP fetch (DAT-104; the D6 plan, D6-E and D6-F): a request template and the format its rows are
 * read in.
 */
export const httpFetchSchema = z.strictObject({
  kind: z.literal('http'),
  request: httpTemplateSchema,
  format: dataFormatSchema,
});
export type HttpFetch = z.infer<typeof httpFetchSchema>;

/**
 * A file fetch (data.md, "The fetch"; the D6 plan, task 2 and D6-J): one S3 object by a key whose
 * segments may be parameters, the format it is read in, and a typed filter over its canonical rows.
 */
export const fileFetchSchema = z.strictObject({
  kind: z.literal('file'),
  key: objectKeySchema,
  format: dataFormatSchema,
  where: fileConditionSchema.optional(),
});
export type FileFetch = z.infer<typeof fileFetchSchema>;

// SQL as D2 wrote it, the builder's tree (D4-A), an HTTP request (D6-E) or a file (D6.2): each arm
// added refuses nothing stored.
const fetchSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sql'), text: sqlTextSchema }),
  builderFetchSchema,
  httpFetchSchema,
  fileFetchSchema,
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
  } else if (fetch.kind === 'http') {
    // An HTTP request: its template's rules against the parameters (D6-E).
    checkHttpTemplate(fetch.request, definition.parameters, problem);
  } else {
    // A file: its key's rules, its filter's over the declared columns, and every parameter placed
    // in one or the other (D6-J).
    const used = checkObjectKey(fetch.key, definition.parameters, problem);
    if (fetch.where !== undefined) {
      const filtered = checkFileCondition(
        fetch.where,
        definition.columns,
        definition.parameters,
        problem,
      );
      for (const name of filtered) used.add(name);
    }
    for (const [at, parameter] of definition.parameters.entries()) {
      if (!used.has(parameter.name)) {
        problem(`parameters.${at}`, `Neither the key nor the filter uses ${parameter.name}`);
      }
      if (parameter.variation !== undefined) {
        problem(`parameters.${at}.variation`, 'A variation chooses SQL; a file filters its rows');
      }
    }
  }

  // A column is read as its fetch reads (D6-F): a database's by its name, JSON's by a pointer, a
  // CSV field by its letter or, where the first record names them, its header.
  for (const [at, column] of definition.columns.entries()) {
    const wrong = fromProblem(fetch, column.from);
    if (wrong !== undefined) problem(`columns.${at}.from`, wrong);
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

/** Why a column cannot be read from where it says by its fetch, or undefined where it can. */
function fromProblem(fetch: DraftDefinition['fetch'], from: Column['from']): string | undefined {
  if (fetch.kind === 'sql' || fetch.kind === 'builder') {
    return 'column' in from ? undefined : "A column of a query is read by the query's column name";
  }
  if (fetch.format.kind !== 'csv' && fetch.format.kind !== 'xlsx') {
    return 'pointer' in from ? undefined : 'A column of JSON is read by a pointer into its row';
  }
  const sheet = fetch.format.kind === 'xlsx';
  if ('letter' in from) return undefined;
  if ('header' in from) {
    if (fetch.format.headerRow) return undefined;
    return sheet
      ? 'A sheet whose first row is not a header names its columns by letter'
      : 'A CSV whose first record is not a header names its fields by letter';
  }
  return sheet
    ? 'A column of a sheet is read by its header or its letter'
    : 'A column of a CSV is read by its header or its letter';
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

/**
 * A parameter's permitted values or range, against its type (DAT-010): what a query definition and a
 * template (the TP1 plan, TP1-A) both declare, checked by the one rule.
 */
export function checkPermitted(
  parameter: Pick<Parameter, 'permitted' | 'type'>,
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

/**
 * A fetch alone as a draft, as a sample sends one before its columns are declared (DAT-105): one
 * placeholder column read as the fetch's format reads, so the fetch's own rules are checked as a
 * definition's would be. A file's sample reads the object before its filter, which names columns.
 */
export function sampleDraft(
  parameters: readonly Parameter[],
  fetch: HttpFetch | Omit<FileFetch, 'where'>,
): DraftDefinition {
  const from =
    fetch.format.kind === 'csv' || fetch.format.kind === 'xlsx'
      ? { letter: 'A' }
      : { pointer: '/proposed' };
  return {
    schemaVersion: QUERY_DEFINITION_SCHEMA_VERSION,
    connection: '00000000-0000-4000-8000-000000000000',
    parameters: [...parameters],
    fetch: fetch.kind === 'file' ? { kind: 'file', key: fetch.key, format: fetch.format } : fetch,
    columns: [{ name: 'proposed', from, type: { base: 'text' } }],
    key: [],
    order: 'multiset',
    empty: 'valid',
    limits: { rows: 1, bytes: 1, seconds: 1 },
  };
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
 * sends its secret in, and a file on an S3 connection. Checked on save, on a sample's draft and at each run, against the connection
 * version it runs on.
 */
export function connectionFetchProblems(
  fetch: DraftDefinition['fetch'],
  settings: Pick<ConnectionSettings, 'type' | 'source'>,
): DefinitionProblem[] {
  const problem = (path: string, message: string): DefinitionProblem[] => [
    { rule: 'definition_invalid', path, message },
  ];
  if (fetch.kind === 'file') {
    return settings.type === 's3' ? [] : problem('fetch', 'A file is read on an S3 connection');
  }
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
