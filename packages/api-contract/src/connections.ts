import {
  SECRET_MAX_BYTES,
  builderFetchSchema,
  connectionSettingsSchema,
  dataFormatSchema,
  httpFetchSchema,
  objectKeySchema,
  ranObjectSchema,
  s3KeyPairSchema,
  httpTemplateSchema,
  draftDefinitionSchema,
  sqlTextSchema,
  parameterSchema,
  proposedTypeSchema,
} from '@alloy-works/domain';
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

/**
 * The credential, taken and never answered (DAT-003): one secret - a database password, or the value
 * an HTTP connection sends in its secret header - or an S3 connection's access key pair, sealed
 * together (the D6 plan, D6-C). One form or the other, never both.
 */
export const CredentialBody = z
  .strictObject({
  secret: z
    .string()
    .refine((value) => utf8Bytes(value) >= 1 && utf8Bytes(value) <= SECRET_MAX_BYTES, {
      message: `A credential is 1 to ${SECRET_MAX_BYTES} bytes of UTF-8`,
    })
    .refine((value) => !value.includes('\u0000'), { message: 'A credential holds no U+0000' })
    .describe(
      "The credential: a PostgreSQL source's password, or the value an HTTP connection sends in its secret header. Never answered by any route",
    )
    .optional(),
    accessKeyId: s3KeyPairSchema.shape.accessKeyId
      .optional()
      .describe("An S3 connection's access key id, sent with its secret access key"),
    secretAccessKey: s3KeyPairSchema.shape.secretAccessKey
      .optional()
      .describe("An S3 connection's secret access key. Never answered by any route"),
  })
  .refine(
    (body) =>
      body.secret !== undefined
        ? body.accessKeyId === undefined && body.secretAccessKey === undefined
        : body.accessKeyId !== undefined && body.secretAccessKey !== undefined,
    { message: 'A credential is a secret, or an access key id and a secret access key' },
  );
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
    setBeforeBinding: z
      .boolean()
      .describe(
        'Whether it was set before credentials were bound to where a connection signs in: if so it ' +
          'is never used, and must be set again, though nothing changed',
      ),
  }),
]);
export type CredentialState = z.infer<typeof CredentialState>;

/** What the source said of a statement it refused (D2-H). */
export const SourceRefusalView = z
  .object({
    sqlstate: z.string().describe("The source's five-character SQLSTATE"),
    message: z
      .string()
      .optional()
      .describe(
        "The source's own message, cut to 1,000 characters: given only to somebody holding write SQL on the connection",
      ),
  })
  .describe('What the source said, where it refused the statement: `source_refused` alone');

/**
 * A data failure: its code, who it is laid at (DAT-049), words for a person, and, where the failure
 * names them, what the source said, the column and the row.
 */
export const DataFailureView = z.object({
  code: z.string().describe('Stable and machine-readable'),
  attribution: z
    .enum(['connector', 'query', 'product'])
    .describe("Whose failure it is: the source's side, the query's author, or the product"),
  message: z.string(),
  source: SourceRefusalView.optional(),
  column: z.string().optional().describe('The column the failure names, where it names one'),
  row: z.number().int().optional().describe('The row the failure names, counted from 1'),
  status: z
    .number()
    .int()
    .optional()
    .describe(
      'The HTTP status an HTTP source refused with: `source_refused` alone, never its body',
    ),
});
export type DataFailureView = z.infer<typeof DataFailureView>;

/** A connection test's answer (data.md, "The connection test"): ok with its findings, or one reason. */
export const TestView = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('ok'),
    findings: z
      .array(z.enum(['account_not_read_only', 'account_holds_privilege']))
      .describe(
        "What the test found of the account once it had signed in: that it may change data, or, on a connection asserting each person's own identity, that it may read data of its own",
      ),
    at: z.string(),
  }),
  z.object({ outcome: z.literal('failed'), failure: DataFailureView, at: z.string() }),
]);
export type TestView = z.infer<typeof TestView>;

