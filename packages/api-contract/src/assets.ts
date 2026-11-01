import {
  ASSET_MAX_BYTES,
  assetAlternativeSchema,
  assetRightsSchema,
  declarableRightsSchema,
} from '@alloy-works/domain';
import { z } from 'zod';
import { SpaceParams } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/**
 * What making an upload takes: the description its uploader gave, or none (docs/design/assets.md).
 * The bytes follow in a second request, so the description never travels in a header or a query
 * string, where a log could keep it (figures 1, R1).
 */
export const CreateAssetUploadBody = z.strictObject({
  alternative: assetAlternativeSchema
    .nullable()
    .describe(
      "The image's default description for somebody who cannot see it, in a language, or null for none",
    ),
  name: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe("The name it is listed by, the file's own name where it has one"),
  rights: declarableRightsSchema
    .optional()
    .describe(
      'Where it came from and the licence it is held under (AST-021, AST-044): `declared`, with its source, a licence of this environment, the last day the grant holds and the credit it needs; or `undeclared`, which is also what giving none records',
    ),
});
export type CreateAssetUploadBody = z.infer<typeof CreateAssetUploadBody>;

export const AssetUploadParams = z.object({ id: LowercaseUuid });
export type AssetUploadParams = z.infer<typeof AssetUploadParams>;

export const AssetVersionParams = z.object({ id: LowercaseUuid });
export type AssetVersionParams = z.infer<typeof AssetVersionParams>;

/** An upload as its uploader follows it: its state, and its asset version once ready or why not. */
export const AssetUploadView = z.object({
  id: z.string(),
  space: z.string(),
  state: z
    .enum(['awaiting', 'checking', 'ready', 'refused'])
    .describe(
      '`awaiting` its bytes; `checking` them; `ready`, with its asset version; or `refused`, with why. Nothing can place an upload that is not ready',
    ),
  reason: z
    .enum([
      'not_permitted',
      'too_large',
      'too_many_pixels',
      'malformed',
      'undecodable',
      'unchecked',
    ])
    .nullable()
    .describe('Why it was refused, once refused'),
  assetVersion: z.string().nullable().describe('The asset version it made, once ready'),
});
export type AssetUploadView = z.infer<typeof AssetUploadView>;

/** An asset version's recorded properties (docs/design/assets.md, "The asset, stored"). */
export const AssetVersionView = z.object({
  id: z.string(),
  asset: z.string(),
  number: z.string(),
  format: z.enum(['png', 'jpeg']),
  bytes: z.number().int(),
  width: z.number().int().describe('In pixels, as the image is displayed'),
  height: z.number().int().describe('In pixels, as the image is displayed'),
  resolution: z.number().nullable().describe('Dots per inch the file declares, or null for none'),
  alternative: z
    .object({ text: z.string(), language: z.string() })
    .nullable()
    .describe('The default description a figure inherits, or null for none'),
  name: z.string().nullable().describe('The name it is listed by, or null for none'),
});
export type AssetVersionView = z.infer<typeof AssetVersionView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

