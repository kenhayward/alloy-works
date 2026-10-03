import { bindingNodeSchema, provenanceSchema } from '@alloy-works/domain';
import { z } from 'zod';
import { DataFailureView, DataProblemsRefusal, UsesView } from './connections.js';
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

/** A dataset version's provenance record (DAT-085): what ran, as whom, when, and the checksum. */
export const ProvenanceView = provenanceSchema;

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
  act: z.enum(['resolve', 'accept']).describe('The act that made it what the binding holds'),
  by: z.string().describe('Who resolved or accepted it'),
  at: z.string().describe('When'),
});

/** One binding of a document, what it holds, and the newer result waiting for it (D3-J). */
export const BindingStateView = z.object({
  node: z.string(),
  binding: bindingNodeSchema,
  held: HeldView.nullable().describe('What it holds, or null where it has never been resolved'),
  waiting: z
    .object({ version: z.string(), provenance: ProvenanceView })
    .nullable()
    .describe(
      'A different result a check recorded after the one held, which nothing holds until it is accepted',
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

export const ResolveBindingsBody = z.strictObject({
  bindings: z.array(NodeBinding).min(1).max(50).describe('The bindings to resolve, 1 to 50'),
});
export type ResolveBindingsBody = z.infer<typeof ResolveBindingsBody>;

export const ResolveBindingsView = z.object({
  results: z.array(
    z.union([
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
    ]),
  ),
});
export type ResolveBindingsView = z.infer<typeof ResolveBindingsView>;

export const CheckBindingsView = z.object({
  results: z.array(
    z.discriminatedUnion('outcome', [
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
          .enum(['limit', 'permission', 'unresolved'])
          .describe(
            '`limit`: past the 50 distinct runs a check makes; `permission`: the caller may not use its connection; `unresolved`: it holds nothing to compare, or has changed since it was resolved',
          ),
      }),
      z.object({
        node: z.string(),
        binding: z.string(),
        outcome: z.literal('failed'),
        failure: BindingFailureView,
      }),
    ]),
  ),
});
export type CheckBindingsView = z.infer<typeof CheckBindingsView>;

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
      "Acknowledges that a result fetched under the caller's own identity is shown to everybody who may read the document. No result is fetched so yet, so it is accepted and not needed",
    ),
});
export type AcceptBindingBody = z.infer<typeof AcceptBindingBody>;

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
  reason: z.enum(['untested', 'not_read_only']).optional(),
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
      400: {
        description:
          "`binding_missing`: no such binding in the component the node places, or a pinned version that is not its definition's; `take_invalid`: what it takes is not the definition's; `parameter_invalid`: a value fails its parameter, or a parameter is taken from the document, which has none yet",
        schema: BindingRefusal,
      },
      401: unauthenticated,
      403: {
        description:
          'The caller may read the document but may not edit it, or may not read a definition or use its connection',
        schema: BindingRefusal,
      },
      404: documentNotFound,
      409: {
        description:
          '`definition_retired`, `connection_retired`, `credential_missing`, `credential_target_changed`, `sql_not_permitted`: a run cannot be made; `access_changed`: a permission or the session ended while the source answered; `binding_changed`: the binding changed while the source answered. Nothing is recorded',
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
      401: unauthenticated,
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
        description: 'The caller may read the document but may not edit it',
        schema: ErrorBody,
      },
      404: documentNotFound,
      409: {
        description:
          '`resolution_precondition`: the binding no longer holds what `replaces` names, or the version is not a newer result of what it holds, answered with the binding as it stands',
        schema: BindingRefusal,
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
          'No such document the caller may read, or a dataset version it neither holds nor has waiting',
        schema: ErrorBody,
      },
      503: {
        description: '`storage_unavailable`: the environment has nowhere results are kept',
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
} as const satisfies Record<string, RouteContract>;