export const LastTestView = z.object({
  outcome: z.enum(['ok', 'failed']),
  findings: z.array(z.enum(['account_not_read_only', 'account_holds_privilege'])),
  failure: DataFailureView.optional(),
  at: z.string(),
  by: Named,
  version: z.string().describe('The connection version it tested'),
  credentialCurrent: z
    .boolean()
    .describe(
      'Whether it was made with the credential set now; a test of an earlier credential says nothing of this one',
    ),
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

/**
 * The query definitions naming a connection, from their latest versions (D2-O): those the caller may
 * read by title, and how many more there are, never named.
 */
export const NamingDefinitionsView = z.object({
  readable: z.array(z.object({ id: z.string(), title: z.string(), retired: z.boolean() })),
  others: z.number().int().describe('How many more name it that the caller may not read'),
});

/** Something used, by what the caller may read and how many more there are (D3-M). */
export const UsesView = z.object({
  readable: z.array(z.object({ id: z.string(), title: z.string() })),
  others: z.number().int().describe('How many more the caller may not read, never named'),
});

/**
 * Where a connection is used (D2-O, D3-M): the definitions naming it, and the documents where a
 * binding holds a result run on it.
 */
export const ConnectionUsesView = z.object({
  definitions: NamingDefinitionsView,
  documents: UsesView.describe('The documents where a binding holds a result run on it'),
});
export type ConnectionUsesView = z.infer<typeof ConnectionUsesView>;

/**
 * The answer to setting a credential: whether it is set, the test run straight after (DA-T), and,
 * where that test failed, every definition naming the connection (DAT-066).
 */
export const CredentialSet = z.object({
  credential: CredentialState,
  test: TestView,
  dependents: NamingDefinitionsView.optional().describe(
    'Where the test failed, the query definitions naming the connection, which cannot run until it passes',
  ),
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

/**
 * A SQL statement as describe takes it: its text with `{{name}}` and `{{#name}}` markers, and the
 * parameters it declares (D2-B, D2-G).
 */
export const SqlStatementBody = z.strictObject({
  text: sqlTextSchema,
  parameters: z.array(parameterSchema).max(50),
});

/**
 * A built query as describe takes it (the D4 plan, D4-Q): its tree, format 1's, and the parameters it
 * declares. Described by its shape statement, generated from the tree; never SQL.
 */
export const BuiltQueryBody = z.strictObject({
  query: builderFetchSchema.shape.query,
  parameters: z.array(parameterSchema).max(50),
});

/**
 * An HTTP request sampled for its columns (DAT-105; the D6 plan, D6-A): its template and format, the
 * parameters it declares and a value for each. It is sent, and each member of its first rows is
 * proposed as a column read by its pointer.
 */
export const HttpSampleBody = z.strictObject({
  request: httpTemplateSchema,
  format: httpFetchSchema.shape.format,
  parameters: z.array(parameterSchema).max(50),
  values: z
    .record(z.string(), z.union([z.string(), z.boolean(), z.null(), z.array(z.string())]))
    .describe("Each parameter's value by name, in its type's canonical form"),
});

/**
 * An S3 object sampled for its columns (DAT-105; the D6 plan, task 2): its key, its format, the
 * parameters its key names and a value for each. The object is read, and each column of its first
 * rows proposed by its pointer, its header or its letter; its filter waits for its columns.
 */
export const FileSampleBody = z.strictObject({
  key: objectKeySchema,
  format: dataFormatSchema,
  parameters: z.array(parameterSchema).max(50),
  values: z
    .record(z.string(), z.union([z.string(), z.boolean(), z.null(), z.array(z.string())]))
    .describe("Each parameter's value by name, in its type's canonical form"),
});

export const DescribeBody = z.strictObject({
  sql: SqlStatementBody.optional().describe(
    "A statement to describe instead of the source's tables and views: its result's columns, never run",
  ),
  builder: BuiltQueryBody.optional().describe(
    "A built query to describe instead of the source's tables and views: the columns its tree returns, from SQL the service generates, never run. Send this or sql, never both",
  ),
  http: HttpSampleBody.optional().describe(
    "An HTTP connection's request, sent and its first rows read to propose its columns, each read by a pointer: an HTTP connection lists no tables. Send one of sql, builder, http and file",
  ),
  file: FileSampleBody.optional().describe(
    "An S3 connection's object, read and its first rows read to propose its columns, each by a pointer, a header or a letter: an S3 connection lists no tables. Send one of sql, builder, http and file",
  ),
});
export type DescribeBody = z.infer<typeof DescribeBody>;

/** A statement described without being run (D2-G): its result's columns, each with a proposal. */
export const DescribeSqlView = z.object({
  columns: z.array(
    z.object({
      name: z.string(),
      sourceType: z.string().describe("The source's own name for the column's type"),
      proposed: proposedTypeSchema
        .nullable()
        .describe(
          "The column type proposed for it, or null where the author must declare one. A binary column is proposed as an image, its description the author's to declare",
        ),
      pointer: z
        .string()
        .optional()
        .describe('For JSON, the JSON Pointer that reads the column from its row'),
      header: z
        .string()
        .optional()
        .describe("For a CSV whose first record is a header, the header that names the column's field"),
      letter: z
        .string()
        .optional()
        .describe("For a CSV, the letter of the column's field, A for the first"),
    }),
  ),
  parameters: z
    .array(z.string())
    .describe("Each parameter's type as the source reads it, in the order they are bound"),
});
export type DescribeSqlView = z.infer<typeof DescribeSqlView>;

/** A value a sample binds: canonical text, a boolean, null, or a list of them (D2-R). */
const SampleValue = z.union([z.string(), z.boolean(), z.null()]);

/** A sample run (D2-I): a draft definition, its columns declared, and a value for each parameter. */
export const SampleBody = z.strictObject({
  definition: draftDefinitionSchema,
  values: z
    .record(z.string(), z.union([SampleValue, z.array(SampleValue)]))
    .describe(
      "Each parameter's value by name, in its type's canonical form, or a list of them for a list parameter",
    ),
});
export type SampleBody = z.infer<typeof SampleBody>;

/** The most rows a sample answers; its row count and checksum are of the whole result. */
export const SAMPLE_ROWS = 100;

/**
 * A sample's answer (D2-I): the first 100 rows in canonical form, with how many there were, the whole
 * result's checksum, the SQL that ran and how long it took - or one named failure. Both are answers.
 */
export const SampleView = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('ok'),
    columns: z
      .array(z.tuple([z.string(), z.string()]))
      .describe("Each column's name and its type's base"),
    rows: z
      .array(z.array(z.union([z.string(), z.boolean(), z.null()])))
      .describe('The first 100 rows, each value in its canonical form'),
    rowCount: z.number().int().describe('How many rows the whole result holds'),
    checksum: z
      .string()
      .describe('The SHA-256 of the whole result in canonical form, in hexadecimal'),
    ran: z
      .union([
        z.object({ sql: z.string().describe('The SQL that ran, each value a bound parameter') }),
        z.object({
          request: httpTemplateSchema.describe(
            'The HTTP request template that was sent, each value placed by position; never its URL',
          ),
        }),
        z.object({
          object: ranObjectSchema.describe(
            'The S3 object read: its bucket, its key as bound and its version where the store names one; never a URL',
          ),
        }),
      ])
      .describe(
        'What ran: SQL for a database, the request template for an HTTP connection, the object for an S3 one',
      ),
    durationMs: z.number().int(),
    images: z
      .record(
        z.string(),
        z.object({
          format: z.enum(['png', 'jpeg']),
          bytes: z.number().int().describe('Its size in bytes'),
          width: z.number().int().describe('Its width in pixels, as displayed'),
          height: z.number().int().describe('Its height in pixels, as displayed'),
        }),
      )
      .describe(
        'Each image in the first rows, by the hash its cell holds: its format, size and pixels, read from its header. A sample stores no image and makes no asset of one',
      ),
  }),
  z.object({ outcome: z.literal('failed'), failure: DataFailureView }),
]);
export type SampleView = z.infer<typeof SampleView>;

