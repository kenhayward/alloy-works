import { SECRET_MAX_BYTES, connectionSettingsSchema } from '@alloy-works/domain';
import { z } from 'zod';
import { FacetCountView, idsFilter, listingQuery, listingTotal, nextCursor } from './listing.js';
import { SpaceParams, VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const ConnectionParams = z.object({ id: LowercaseUuid });
export type ConnectionParams = z.infer<typeof ConnectionParams>;

/**
 * A connection's settings (data.md, "The connection"), the domain's own: what anybody who may read the
 * connection sees, and never a secret.
 */
export const ConnectionSettingsBody = connectionSettingsSchema;

export const CreateConnectionBody = z.strictObject({ settings: connectionSettingsSchema });
export type CreateConnectionBody = z.infer<typeof CreateConnectionBody>;

/** A connection's next version: the whole settings, from the version it was opened at (API-037). */
export const ConnectionVersionBody = z.strictObject({
  openedFrom: LowercaseUuid,
  settings: connectionSettingsSchema,
});
export type ConnectionVersionBody = z.infer<typeof ConnectionVersionBody>;

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

/** The credential, taken and never answered (DAT-003): a database password, in D1. */
export const CredentialBody = z.strictObject({
  secret: z
    .string()
    .refine((value) => utf8Bytes(value) >= 1 && utf8Bytes(value) <= SECRET_MAX_BYTES, {
      message: `A credential is 1 to ${SECRET_MAX_BYTES} bytes of UTF-8`,
    })
    .refine((value) => !value.includes('\u0000'), { message: 'A credential holds no U+0000' })
    .describe('The credential, a password for a PostgreSQL source. Never answered by any route'),
});
export type CredentialBody = z.infer<typeof CredentialBody>;

const Named = z.object({
  id: z.string(),
  name: z.string().nullable().describe('Their name, or their address where they have none'),
});

/** Whether a credential is set, and by whom and when: never the credential (DAT-004). */
export const CredentialState = z.discriminatedUnion('set', [
  z.object({ set: z.literal(false) }),
  z.object({
    set: z.literal(true),
    setBy: Named,
    setAt: z.string(),
    targetChanged: z
      .boolean()
      .describe(
        'Whether the host, port, database, account or TLS has changed since it was set: if so it is ' +
          'never used again, and must be set again',
      ),
  }),
]);
export type CredentialState = z.infer<typeof CredentialState>;

/** A data failure: its code, who it is laid at (DAT-049), and words for a person. */
export const DataFailureView = z.object({
  code: z.string().describe('Stable and machine-readable'),
  attribution: z
    .enum(['connector', 'query', 'product'])
    .describe("Whose failure it is: the source's side, the query's author, or the product"),
  message: z.string(),
});
export type DataFailureView = z.infer<typeof DataFailureView>;

/** A connection test's answer (data.md, "The connection test"): ok with its findings, or one reason. */
export const TestView = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('ok'),
    findings: z
      .array(z.enum(['account_not_read_only']))
      .describe('What the test found of the account once it had signed in'),
    at: z.string(),
  }),
  z.object({ outcome: z.literal('failed'), failure: DataFailureView, at: z.string() }),
]);
export type TestView = z.infer<typeof TestView>;

export const LastTestView = z.object({
  outcome: z.enum(['ok', 'failed']),
  findings: z.array(z.enum(['account_not_read_only'])),
  failure: DataFailureView.optional(),
  at: z.string(),
  by: Named,
  version: z.string().describe('The connection version it tested'),
});

export const ConnectionView = z.object({
  id: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  settings: connectionSettingsSchema,
  credential: CredentialState,
  lastTest: LastTestView.nullable(),
  mayAdminister: z.boolean().describe('Whether the caller may change it and set its credential'),
  mayUse: z.boolean().describe('Whether the caller may test it and list its tables'),
});
export type ConnectionView = z.infer<typeof ConnectionView>;

/** The answer to setting a credential: whether it is set, and the test run straight after (DA-T). */
export const CredentialSet = z.object({
  credential: CredentialState,
  test: TestView,
});
export type CredentialSet = z.infer<typeof CredentialSet>;

