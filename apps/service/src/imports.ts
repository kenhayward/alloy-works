import type {
  AcceptImportBody,
  CreateImportBody,
  EditImportBody,
  ImportAccepted,
  ImportKindBody,
  ImportLevelsBody,
  ImportList,
  ImportListQuery,
  ImportParams,
  ImportPartDetail,
  ImportPartMatches,
  ImportPartParams,
  ImportPartSearchQuery,
  ImportPlaceBody,
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
  againCandidates,
  changeImportLevels,
  chooseImportKind,
  createImport,
  earlierImport,
  editImport,
  holdObject,
  importMembers,
  importParts,
  importPolicy,
  latestVersion,
  listImports,
  loadFacts,
  readableComponents,
  readImport,
  receiveImportFile,
  releaseObject,
  setImportPlace,
  type ImportEditInput,
  type StoredImport,
  type StoredImportPart,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  againDiff,
  againStatus,
  blockText,
  decide,
  importLevelsSchema,
  matchIdentity,
  partMatches,
  reviewFlags,
  type ContentDocument,
  type ImportEditRefusal,
} from '@alloy-works/domain';
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
const changedSince = () =>
  new AppError(
    409,
    'import_changed',
    'This proposal was changed since you opened it. Open it again to see it as it is.',
  );

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

/** Why an edit was refused (IMP-041), in words the importer can act on. */
const REFUSALS: Readonly<Record<ImportEditRefusal, string>> = {
  part_missing: 'There is no such part in this proposal.',
  no_neighbour: 'There is no part on that side to move to or merge with.',
  neighbour_section: 'A section holds no blocks, so blocks cannot move into or out of one.',
  section_holds_no_blocks:
    'A section holds no blocks. Move or merge this part’s blocks before making it a section.',
  blocks_out_of_range:
    'That is not a block this part can split or move at: each part keeps at least one block.',
  kinds_differ: 'Only two components, or two sections, can be merged.',
  title_invalid: 'A part needs a title.',
  content_invalid: 'What this would make is not content a component can hold, so it was not made.',
  reference_missing: 'There is no such reference outside the import in this proposal.',
  target_missing: 'There is no such block in this import, or in a component of this space.',
  identity_invalid:
    'That member is not who this name matches, or the file does not carry this name.',
  match_invalid:
    'That is not a component the earlier import made, or another part is already matched to it. Mark that part new first.',
};

type AgainView = ImportView['parts'][number]['again'];

const partOf = (found: StoredImport, part: StoredImportPart, again: AgainView = null) => ({
  id: part.id,
  kind: part.kind,
  title: part.title,
  parent: part.parent,
  reason: part.reason,
  flags: reviewFlags(part, found.report),
  source: part.source,
  again,
});

/**
 * What an import again's parts are to what the earlier import made (IM-K): each component part
 * unchanged, changed or new against its component as it is now, and what no part matches. A title
 * and a text are shown only where its importer may read the component.
 */
async function againOf(
  trx: TenantTransaction,
  found: StoredImport,
  parts: readonly StoredImportPart[],
) {
  const views = new Map<string, AgainView>();
  const current = new Map<string, ContentDocument>();
  if (found.kind !== 'again' || found.earlier === null) {
    return { views, current, made: [], gone: [] };
  }
  const candidates = await againCandidates(trx, found.earlier);
  const ids = [
    ...new Set([
      ...candidates.map((each) => each.component),
      ...parts.flatMap((part) => part.matched ?? []),
    ]),
  ];
  const readable = await readableComponents(trx, found.importer, ids);
  const latest = new Map<string, ContentDocument>();
  for (const id of ids) {
    const version = await latestVersion(trx, id);
    if (!version) continue;
    latest.set(id, version.content as ContentDocument);
    if (readable.has(id)) current.set(id, version.content as ContentDocument);
  }
  for (const part of parts) {
    if (part.kind !== 'component') continue;
    const matched = part.matched === null ? undefined : latest.get(part.matched);
    views.set(part.id, {
      status: againStatus(part.blocks, matched?.content ?? null),
      component: part.matched,
      componentTitle: part.matched === null ? null : (current.get(part.matched)?.title ?? null),
      by: part.matchedBy,
    });
  }
  const made = candidates.map((each) => ({
    component: each.component,
    title: readable.has(each.component) ? each.title : null,
  }));
  const held = new Set(parts.map((part) => part.matched));
  return { views, current, made, gone: made.filter((each) => !held.has(each.component)) };
}