export const ConnectionSummary = z.object({
  id: z.string(),
  name: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  type: z.enum(['postgres', 'http', 's3']),
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
      credentialCurrent: z.boolean().describe('Whether it was made with the credential set now'),
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
  definitions: NamingDefinitionsView.optional().describe(
    'Where retiring is refused, the query definitions still naming the connection that are not retired',
  ),
});
export type ConnectionRefusal = z.infer<typeof ConnectionRefusal>;

/** A data act refused by a data failure: the one error shape, and whose failure it is (DAT-049). */
export const DataRefusal = ErrorBody.extend({
  attribution: z.enum(['connector', 'query', 'product']).optional(),
  source: SourceRefusalView.optional(),
  column: z.string().optional(),
  row: z.number().int().optional(),
});

/**
 * SQL refused on a connection (DAT-103): `untested` where its latest test is not a pass of its latest
 * version and credential, `not_read_only` where that test found its account able to write; and on a
 * connection that runs as each person (DAT-102), `asserted`.
 */
export const SqlRefusal = DataRefusal.extend({
  reason: z.enum(['untested', 'not_read_only', 'asserted']).optional(),
});

/**
 * An act stopped because the session it was asked in was signed out, or the token it was asked with
 * revoked, while the source answered (IAM-082): `authority_ended`, with which, and nothing recorded.
 */
