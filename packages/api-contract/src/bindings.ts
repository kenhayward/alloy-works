import {
  bindingNodeSchema,
  tableBindingSchema,
  imageColumnTypeSchema,
  MAX_COLUMNS,
  httpTemplateSchema,
  ranObjectSchema,
  provenanceSchema,
  TAKE_FAILURES,
  valueTypeSchema,
} from '@alloy-works/domain';
import { z } from 'zod';
import {
  DataFailureView,
  DataProblemsRefusal,
  unauthenticatedOrEnded,
  UsesView,
} from './connections.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/**
 * Bindings and datasets (data.md, "Routes"; the D3 plan, task 3): what a document's bindings hold,
 * resolving and checking them through the connector, accepting a waiting result, reading a stored
 * result through a document, and naming a dataset. No screen places a binding yet (D3-P): these are
 * the API's.
 */

export const DocumentBindingParams = z.object({ id: LowercaseUuid });
export type DocumentBindingParams = z.infer<typeof DocumentBindingParams>;

export const DocumentDatasetParams = z.object({ id: LowercaseUuid, version: LowercaseUuid });
export type DocumentDatasetParams = z.infer<typeof DocumentDatasetParams>;

export const DatasetParams = z.object({ id: LowercaseUuid });
export type DatasetParams = z.infer<typeof DatasetParams>;

/** A binding in a document: the outline node whose component holds it, and its identifier. */
const NodeBinding = z.strictObject({
  node: z.string().min(1).max(64).describe('The outline node referencing the component'),
  binding: z.string().min(1).max(200).describe("The binding's identifier in that component"),
});

/** Where a binding is read from (B2-C): the component version the node resolves to, or a session. */
const BindingFrom = z
  .enum(['version', 'session'])
  .optional()
  .describe(
    "`session`: read the binding from the latest save of the caller's own editing session, named by `session`, where the node floats at the latest version, that session holds the component's lock, and it opened from the latest version; otherwise it is `binding_missing`. Absent or `version`: from the component version the node resolves to",
  );

const SessionNamed = LowercaseUuid.optional().describe(
  "The caller's own editing session a binding is read from, for an item that says `session`",
);

/** A component and one binding's identifier in it, for its holders. */
export const ComponentBindingParams = z.object({
  id: LowercaseUuid,
  binding: z.string().min(1).max(200),
});
export type ComponentBindingParams = z.infer<typeof ComponentBindingParams>;

/** The bindings view, read with the bindings of one editing session (B2-C). */
export const DocumentBindingsQuery = z.object({
  session: SessionNamed.describe(
    "The caller's own editing session: a component whose lock it holds is read from its latest save, as a resolve's `session` item is",
  ),
});
export type DocumentBindingsQuery = z.infer<typeof DocumentBindingsQuery>;

/**
 * A dataset version's provenance record (DAT-085): what ran, as whom, when, and the checksum - the SQL
 * that ran, the connection and the source's column each declared column reads shown only to a caller
 * who may read the query definition, as D2 shows a definition only to its reader. The stored record
 * is whole either way.
 */
export const ProvenanceView = provenanceSchema.extend({
  columns: z
    .array(
      provenanceSchema.shape.columns.element.extend({
        from: provenanceSchema.shape.columns.element.shape.from
          .nullable()
          .describe(
            "The source's column it reads, or null where the caller may not read the query definition",
          ),
      }),
    )
    .min(1)
    .max(MAX_COLUMNS)
    .describe("The definition's declared columns: each one's name and type, and where it reads"),
  connection: provenanceSchema.shape.connection
    .nullable()
    .describe(
      'The connection version it ran on, or null where the caller may not read the query definition',
    ),
  ran: z.union([
    z.strictObject({
      sql: z
        .string()
        .nullable()
        .describe('The SQL that ran, or null where the caller may not read the query definition'),
    }),
    z.strictObject({
      request: httpTemplateSchema
        .nullable()
        .describe(
          'The HTTP request template that was sent, never its URL, or null where the caller may not read the query definition',
        ),
    }),
    z.strictObject({
      object: ranObjectSchema
        .nullable()
        .describe(
          'The S3 object read - its bucket, its key as bound and its version - never a URL, or null where the caller may not read the query definition',
        ),
    }),
  ]),
});

