import type {
  AcceptImportBody,
  CreateImportBody,
  ImportAccepted,
  ImportLevelsBody,
  ImportList,
  ImportListQuery,
  ImportParams,
  ImportSummary,
  ImportView,
  SpaceParams,
} from '@alloy-works/api-contract';
import { IMPORT_MAX_BYTES } from '@alloy-works/api-contract';
import { createHash } from 'node:crypto';
import {
  IMPORT_KEPT_DAYS,
  abandonImport,
  acceptImport,
  changeImportLevels,
  createImport,
  holdObject,
  importParts,
  listImports,
  loadFacts,
  readImport,
  receiveImportFile,
  type StoredImport,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { importLevelsSchema } from '@alloy-works/domain';
import { checkImportFile } from '@alloy-works/readers/import';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { administerOrAbove, authoriseAt, callerOf, notFound, type Authorised } from './access.js';
import { contextOf } from './audit.js';
import { cursorFor, pageAsked } from './listing.js';
import { AppError, storageUnavailable } from './errors.js';

/** The name each kind of file ends with (IM-B), checked before its bytes are. */
const ENDINGS: Readonly<Record<CreateImportBody['fileType'], RegExp>> = {
  docx: /\.docx$/i,
  markdown: /\.(md|markdown)$/i,
  html: /\.html?$/i,
};

const notPermitted = () =>
  new AppError(
    400,
    'import_file_not_permitted',
    'Only a Word document (.docx), Markdown (.md) or HTML (.html) file can be imported.',
  );
const notProposed = () =>
  new AppError(409, 'import_not_proposed', 'This import has no proposal to act on now.');

const summaryOf = (found: StoredImport): ImportSummary => ({
  id: found.id,
  space: found.spaceId,
  importer: found.importer,
  fileName: found.fileName,
  fileType: found.fileType,
  state: found.state,
  failure: found.failure,
  document: found.documentId,
  createdAt: found.createdAt.toISOString(),
  sweepsAt: ['awaiting', 'reading', 'proposed'].includes(found.state)
    ? new Date(found.touchedAt.getTime() + IMPORT_KEPT_DAYS * 86_400_000).toISOString()
    : null,
});

async function viewOf(trx: TenantTransaction, found: StoredImport): Promise<ImportView> {
  const parts = await importParts(trx, found.id);
  return {
    ...summaryOf(found),
    levels: found.levels,
    title: found.title,
    parts: parts.map((part) => ({
      id: part.id,
      kind: part.kind,
      title: part.title,
      parent: part.parent,
      reason: part.reason,
      flags: [...part.flags],
      blocks: part.blocks.length,
      source: part.source,
    })),
    report: found.report.map((entry) => ({ ...entry })),
  };
}

/** A file's name, its last dot on, left off: what a document is called when the file names no title. */
const stem = (name: string) => name.replace(/\.[^.]*$/, '').trim() || name;

/**
 * The import routes (docs/design/import.md; the IM plan, IM-A, IM-B, IM-F). An import is seen by its
 * importer, while they may read its space, and by the space's administrators, who may abandon it;
 * anybody else is told there is no such import. Only its importer fills, re-levels or accepts it.
 */
export function importHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  objects: ObjectStores | undefined,
) {
  const visible = async (
    request: FastifyRequest,
    trx: TenantTransaction,
    who: 'importer' | 'administrator',
  ): Promise<StoredImport> => {
    const { id } = request.params as ImportParams;
    const found = await readImport(trx, id);
    if (!found) throw notFound();
    const caller = callerOf(request);
    const space = { kind: 'space', id: found.spaceId } as const;
    if (found.importer === caller.principalId) {
      await authoriseAt(trx, caller, 'read', space);
      return found;
    }
    if (who === 'importer') throw notFound();
    const facts = await loadFacts(trx, caller.principalId, space);
    if (facts && administerOrAbove({ ...facts, scopes: caller.scopes }).allowed) return found;
    throw notFound();
  };

  const remover = async (trx: TenantTransaction, tenant: Tenant) => {
    if (!objects) return async () => Promise.reject(storageUnavailable());
    const store = await objects.forTenant(trx, tenant);
    return (key: string) => store.remove(key);
  };

  return {
    /** `create` was decided on the space by `authorise`, in `trx`. */
    createImport: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ImportView> => {
      const { space } = request.params as SpaceParams;
      const body = request.body as CreateImportBody;
      const fileName = body.fileName.trim();
      const unsafe = [...fileName].some(
        (character) => character.charCodeAt(0) < 0x20 || character === '/' || character === '\\',
      );
      if (!ENDINGS[body.fileType].test(fileName) || unsafe) {
        throw notPermitted();
      }
      return viewOf(
        trx,
        await createImport(trx, {
          spaceId: space,
          importer: principalId,
          fileName,
          fileType: body.fileType,
        }),
      );
    },

    /**
     * The file, checked from its bytes (IM-B), kept by its hash, and the `import` job queued. A file
     * that is not what the import says is refused with nothing stored, the import still awaiting one.
     */
    putImportFile: async (request: FastifyRequest): Promise<ImportView> => {
      const tenant = tenantOf(request);
      const bytes =
        Buffer.isBuffer(request.body) &&
        request.headers['content-type']?.split(';')[0]?.trim() === 'application/octet-stream'
          ? request.body
          : undefined;
      if (bytes !== undefined && bytes.length > IMPORT_MAX_BYTES) {
        throw new AppError(413, 'import_too_large', 'A file to import may hold at most 25 MB.');
      }
      return db.withTenant(
        tenant,
        async (trx) => {
          const found = await visible(request, trx, 'importer');
          // `create` in the space, decided again now that a file will be kept for it.
          await authoriseAt(trx, callerOf(request), 'create', { kind: 'space', id: found.spaceId });
          if (bytes === undefined) {
            throw new AppError(
              415,
              'import_bytes_expected',
              "Send the file's bytes as application/octet-stream.",
            );
          }
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          if (found.state !== 'awaiting') {
            // The same file again - a retry after a lost answer - is answered with the import as it is.
            if (found.sha256 === sha256) return viewOf(trx, found);
            throw new AppError(409, 'import_filled', 'This import already has its file.');
          }
          if (!checkImportFile(bytes, found.fileType)) throw notPermitted();
          if (!objects) throw storageUnavailable();
          await holdObject(trx, sha256);
          const store = await objects.forTenant(trx, tenant);
          const stored = await store.put(bytes, 'application/octet-stream');
          const received = await receiveImportFile(trx, found.id, {
            key: stored.key,
            sha256,
            bytes: stored.size,
          });
          if (!received)
            throw new AppError(409, 'import_filled', 'This import already has its file.');
          return viewOf(trx, received);
        },
        contextOf(request),
      );
    },

    /** `read` was decided on the space; its administrator sees every import there. */
    listImports: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<ImportList> => {
      const { space } = request.params as SpaceParams;
      const all = administerOrAbove(facts).allowed;
      const asked = pageAsked('imports', request.query as ImportListQuery);
      const listed = await listImports(trx, { spaceId: space, principal: principalId, all }, asked);
      return {
        items: listed.items.map(summaryOf),
        next: cursorFor('imports', asked.sort, asked.order, listed.snapshot, listed.next),
      };
    },

    getImport: async (request: FastifyRequest): Promise<ImportView> =>
      db.withTenant(tenantOf(request), async (trx) =>
        viewOf(trx, await visible(request, trx, 'administrator')),
      ),

    setImportLevels: async (request: FastifyRequest): Promise<ImportView> =>
      db.withTenant(
        tenantOf(request),
        async (trx) => {
          const found = await visible(request, trx, 'importer');
          const levels = importLevelsSchema.safeParse(request.body as ImportLevelsBody);
          if (!levels.success) {
            throw new AppError(
              400,
              'import_levels_invalid',
              "A component's heading level must be below a section's.",
            );
          }
          const changed = await changeImportLevels(trx, found.id, levels.data);
          if (!changed) throw notProposed();
          return viewOf(trx, changed);
        },
        contextOf(request),
      ),

    /** One act (IM-F): everything is made, or the transaction is rolled back and nothing is. */
    acceptImport: async (request: FastifyRequest): Promise<ImportAccepted> =>
      db.withTenant(
        tenantOf(request),
        async (trx) => {
          const found = await visible(request, trx, 'importer');
          const caller = callerOf(request);
          await authoriseAt(trx, caller, 'create', { kind: 'space', id: found.spaceId });
          const body = request.body as AcceptImportBody;
          const answer = await acceptImport(trx, found.id, {
            by: caller.principalId,
            title: body.title ?? found.title ?? stem(found.fileName),
            language: body.language ?? found.language ?? 'en',
            direction: 'ltr',
            ...(body.template === undefined ? {} : { template: body.template }),
          });
          switch (answer.answer) {
            case 'accepted':
              return {
                import: await viewOf(trx, answer.import),
                document: answer.document.artifactId,
              };
            case 'import.not_proposed':
              throw notProposed();
            case 'space.missing':
            case 'template.missing':
              throw notFound();
            case 'template.unresolved':
              throw new AppError(400, 'template_unresolved', 'The template does not resolve.');
            default:
              throw new AppError(
                400,
                'content_invalid',
                'The document could not be made with this title, language or template.',
              );
          }
        },
        contextOf(request),
      ),

    abandonImport: async (request: FastifyRequest): Promise<ImportView> => {
      const tenant = tenantOf(request);
      return db.withTenant(
        tenant,
        async (trx) => {
          const found = await visible(request, trx, 'administrator');
          const abandoned = await abandonImport(trx, found.id, await remover(trx, tenant));
          if (!abandoned) {
            throw new AppError(
              409,
              'import_not_open',
              'This import is already accepted, abandoned or failed.',
            );
          }
          return viewOf(trx, abandoned);
        },
        contextOf(request),
      );
    },
  };
}