export const AuthorityEndedRefusal = ErrorBody.extend({
  reason: z.enum(['signed_out', 'token_revoked']).optional(),
});

/** The 401 of a route that asks the source: no session, or its authority ended meanwhile. */
export const unauthenticatedOrEnded = {
  description:
    'No session, or not one this environment issued; or `authority_ended`: the session was signed out, or the token revoked ' +
    '(`signed_out`, `token_revoked`), while the source answered, which stopped it within two seconds. Nothing is recorded',
  schema: AuthorityEndedRefusal,
} as const;

/** A value refused by its declaration (DAT-020): the parameter, the rule and the value. */
const ParameterProblem = z.object({
  parameter: z.string(),
  rule: z.enum([
    'required',
    'type',
    'permitted',
    'range',
    'list',
    'precision',
    'scale',
    'zone',
    'variation',
    'position',
  ]),
  value: z.string().describe('The value as sent, cut to 1,000 characters'),
});

/** A definition's rule broken (the D2 plan's stored-shape check). */
const DefinitionProblem = z.object({
  rule: z.literal('definition_invalid'),
  path: z.string().describe('The member refused, dotted, as `columns.2.name`'),
  message: z.string(),
});

/**
 * A draft, a statement or a value refused: `definition_invalid` with each rule the definition breaks,
 * or `parameter_invalid` with each value that fails its declaration, named with the parameter, the
 * rule and the value (DAT-020).
 */