/** Why an image a take gave cannot stand where its binding is placed (the B6 plan, B6-D). */
export const PLACEMENT_FAILURES = ['value_not_image', 'image_not_placeable'] as const;

/**
 * What a binding's take gave from a dataset version (B1-H): the value, in its column's canonical form,
 * with the column it was declared as - its name and type, never the source's column it reads - or an
 * image (B6-D), with the asset version it was admitted as and its description; or why there is none,
 * by code, its placement among them; or `unavailable` where the stored result could not be read to
 * take it.
 */
export const TakeOutcomeView = z
  .union([
    z.strictObject({
      value: z
        .union([z.string(), z.boolean()])
        .describe("The value, in its column's canonical form: a string, or a boolean"),
      column: z.strictObject({
        name: z.string().describe('The declared column it was taken from'),
        type: valueTypeSchema,
      }),
    }),
    z.strictObject({
      image: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .describe("The image's SHA-256, as the result's cell holds it"),
      assetVersion: z
        .string()
        .describe(
          "The asset version the image was admitted as, from the dataset version's provenance: its bytes are at /v1/asset-versions/{id}/content to a reader of a document holding it",
        ),
      description: z
        .string()
        .describe(
          "What describes the image: the text the same row holds in the column the image column's type names, or `decorative` where the type says so",
        ),
      column: z.strictObject({
        name: z.string().describe('The declared image column it was taken from'),
        type: imageColumnTypeSchema,
      }),
    }),
    z.strictObject({
      failure: z
        .enum([...TAKE_FAILURES, ...PLACEMENT_FAILURES])
        .describe(
          "`take_invalid`: the result has no such column, taken, key or an image's description; `value_none`: no rows; `value_many`: more than one row; `row_missing`: no row the key names; `value_null`: a null; `value_empty`: text of no characters or spaces alone; `image_description_missing`: an image whose description is null, or text of no characters or spaces alone; `value_not_image`: a figure's binding taking a column that is not an image; `image_not_placeable`: an image taken in a footnote's text or a caption, which holds no image",
        ),
      count: z.number().int().min(2).optional().describe('`value_many`: how many rows there were'),
      column: z
        .string()
        .optional()
        .describe(
          "`take_invalid`: the column, taken, key or description, the result does not have; `image_description_missing`: the image's description column",
        ),
    }),
    z.strictObject({
      unavailable: z
        .literal(true)
        .describe(
          'The stored result could not be read to take a value from it now: nothing is recorded, and a later read tries again',
        ),
    }),
    z.strictObject({
      table: z
        .literal(true)
        .describe(
          "A bound table's binding: it takes no value, and holds the whole result, which the table lays out by its own columns, headers and formats",
        ),
    }),
  ])
  .describe('What the binding takes from this dataset version');
export type TakeOutcomeView = z.infer<typeof TakeOutcomeView>;

/** What a binding holds in a document: a dataset version, from the latest resolution for it. */
const HeldView = z.object({
  dataset: z.string(),
  version: z.string().describe('The dataset version it holds'),
  number: z.string().describe('`revision.version`, as `0.2`'),
  provenance: ProvenanceView,
  name: z.string().nullable().describe("The dataset's name, or null where nobody has named it"),
  stale: z
    .boolean()
    .describe(
      "Whether the binding has changed since it was resolved: if so it holds nothing for this document's purposes until it is resolved again",
    ),
  taken: TakeOutcomeView.nullable().describe(
    'The value the binding takes from the version held, or null where it is stale',
  ),
  act: z
    .enum(['resolve', 'accept', 'confirm'])
    .describe('The act that made it what the binding holds'),
  keepable: z
    .boolean()
    .describe(
      'Whether Keep may hold it under the binding as it now stands: stale, and still asking the question it answers - the same definition, parameters and version - so only the value taken or the mode changed',
    ),
  by: z
    .object({
      id: z.string(),
      displayName: z.string().nullable().describe('Their name, or null where they have none'),
    })
    .describe('Who resolved or accepted it'),
  at: z.string().describe('When'),
});