export const RelationView = z.object({
  schema: z.string(),
  name: z.string(),
  kind: z.enum(['table', 'view', 'materializedView', 'foreignTable', 'partitionedTable']),
  columns: z.array(
    z.object({
      name: z.string(),
      sourceType: z.string(),
      nullable: z.boolean(),
      proposed: z
        .record(z.string(), z.unknown())
        .nullable()
        .describe('The column type the source proposes, or null where the author must declare one'),
    }),
  ),
});

export const DescribeView = z.object({
  relations: z.array(RelationView),
  truncated: z
    .boolean()
    .describe(
      'Whether the list was cut short: past 2,000 relations, or before the answer would pass its size budget',
    ),
  leftOut: z
    .object({ relations: z.number().int(), columns: z.number().int() })
    .describe(
      'How many relations, and columns of the relations listed, were left out because their names hold a control character or their types are longer than any PostgreSQL names',
    ),
});
export type DescribeView = z.infer<typeof DescribeView>;

export const ConnectionSummary = z.object({
  id: z.string(),
  name: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  type: z.enum(['postgres']),
  retired: z.boolean(),
  version: z.object({ id: z.string(), number: z.string() }),
  credentialSet: z
    .boolean()
    .describe('Whether a credential is set for where the connection now signs in'),
  lastTest: z
    .object({
      outcome: z.enum(['ok', 'failed']),
      at: z.string(),
      version: z.string().describe('The version it tested, which need not be the latest'),
    })
    .nullable(),
  changedAt: z.string().describe('When its latest version was made'),
});
export const ConnectionList = z.object({
  items: z.array(ConnectionSummary),
  next: nextCursor,
  total: listingTotal,
  facets: z
    .object({ spaces: z.array(FacetCountView) })
    .describe(
      'Each filter the listing takes, counted with the others in force and its own left out',
    ),
});
export type ConnectionList = z.infer<typeof ConnectionList>;

export const ConnectionListQuery = z.object({
  ...listingQuery(['name', 'changed'], 'name'),
  spaces: idsFilter.optional().describe('Only connections in these spaces, by id'),
});
export type ConnectionListQuery = z.infer<typeof ConnectionListQuery>;

/**
 * A connection refused: its settings by rule (`connection_invalid`, `identity_not_supported`) with each
 * problem, or the connection as it now stands where the version it was opened at is no longer the
 * latest (`version_precondition`).
 */
export const ConnectionRefusal = ErrorBody.extend({
  problems: z
    .array(
      z.object({
        rule: z.enum(['connection_invalid', 'identity_not_supported']),
        path: z.string().optional(),
        message: z.string().optional(),
        type: z.string().optional(),
        mechanism: z.string().optional(),
      }),
    )
    .optional(),
  current: ConnectionView.optional(),
});
export type ConnectionRefusal = z.infer<typeof ConnectionRefusal>;

/** A data act refused by a data failure: the one error shape, and whose failure it is (DAT-049). */
export const DataRefusal = ErrorBody.extend({
  attribution: z.enum(['connector', 'query', 'product']).optional(),
});

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such connection in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const settingsRefused = {
  description:
    '`connection_invalid` or `identity_not_supported`: the settings are refused by rule, each problem named',
  schema: ConnectionRefusal,
} as const;
const unavailable = {
  description:
    '`connector_unavailable`: no connector is configured or it did not answer; `connector_busy`: it is full',
  schema: DataRefusal,
} as const;
const retiredOrUnset = {
  description:
    '`connection_retired`: a retired connection runs nothing; `credential_missing`: no credential is set; ' +
    '`credential_target_changed`: the host, port, database, account or TLS changed after the credential ' +
    'was set, so the password must be set again',
  schema: DataRefusal,
} as const;

/**
 * Connections (data.md, "Routes"): `administer` makes and changes one and sets its credential,
 * `use_connection` tests it and lists its tables, `read` shows it (DA-Y).
 */