/** An accepted import in the space holding the same file (IMP-036), while this one is open. */
async function recognisedOf(
  trx: TenantTransaction,
  found: StoredImport,
): Promise<ImportView['recognised']> {
  if (!['awaiting', 'reading', 'proposed'].includes(found.state)) return null;
  // Only one whose document its importer may read, or their own: nothing else is said of another's.
  const readable = async (document: string) => {
    const facts = await loadFacts(trx, found.importer, { kind: 'artifact', id: document });
    return facts !== undefined && decide('read', facts).allowed;
  };
  const earlier = await earlierImport(
    trx,
    found.id,
    async (each) => each.importer === found.importer || (await readable(each.documentId)),
  );
  if (!earlier) return null;
  const document = (await readable(earlier.documentId))
    ? await latestVersion(trx, earlier.documentId)
    : undefined;
  const title = (document?.content as { readonly title?: unknown } | undefined)?.title;
  const person = await trx
    .selectFrom('principal')
    .select('display_name')
    .where('id', '=', earlier.importer)
    .executeTakeFirst();
  return {
    import: earlier.id,
    match: earlier.match,
    fileName: earlier.fileName,
    importer: earlier.importer,
    importerName: person?.display_name ?? null,
    at: earlier.finishedAt.toISOString(),
    document: earlier.documentId,
    documentTitle: typeof title === 'string' ? title : null,
  };
}