/** One binding of a document, what it holds, and the newer result waiting for it (D3-J). */
export const BindingStateView = z.object({
  node: z.string(),
  binding: z
    .union([bindingNodeSchema, tableBindingSchema])
    .describe(
      "The binding as the component stores it: one taking a value, or a bound table's, which has no `take` and binds the whole result",
    ),
  held: HeldView.nullable().describe('What it holds, or null where it has never been resolved'),
  waiting: z
    .object({
      version: z.string(),
      provenance: ProvenanceView,
      taken: TakeOutcomeView.describe('The value the binding would take from it'),
    })
    .nullable()
    .describe(
      'A different result a check recorded after the one held, which nothing holds until it is accepted',
    ),
  definition: z
    .object({
      title: z.string(),
      version: z.string().describe('`revision.version`, as `0.2`'),
    })
    .nullable()
    .describe(
      'The query definition: the version the held result ran, or where it holds none the version the binding pins or the latest. Null where the caller may not read the definition',
    ),
  connection: z
    .object({ name: z.string() })
    .nullable()
    .describe(
      'The connection the held result ran on. Null where it holds none, or where the caller may not read both the definition and the connection',
    ),
  definitionChanged: z
    .boolean()
    .describe(
      "Whether the binding floats at its definition's latest version and that has moved on from the version its held result ran",
    ),
  sincePublished: z
    .union([z.literal('new'), z.array(z.enum(['digest', 'dataset', 'definition'])).min(1)])
    .nullable()
    .describe(
      "How the binding differs from what the document's latest publication printed: `new` where it printed no such binding, or the members that differ - `digest`, the binding itself; `dataset`, the dataset version held; `definition`, the definition version that ran. Null where nothing differs or the document has never been published",
    ),
  mayCheck: z
    .boolean()
    .describe(
      'Whether a check would look for a revision of it for the caller: checked, resolved, and the caller may use the connection its held result ran on',
    ),
  mayResolve: z
    .boolean()
    .describe(
      'Whether the caller may resolve it: they may edit the document and use the connection its definition runs on',
    ),
});
export type BindingStateView = z.infer<typeof BindingStateView>;

export const DocumentBindingsView = z.object({
  bindings: z
    .array(BindingStateView)
    .describe(
      "Every binding in the components the document's latest version places that the caller may read, in the outline's order",
    ),
});
export type DocumentBindingsView = z.infer<typeof DocumentBindingsView>;

/**
 * A resolve's or a check's failure for one binding (DAT-086): a data failure, or a refusal of what the
 * run would need, naming the definition, the binding, its node and the document.
 */
export const BindingFailureView = DataFailureView.extend({
  definition: z.string().describe('The query definition the binding names'),
  binding: z.string(),
  node: z.string(),
  document: z.string(),
});

export const ResolveBindingsBody = z
  .strictObject({
    bindings: z
      .array(NodeBinding.extend({ from: BindingFrom }))
      .min(1)
      .max(50)
      .describe('The bindings to resolve, 1 to 50'),
    session: SessionNamed,
    sharesOwnView: z
      .boolean()
      .optional()
      .describe(
        "Acknowledges that a result fetched under the caller's own identity - a binding on a connection that runs as each person - " +
          'is shown to everybody who may read the document. Without it such a binding is refused `acknowledgement_required`',
      ),
  })
  .refine(
    (body) => body.session !== undefined || body.bindings.every((each) => each.from !== 'session'),
    { message: 'An item read from a session needs the session named', path: ['session'] },
  );
export type ResolveBindingsBody = z.infer<typeof ResolveBindingsBody>;

/** What a resolve did for one binding: the version it holds now, or its run's failure. */
const ResolveDone = [
  z.object({
    node: z.string(),
    binding: z.string(),
    held: z.object({
      dataset: z.string(),
      version: z.string().describe('The dataset version it now holds'),
      reused: z
        .boolean()
        .describe(
          'Whether the run found what the latest version already records, so no version was made',
        ),
    }),
  }),
  z.object({ node: z.string(), binding: z.string(), failure: BindingFailureView }),
] as const;

const pendingId = z
  .string()
  .describe(
    'A pending result: the run holds images not yet admitted as assets. Ask `GET /v1/datasets/pending/{id}` until it is done',
  );

export const ResolveBindingsView = z.object({
  results: z.array(
    z.union([
      ...ResolveDone,
      z.object({ node: z.string(), binding: z.string(), pending: pendingId }),
    ]),
  ),
});
export type ResolveBindingsView = z.infer<typeof ResolveBindingsView>;

