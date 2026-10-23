import { contentDocumentSchema, storedProfileSchema } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { PublicationRefusal } from './publishing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/**
 * **The warm range preview** (CNT-186, PUB-080; publishing.md, "The warm range preview"; the R22 plan):
 * the occurrence being edited and a page either side, drawn as PNG images from its author's saved
 * edits, refreshed after each save. Untagged by design (PUB-061): every page says so, and names the
 * tagged PDF a preview makes.
 */

export const RangePreviewParams = z.object({ id: LowercaseUuid, range: LowercaseUuid });
export type RangePreviewParams = z.infer<typeof RangePreviewParams>;

export const RangePageParams = z.object({
  id: LowercaseUuid,
  range: LowercaseUuid,
  page: z.string().regex(/^[1-9][0-9]{0,5}$/, 'Expected a page number'),
});
export type RangePageParams = z.infer<typeof RangePageParams>;

export const RequestRangePreviewBody = z.strictObject({
  version: LowercaseUuid.describe('The document version being edited, which must be the latest'),
  node: z.string().min(1).max(64).describe('The occurrence being edited, by its outline node'),
  session: LowercaseUuid.describe('The editing session whose saves the range shows'),
  profile: storedProfileSchema
    .optional()
    .describe("The profile to preview under in place of the document's own (REU-025)"),
  language: contentDocumentSchema.shape.language
    .optional()
    .describe(
      "The language to make it in (the TR plan, TRb): each component reads its translation into it, falling back to its own language, marked, or refusing, as the document's or the environment's policy says. Absent, the document's own",
    ),
});
export type RequestRangePreviewBody = z.infer<typeof RequestRangePreviewBody>;

export const RangePreviewView = z.object({
  id: z.string(),
  state: z
    .enum(['waiting', 'ready', 'failed'])
    .describe(
      'waiting until the latest refresh asked for is drawn; ready once it is; failed where it could not be',
    ),
  node: z.string(),
  sequence: z
    .number()
    .int()
    .nullable()
    .describe("The editing session's save the pages show, or null where they show the version"),
  pages: z
    .number()
    .int()
    .nullable()
    .describe('How many pages the document had when the range was made'),
  images: z
    .array(
      z.object({
        page: z.number().int(),
        alternative: z
          .string()
          .describe(
            'Says the page is an untagged preview, and names the tagged PDF as the accessible way to read it',
          ),
      }),
    )
    .describe('The pages drawn, in order: the occurrence and one either side'),
  untagged: z
    .string()
    .describe(
      'What the pane says on screen: these pages are untagged, and the tagged PDF is the accessible path',
    ),
  failure: z.string().nullable(),
});
export type RangePreviewView = z.infer<typeof RangePreviewView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const READ = { check: 'permission', permission: 'read', target: { artifact: 'id' } } as const;
const missing = {
  description: 'No such range preview of a document the caller may read, or not theirs',
  schema: ErrorBody,
} as const;

export const rangePreviewRoutes = {
  requestRangePreview: {
    operationId: 'requestRangePreview',
    method: 'POST',
    path: '/v1/documents/{id}/range-previews',
    summary: 'Preview the pages of the occurrence being edited, refreshed after each save',
    tenantScoped: true,
    access: READ,
    params: z.object({ id: LowercaseUuid }),
    body: RequestRangePreviewBody,
    idempotencyKey: false,
    responses: {
      200: { description: 'Asked for: its pages are drawn by a job', schema: RangePreviewView },
      400: {
        description:
          "`node_missing`: the version places no component at that node; otherwise as a preview's refusals",
        schema: PublicationRefusal,
      },
      401: unauthenticated,
      403: { description: 'Never answered: a reader may preview', schema: ErrorBody },
      404: { description: 'No such document the caller may read', schema: ErrorBody },
      409: {
        description: '`version_precondition`: the document has a newer version than the one named',
        schema: PublicationRefusal,
      },
    },
  },
  getRangePreview: {
    operationId: 'getRangePreview',
    method: 'GET',
    path: '/v1/documents/{id}/range-previews/{range}',
    summary: 'A range preview: whether its latest refresh is drawn, and its pages',
    tenantScoped: true,
    access: READ,
    params: RangePreviewParams,
    responses: {
      200: { description: 'The range preview', schema: RangePreviewView },
      401: unauthenticated,
      403: { description: 'Never answered', schema: ErrorBody },
      404: missing,
    },
  },
  refreshRangePreview: {
    operationId: 'refreshRangePreview',
    method: 'POST',
    path: '/v1/documents/{id}/range-previews/{range}/refresh',
    summary: 'Draw the range again from the latest save its session recorded',
    tenantScoped: true,
    access: READ,
    params: RangePreviewParams,
    idempotencyKey: false,
    responses: {
      200: {
        description: 'Asked for: the pages are drawn again by a job',
        schema: RangePreviewView,
      },
      401: unauthenticated,
      403: { description: 'Never answered', schema: ErrorBody },
      404: missing,
    },
  },
  getRangePage: {
    operationId: 'getRangePage',
    method: 'GET',
    path: '/v1/documents/{id}/range-previews/{range}/pages/{page}',
    summary: 'One page of a range preview, as PNG',
    tenantScoped: true,
    access: READ,
    params: RangePageParams,
    responses: {
      200: {
        description: 'The page as the warm compile drew it: an image, untagged by design',
        binary: { contentTypes: ['image/png'] },
      },
      401: unauthenticated,
      403: { description: 'Never answered', schema: ErrorBody },
      404: { description: 'No such page of a range preview of the caller', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