async function viewOf(trx: TenantTransaction, found: StoredImport): Promise<ImportView> {
  const parts = await importParts(trx, found.id);
  const again = await againOf(trx, found, parts);
  // A report entry names a part as read: shown against the part now holding what it came from.
  const holding = (read: number | null) => {
    const at = read === null ? -1 : parts.findIndex((part) => part.origins.includes(read));
    return at === -1 ? null : at;
  };
  // Each name the file carries, with the member it matches: attribution alone, never authorship.
  // By email only for an importer who may list the space's members with their emails; anybody else
  // sees the directory, names alone, so a file's addresses learn them nothing more (IM-I).
  const everyone = found.identities.length === 0 ? [] : await importMembers(trx);
  const facts =
    everyone.length === 0
      ? undefined
      : await loadFacts(trx, found.importer, { kind: 'space', id: found.spaceId });
  const members =
    facts && administerOrAbove(facts).allowed
      ? everyone
      : everyone.map((member) => ({ ...member, email: null }));
  return {
    ...summaryOf(found),
    levels: found.levels,
    title: found.title,
    parts: parts.map((part) => ({
      ...partOf(found, part, again.views.get(part.id) ?? null),
      blocks: part.blocks.length,
    })),
    revision: found.revision,
    place: found.place,
    accepted: found.acceptedCounts,
    report: found.report.map((entry) => ({ ...entry, part: holding(entry.part) })),
    references: found.outside.map(({ key, field, text, resolved }) => ({
      key,
      field,
      text,
      resolved,
    })),
    identities: found.identities.map((identity) => {
      const { match, member } = matchIdentity(identity, members);
      return {
        ...identity,
        carries: [...identity.carries],
        match,
        member,
        memberName: members.find((each) => each.id === member)?.name ?? null,
        confirmed: match === 'name' && found.confirmed[identity.name] === member,
      };
    }),
    policy: found.policy ?? (await importPolicy(trx)),
    policyApplied: found.policy !== null,
    kind: found.kind,
    earlier: found.earlier,
    recognised: await recognisedOf(trx, found),
    earlierMade: again.made,
    gone: again.gone,
    outcome: found.outcome
      ? {
          ...found.outcome,
          suggested: [...found.outcome.suggested],
          made: [...found.outcome.made],
          gone: [...found.outcome.gone],
          skipped: [...found.outcome.skipped],
        }
      : null,
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
          if (!received) {
            // Filled by another request meanwhile: these bytes let go, unless something holds them.
            await releaseObject(trx, { key: stored.key, sha256 }, (key) => store.remove(key));
            throw new AppError(409, 'import_filled', 'This import already has its file.');
          }
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
          const { revision, ...asked } = request.body as ImportLevelsBody;
          const levels = importLevelsSchema.safeParse(asked);
          if (!levels.success) {
            throw new AppError(
              400,
              'import_levels_invalid',
              "A component's heading level must be below a section's.",
            );
          }
          const changed = await changeImportLevels(
            trx,
            found.id,
            levels.data,
            await remover(trx, tenantOf(request)),
            revision,
          );
          if (changed === 'import.changed') throw changedSince();
          if (!changed) throw notProposed();
          return viewOf(trx, changed);
        },
        contextOf(request),
      ),

    /**
     * Imported as new, or again as an update of what an earlier import of the same file made (IM-K):
     * its importer needs read on that import's document.
     */
    setImportKind: async (request: FastifyRequest): Promise<ImportView> =>
      db.withTenant(
        tenantOf(request),
        async (trx) => {
          const found = await visible(request, trx, 'importer');
          const body = request.body as ImportKindBody;
          const invalid = () =>
            new AppError(
              400,
              'import_earlier_invalid',
              'That is not an import accepted in this space whose document is still there.',
            );
          if (body.kind === 'again') {
            if (body.earlier === undefined) throw invalid();
            const earlier = await readImport(trx, body.earlier);
            if (earlier?.documentId) {
              await authoriseAt(trx, callerOf(request), 'read', {
                kind: 'artifact',
                id: earlier.documentId,
              });
            }
          }
          const chosen = await chooseImportKind(
            trx,
            found.id,
            body.kind === 'again' ? { kind: 'again', earlier: body.earlier! } : { kind: 'first' },
            body.revision,
          );
          if (chosen === 'import.earlier_invalid') throw invalid();
          if (chosen === 'import.changed') throw changedSince();
          if (!chosen) {
            throw new AppError(
              409,
              'import_not_open',
              'This import is already accepted, abandoned or failed.',
            );
          }
          return viewOf(trx, chosen);
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
            revision: body.revision,
            title: body.title ?? found.title ?? stem(found.fileName),
            language: body.language ?? found.language ?? 'en',
            direction: 'ltr',
            ...(body.template === undefined ? {} : { template: body.template }),
            // Imported again, what the caller may do on each component and on the document.
            may: async (artifact, permission) => {
              const facts = await loadFacts(trx, caller.principalId, {
                kind: 'artifact',
                id: artifact,
              });
              return (
                facts !== undefined &&
                decide(permission, { ...facts, scopes: caller.scopes }).allowed
              );
            },
          });
          switch (answer.answer) {
            case 'accepted':
              return {
                import: await viewOf(trx, answer.import),
                document: answer.document.artifactId,
              };
            case 'import.not_proposed':
              throw notProposed();
            case 'import.changed':
              throw changedSince();
            case 'import.not_permitted':
              throw new AppError(
                403,
                'import_not_permitted',
                'You may not suggest on any of the components this file changes, so nothing was updated.',
              );
            case 'import.earlier_missing':
              throw new AppError(
                409,
                'import_earlier_missing',
                'The document the earlier import made is gone. Import this file as new instead.',
              );
            case 'import.references_unresolved':
              throw new AppError(
                409,
                'import_references_unresolved',
                'A cross-reference points at something outside the import. Point it at a block, or make it the text it showed, before accepting.',
              );
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

    /** One part beside what it came from (IMP-028): reviewed alone, never the whole proposal. */
    getImportPart: async (request: FastifyRequest): Promise<ImportPartDetail> =>
      db.withTenant(tenantOf(request), async (trx) => {
        const found = await visible(request, trx, 'administrator');
        const { part: wanted } = request.params as ImportPartParams;
        const parts = await importParts(trx, found.id);
        const at = parts.findIndex((part) => part.id === wanted);
        const part = parts[at];
        if (!part) throw notFound();
        const authors = [...new Set(part.changes.map((change) => change.author))];
        const held = JSON.stringify(part.blocks);
        // Against its component as it is now, so edits made in the space show (IMP-036).
        const again = await againOf(trx, found, [part]);
        const current = part.matched === null ? undefined : again.current.get(part.matched);
        return {
          ...partOf(found, part, again.views.get(part.id) ?? null),
          diff: current ? againDiff(current.content, part.blocks) : null,
          blocks: part.blocks.map((block) => ({
            id: block.id,
            type: block.type,
            text: blockText(block),
          })),
          suggestions: authors.map((author) => {
            const changes = part.changes.filter((change) => change.author === author);
            return {
              author,
              blocks: changes.length,
              text: changes.flatMap((change) => change.proposed.map(blockText)).join('\n'),
            };
          }),
          threads: part.threads.map((thread) => ({
            author: thread.author,
            text: thread.text,
            quote: thread.span ? thread.quote : null,
            clamped: thread.clamped,
            replies: thread.replies.map(({ author, text }) => ({ author, text })),
          })),
          references: found.outside
            .filter((each) => held.includes(JSON.stringify(each.key)))
            .map((each) => each.key),
          place: at,
          of: parts.length,
          previous: parts[at - 1]?.id ?? null,
          next: parts[at + 1]?.id ?? null,
        };
      }),

    /** Searched by title and text, filtered by flag (IMP-029). */
    searchImportParts: async (request: FastifyRequest): Promise<ImportPartMatches> =>
      db.withTenant(tenantOf(request), async (trx) => {
        const found = await visible(request, trx, 'administrator');
        const { q, flag } = request.query as ImportPartSearchQuery;
        const parts = await importParts(trx, found.id);
        return {
          parts: parts
            .filter((part) => partMatches(part, q ?? ''))
            .filter((part) => flag === undefined || reviewFlags(part, found.report).includes(flag))
            .map((part) => part.id),
        };
      }),

    /** An edit by its importer (IMP-002, IMP-041), validated as made, against the revision read. */
    editImport: async (request: FastifyRequest): Promise<ImportView> =>
      db.withTenant(
        tenantOf(request),
        async (trx) => {
          const found = await visible(request, trx, 'importer');
          const body = request.body as EditImportBody;
          const answer = await editImport(trx, found.id, {
            revision: body.revision,
            edit: body.edit as ImportEditInput,
            by: callerOf(request).principalId,
          });
          switch (answer.answer) {
            case 'edited':
              return viewOf(trx, answer.import);
            case 'import.not_proposed':
              throw notProposed();
            case 'import.changed':
              throw changedSince();
            default:
              throw new AppError(400, 'import_edit_refused', REFUSALS[answer.refusal]);
          }
        },
        contextOf(request),
      ),

    /** Where its importer is (IMP-029), to return to from any session. */
    setImportPlace: async (request: FastifyRequest): Promise<ImportView> =>
      db.withTenant(
        tenantOf(request),
        async (trx) => {
          const found = await visible(request, trx, 'importer');
          const placed = await setImportPlace(
            trx,
            found.id,
            (request.body as ImportPlaceBody).part,
          );
          if (placed === 'part.missing') throw notFound();
          if (!placed) throw notProposed();
          return viewOf(trx, placed);
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