const notFound = {
  description: 'No such thing in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;

export const AssetParams = z.object({ id: LowercaseUuid });
export type AssetParams = z.infer<typeof AssetParams>;

/** One change to an image's rights (AST-031): what they became, by whom and when. */
export const AssetRightsChange = z.object({
  rights: assetRightsSchema,
  by: z.object({ id: z.string(), name: z.string() }).describe('Who recorded it'),
  at: z.iso.datetime().describe('When'),
});

/** An image's rights now, and every change to them, newest first (the AL plan, AL-C). */
export const AssetRightsView = z.object({
  asset: z.string(),
  current: assetRightsSchema.describe(
    "`declared`, `undeclared`, or `dataset` for an image a dataset holds, the environment's own data",
  ),
  history: z.array(AssetRightsChange),
});
export type AssetRightsView = z.infer<typeof AssetRightsView>;

export const SetAssetRightsBody = z.strictObject({
  rights: declarableRightsSchema.describe(
    '`declared`, with its source and a licence of this environment, or `undeclared`',
  ),
});
export type SetAssetRightsBody = z.infer<typeof SetAssetRightsBody>;

/** Uploading an image into a space, following its check, and reading what it made. */
export const assetRoutes = {
  createAssetUpload: {
    operationId: 'createAssetUpload',
    method: 'POST',
    path: '/v1/spaces/{space}/asset-uploads',
    summary: 'Make an upload in this space, with the description its image will carry',
    tenantScoped: true,
    access: { check: 'permission', permission: 'create', target: { space: 'space' } },
    params: SpaceParams,
    body: CreateAssetUploadBody,
    responses: {
      200: { description: 'The upload, awaiting its bytes', schema: AssetUploadView },
      401: unauthenticated,
      403: { description: 'The caller may read the space but not create in it', schema: ErrorBody },
      404: notFound,
      422: {
        description:
          '`asset_licence_missing`: the licence declared is no licence of this environment',
        schema: ErrorBody,
      },
    },
  },
  putAssetUploadBytes: {
    operationId: 'putAssetUploadBytes',
    method: 'PUT',
    path: '/v1/asset-uploads/{id}/bytes',
    summary:
      "Fill an upload with its image's bytes, which are checked before anything may place it",
    tenantScoped: true,
    access: { check: 'session' },
    params: AssetUploadParams,
    rawBody: { contentType: 'application/octet-stream', maxBytes: ASSET_MAX_BYTES },
    responses: {
      200: { description: 'The upload, checking', schema: AssetUploadView },
      400: {
        description:
          '`asset_format_not_permitted`: not a PNG or a JPEG, read from its bytes; `asset_unreadable`: its structure is not what its format permits. The upload is refused',
        schema: ErrorBody,
      },
      401: unauthenticated,
      404: { description: 'No such upload, or one somebody else made', schema: ErrorBody },
      409: {
        description: '`asset_upload_filled`: the upload already has its bytes',
        schema: ErrorBody,
      },
      415: {
        description:
          '`asset_bytes_expected`: the body is not application/octet-stream. Nothing is read, and the upload still awaits its bytes',
        schema: ErrorBody,
      },
      413: {
        description:
          '`asset_too_large`: more pixels than an image may have, which refuses the upload; or more bytes, read no further, which leaves it awaiting a smaller file',
        schema: ErrorBody,
      },
    },
  },
  getAssetUpload: {
    operationId: 'getAssetUpload',
    method: 'GET',
    path: '/v1/asset-uploads/{id}',
    summary: 'An upload the caller made: its state, and its asset version once ready',
    tenantScoped: true,
    access: { check: 'session' },
    params: AssetUploadParams,
    responses: {
      200: { description: 'The upload', schema: AssetUploadView },
      401: unauthenticated,
      404: { description: 'No such upload, or one somebody else made', schema: ErrorBody },
    },
  },
  getAssetVersion: {
    operationId: 'getAssetVersion',
    method: 'GET',
    path: '/v1/asset-versions/{id}',
    summary: "An asset version's recorded properties",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifactVersion: 'id' } },
    params: AssetVersionParams,
    responses: {
      200: { description: 'The asset version', schema: AssetVersionView },
      401: unauthenticated,
      403: {
        description: 'Never answered: an asset the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  getAssetVersionContent: {
    operationId: 'getAssetVersionContent',
    method: 'GET',
    path: '/v1/asset-versions/{id}/content',
    summary: "An asset version's image, as it was uploaded",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifactVersion: 'id' } },
    params: AssetVersionParams,
    responses: {
      200: {
        description:
          'The bytes, never sniffed and never run: a version never changes, so they may be kept for a year',
        binary: { contentTypes: ['image/png', 'image/jpeg'] },
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: an asset the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  getAssetRights: {
    operationId: 'getAssetRights',
    method: 'GET',
    path: '/v1/assets/{id}/rights',
    summary: "An image's source and licence, and every change to them",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: AssetParams,
    responses: {
      200: { description: 'Its rights', schema: AssetRightsView },
      401: unauthenticated,
      403: {
        description: 'Never answered: an asset the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  setAssetRights: {
    operationId: 'setAssetRights',
    method: 'PUT',
    path: '/v1/assets/{id}/rights',
    summary: "Record an image's source and licence, as a change of its own",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: AssetParams,
    body: SetAssetRightsBody,
    responses: {
      200: { description: 'Its rights, as recorded', schema: AssetRightsView },
      401: unauthenticated,
      403: { description: 'The caller may read the image but not edit it', schema: ErrorBody },
      404: notFound,
      409: {
        description: "`asset_rights_dataset`: a dataset's image, whose rights are the dataset's",
        schema: ErrorBody,
      },
      422: {
        description: '`asset_licence_missing`: the licence named is no licence of this environment',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