/** What a check found for one binding. */
const CheckDone = [
  z.object({ node: z.string(), binding: z.string(), outcome: z.literal('unchanged') }),
  z.object({
    node: z.string(),
    binding: z.string(),
    outcome: z.literal('revision'),
    version: z.string().describe('The different result, recorded and waiting to be accepted'),
  }),
  z.object({
    node: z.string(),
    binding: z.string(),
    outcome: z.literal('unchecked'),
    reason: z
      .enum(['limit', 'permission', 'unresolved', 'identity'])
      .describe(
        "`limit`: past the 50 distinct runs a check makes; `permission`: the caller may not use its connection; `unresolved`: it holds nothing to compare, or has changed since it was resolved; `identity`: what it holds is another person's own view, or was fetched as another identity than the caller's run would be, so it is never compared",
      ),
  }),
  z.object({
    node: z.string(),
    binding: z.string(),
    outcome: z.literal('failed'),
    failure: BindingFailureView,
  }),
] as const;

export const CheckBindingsView = z.object({
  results: z.array(
    z.discriminatedUnion('outcome', [
      ...CheckDone,
      z.object({
        node: z.string(),
        binding: z.string(),
        outcome: z.literal('pending'),
        pending: pendingId,
      }),
    ]),
  ),
});
export type CheckBindingsView = z.infer<typeof CheckBindingsView>;

export const PendingResultParams = z.object({ id: LowercaseUuid });
export type PendingResultParams = z.infer<typeof PendingResultParams>;

/**
 * A pending result as its act's caller follows it (the D8 plan, D8-E, D8-F): waiting on its images,
 * or done, answered with what the act would have answered for its binding had it not waited.
 */
export const PendingResultView = z.object({
  id: z.string(),
  act: z
    .enum(['resolve', 'session', 'check'])
    .describe('The act that ran it: a resolve, a resolve from an editing session, or a check'),
  document: z.string(),
  node: z.string(),
  binding: z.string(),
  state: z
    .enum(['pending', 'done'])
    .describe(
      '`pending`: an image is still being admitted; `done`: recorded, or refused, as `result` says',
    ),
  // A check's first: each names its outcome, which a resolve's failure, were it matched first,
  // would drop.
  result: z
    .union([...CheckDone, ...ResolveDone])
    .nullable()
    .describe(
      "Null while pending. Done, the act's own result for the binding: for a resolve, the version it now holds or the failure; for a check, its outcome. `image_refused` names the row and column of an image that is not one the product admits",
    ),
});
export type PendingResultView = z.infer<typeof PendingResultView>;

export const AcceptBindingBody = z.strictObject({
  node: NodeBinding.shape.node,
  binding: NodeBinding.shape.binding,
  version: LowercaseUuid.describe('The waiting dataset version to hold'),
  replaces: LowercaseUuid.describe(
    'The dataset version the binding holds now, as the caller saw it',
  ),
  sharesOwnView: z
    .boolean()
    .optional()
    .describe(
      "Acknowledges that a result fetched under the caller's own identity is shown to everybody who may read the document. Without it such a result is refused `acknowledgement_required`",
    ),
});
export type AcceptBindingBody = z.infer<typeof AcceptBindingBody>;

export const ConfirmBindingBody = z
  .strictObject({
    node: NodeBinding.shape.node,
    binding: NodeBinding.shape.binding,
    replaces: LowercaseUuid.describe(
      'The dataset version the binding holds now, as the caller saw it',
    ),
    from: BindingFrom,
    session: SessionNamed,
  })
  .refine((body) => body.from !== 'session' || body.session !== undefined, {
    message: 'A binding read from a session needs the session named',
    path: ['session'],
  });
export type ConfirmBindingBody = z.infer<typeof ConfirmBindingBody>;

/** The documents holding a value for one binding of a component (B2-I). */
export const BindingHoldersView = z.object({
  documents: UsesView.describe(
    'The documents whose latest outline places the component at a node holding a value for the binding',
  ),
});
export type BindingHoldersView = z.infer<typeof BindingHoldersView>;

/** A stored result, read through a document (DAT-090): its provenance and its rows, whole. */
export const DocumentDatasetView = z.object({
  dataset: z.string(),
  version: z.string(),
  name: z.string().nullable(),
  provenance: ProvenanceView,
  result: z.object({
    columns: z
      .array(z.tuple([z.string(), z.string()]))
      .describe("Each column's name and its type's base"),
    rows: z
      .array(z.array(z.union([z.string(), z.boolean(), z.null()])))
      .describe('Every row, each value in its canonical form'),
  }),
});
export type DocumentDatasetView = z.infer<typeof DocumentDatasetView>;

