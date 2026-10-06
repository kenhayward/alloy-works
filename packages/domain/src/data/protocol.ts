import { z } from 'zod';

import { storableText } from '../stored/storable.js';
import { MAX_COLUMNS, proposedTypeSchema } from './columns.js';
import { connectionSettingsSchema } from './connection.js';
import { builderQuerySchema, checkTree, type Query } from './builder.js';
import {
  checkQueryDefinition,
  connectionFetchProblems,
  dataFormatSchema,
  draftDefinitionSchema,
  httpFetchSchema,
  sampleDraft,
  parameterSchema,
  sqlTextSchema,
  type Parameter,
} from './definition.js';
import { headerValueProblem, httpTemplateSchema } from './http-template.js';
import { keyPairText, objectKeySchema, parseKeyPair } from './s3.js';
import { generatePostgres } from './generate.js';
import { dataFailureSchema } from './failures.js';
import { limitCeilings } from './limits.js';
import { checkParameterValues, type ParameterValues } from './parameters.js';
import { lexPostgres, RAN_MAX_CHARACTERS } from './sql.js';

/**
 * The connector's requests and answers (data.md, "One request, one answer"; the D1 plan, D1-E), parsed
 * on both sides of the interface: by the connector when a request arrives, and by the service when an
 * answer does. Nothing crosses it that these do not admit.
 */

/** The sealing scheme's shape, as migration 0042 holds a sealed sign-in secret to it. */
export const SEALED = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;

/**
 * The most an answer of the connector's may be, in bytes: a child's answer is cut off past it by the
 * supervisor, and the service stops reading one past it. A run's answer at the byte ceiling, its images
 * as base64 (D8-C), comes to about 34 MiB, so the cap is 40. A describe can reach it - 2,000 relations
 * of wide tables with long names come to tens of megabytes - so the child stops listing relations before
 * its answer passes `DESCRIBE_BUDGET_BYTES`, and says `truncated`.
 */
export const CONNECTOR_ANSWER_MAX_BYTES = 40 * 1024 * 1024;

/**
 * The most a describe's answer may be, in UTF-8 bytes of its JSON, before the child stops adding
 * relations and says `truncated`: well under the cap, so an answer never meets it (the D1 fix, round
 * two).
 */
export const DESCRIBE_BUDGET_BYTES = 16 * 1024 * 1024;

/** A secret's longest, in UTF-8 bytes. */
export const SECRET_MAX_BYTES = 4096;

/** A sealed value's longest: 4,096 bytes of secret seal to 5,462 characters of body, and the rest. */
export const SEALED_MAX_BYTES = 5600;

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

/** A tenant's identifier, as the platform's `tenant` table holds it. */
const tenant = z.string().regex(/^[0-9a-z]{1,40}$/);

const secret = z
  .string()
  .refine((value) => utf8Bytes(value) >= 1 && utf8Bytes(value) <= SECRET_MAX_BYTES, {
    message: `A secret is 1 to ${SECRET_MAX_BYTES} bytes of UTF-8`,
  })
  .refine((value) => !value.includes('\u0000'), { message: 'A secret holds no U+0000' });

const sealed = z
  .string()
  .max(SEALED_MAX_BYTES)
  .regex(SEALED, { message: 'Not a sealed value this scheme wrote' });

/**
 * A secret to seal, the connection it is set on, and the connection settings whose target it is
 * sealed to (the D1 fix, C3 and round two): it opens only for a request naming that connection, whose
 * settings name the same type, host, port, database, account and TLS.
 */
export const sealRequestSchema = z
  .strictObject({
    tenant,
    connection: z.uuid(),
    secret,
    settings: connectionSettingsSchema,
  })
  // An HTTP secret is sent as a header's value, so it is one a header can carry (the D6 plan, D6-D).
  .refine(
    (request) =>
      request.settings.type !== 'http' || headerValueProblem(request.secret) === undefined,
    { message: 'A secret sent in a header is printable ASCII, with no space before or after it' },
  )
  // An S3 secret is its key pair, sealed together as JSON (the stored-shape check).
  .refine(
    (request) =>
      request.settings.type !== 's3' ||
      (parseKeyPair(request.secret) !== undefined &&
        keyPairText(parseKeyPair(request.secret)!) === request.secret),
    { message: "An S3 connection's secret is its key pair, as the service writes it" },
  );
export type SealRequest = z.infer<typeof sealRequestSchema>;