export const DataProblemsRefusal = DataRefusal.extend({
  problems: z.array(z.union([DefinitionProblem, ParameterProblem])).optional(),
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
    'was set, or it was set before credentials were bound to a target, so the password must be set again',
  schema: DataRefusal,
} as const;

/** SQL refused on a connection that has not been found read-only (DAT-103), or that asserts (DAT-102). */
const sqlNotPermitted =
  '`sql_not_permitted`: for SQL, the connection has not been tested clean at its latest version and ' +
  'credential (`untested`), its account was found able to write (`not_read_only`), or it runs as each person (`asserted`). ' +
  'A built query is never refused this way';

/** A connection that runs as each person, and cannot name the caller (D7-B). */
const identityUnavailable =
  "`identity_unavailable`: the connection runs as each person, and the caller's sign-in has no email or subject it can name them by, " +
  'or one longer than 63 bytes';

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
          '`version_precondition`: the connection has a newer version than the one named; ' +
          '`connection_in_use`: a version retiring it is refused while a query definition that is not ' +
          'retired names it, those the caller may read named and the rest counted',
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
          'Set: who set it and when, never the credential, and the test run straight after. A test stopped because the session was signed out, or the token revoked, meanwhile fails `authority_ended`, the credential still set',
        schema: CredentialSet,
      },
      400: {
        description: 'The credential is empty, longer than 4,096 bytes, or holds U+0000',
        schema: ErrorBody,
      },
      401: unauthenticatedOrEnded,
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
      401: unauthenticatedOrEnded,
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
    summary:
      "List the tables and views a connection's account may read, or a statement's or a built query's result columns",
    tenantScoped: true,
    access: { check: 'permission', permission: 'use_connection', target: { artifact: 'id' } },
    params: ConnectionParams,
    body: DescribeBody,
    // Answered after the deciding transaction commits, so nothing could be recorded against a key
    // (the D1 fix, C4); a test repeated is a test run again.
    idempotencyKey: false,
    responses: {
      200: {
        description:
          "The source's tables and views, or, where a statement or a built query was sent, its result's columns",
        schema: z.union([DescribeView, DescribeSqlView]),
      },
      400: {
        description:
          '`definition_invalid`: the statement does not lex whole or names a parameter it does not declare, or the built query fails ' +
          "the builder's rules, each problem named, or both were sent; `source_refused`: the source refused the statement, with its " +
          "SQLSTATE, and what it said only to a caller who may write SQL on the connection; a built query's commonest refusals are " +
          'worded by their SQLSTATE; `result_mismatch`: it has no columns to describe',
        schema: DataProblemsRefusal,
      },
      401: unauthenticatedOrEnded,
      403: {
        description:
          'The caller may read the connection but may not use it, or, for a statement, may not write SQL against it. A built query needs use connection alone',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description: `${retiredOrUnset.description}; ${sqlNotPermitted}; ${identityUnavailable}`,
        schema: SqlRefusal,
      },
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
  sampleConnection: {
    operationId: 'sampleConnection',
    method: 'POST',
    path: '/v1/connections/{id}/sample',
    summary: 'Run a draft query definition against sample values, storing nothing',
    tenantScoped: true,
    access: { check: 'permission', permission: 'use_connection', target: { artifact: 'id' } },
    params: ConnectionParams,
    body: SampleBody,
    // Answered after the deciding transaction commits, and nothing of a sample is kept (D2-I).
    idempotencyKey: false,
    responses: {
      200: {
        description:
          'Run: the first 100 rows, how many there were, the checksum and the SQL that ran, or one named failure with its attribution',
        schema: SampleView,
      },
      400: {
        description:
          '`definition_invalid`: the draft fails a rule, each problem named, or is for another connection; ' +
          '`parameter_invalid`: a value fails its declaration, each named with the parameter, the rule and the value',
        schema: DataProblemsRefusal,
      },
      401: unauthenticatedOrEnded,
      403: {
        description:
          'The caller may read the connection but may not use it, or, for a draft of SQL, may not write SQL against it. A built query needs use connection alone',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description: `${retiredOrUnset.description}; ${sqlNotPermitted}; ${identityUnavailable}`,
        schema: SqlRefusal,
      },
      503: unavailable,
    },
  },
  getConnectionUses: {
    operationId: 'getConnectionUses',
    method: 'GET',
    path: '/v1/connections/{id}/uses',
    summary:
      'Where a connection is used: the query definitions naming it, and the documents through them',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ConnectionParams,
    responses: {
      200: {
        description:
          'The query definitions whose latest versions name it, and the documents holding a result run on it: those the caller may read, and how many more',
        schema: ConnectionUsesView,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a connection the caller may not read is not found',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
} as const satisfies Record<string, RouteContract>;