/** One bound table in a document: its node, and its binding (the TB2 plan, TB2-A). */
export const BoundTableRowsParams = z.object({
  id: LowercaseUuid,
  node: z.string().min(1).max(64),
  binding: z.string().min(1).max(200),
});
export type BoundTableRowsParams = z.infer<typeof BoundTableRowsParams>;

/** Which result's rows: the version held, as the bindings view names it, read with a session. */
export const BoundTableRowsQuery = z.object({
  version: LowercaseUuid.describe(
    'The dataset version the binding holds, as the bindings view names it: any other, a waiting one among them, is refused `version_not_held`',
  ),
  session: SessionNamed.describe(
    "The caller's own editing session: where it holds the component's lock and the caller may read the binding's definition, the table is read from its latest save, as the bindings view's `session` is",
  ),
});
export type BoundTableRowsQuery = z.infer<typeof BoundTableRowsQuery>;

/** A bound table's rows, only the columns it names (TB2-A). */
export const BoundTableRowsView = z.object({
  version: z.string(),
  presorted: z
    .boolean()
    .describe(
      "True where the rows are already in the table's order and its sort columns not sent, as a reader is answered; false to the lock holder's own session, which is sent its sort columns, rows in stored order",
    ),
  result: z.object({
    columns: z
      .array(z.tuple([z.string(), z.string()]))
      .describe(
        "Each column the table shows or sorts by, by its name and its type's base, in the result's order",
      ),
    rows: z
      .array(z.array(z.union([z.string(), z.boolean(), z.null()])))
      .describe("Every row, in the result's stored order, each value in its canonical form"),
  }),
});
export type BoundTableRowsView = z.infer<typeof BoundTableRowsView>;

export const DatasetNameBody = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(400)
    .describe('1 to 200 characters, with no space before or after and no control character'),
});
export type DatasetNameBody = z.infer<typeof DatasetNameBody>;

export const DatasetNameView = z.object({
  name: z.string(),
  namedBy: z.string(),
  namedAt: z.string(),
});
export type DatasetNameView = z.infer<typeof DatasetNameView>;

/** Where a query definition is used (DAT-016): the components binding it and the documents resolving them. */
export const QueryDefinitionUsesView = z.object({
  components: UsesView.describe('The components whose latest versions hold a binding naming it'),
  documents: UsesView.describe('The documents where a binding holds a result of it'),
});
export type QueryDefinitionUsesView = z.infer<typeof QueryDefinitionUsesView>;

/**
 * A resolve or an accept refused (D3-L), naming the definition, the binding, its node and the
 * document where it has them, with the data refusal's members, and the binding's state where an
 * acceptance came from what it no longer holds.
 */
export const BindingRefusal = DataProblemsRefusal.extend({
  definition: z.string().optional(),
  binding: z.string().optional(),
  node: z.string().optional(),
  document: z.string().optional(),
  reason: z
    .enum(['untested', 'not_read_only', 'asserted', 'signed_out', 'token_revoked'])
    .optional(),
  current: BindingStateView.optional().describe(
    'resolution_precondition: the binding as it now stands',
  ),
});

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const documentNotFound = {
  description: 'No such document in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const unavailable = {
  description:
    '`connector_unavailable`: no connector is configured; `storage_unavailable`: the environment has nowhere to keep a result',
  schema: BindingRefusal,
} as const;

const documentTarget = { artifact: 'id' } as const;

