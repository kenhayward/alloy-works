import { z } from 'zod';
import { DocumentParams } from './documents.js';
import {
  PublicationRefusal,
  PublicationRequestView,
  PublishFailureView,
  RequestPublicationBody,
} from './publishing.js';
import { BindingStateView } from './bindings.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** What making a baseline takes: the version the caller is looking at, and its name (VER-046). */
export const MakeBaselineBody = z.strictObject({
  version: LowercaseUuid.describe(
    'The document version the caller is pinning, which must be the latest',
  ),
  name: z
    .string()
    .min(1)
    .max(480)
    .describe(
      'Its name: 1 to 120 characters, nothing before or after, no control character, unique in the document whatever its case. Never changed',
    ),
});
export type MakeBaselineBody = z.infer<typeof MakeBaselineBody>;

export const BaselineParams = z.object({ id: LowercaseUuid });
export type BaselineParams = z.infer<typeof BaselineParams>;

export const BaselineListQuery = z.strictObject({
  state: z
    .enum(['current', 'superseded'])
    .optional()
    .describe('Only those not superseded, or only those superseded; both when omitted'),
});
export type BaselineListQuery = z.infer<typeof BaselineListQuery>;

export const SupersedeBaselineBody = z.strictObject({
  by: LowercaseUuid.describe('A later baseline of the same document'),
});
export type SupersedeBaselineBody = z.infer<typeof SupersedeBaselineBody>;

/** What publishing a baseline takes: the formats alone, since a baseline is one version for ever. */
export const PublishBaselineBody = RequestPublicationBody.pick({ formats: true });
export type PublishBaselineBody = z.infer<typeof PublishBaselineBody>;

const Digest = z.string().regex(/^[0-9a-f]{64}$/);
const Pinned = z.object({
  version: LowercaseUuid,
  digest: Digest.describe("The version's digest"),
});

/** A baseline as a list shows it (VER-049). */
export const BaselineSummaryView = z.object({
  id: LowercaseUuid,
  document: LowercaseUuid,
  name: z.string(),
  madeBy: z.object({ id: LowercaseUuid, name: z.string().nullable() }),
  madeAt: z.iso.datetime(),
  digest: Digest.describe('SHA-256 over everything it pins (VER-043)'),
  superseded: z
    .object({
      by: LowercaseUuid.describe('The baseline that superseded it'),
      principal: LowercaseUuid.describe('Who marked it'),
      at: z.iso.datetime(),
    })
    .nullable()
    .describe('Null while it is current'),
});
export type BaselineSummaryView = z.infer<typeof BaselineSummaryView>;

export const BaselineList = z.object({ baselines: z.array(BaselineSummaryView) });
export type BaselineList = z.infer<typeof BaselineList>;

/** A baseline read whole, as the caller may read it (BL-G). */
export const BaselineView = BaselineSummaryView.extend({
  pins: z
    .object({
      document: Pinned,
      layout: Pinned,
      theme: Pinned,
      template: Pinned.nullable(),
      occurrences: z.array(Pinned.extend({ node: z.string() })),
      assets: z.array(Pinned),
      bindings: z.array(
        z.object({
          node: z.string(),
          binding: z.string(),
          digest: Digest.describe("The binding's own digest, as its result was taken under"),
          datasetVersion: LowercaseUuid,
          datasetDigest: Digest,
          revisions: z
            .array(z.object({ id: z.string(), value: z.union([z.string(), z.boolean()]) }))
            .optional()
            .describe(
              'The values revised by hand it pinned, by identifier and value, ascending; absent where none stood',
            ),
        }),
      ),
    })
    .describe(
      'Every pin the caller may read. A caller who may read all of them recomputes `digest` as SHA-256 over the canonical JSON of this object, each list sorted (`baselineDigestInput`)',
    ),
  withheld: z
    .object({
      nodes: z
        .array(z.string())
        .describe('Each occurrence whose component the caller may not read'),
      assets: z.int().nonnegative().describe('How many images the caller may not read'),
    })
    .describe('What the caller may not read, as little as says it is there'),
});
export type BaselineView = z.infer<typeof BaselineView>;

/**
 * The document as a baseline holds it, for its page (STR-047; the BL plan, BL-I): every part from the
 * pins, never the document as it is now, and as the caller may read it.
 */
export const BaselinePageView = z.object({
  baseline: BaselineSummaryView,
  state: z
    .object({ key: z.string(), name: z.string() })
    .describe(
      "The document's workflow state now (LIF-005): the one part of this page read at its latest, said as now",
    ),
  version: z
    .object({ id: LowercaseUuid, number: z.string() })
    .describe('The document version pinned'),
  outline: z
    .record(z.string(), z.unknown())
    .describe(
      "The pinned version's outline, as the caller is shown it: a reference to a component the caller may not read carries `component: null`, as the document's own outline does",
    ),
  layout: z
    .object({
      version: z.object({ id: LowercaseUuid, number: z.string() }),
      scheme: z.record(z.string(), z.unknown()).describe("The pinned layout's numbering scheme"),
      words: z.record(z.string(), z.unknown()).describe("The pinned layout's own words"),
    })
    .describe('The layout version pinned, which numbers it'),
  texts: z
    .array(
      z.object({
        node: z.string(),
        component: LowercaseUuid,
        version: z.object({ id: LowercaseUuid, number: z.string() }),
        title: z.string(),
        content: z
          .record(z.string(), z.unknown())
          .describe("The pinned version's content document"),
        mayComment: z
          .boolean()
          .describe('Whether the caller may comment on the component, as Review offers it (RR-G)'),
      }),
    )
    .describe('Each occurrence the caller may read, at its pinned version'),
  bindings: z
    .array(BindingStateView)
    .describe('What each binding of those occurrences held when the baseline was made'),
  mayComment: z.boolean().describe('Whether the caller may comment on the document'),
  mayReview: z
    .boolean()
    .describe(
      'Whether the caller may review it here: comment on the document, or on a component it pins (the RR plan, RR-G)',
    ),
});
export type BaselinePageView = z.infer<typeof BaselinePageView>;