export const sealAnswerSchema = z.strictObject({ sealed });
export type SealAnswer = z.infer<typeof sealAnswerSchema>;

/**
 * A test or a describe. The settings are read by their shape alone: they are a stored version's,
 * already checked when it was written, and a declaration widened later must not refuse one.
 */
export const testRequestSchema = z.strictObject({
  requestId: z.uuid(),
  tenant,
  connection: z.strictObject({ id: z.uuid(), version: z.uuid() }),
  settings: connectionSettingsSchema,
  sealed,
  deadlineMs: z.number().int().min(1000).max(60_000),
});
export type TestRequest = z.infer<typeof testRequestSchema>;

/**
 * A person's role at the source (the D7 plan, D7-B): their declared attribute verbatim, a PostgreSQL
 * name of 1 to 63 bytes, no U+0000. Bound as a value where it is asserted (D7-A), never text.
 */
export const assertedRoleSchema = z
  .string()
  .refine((value) => utf8Bytes(value) >= 1 && utf8Bytes(value) <= 63, {
    message: 'A role is 1 to 63 bytes of UTF-8',
  })
  .refine((value) => !value.includes('\u0000'), { message: 'A role holds no U+0000' });

/**
 * Who a run, a sample or a describe runs as (the D7 plan, D7-G): the connection's account, or a
 * person's own role, asserted at the source. Left out, the account; a test is always the account's.
 */
export const runIdentitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('service') }),
  z.strictObject({ kind: z.literal('asserted'), role: assertedRoleSchema }),
]);
export type RunIdentity = z.infer<typeof runIdentitySchema>;

/** Whether a request is a person's, and its connection asserts identity: both, or neither (D7-G). */
function assertsAsDeclared(request: {
  readonly settings: { readonly identity: { readonly kind: string; readonly mechanism?: string } };
  readonly identity?: RunIdentity | undefined;
}): boolean {
  const { identity } = request.settings;
  const declared = identity.kind === 'endUser' && identity.mechanism === 'asserted';
  return declared === (request.identity?.kind === 'asserted');
}

const AS_DECLARED = {
  message: 'A request runs as a person exactly where its connection asserts identity',
};

/** A describe of the relations a connection lists: as the account, or as a person (D7-G). */
export const describeRequestSchema = testRequestSchema
  .extend({ identity: runIdentitySchema.optional() })
  .refine(assertsAsDeclared, AS_DECLARED);
export type DescribeRequest = z.infer<typeof describeRequestSchema>;

/**
 * What a test finds of an authenticated account (D1-M): it may write; and, on a connection that
 * asserts identity, it may read data of its own (DAT-112, the D7 plan's D7-D).
 */
export const testFindings = ['account_not_read_only', 'account_holds_privilege'] as const;
export type TestFinding = (typeof testFindings)[number];

export const testAnswerSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('ok'),
    findings: z
      .array(z.enum(testFindings))
      .refine((findings) => new Set(findings).size === findings.length, {
        message: 'A finding is reported once',
      }),
  }),
  z.strictObject({ outcome: z.literal('failed'), failure: dataFailureSchema }),
]);
export type TestAnswer = z.infer<typeof testAnswerSchema>;

/**
 * Text a source says of itself, bounded: 1 to `bytes` bytes of UTF-8, no control character, and
 * nothing Postgres could not store. What a hostile source answers is shown on a page and, from D2,
 * kept: it is held to what a real one can say rather than to whatever it sends.
 */
const sourceText = (bytes: number) =>
  z
    .string()
    .refine((value) => utf8Bytes(value) >= 1 && utf8Bytes(value) <= bytes, {
      message: `1 to ${bytes} bytes of UTF-8`,
    })
    .refine((value) => !/\p{Cc}/u.test(value) && storableText(value), {
      message: 'No control character, and nothing that cannot be stored',
    });

/** A PostgreSQL name: NAMEDATALEN less one, 63 bytes, the most the catalogue holds. */
export const sourceNameSchema = sourceText(63);
const sourceName = sourceNameSchema;

/**
 * The longest `format_type` text a describe lists. A type outside the search path is named with its
 * schema, and each of the two names is quoted: 63 bytes that are all double quotes quote to 128, so
 * the two and the dot between them come to 257, and an array's `[]` to 259, before any modifier. A
 * built-in type's modifier is at most a dozen bytes (`(1000,-1000)`); an extension's `typmodout` may
 * write more. 1,024 holds the longest name with room for such a modifier; a column whose type says
 * more is left out, and counted.
 */
