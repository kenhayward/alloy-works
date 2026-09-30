import { z } from 'zod';

import { storableText } from '../stored/storable.js';
import { columnTypeSchema, MAX_COLUMNS, valueTypeSchema } from './columns.js';
import { connectionSettingsSchema } from './connection.js';
import {
  checkQueryDefinition,
  draftDefinitionSchema,
  parameterSchema,
  type Parameter,
} from './definition.js';
import { dataFailureSchema } from './failures.js';
import { limitCeilings } from './limits.js';
import { checkParameterValues, type ParameterValues } from './parameters.js';
import { lexPostgres } from './sql.js';

/**
 * The connector's requests and answers (data.md, "One request, one answer"; the D1 plan, D1-E), parsed
 * on both sides of the interface: by the connector when a request arrives, and by the service when an
 * answer does. Nothing crosses it that these do not admit.
 */

/** The sealing scheme's shape, as migration 0042 holds a sealed sign-in secret to it. */
export const SEALED = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;

/**
 * The most an answer of the connector's may be, in bytes: a child's answer is cut off past it by the
 * supervisor, and the service stops reading one past it. A describe can reach it - 2,000 relations of
 * wide tables with long names come to tens of megabytes - so the child stops listing relations before
 * its answer passes `DESCRIBE_BUDGET_BYTES`, half of this, and says `truncated`.
 */
export const CONNECTOR_ANSWER_MAX_BYTES = 32 * 1024 * 1024;

/**
 * The most a describe's answer may be, in UTF-8 bytes of its JSON, before the child stops adding
 * relations and says `truncated`: half the cap, so an answer never meets it (the D1 fix, round two).
 */
export const DESCRIBE_BUDGET_BYTES = CONNECTOR_ANSWER_MAX_BYTES / 2;

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
export const sealRequestSchema = z.strictObject({
  tenant,
  connection: z.uuid(),
  secret,
  settings: connectionSettingsSchema,
});
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

export const describeRequestSchema = testRequestSchema;
export type DescribeRequest = TestRequest;

/** What a test finds of an authenticated account (D1-M): one finding in D1. */
export const testFindings = ['account_not_read_only'] as const;
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
        proposed: columnTypeSchema.nullable(),
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

/** The most a run's request may be, in bytes: its definition - SQL of up to 100,000 characters - and values. */
export const RUN_REQUEST_MAX_BYTES = 256 * 1024;

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

/** The longest SQL a run reports it ran: its text, with each marker written `$n::type` and each fragment placed. */
const RAN_MAX_CHARACTERS = 300_000;

/**
 * A run's answer (D2-K): the canonical result as a JSON value, its SHA-256 checksum, which the service
 * checks against the bytes it serialises, the row count, the SQL that ran and how long it took - or
 * one named failure.
 */
export const runAnswerSchema = z.discriminatedUnion('outcome', [
  z
    .strictObject({
      outcome: z.literal('ok'),
      result: canonicalResultSchema,
      checksum: z.string().regex(/^[0-9a-f]{64}$/),
      rowCount: z.number().int().min(0),
      ran: z.strictObject({ sql: z.string().max(RAN_MAX_CHARACTERS) }),
      durationMs: z.number().int().min(0),
    })
    .refine((answer) => answer.rowCount === answer.result.rows.length, {
      message: 'The row count is the number of rows',
    }),
  z.strictObject({ outcome: z.literal('failed'), failure: dataFailureSchema }),
]);
export type RunAnswer = z.infer<typeof runAnswerSchema>;

/**
 * A SQL statement described without being run (D2-G; Q1): its text with its markers, and the
 * parameters it declares, so the connector can bind it as a run would.
 */
export const describeSqlRequestSchema = testRequestSchema.extend({
  sql: z
    .strictObject({
      text: draftDefinitionSchema.shape.fetch.shape.text,
      parameters: z.array(parameterSchema).max(50),
    })
    .refine(describable, {
      message: 'A statement lexes whole, each marker naming a declared parameter of its kind',
    }),
});

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
          proposed: valueTypeSchema.nullable(),
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
  z.strictObject({ kind: z.literal('describe'), request: testRequestSchema, ...childMembers }),
  z.strictObject({ kind: z.literal('run'), request: runRequestSchema, ...childMembers }),
  z.strictObject({
    kind: z.literal('describeSql'),
    request: describeSqlRequestSchema,
    ...childMembers,
  }),
]);
export type ChildRequest = z.infer<typeof childRequestSchema>;