/** A refusal of a baseline: a publish's, and the places resolving failed, each by its node. */
export const BaselineRefusal = PublicationRefusal.extend({
  places: z
    .array(PublishFailureView)
    .optional()
    .describe('baseline_unresolved: each place resolving failed, by its node'),
  nodes: z
    .array(z.string())
    .optional()
    .describe('baseline_unreadable: each occurrence the caller may not read, by its node'),
  assets: z
    .int()
    .nonnegative()
    .optional()
    .describe('baseline_unreadable: how many images the caller may not read'),
});
export type BaselineRefusal = z.infer<typeof BaselineRefusal>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/** Baselines (docs/design/baselines.md; the BL plan, Task 1). */
export const baselineRoutes = {
  makeBaseline: {
    operationId: 'makeBaseline',
    method: 'POST',
    path: '/v1/documents/{id}/baselines',
    summary: 'Pin the latest version of this document, and everything it uses, under a name',
    tenantScoped: true,
    access: { check: 'permission', permission: 'publish', target: { artifact: 'id' } },
    params: DocumentParams,
    body: MakeBaselineBody,
    responses: {
      200: { description: 'Made', schema: BaselineSummaryView },
      400: {
        description:
          "`name_invalid`: the name cannot be stored; `baseline_unresolved`: a place does not resolve as the caller reads it, each in `places`; and a publish's refusals: `layout_language`, `section_required`, `metadata_invalid`, `values_unresolved`, `binding_unresolved`",
        schema: BaselineRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not publish it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: {
        description:
          '`version_precondition`: the document has a newer version, which `current` names; `name_taken`: another baseline of this document has this name',
        schema: BaselineRefusal,
      },
    },
  },
  listBaselines: {
    operationId: 'listBaselines',
    method: 'GET',
    path: '/v1/documents/{id}/baselines',
    summary: "This document's baselines, newest first",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    query: BaselineListQuery,
    responses: {
      200: { description: 'Every one in the state asked for', schema: BaselineList },
      401: unauthenticated,
      403: {
        description: 'Never answered: a reader of the document reads its baselines',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  getBaseline: {
    operationId: 'getBaseline',
    method: 'GET',
    path: '/v1/baselines/{id}',
    summary: 'A baseline and what it pins, as the caller may read it',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { baseline: 'id' } },
    params: BaselineParams,
    responses: {
      200: { description: 'The baseline', schema: BaselineView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a reader of the document reads its baselines',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such baseline in this environment, or one of a document the caller may not read',
        schema: ErrorBody,
      },
    },
  },
  getBaselineView: {
    operationId: 'getBaselineView',
    method: 'GET',
    path: '/v1/baselines/{id}/view',
    summary: 'The document as a baseline holds it, to read',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { baseline: 'id' } },
    params: BaselineParams,
    responses: {
      200: {
        description: 'The pinned document, as the caller may read it',
        schema: BaselinePageView,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a reader of the document reads its baselines',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such baseline in this environment, or one of a document the caller may not read',
        schema: ErrorBody,
      },
    },
  },
  publishBaseline: {
    operationId: 'publishBaseline',
    method: 'POST',
    path: '/v1/baselines/{id}/publications',
    summary: 'Publish a baseline, from what it pins, as it was when it was made',
    tenantScoped: true,
    access: { check: 'permission', permission: 'publish', target: { baseline: 'id' } },
    params: BaselineParams,
    body: PublishBaselineBody,
    responses: {
      // 200, not 202, as a publish's: a permission-checked handler cannot set a status.
      200: {
        description: 'Asked for, and queued; follow the request for its outcome',
        schema: PublicationRequestView,
      },
      400: {
        description:
          "`format_unsupported`: a format the baseline's layout does not make; `page_reference_without_pdf`: it cites a page and the PDF was not asked for; `baseline_unreadable`: the caller may not read something it pins, each occurrence in `nodes` and the images counted in `assets`",
        schema: BaselineRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not publish it',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such baseline in this environment, or one of a document the caller may not read',
        schema: ErrorBody,
      },
    },
  },
  supersedeBaseline: {
    operationId: 'supersedeBaseline',
    method: 'POST',
    path: '/v1/baselines/{id}/supersession',
    summary: 'Mark a baseline superseded by a later one of its document',
    tenantScoped: true,
    access: { check: 'permission', permission: 'publish', target: { baseline: 'id' } },
    params: BaselineParams,
    body: SupersedeBaselineBody,
    responses: {
      200: {
        description: 'Superseded: still read, listed and published as before',
        schema: BaselineSummaryView,
      },
      400: {
        description: '`superseder_invalid`: `by` is not a later baseline of the same document',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not publish it',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such baseline in this environment, or one of a document the caller may not read',
        schema: ErrorBody,
      },
      409: { description: '`superseded_already`: it is superseded already', schema: ErrorBody },
    },
  },
} as const;