export const SOURCE_TYPE_MAX_BYTES = 1024;
export const sourceTypeSchema = sourceText(SOURCE_TYPE_MAX_BYTES);

export { MAX_COLUMNS };
/** The most relations a describe lists, past which it says `truncated` (the connector's own cap). */
export const MAX_DESCRIBED_RELATIONS = 2000;

export const relationSchema = z.strictObject({
  schema: sourceName,
  name: sourceName,
  kind: z.enum(['table', 'view', 'materializedView', 'foreignTable', 'partitionedTable']),
  columns: z
    .array(
      z.strictObject({
        name: sourceName,
        // `format_type`'s text: a qualified, quoted name with its modifier and array bounds.
        sourceType: sourceTypeSchema,
        nullable: z.boolean(),
        proposed: proposedTypeSchema.nullable(),
      }),
    )
    .max(MAX_COLUMNS),
});
export type Relation = z.infer<typeof relationSchema>;

/** A count of what a describe left out. */
const leftOutCount = z.number().int().min(0).max(1_000_000_000);

export const describeAnswerSchema = z.union([
  z.strictObject({
    relations: z.array(relationSchema).max(MAX_DESCRIBED_RELATIONS),
    /** Whether the source has more than are listed: past 2,000 relations, or past the budget. */
    truncated: z.boolean(),
    /**
     * What was left out because a page cannot show it: a relation whose schema or name holds a
     * control character, or that has more columns than a relation can, and, of the relations listed,
     * a column whose name holds one or whose type is longer than `SOURCE_TYPE_MAX_BYTES`. Left out
     * rather than escaped: an escaped name is not the name, and nothing may be read by it.
     */
    leftOut: z.strictObject({ relations: leftOutCount, columns: leftOutCount }),
  }),
  z.strictObject({ failure: dataFailureSchema }),
]);
export type DescribeAnswer = z.infer<typeof describeAnswerSchema>;

/**
 * The most a run's or a describe's request may be, in bytes: the service's own body limit, 1 MiB, which
 * holds a definition - at most `DEFINITION_MAX_BYTES` - and the values sent to sample it, and room for
 * the connection and its sealed credential, so that nothing the service accepts is refused here.
 */
export const RUN_REQUEST_MAX_BYTES = 1024 * 1024 + 64 * 1024;

/** A parameter's value as it crosses the interface: canonical text, a boolean, null, or a list. */
const canonicalValue = z.union([z.string(), z.boolean(), z.null()]);
const parameterValuesSchema = z.record(
  z.string(),
  z.union([canonicalValue, z.array(canonicalValue)]),
);

const limit = (ceiling: number) => z.number().int().min(1).max(ceiling);
const limitsSchema = z.strictObject({
  rows: limit(limitCeilings.rows),
  bytes: limit(limitCeilings.bytes),
  seconds: limit(limitCeilings.seconds),
});

/**
 * A run (the D2 plan, D2-I and D2-Q): the connection, its sealed credential, the definition being run -
 * a draft or a version's, its columns declared - the parameter values, already checked by the service
 * against their declarations, the limits the run takes, and its deadline, at most the time ceiling.
 * The connector binds the values by its own type's binder, so what it ran is its own to report.
 */
export const runRequestSchema = testRequestSchema
  .extend({
    identity: runIdentitySchema.optional(),
    definition: draftDefinitionSchema,
    values: parameterValuesSchema,
    limits: limitsSchema,
    deadlineMs: z
      .number()
      .int()
      .min(1000)
      .max(limitCeilings.seconds * 1000),
  })
  .refine((request) => request.definition.connection === request.connection.id, {
    message: 'A run runs a definition of the connection it is sent for',
  })
  // A fetch of the connection's type, by the version it runs on (the D6 plan's stored-shape check).
  .refine(
    (request) => connectionFetchProblems(request.definition.fetch, request.settings).length === 0,
    { message: "A run's fetch suits its connection's type" },
  )
  .refine(assertsAsDeclared, AS_DECLARED)
  // Only text the product generated runs as a person (DAT-113, the D7 plan's D7-F).
  .refine(
    (request) =>
      request.identity?.kind !== 'asserted' || request.definition.fetch.kind === 'builder',
    { message: "A run as a person runs the builder's text alone" },
  )
  // The service checks both before it asks (DAT-020); the connector holds a request to them again at
  // its door, so nothing it binds was not checked.
  .refine((request) => checkQueryDefinition(request.definition).length === 0, {
    message: 'A run runs a definition that passes its checks',
  })
  .refine(
    (request) =>
      checkParameterValues(request.definition.parameters, request.values as ParameterValues)
        .length === 0,
    { message: 'A run binds values that pass their declarations' },
  );