export const bindingRoutes = {
  getDocumentBindings: {
    operationId: 'getDocumentBindings',
    method: 'GET',
    path: '/v1/documents/{id}/bindings',
    summary: "A document's bindings, what each holds, and any newer result waiting",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: documentTarget },
    params: DocumentBindingParams,
    query: DocumentBindingsQuery,
    responses: {
      200: { description: 'Every binding the caller may read', schema: DocumentBindingsView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may not read is not found',
        schema: ErrorBody,
      },
      404: documentNotFound,
    },
  },
  resolveBindings: {
    operationId: 'resolveBindings',
    method: 'POST',
    path: '/v1/documents/{id}/bindings/resolve',
    summary: "Run the named bindings' queries now and hold their results in this document",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: documentTarget },
    params: DocumentBindingParams,
    body: ResolveBindingsBody,
    // The source is asked after the deciding transaction commits, and the result recorded in a
    // second that decides again (D3-H): nothing could be recorded against a key.
    idempotencyKey: false,
    responses: {
      200: {
        description:
          'Each binding: the dataset version it now holds, or the failure of its run, naming the definition, the binding and the document',
        schema: ResolveBindingsView,
      },
      202: {
        description:
          'As 200, where a run holds images not yet admitted as assets: each such binding is answered with a pending result, recorded only once every image is admitted',
        schema: ResolveBindingsView,
      },
      400: {
        description:
          "`binding_missing`: no such binding in the component the node places, a definition that is not there or that the caller may not read, answered alike, or a pinned version that is not its definition's; `take_invalid`: what it takes is not the definition's; `parameter_invalid`: a value fails its parameter, or a parameter is taken from the document, which has none yet",
        schema: BindingRefusal,
      },
      401: unauthenticatedOrEnded,
      403: {
        description:
          'The caller may read the document but may not edit it, or may not use the connection a binding runs on',
        schema: BindingRefusal,
      },
      404: documentNotFound,
      409: {
        description:
          "`definition_retired`, `connection_retired`, `credential_missing`, `credential_target_changed`, `sql_not_permitted`: a run cannot be made; `identity_unavailable`: a binding's connection runs as each person and the caller's sign-in cannot name them; `acknowledgement_required`: a binding runs as the caller and `sharesOwnView` was not sent; `access_changed`: a permission or the session ended while the source answered; `binding_changed`: the binding changed while the source answered. Nothing is recorded",
        schema: BindingRefusal,
      },
      503: unavailable,
    },
  },
  checkBindings: {
    operationId: 'checkBindings',
    method: 'POST',
    path: '/v1/documents/{id}/bindings/check',
    summary: "Run a document's checked bindings again and record any different result as waiting",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: documentTarget },
    params: DocumentBindingParams,
    body: z.strictObject({}),
    idempotencyKey: false,
    responses: {
      200: {
        description:
          'Each checked binding: unchanged, a revision waiting, unchecked and why, or its failure',
        schema: CheckBindingsView,
      },
      202: {
        description:
          'As 200, where a different result holds images not yet admitted as assets: each such binding is answered with a pending result, recorded only once every image is admitted',
        schema: CheckBindingsView,
      },
      401: unauthenticatedOrEnded,
      403: {
        description: 'Never answered: a document the caller may not read is not found',
        schema: ErrorBody,
      },
      404: documentNotFound,
      409: {
        description:
          '`access_changed` or `binding_changed`: a permission, the session or a binding changed while the source answered, and nothing is recorded',
        schema: BindingRefusal,
      },
      503: unavailable,
    },
  },
  acceptBinding: {
    operationId: 'acceptBinding',
    method: 'POST',
    path: '/v1/documents/{id}/bindings/accept',
    summary: 'Hold a waiting result for one binding in this document, querying nothing',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: documentTarget },
    params: DocumentBindingParams,
    body: AcceptBindingBody,
    responses: {
      200: { description: 'The binding as it now stands', schema: BindingStateView },
      400: {
        description: '`binding_missing`: no such binding in the component the node places',
        schema: BindingRefusal,
      },
      401: unauthenticated,
      403: {
        description:
          "The caller may read the document but may not edit it, or may not use the connection the accepted result ran on; `identity_differs`: the result is another person's own view, which only they may accept. Nothing is recorded",
        schema: BindingRefusal,
      },
      404: documentNotFound,
      409: {
        description:
          "`resolution_precondition`: the binding no longer holds what `replaces` names, or the version is not a newer result of what it holds, answered with the binding as it stands; `acknowledgement_required`: the result is the caller's own view and `sharesOwnView` was not sent",
        schema: BindingRefusal,
      },
    },
  },
  confirmBinding: {
    operationId: 'confirmBinding',
    method: 'POST',
    path: '/v1/documents/{id}/bindings/confirm',
    summary: 'Keep the result a changed binding holds, where its question is unchanged',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: documentTarget },
    params: DocumentBindingParams,
    body: ConfirmBindingBody,
    responses: {
      200: { description: 'The binding as it now stands', schema: BindingStateView },
      400: {
        description:
          "`binding_missing`: no such binding in the component the node places, or in the session named, or a definition the caller may not read; `take_invalid`: what it now takes is not the held result's",
        schema: BindingRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not edit it. Nothing is recorded',
        schema: ErrorBody,
      },
      404: documentNotFound,
      409: {
        description:
          '`resolution_precondition`: the binding no longer holds what `replaces` names, answered with the binding as it stands; `confirm_not_possible`: its definition, parameters or version changed, so it must be resolved',
        schema: BindingRefusal,
      },
    },
  },
  getBindingHolders: {
    operationId: 'getBindingHolders',
    method: 'GET',
    path: '/v1/components/{id}/bindings/{binding}/holders',
    summary: 'The documents holding a value for one binding of a component',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ComponentBindingParams,
    responses: {
      200: {
        description: 'Those the caller may read, by title, and how many more',
        schema: BindingHoldersView,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a component the caller may not read is not found',
        schema: ErrorBody,
      },
      404: {
        description: 'No such component in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  getDocumentDataset: {
    operationId: 'getDocumentDataset',
    method: 'GET',
    path: '/v1/documents/{id}/datasets/{version}',
    summary: 'A stored result the document holds or has waiting, whole',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: documentTarget },
    params: DocumentDatasetParams,
    responses: {
      200: { description: 'The result and its provenance', schema: DocumentDatasetView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may not read is not found',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such document the caller may read, or a dataset version its bindings do not show the caller: one no binding they can see holds, or has waiting while that binding is unchanged',
        schema: ErrorBody,
      },
      503: {
        description: '`storage_unavailable`: the environment has nowhere results are kept',
        schema: ErrorBody,
      },
    },
  },
  getBoundTableRows: {
    operationId: 'getBoundTableRows',
    method: 'GET',
    path: '/v1/documents/{id}/bindings/{node}/{binding}/rows',
    summary: "A bound table's rows, as the document holds them, in the columns it names",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: documentTarget },
    params: BoundTableRowsParams,
    query: BoundTableRowsQuery,
    responses: {
      200: {
        description:
          "The rows of the result the bound table holds: to a reader, in the table's order and only the columns it shows; to the lock holder's own session, the columns it shows or sorts by. Sent with an `ETag`, and `Cache-Control: private, no-cache`",
        schema: BoundTableRowsView,
      },
      304: { description: '`If-None-Match` named the same rows: nothing has changed' },
      400: {
        description:
          "`binding_missing`: no such binding in the component the node places, or none the caller may read; `binding_not_table`: the binding is a value's, not a bound table's",
        schema: BindingRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may not read is not found',
        schema: ErrorBody,
      },
      404: documentNotFound,
      409: {
        description:
          '`binding_unresolved`: the document holds no result for it; `binding_stale`: the binding has changed since its result was held; `version_not_held`: the version named is not the one held, a waiting one among them; `table_too_long`: the result has more rows than a table prints',
        schema: BindingRefusal,
      },
      503: {
        description:
          '`storage_unavailable`: the environment has nowhere results are kept; `result_unreadable`: the stored result cannot be read now',
        schema: ErrorBody,
      },
    },
  },
  nameDataset: {
    operationId: 'nameDataset',
    method: 'PUT',
    path: '/v1/datasets/{id}/name',
    summary: 'Name a dataset; the latest name is its name',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: DatasetParams,
    body: DatasetNameBody,
    responses: {
      200: { description: 'Named', schema: DatasetNameView },
      400: {
        description:
          '`name_invalid`: longer than 200 characters, with a space before or after, a control character, or not in NFC',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the dataset but may not edit it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such dataset in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  getPendingResult: {
    operationId: 'getPendingResult',
    method: 'GET',
    path: '/v1/datasets/pending/{id}',
    summary: 'A result waiting on its images, finished once every image is admitted',
    tenantScoped: true,
    access: { check: 'session' },
    params: PendingResultParams,
    responses: {
      200: {
        description: "Pending, or done with the act's own result for its binding",
        schema: PendingResultView,
      },
      401: unauthenticated,
      404: {
        description:
          'No such pending result, one somebody else asked for, or one already done and recorded',
        schema: ErrorBody,
      },
      503: {
        description: '`storage_unavailable`: the environment has nowhere results are kept',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