export const connectionRoutes = {
  listConnections: {
    operationId: 'listConnections',
    method: 'GET',
    path: '/v1/connections',
    summary: 'The connections the caller may read, each with its space and whether it is ready',
    tenantScoped: true,
    access: { check: 'session' },
    query: ConnectionListQuery,
    responses: {
      200: { description: 'A page of connections', schema: ConnectionList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
    },
  },
  createConnection: {
    operationId: 'createConnection',
    method: 'POST',
    path: '/v1/spaces/{space}/connections',
    summary: 'Make a connection in this space, at version 0.1',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { space: 'space' } },
    params: SpaceParams,
    body: CreateConnectionBody,
    responses: {
      // 200, not 201, for the reason createComponent gives: a permission-checked handler cannot set
      // a status.
      200: { description: 'Made, at version 0.1', schema: ConnectionView },
      400: settingsRefused,
      401: unauthenticated,
      403: {
        description: 'The caller may read the space but may not administer it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  getConnection: {
    operationId: 'getConnection',
    method: 'GET',
    path: '/v1/connections/{id}',
    summary: 'A connection at its latest version, whether its credential is set, and its last test',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ConnectionParams,
    responses: {
      200: { description: 'The connection', schema: ConnectionView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a connection the caller may not read is not found',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  recordConnectionVersion: {
    operationId: 'recordConnectionVersion',
    method: 'POST',
    path: '/v1/connections/{id}/versions',
    summary: "Cut a connection's next version from the one the caller opened; retiring among them",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { artifact: 'id' } },
    params: ConnectionParams,
    body: ConnectionVersionBody,
    responses: {
      200: {
        description:
          'The connection at its latest version: the one cut, or the one before where nothing changed',
        schema: ConnectionView,
      },
      400: settingsRefused,
      401: unauthenticated,
      403: {
        description: 'The caller may read the connection but may not administer it',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description:
          '`version_precondition`: the connection has a newer version than the one named',
        schema: ConnectionRefusal,
      },
    },
  },
  setConnectionCredential: {
    operationId: 'setConnectionCredential',
    method: 'PUT',
    path: '/v1/connections/{id}/credential',
    summary: "Set or replace a connection's credential, then test the connection with it",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { artifact: 'id' } },
    params: ConnectionParams,
    body: CredentialBody,
    idempotencyKey: false,
    responses: {
      200: {
        description:
          'Set: who set it and when, never the credential, and the test run straight after',
        schema: CredentialSet,
      },
      400: {
        description: 'The credential is empty, longer than 4,096 bytes, or holds U+0000',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the connection but may not administer it',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description: '`connection_retired`: a retired connection takes none',
        schema: DataRefusal,
      },
      503: unavailable,
    },
  },
  testConnection: {
    operationId: 'testConnection',
    method: 'POST',
    path: '/v1/connections/{id}/test',
    summary: 'Test a connection: whether it reaches its source and signs in, and what it found',
    tenantScoped: true,
    access: { check: 'permission', permission: 'use_connection', target: { artifact: 'id' } },
    params: ConnectionParams,
    body: z.strictObject({}),
    // Answered after the deciding transaction commits, so nothing could be recorded against a key
    // (the D1 fix, C4); a test repeated is a test run again.
    idempotencyKey: false,
    responses: {
      200: {
        description:
          'Tested, and recorded against the version tested: ok with its findings, or one reason',
        schema: TestView,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the connection but may not use it',
        schema: ErrorBody,
      },
      404: notFound,
      409: retiredOrUnset,
      503: unavailable,
    },
  },
  describeConnection: {
    operationId: 'describeConnection',
    method: 'POST',
    path: '/v1/connections/{id}/describe',
    summary: "List the tables and views a connection's account may read, with each column",
    tenantScoped: true,
    access: { check: 'permission', permission: 'use_connection', target: { artifact: 'id' } },
    params: ConnectionParams,
    body: z.strictObject({}),
    // Answered after the deciding transaction commits, so nothing could be recorded against a key
    // (the D1 fix, C4); a test repeated is a test run again.
    idempotencyKey: false,
    responses: {
      200: { description: "The source's tables and views", schema: DescribeView },
      401: unauthenticated,
      403: {
        description: 'The caller may read the connection but may not use it',
        schema: ErrorBody,
      },
      404: notFound,
      409: retiredOrUnset,
      502: {
        description:
          '`connection_failed`: the source could not be reached or signed in to; `connector_error`: the connector failed; ' +
          '`source_unsupported`: the source is older than PostgreSQL 14',
        schema: DataRefusal,
      },
      503: unavailable,
      504: { description: '`timeout`: the source did not answer in time', schema: DataRefusal },
    },
  },
} as const satisfies Record<string, RouteContract>;