export type RunRequest = z.infer<typeof runRequestSchema>;

/** A base as a canonical result names a column's type: the eight and image (ADR-0035, form 1). */
const columnBase = z.enum([
  'text',
  'integer',
  'decimal',
  'date',
  'time',
  'localDateTime',
  'instant',
  'boolean',
  'image',
]);

/** A result in canonical form (ADR-0035): its columns, and rows of strings, booleans and null. */
export const canonicalResultSchema = z
  .strictObject({
    columns: z
      .array(z.tuple([z.string(), columnBase]))
      .min(1)
      .max(MAX_COLUMNS),
    rows: z.array(z.array(canonicalValue)).max(limitCeilings.rows),
  })
  .refine((result) => result.rows.every((row) => row.length === result.columns.length), {
    message: 'Every row has a cell for each column',
  });

/** An S3 object as a run reports it read one: never a URL, an endpoint or a signature. */
export const ranObjectSchema = z.strictObject({
  bucket: z.string().min(3).max(63),
  key: z.string().min(1).max(1024).refine(storableText),
  versionId: z
    .string()
    .regex(/^[\x21-\x7e]{1,1024}$/)
    .optional(),
});
export type RanObject = z.infer<typeof ranObjectSchema>;

/**
 * What a run reports it ran (D2-K; the D6 plan, D6-L): a database's SQL, its values bound apart from
 * it, or an HTTP request's template, its values placed apart from it. Never a composed URL, which no
 * answer carries.
 */
export const ranSchema = z.union([
  z.strictObject({ sql: z.string().max(RAN_MAX_CHARACTERS) }),
  z.strictObject({ request: httpTemplateSchema }),
  // An object read: its bucket, its key bound, and its version where the store names one (D6-L).
  z.strictObject({ object: ranObjectSchema }),
]);
export type Ran = z.infer<typeof ranSchema>;

/**
 * Whether text is base64 as the connector writes it: the standard alphabet, padded to a multiple of
 * four, and nothing between. A character class and a length, so megabytes are read in one pass.
 */
export function isPaddedBase64(text: string): boolean {
  return text.length > 0 && text.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(text);
}

/**
 * Each distinct image a result holds, by its SHA-256, as base64 (D8-B). Whether the bytes are the
 * hash's is the service's to check, which holds `node:crypto`.
 */
const imagesSchema = z.record(
  z.string().regex(/^[0-9a-f]{64}$/),
  z.string().refine(isPaddedBase64, { message: 'An image is padded base64' }),
);

/** Whether a result's image cells are hashes, each carried, and every image carried is in a cell. */
function imagesHeld(answer: {
  readonly result: z.infer<typeof canonicalResultSchema>;
  readonly images?: Readonly<Record<string, string>> | undefined;
}): boolean {
  const carried = answer.images ?? {};
  const held = new Set<string>();
  for (const [at, [, base]] of answer.result.columns.entries()) {
    if (base !== 'image') continue;
    for (const row of answer.result.rows) {
      const cell = row[at];
      if (cell === null) continue;
      if (typeof cell !== 'string' || !/^[0-9a-f]{64}$/.test(cell) || !(cell in carried)) {
        return false;
      }
      held.add(cell);
    }
  }
  return Object.keys(carried).every((hash) => held.has(hash));
}

/**
 * A run's answer (D2-K): the canonical result as a JSON value, its SHA-256 checksum, which the service
 * checks against the bytes it serialises, the row count, the SQL that ran and how long it took, and each
 * image its cells name (D8-B) - or one named failure.
 */
export const runAnswerSchema = z.discriminatedUnion('outcome', [
  z
    .strictObject({
      outcome: z.literal('ok'),
      result: canonicalResultSchema,
      checksum: z.string().regex(/^[0-9a-f]{64}$/),
      rowCount: z.number().int().min(0),
      // The SQL that ran, or an HTTP request's template: never a URL (the D6 plan, D6-L).
      ran: ranSchema,
      durationMs: z.number().int().min(0),
      // Absent where a result holds no image, as every answer before D8.
      images: imagesSchema.optional(),
      // The identity as the source saw it, `current_user`, where the run was a person's (D7-A).
      asSeen: sourceName.optional(),
    })
    .refine((answer) => answer.rowCount === answer.result.rows.length, {
      message: 'The row count is the number of rows',
    })
    .refine(imagesHeld, {
      message:
        'Every image cell is a hash the answer carries, and every image carried is in a cell',
    }),
  z.strictObject({ outcome: z.literal('failed'), failure: dataFailureSchema }),
]);
export type RunAnswer = z.infer<typeof runAnswerSchema>;

