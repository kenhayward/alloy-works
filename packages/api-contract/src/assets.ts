import {
  ASSET_MAX_BYTES,
  DERIVATIVE_KINDS,
  LICENCE_USES,
  assetAlternativeSchema,
  assetNameSchema,
  assetRightsSchema,
  declarableRightsSchema,
} from '@alloy-works/domain';
import { z } from 'zod';
import { SpaceParams } from './components.js';
import type { RouteContract } from './contract.js';
import { listingQuery, listingTotal, nextCursor } from './listing.js';
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
  name: assetNameSchema
    .optional()
    .describe("The name it is listed by, the file's own name where it has one"),
  rights: declarableRightsSchema
    .optional()
    .describe(
      'Where it came from and the licence it is held under (AST-021, AST-044): `declared`, with its source, a licence of this environment, the last day the grant holds and the credit it needs; or `undeclared`, which is also what giving none records',
    ),
});
export type CreateAssetUploadBody = z.infer<typeof CreateAssetUploadBody>;

/**
 * What replacing an image takes (AST-016; the AL plan, AL-M): the description and the name its next
 * version carries, each the version it replaces' where not given. Its rights are the image's already.
 */
export const CreateAssetReplacementBody = z.strictObject({
  alternative: assetAlternativeSchema
    .nullable()
    .optional()
    .describe("The next version's default description, null for none, or the latest's where absent"),
  name: assetNameSchema.optional().describe("The name it is listed by, or the latest's where absent"),
});
export type CreateAssetReplacementBody = z.infer<typeof CreateAssetReplacementBody>;

export const AssetUploadParams = z.object({ id: LowercaseUuid });
export type AssetUploadParams = z.infer<typeof AssetUploadParams>;

export const AssetVersionParams = z.object({ id: LowercaseUuid });

/** Reading a version's image, or its asset's latest's, as a figure following it shows (AL-M). */
export const AssetContentQuery = z.object({
  follow: z
    .literal('latest')
    .optional()
    .describe(
      "`latest`: the image of this version's asset's latest version instead, never kept, as a figure following its image shows it",
    ),
});
export type AssetContentQuery = z.infer<typeof AssetContentQuery>;
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

/** A version and one of its derivatives (AL-H). */
export const AssetDerivativeParams = z.object({
  id: LowercaseUuid,
  kind: z
    .enum(DERIVATIVE_KINDS)
    .describe('`thumbnail`, 256 px on its long side, or `preview`, 1,024'),
});
export type AssetDerivativeParams = z.infer<typeof AssetDerivativeParams>;

/** What discarding a space's derivatives did (AST-048). */
export const AssetDerivativesDiscarded = z.object({
  discarded: z.number().int().nonnegative().describe('How many derivatives were discarded'),
});
export type AssetDerivativesDiscarded = z.infer<typeof AssetDerivativesDiscarded>;

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
  licence: z
    .object({ id: z.string(), name: z.string(), permits: z.array(z.enum(LICENCE_USES)) })
    .nullable()
    .describe(
      'The licence its rights declare, at its latest version: its name and what it permits now (AST-032); null where none is declared',
    ),
  expired: z.boolean().describe('Whether the grant it is held under has lapsed (AST-052)'),
  changedAt: z.iso
    .datetime()
    .describe('When its rights or its licence last changed, whichever is later (AST-032)'),
});
export type AssetRightsView = z.infer<typeof AssetRightsView>;

/** An image as a space's library lists it (AST-028): its latest version, and its rights now. */
export const LibraryAssetView = z.object({
  id: z.string(),
  version: z.object({ id: z.string(), number: z.string() }).describe('Its latest version'),
  name: z.string().nullable().describe('The name it is listed by, or null for none'),
  alternative: z
    .object({ text: z.string(), language: z.string() })
    .nullable()
    .describe('The default description a figure inherits, or null for none'),
  format: z.enum(['png', 'jpeg']),
  width: z.number().int().describe('In pixels, as the image is displayed'),
  height: z.number().int().describe('In pixels, as the image is displayed'),
  rights: assetRightsSchema,
  licence: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe('The licence its rights declare, by its name now; null where none is declared'),
  expired: z.boolean().describe("Whether its licence's last day has passed"),
  used: z
    .boolean()
    .describe('Whether a component, a baseline or a publication holds it (AST-018, AST-050)'),
  changedAt: z.string().describe('When its latest version was made'),
});
export type LibraryAssetView = z.infer<typeof LibraryAssetView>;

export const LibraryAssetList = z.object({
  items: z.array(LibraryAssetView),
  next: nextCursor,
  total: listingTotal,
});
export type LibraryAssetList = z.infer<typeof LibraryAssetList>;

