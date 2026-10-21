import { createHash, randomUUID } from 'node:crypto';
import type {
  ExtensionList,
  ExtensionListQuery,
  ExtensionParams,
  ExtensionPreview,
  ExtensionRemoved,
  ExtensionUses,
  ExtensionView,
  InstallExtensionBody,
  PreviewExtensionBody,
  UpdateExtensionBody,
} from '@alloy-works/api-contract';
import {
  extensionUses,
  installedExtension,
  installExtension,
  listExtensions,
  removeExtension,
  updateExtension,
  type InstalledExtension,
  type Tenant,
} from '@alloy-works/db';
import {
  canonicalJsonText,
  manifestDigestInput,
  readManifest,
  type ExtensionManifest,
  type JsonValue,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import { createConnectorClient } from './data/connector.js';
import type { ConnectorOptions } from './data/connections.js';
import { AppError } from './errors.js';

function view(extension: InstalledExtension): ExtensionView {
  return {
    id: extension.id,
    url: extension.url,
    digest: extension.digest,
    manifest: extension.manifest,
    installedBy: extension.installedBy,
    installedAt: extension.installedAt.toISOString(),
    updatedAt: extension.updatedAt.toISOString(),
    removedAt: extension.removedAt && extension.removedAt.toISOString(),
  };
}

const digestOf = (manifest: ExtensionManifest) =>
  createHash('sha256').update(manifestDigestInput(manifest), 'utf8').digest('hex');

/** What an update from `was` to `now` changes, by part (EX-C). */
function changesBetween(
  was: ExtensionManifest,
  now: ExtensionManifest,
): NonNullable<ExtensionPreview['changes']> {
  // Canonically: a manifest kept in jsonb comes back in jsonb's own key order.
  const same = (one: unknown, other: unknown) =>
    canonicalJsonText(one as JsonValue) === canonicalJsonText(other as JsonValue);
  return [
    ...(was.endpoint === now.endpoint ? [] : (['endpoint'] as const)),
    ...(same(was.settings, now.settings) ? [] : (['settings'] as const)),
    ...(same(was.authentication, now.authentication) ? [] : (['authentication'] as const)),
    ...(same(was.capabilities, now.capabilities) ? [] : (['capabilities'] as const)),
    ...(same(was.outbound, now.outbound) ? [] : (['outbound'] as const)),
    ...(same(
      [was.name, was.version, was.publisher, was.description],
      [now.name, now.version, now.publisher, now.description],
    )
      ? []
      : (['about'] as const)),
  ];
}

/**
 * Extensions (extensions.md; the EX plan, EX-B to EX-E): each run in the transaction `administer` at
 * the tenant was decided in, with a session alone. A manifest is fetched by the connector, the service
 * reaching nothing outside (ADR-0064), and read strictly here.
 */
export function extensionHandlers(
  tenantOf: (request: FastifyRequest) => Tenant,
  connector?: ConnectorOptions,
) {
  const client = connector ? createConnectorClient(connector) : undefined;

  /** The manifest at a URL, read, with its digest; or the refusal saying why not. */
  async function fetched(request: FastifyRequest, url: string) {
    if (!client) {
      throw new AppError(503, 'connector_unavailable', 'The connector cannot be reached.');
    }
    const answer = await client.manifest({
      requestId: randomUUID(),
      tenant: tenantOf(request).id,
      url,
    });
    if ('refused' in answer) {
      throw new AppError(503, answer.refused.code, 'The connector cannot fetch the manifest now.');
    }
    if (answer.answer.type === 'failed') {
      throw new AppError(
        422,
        'manifest_unavailable',
        `The manifest could not be read: ${answer.answer.code}.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(answer.answer.body);
    } catch {
      throw new AppError(422, 'manifest_invalid', 'What the URL answered is not JSON.');
    }
    const read = readManifest(parsed);
    if (!read.ok) {
      // Where it failed, never what it said: it is whatever the named host answered.
      throw new AppError(
        422,
        'manifest_invalid',
        `What the URL answered is not a manifest, at: ${read.paths.join(', ')}.`,
      );
    }
    return { manifest: read.manifest, digest: digestOf(read.manifest) };
  }

  async function held(trx: Authorised['trx'], id: string) {
    const extension = await installedExtension(trx, id);
    if (!extension) throw notFound();
    return extension;
  }

  return {
    listExtensions: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ExtensionList> => {
      const query = request.query as ExtensionListQuery;
      const after = afterCursor(query.cursor);
      const page = await listExtensions(trx, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      return { items: page.items.map(view), next: cursorAfter(page.after) };
    },

    previewExtension: async (request: FastifyRequest): Promise<ExtensionPreview> => {
      const { url } = request.body as PreviewExtensionBody;
      return { url, ...(await fetched(request, url)) };
    },

    installExtension: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ExtensionView> => {
      const { url, digest } = request.body as InstallExtensionBody;
      const now = await fetched(request, url);
      if (now.digest !== digest) {
        throw new AppError(
          409,
          'manifest_changed',
          'The manifest is no longer the one its preview showed: preview it again.',
        );
      }
      return view(
        await installExtension(trx, { url, digest, manifest: now.manifest, by: principalId }),
      );
    },

    getExtension: async (request: FastifyRequest, { trx }: Authorised): Promise<ExtensionView> => {
      const { id } = request.params as ExtensionParams;
      return view(await held(trx, id));
    },

    previewExtensionUpdate: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ExtensionPreview> => {
      const { id } = request.params as ExtensionParams;
      const extension = await held(trx, id);
      if (extension.removedAt !== null) {
        throw new AppError(409, 'extension_removed', 'This extension is removed.');
      }
      const now = await fetched(request, extension.url);
      return {
        url: extension.url,
        ...now,
        changes: changesBetween(extension.manifest, now.manifest),
      };
    },

    updateExtension: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ExtensionView> => {
      const { id } = request.params as ExtensionParams;
      const { digest } = request.body as UpdateExtensionBody;
      const extension = await held(trx, id);
      if (extension.removedAt !== null) {
        throw new AppError(409, 'extension_removed', 'This extension is removed.');
      }
      const now = await fetched(request, extension.url);
      if (now.digest !== digest) {
        throw new AppError(
          409,
          'manifest_changed',
          'The manifest is no longer the one its preview showed: preview it again.',
        );
      }
      return view(
        await updateExtension(trx, id, { digest, manifest: now.manifest, by: principalId }),
      );
    },

    listExtensionUses: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ExtensionUses> => {
      const { id } = request.params as ExtensionParams;
      await held(trx, id);
      return { items: [...(await extensionUses(trx, id))] };
    },

    removeExtension: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ExtensionRemoved> => {
      const { id } = request.params as ExtensionParams;
      await held(trx, id);
      const answer = await removeExtension(trx, id, principalId);
      if ('inUse' in answer) {
        throw new AppError(
          409,
          'extension_in_use',
          `${answer.inUse.length} connection(s) not retired use it: retire them first.`,
        );
      }
      return { removed: id };
    },
  };
}