/**
 * A statement described without being run (D2-G; Q1): SQL with its markers, or a built query's tree
 * (the D4 plan, D4-Q), and the parameters it declares, so the connector can bind it as a run would. A
 * built query is described by its shape statement (D4-H), and held to the builder's rules but those
 * that need its declared columns.
 */
const sqlDescribe = z
  .strictObject({
    text: sqlTextSchema,
    parameters: z.array(parameterSchema).max(50),
  })
  .refine(describable, {
    message: 'A statement lexes whole, each marker naming a declared parameter of its kind',
  });

const builderDescribe = z
  .strictObject({
    query: builderQuerySchema(),
    parameters: z.array(parameterSchema).max(50),
  })
  .refine((builder) => builtDescribable(builder.query, builder.parameters), {
    message: "A built query passes the builder's checks, each parameter declared once and used",
  });

const sqlDescribeRequest = testRequestSchema
  .extend({ identity: runIdentitySchema.optional(), sql: sqlDescribe })
  .refine(assertsAsDeclared, AS_DECLARED)
  // A person's identity describes generated text alone, as it runs it (DAT-113).
  .refine((request) => request.identity?.kind !== 'asserted', {
    message: "A describe as a person describes the builder's text alone",
  });
const builderDescribeRequest = testRequestSchema
  .extend({ identity: runIdentitySchema.optional(), builder: builderDescribe })
  .refine(assertsAsDeclared, AS_DECLARED);

/**
 * An HTTP request sampled for its columns (DAT-105; the D6 plan, D6-A): its template, its format, the
 * parameters it declares and the values to sample it with. A response is described by its rows, so it
 * is sent, and each member of the first rows proposed as a column by its pointer.
 */
const httpDescribe = z
  .strictObject({
    request: httpTemplateSchema,
    format: httpFetchSchema.shape.format,
    parameters: z.array(parameterSchema).max(50),
    values: parameterValuesSchema,
  })
  .refine(
    (http) =>
      checkQueryDefinition(
        sampleDraft(http.parameters, {
          kind: 'http',
          request: http.request,
          format: http.format,
        }),
      ).length === 0 &&
      checkParameterValues(http.parameters, http.values as ParameterValues).length === 0,
    { message: 'A request passes its checks, and its values their declarations' },
  );
const httpDescribeRequest = testRequestSchema
  .extend({ http: httpDescribe })
  .refine(
    (request) =>
      connectionFetchProblems(
        { kind: 'http', request: request.http.request, format: request.http.format },
        request.settings,
      ).length === 0,
    { message: "A request suits its connection's type" },
  );

/**
 * An S3 object sampled for its columns (DAT-105; the D6 plan, task 2): its key, its format, the
 * parameters the key names and their values. The object is read, and each column of its first rows
 * proposed by its pointer, its header or its letter; a file's filter waits for its columns.
 */
const fileDescribe = z
  .strictObject({
    key: objectKeySchema,
    format: dataFormatSchema,
    parameters: z.array(parameterSchema).max(50),
    values: parameterValuesSchema,
  })
  .refine(
    (file) =>
      checkQueryDefinition(
        sampleDraft(file.parameters, { kind: 'file', key: file.key, format: file.format }),
      ).length === 0 &&
      checkParameterValues(file.parameters, file.values as ParameterValues).length === 0,
    { message: 'A key passes its checks, and its values their declarations' },
  );
const fileDescribeRequest = testRequestSchema
  .extend({ file: fileDescribe })
  .refine(
    (request) =>
      connectionFetchProblems(
        { kind: 'file', key: request.file.key, format: request.file.format },
        request.settings,
      ).length === 0,
    { message: "A file suits its connection's type" },
  );

/**
 * A describe of SQL or of a built query, chosen by its key rather than by trying each: a union that
 * tried each would answer a refusal of either in its own words, "Invalid input", and never the
 * walk's or the builder's. A body holding `builder` and no `sql` is a built query's; any other is
 * SQL's, whose strict shape refuses a `builder` beside it.
 */