export const LibraryAssetQuery = z.object({
  ...listingQuery(['name', 'changed'], 'name'),
  q: z
    .string()
    .max(200)
    .optional()
    .describe('Words in its name, description, format, licence or source, case aside'),
  format: z.enum(['png', 'jpeg']).optional(),
  licence: LowercaseUuid.optional().describe('Only those its rights declare under this licence'),
  rights: z
    .enum(['undeclared', 'expired'])
    .optional()
    .describe('Only those with no rights declared, or whose licence has expired'),
  orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
  unused: z.enum(['true']).optional().describe('Only those nothing uses (AST-050)'),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'Expected 64 lowercase hexadecimal digits')
    .optional()
    .describe("Only those whose bytes have this SHA-256: an upload's duplicate (AST-029)"),
});
export type LibraryAssetQuery = z.infer<typeof LibraryAssetQuery>;

const NamedUses = <T extends z.ZodRawShape>(shape: T, what: string) =>
  z.object({
    named: z.array(z.object(shape)),
    unreadable: z.boolean().describe(`Whether ${what} the caller may not read holds it too`),
  });

/** Where an image is used (AST-018): named where the caller may read, else only flagged. */
export const AssetUsesView = z.object({
  components: NamedUses({ id: z.string(), title: z.string() }, 'a component'),
  documents: NamedUses({ id: z.string(), title: z.string() }, 'a document'),
  baselines: NamedUses({ id: z.string(), name: z.string(), document: z.string() }, 'a baseline'),
  publications: NamedUses({ id: z.string(), title: z.string() }, 'a publication'),
});
export type AssetUsesView = z.infer<typeof AssetUsesView>;

export const SetAssetRightsBody = z.strictObject({
  rights: declarableRightsSchema.describe(
    '`declared`, with its source and a licence of this environment, or `undeclared`',
  ),
});
export type SetAssetRightsBody = z.infer<typeof SetAssetRightsBody>;

/** Uploading an image into a space, following its check, and reading what it made. */
export const assetRoutes = {
  listSpaceAssets: {
    operationId: 'listSpaceAssets',
    method: 'GET',
    path: '/v1/spaces/{space}/assets',
    summary: "The space's images the caller may read, searched and filtered",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { space: 'space' } },
    params: SpaceParams,
    query: LibraryAssetQuery,
    responses: {
      200: { description: 'A page of images', schema: LibraryAssetList },
      400: {
        description:
          'A cursor this listing did not give out, a limit outside 1 to 100, or a bad filter',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a space the caller may not read is not found',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  getAssetUses: {
    operationId: 'getAssetUses',
    method: 'GET',
    path: '/v1/assets/{id}/uses',
    summary: 'Where an image is used: components, documents, baselines and publications',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: AssetParams,
    responses: {
      200: { description: 'Where it is used', schema: AssetUsesView },
      401: unauthenticated,
      403: {
        description: 'Never answered: an asset the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
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
  createAssetReplacement: {
    operationId: 'createAssetReplacement',
    method: 'POST',
    path: '/v1/assets/{id}/replacements',
    summary: "Make an upload replacing an image: its check cuts the image's next version",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: AssetParams,
    body: CreateAssetReplacementBody,
    responses: {
      200: {
        description: 'The upload, awaiting its bytes, which go to `putAssetUploadBytes`',
        schema: AssetUploadView,
      },
      401: unauthenticated,
      403: { description: 'The caller may read the image but not edit it', schema: ErrorBody },
      404: notFound,
      409: {
        description: "`asset_replace_dataset`: a dataset's image, which its dataset replaces",
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
    query: AssetContentQuery,
    responses: {
      200: {
        description:
          'The bytes, never sniffed and never run: a version never changes, so they may be kept for a year; the latest, asked for, is never kept',
        binary: { contentTypes: ['image/png', 'image/jpeg'] },
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: an asset the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: notFound,
      502: {
        description:
          '`asset_corrupt`: the stored bytes do not match the hash the version records (AST-042), so none are sent',
        schema: ErrorBody,
      },
    },
  },
  getAssetVersionDerivative: {
    operationId: 'getAssetVersionDerivative',
    method: 'GET',
    path: '/v1/asset-versions/{id}/derivatives/{kind}',
    summary: "An asset version's thumbnail or preview",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifactVersion: 'id' } },
    params: AssetDerivativeParams,
    responses: {
      200: {
        description:
          'The derivative, WebP, turned upright and stripped of metadata, kept for a year; or, until it is made, the original image, never kept, while it is made',
        binary: { contentTypes: ['image/webp', 'image/png', 'image/jpeg'] },
      },
      400: { description: 'No such kind of derivative', schema: ErrorBody },
      401: unauthenticated,
      403: {
        description: 'Never answered: an asset the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: notFound,
      502: {
        description:
          '`asset_corrupt`: the stored bytes do not match the hash they are kept under (AST-042), so none are sent',
        schema: ErrorBody,
      },
    },
  },
  discardAssetDerivatives: {
    operationId: 'discardAssetDerivatives',
    method: 'DELETE',
    path: '/v1/spaces/{space}/asset-derivatives',
    summary: "Discard a space's image thumbnails and previews, to be made again",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { space: 'space' } },
    params: SpaceParams,
    responses: {
      200: { description: 'How many were discarded', schema: AssetDerivativesDiscarded },
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
