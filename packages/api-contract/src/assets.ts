import { ASSET_MAX_BYTES, assetAlternativeSchema } from '@alloy-works/domain';
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
} as const satisfies Record<string, RouteContract>;
