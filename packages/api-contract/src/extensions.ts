import { extensionManifestSchema, httpsUrl } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { nextCursor, pageQuery } from './listing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/**
 * Extensions (extensions.md; the EX plan, EX-B to EX-E; ADR-0066): a manifest at a URL and the
 * service it names, installed by whoever administers the environment, with a session alone, after
 * reading what it declares.
 */
export const ExtensionParams = z.object({ id: LowercaseUuid.describe('The extension') });
export type ExtensionParams = z.infer<typeof ExtensionParams>;

const Digest = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe('SHA-256 of the manifest’s canonical JSON, as its preview gave it');

// Held as the connector holds it, so a URL it would refuse is the caller's 400, never a 503.
const manifestUrl = httpsUrl.describe(
  'Where its manifest is: HTTPS, at most 2,000 characters, with no user, password, query or fragment',
);

export const ExtensionManifestView = extensionManifestSchema.describe(
  'What the extension says it is, takes and does, and where it sends data: its own words',
);

export const ExtensionPreview = z.object({
  url: z.string(),
  digest: Digest,
  manifest: ExtensionManifestView,
  changes: z
    .array(z.enum(['endpoint', 'settings', 'authentication', 'capabilities', 'outbound', 'about']))
    .optional()
    .describe(
      'Against the manifest it has now, where it is installed: what an update would change',
    ),
});
export type ExtensionPreview = z.infer<typeof ExtensionPreview>;

export const ExtensionView = z.object({
  id: z.string(),
  url: z.string(),
  digest: Digest,
  manifest: ExtensionManifestView,
  installedBy: z.string().nullable(),
  installedAt: z.string(),
  updatedAt: z.string(),
  removedAt: z.string().nullable().describe('When it was removed; kept, so what used it names it'),
});
export type ExtensionView = z.infer<typeof ExtensionView>;

export const ExtensionListQuery = z.object(pageQuery);
export type ExtensionListQuery = z.infer<typeof ExtensionListQuery>;

export const ExtensionList = z.object({ items: z.array(ExtensionView), next: nextCursor });
export type ExtensionList = z.infer<typeof ExtensionList>;

export const PreviewExtensionBody = z.strictObject({ url: manifestUrl });
export type PreviewExtensionBody = z.infer<typeof PreviewExtensionBody>;

export const InstallExtensionBody = z.strictObject({ url: manifestUrl, digest: Digest });
export type InstallExtensionBody = z.infer<typeof InstallExtensionBody>;

export const UpdateExtensionBody = z.strictObject({ digest: Digest });
export type UpdateExtensionBody = z.infer<typeof UpdateExtensionBody>;

export const ExtensionUseView = z.object({
  connection: z.string(),
  name: z.string(),
  digest: Digest.describe('The manifest the connection was saved against'),
  retired: z.boolean(),
});

export const ExtensionUses = z.object({ items: z.array(ExtensionUseView) });
export type ExtensionUses = z.infer<typeof ExtensionUses>;

export const ExtensionRemoved = z.object({ removed: z.string() });
export type ExtensionRemoved = z.infer<typeof ExtensionRemoved>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notAdministering = {
  description:
    'forbidden: the caller may not administer this environment; or token_not_allowed: extensions are managed with a signed-in session, never a token',
  schema: ErrorBody,
} as const;
const missing = {
  description: 'No such extension in this environment',
  schema: ErrorBody,
} as const;
const unread = {
  description:
    'manifest_invalid: what the URL answered is not a manifest, naming where it failed and never what it said; manifest_unavailable: the URL could not be read, by the connector’s code',
  schema: ErrorBody,
} as const;
const ADMINISTER = {
  check: 'permission',
  permission: 'administer',
  target: { tenant: true },
  credential: 'session',
} as const;

export const extensionRoutes = {
  listExtensions: {
    operationId: 'listExtensions',
    method: 'GET',
    path: '/v1/extensions',
    summary: 'The extensions installed, removed ones too, a page at a time',
    tenantScoped: true,
    access: ADMINISTER,
    query: ExtensionListQuery,
    responses: {
      200: { description: 'A page of extensions', schema: ExtensionList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: notAdministering,
    },
  },
  previewExtension: {
    operationId: 'previewExtension',
    method: 'POST',
    path: '/v1/extensions/preview',
    summary: 'Read an extension’s manifest by its URL, before installing it',
    tenantScoped: true,
    access: ADMINISTER,
    body: PreviewExtensionBody,
    responses: {
      200: {
        description: 'Its manifest, and the digest installing it names',
        schema: ExtensionPreview,
      },
      400: { description: 'invalid_request', schema: ErrorBody },
      401: unauthenticated,
      403: notAdministering,
      422: unread,
    },
  },
  installExtension: {
    operationId: 'installExtension',
    method: 'POST',
    path: '/v1/extensions',
    summary: 'Install an extension at the manifest its preview showed',
    tenantScoped: true,
    access: ADMINISTER,
    body: InstallExtensionBody,
    responses: {
      200: { description: 'Installed', schema: ExtensionView },
      400: { description: 'invalid_request', schema: ErrorBody },
      401: unauthenticated,
      403: notAdministering,
      409: {
        description: 'manifest_changed: the manifest is no longer the one its preview showed',
        schema: ErrorBody,
      },
      422: unread,
    },
  },
  getExtension: {
    operationId: 'getExtension',
    method: 'GET',
    path: '/v1/extensions/{id}',
    summary: 'An extension and the manifest it has now',
    tenantScoped: true,
    access: ADMINISTER,
    params: ExtensionParams,
    responses: {
      200: { description: 'The extension', schema: ExtensionView },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
    },
  },
  previewExtensionUpdate: {
    operationId: 'previewExtensionUpdate',
    method: 'POST',
    path: '/v1/extensions/{id}/preview',
    summary: 'Read an extension’s manifest again, saying what an update would change',
    tenantScoped: true,
    access: ADMINISTER,
    params: ExtensionParams,
    responses: {
      200: { description: 'Its manifest now, and what changed', schema: ExtensionPreview },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
      409: { description: 'extension_removed: it is removed', schema: ErrorBody },
      422: unread,
    },
  },
  updateExtension: {
    operationId: 'updateExtension',
    method: 'POST',
    path: '/v1/extensions/{id}/update',
    summary: 'Move an extension to the manifest its update preview showed',
    tenantScoped: true,
    access: ADMINISTER,
    params: ExtensionParams,
    body: UpdateExtensionBody,
    responses: {
      200: { description: 'Updated', schema: ExtensionView },
      400: { description: 'invalid_request', schema: ErrorBody },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
      409: {
        description:
          'manifest_changed: the manifest is no longer the one its preview showed; extension_removed',
        schema: ErrorBody,
      },
      422: unread,
    },
  },
  listExtensionUses: {
    operationId: 'listExtensionUses',
    method: 'GET',
    path: '/v1/extensions/{id}/uses',
    summary: 'The connections using an extension, retired ones too',
    tenantScoped: true,
    access: ADMINISTER,
    params: ExtensionParams,
    responses: {
      200: { description: 'Its uses', schema: ExtensionUses },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
    },
  },
  removeExtension: {
    operationId: 'removeExtension',
    method: 'DELETE',
    path: '/v1/extensions/{id}',
    summary: 'Remove an extension no connection uses but a retired one',
    tenantScoped: true,
    access: ADMINISTER,
    params: ExtensionParams,
    responses: {
      200: { description: 'Removed', schema: ExtensionRemoved },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
      409: {
        description: 'extension_in_use: a connection not retired uses it; its uses list them',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
