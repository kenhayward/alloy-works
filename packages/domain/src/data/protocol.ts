import { z } from 'zod';

import { columnTypeSchema } from './columns.js';
import { connectionSettingsSchema } from './connection.js';
import { dataFailureSchema } from './failures.js';

/**
 * The connector's requests and answers (data.md, "One request, one answer"; the D1 plan, D1-E), parsed
 * on both sides of the interface: by the connector when a request arrives, and by the service when an
 * answer does. Nothing crosses it that these do not admit.
 */

/** The sealing scheme's shape, as migration 0042 holds a sealed sign-in secret to it. */
export const SEALED = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/;

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
 * A secret to seal, and the connection settings whose target it is sealed to (the D1 fix, C3): it
 * opens only for a request whose settings name the same type, host, port, database, account and TLS.
 */
export const sealRequestSchema = z.strictObject({
  tenant,
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

export const relationSchema = z.strictObject({
  schema: z.string(),
  name: z.string(),
  kind: z.enum(['table', 'view', 'materializedView', 'foreignTable', 'partitionedTable']),
  columns: z.array(
    z.strictObject({
      name: z.string(),
      sourceType: z.string(),
      nullable: z.boolean(),
      proposed: columnTypeSchema.nullable(),
    }),
  ),
});
export type Relation = z.infer<typeof relationSchema>;

export const describeAnswerSchema = z.union([
  z.strictObject({ relations: z.array(relationSchema), truncated: z.boolean() }),
  z.strictObject({ failure: dataFailureSchema }),
]);
export type DescribeAnswer = z.infer<typeof describeAnswerSchema>;

/**
 * The one line the supervisor writes to a child's standard input: the request, the one opened secret,
 * the guard's ranges, and the connect timeout and failure floor (D1-H, D1-L). Never the sealing key.
 */
export const childRequestSchema = z.strictObject({
  kind: z.enum(['test', 'describe']),
  request: testRequestSchema,
  secret,
  deny: z.array(z.string()),
  connectTimeoutMs: z.number().int().min(1).max(60_000),
  failureFloorMs: z.number().int().min(0).max(60_000),
});
export type ChildRequest = z.infer<typeof childRequestSchema>;