export const describeSqlRequestSchema = z.unknown().transform((value, context) => {
  const has = (key: string) => typeof value === 'object' && value !== null && key in value;
  const built = has('builder') && !has('sql');
  const http = has('http') && !has('sql') && !has('builder');
  const file = has('file') && !has('sql') && !has('builder') && !has('http');
  const parsed = (
    file
      ? fileDescribeRequest
      : http
        ? httpDescribeRequest
        : built
          ? builderDescribeRequest
          : sqlDescribeRequest
  ).safeParse(value);
  if (parsed.success) {
    return parsed.data as
      | z.infer<typeof sqlDescribeRequest>
      | z.infer<typeof builderDescribeRequest>
      | z.infer<typeof httpDescribeRequest>
      | z.infer<typeof fileDescribeRequest>;
  }
  for (const issue of parsed.error.issues) context.addIssue({ ...issue } as never);
  return z.NEVER;
});

/** Whether a built query passes the builder's checks of its tree, and its shape generates whole. */
function builtDescribable(query: Query, parameters: readonly Parameter[]) {
  if (new Set(parameters.map((parameter) => parameter.name)).size !== parameters.length) {
    return false;
  }
  let sound = true;
  checkTree(query, parameters, () => {
    sound = false;
  });
  if (!sound) return false;
  try {
    const shape = generatePostgres(
      {
        parameters: [...parameters],
        fetch: { kind: 'builder', format: 1, query },
        columns: [],
        order: 'multiset',
      },
      {},
      'shape',
    );
    return shape.text.length <= RAN_MAX_CHARACTERS;
  } catch {
    return false;
  }
}

/** Whether SQL lexes whole, each parameter declared once and each marker naming one of its kind. */
function describable(sql: { readonly text: string; readonly parameters: readonly Parameter[] }) {
  const pieces = lexPostgres(sql.text);
  if (!Array.isArray(pieces)) return false;
  const byName = new Map(sql.parameters.map((parameter) => [parameter.name, parameter]));
  if (byName.size !== sql.parameters.length) return false;
  return pieces.every((piece) => {
    if (piece.kind === 'text') return true;
    const parameter = byName.get(piece.name);
    return (
      parameter !== undefined &&
      (piece.kind === 'variation') === (parameter.variation !== undefined)
    );
  });
}
export type DescribeSqlRequest = z.infer<typeof describeSqlRequestSchema>;

/**
 * What a statement's result would be: each column's name, the source's type and its proposal, and each
 * parameter's type as the source reads it - or one named failure.
 */
export const describeSqlAnswerSchema = z.union([
  z.strictObject({
    columns: z
      .array(
        z.strictObject({
          name: sourceName,
          sourceType: sourceTypeSchema,
          proposed: proposedTypeSchema.nullable(),
          // Where a JSON response's column is read from its row (the D6 plan, D6-F).
          pointer: z.string().max(1024).optional(),
          // Where a CSV's column is read from its record: its header, or its letter (D6-F).
          header: z.string().max(1000).optional(),
          letter: z
            .string()
            .regex(/^[A-Z]{1,3}$/)
            .optional(),
        }),
      )
      .max(MAX_COLUMNS),
    parameters: z.array(sourceTypeSchema).max(50),
  }),
  z.strictObject({ failure: dataFailureSchema }),
]);
export type DescribeSqlAnswer = z.infer<typeof describeSqlAnswerSchema>;

const childMembers = {
  secret,
  // The certificate authorities a development or CI source is signed by, as PEM, beside the
  // system's; production names none (the D6 plan, task 1).
  ca: z
    .string()
    .max(256 * 1024)
    .optional(),
  deny: z.array(z.string()),
  connectTimeoutMs: z.number().int().min(1).max(60_000),
  failureFloorMs: z.number().int().min(0).max(60_000),
};

/**
 * The one line the supervisor writes to a child's standard input: the request, the one opened secret,
 * the guard's ranges, and the connect timeout and failure floor (D1-H, D1-L). Never the sealing key.
 */
export const childRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('test'), request: testRequestSchema, ...childMembers }),
  z.strictObject({ kind: z.literal('describe'), request: describeRequestSchema, ...childMembers }),
  z.strictObject({ kind: z.literal('run'), request: runRequestSchema, ...childMembers }),
  z.strictObject({
    kind: z.literal('describeSql'),
    request: describeSqlRequestSchema,
    ...childMembers,
  }),
]);
export type ChildRequest = z.infer<typeof childRequestSchema>;
