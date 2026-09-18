import type {
  CreateDocumentBody,
  DocumentParams,
  DocumentView,
  OutlineOperationBody,
  SpaceParams,
} from '@alloy-works/api-contract';
import {
  createDocument,
  editOutline,
  listReadableDocuments,
  readDocument,
  type StoredDocument,
  type StoredVersion,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { versionView } from './components.js';
import { AppError } from './errors.js';
import type { SessionPrincipal } from './sessions.js';
import { wireCode } from './wire-codes.js';

/** A document as the API shows it: at one version, with whether the caller may restructure it. */
function documentView(
  document: Pick<StoredDocument, 'id' | 'space'>,
  version: StoredVersion,
  mayEdit: boolean,
): DocumentView {
  return {
    id: document.id,
    space: document.space,
    version: versionView(version),
    outline: version.content as Record<string, unknown>,
    mayEdit,
  };
}

/** The precondition's refusal, carrying the document as it now stands so the caller can look again. */
function stale(current: DocumentView): AppError {
  return new AppError(
    409,
    wireCode('version.precondition'),
    'This document has a newer version than the one this page opened.',
    undefined,
    { current },
  );
}

/**
 * The document as it now stands, for a refusal to carry. Read in the handler's transaction; a
 * document is never removed, so one that authorised a moment ago is still there.
 */
async function latestView(trx: TenantTransaction, id: string, mayEdit: boolean) {
  const latest = await readDocument(trx, id);
  if (!latest) throw notFound();
  return documentView(latest, latest.version, mayEdit);
}

/**
 * The handlers that create, find, open and restructure documents. Each permission-checked one runs in
 * the transaction its permission was decided in; none changes a fact a decision reads - creating an
 * artifact fires no epoch trigger, and a version is not a grant - so none declares `changesAccess`.
 */
export function documentHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    listDocuments: async (request: FastifyRequest) => {
      const listed = await db.withTenant(tenantOf(request), (trx) =>
        listReadableDocuments(trx, principalOf(request).principalId),
      );
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map((item) => ({
          id: item.id,
          title: item.title,
          space: item.space,
          version: `${item.revision}.${item.version}`,
        })),
      };
    },

    createDocument: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const body = request.body as CreateDocumentBody;
      const answer = await createDocument(trx, {
        spaceId: space,
        title: body.title,
        language: body.language,
        direction: body.direction,
        author: principalId,
      });
      // The space was decided on before this ran, so `space.missing` here means it went in the moment
      // between; answered as absent either way, never as a refusal that says it exists.
      if (answer.answer === 'space.missing') throw notFound();
      if (answer.answer === 'content.invalid') {
        throw new AppError(
          400,
          wireCode('content.invalid'),
          'A document needs a title and a language tag such as en-GB.',
        );
      }
      const held = await trx
        .selectFrom('space')
        .select(['id', 'name'])
        .where('id', '=', space)
        .executeTakeFirstOrThrow();
      // Decided against the space, as `createComponent` decides it: the document did not exist when
      // the facts were loaded, so no denial on it can exist yet.
      return documentView(
        { id: answer.version.artifactId, space: held },
        answer.version,
        decide('edit', facts).allowed,
      );
    },

    getDocument: async (request: FastifyRequest, { trx, facts }: Authorised) => {
      const { id } = request.params as DocumentParams;
      // `authorise` never looks at an artifact's kind, so a component's id authorises cleanly here;
      // `readDocument` answers nothing for it, and neither does this.
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      return documentView(document, document.version, decide('edit', facts).allowed);
    },

    /**
     * One structural act, and one version. **A stale caller is told it is stale before anything
     * else**, whatever else is wrong with what it sent: the store applies the operation to the version
     * the caller opened from, so an operation that does not apply there - a node somebody else has
     * since added, say - would otherwise be answered `outline_invalid`, which leaves the caller with
     * nothing to recover from. Answered `version_precondition` with the outline as it stands, they can
     * look again and act on that. Only an operation refused against the latest version is
     * `outline_invalid`. An opened-from version that is not one of this document's is stale in the
     * same sense, as `cutVersion` already answers one that is not the component's latest.
     */
    editOutline: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<DocumentView> => {
      const { id } = request.params as DocumentParams;
      const body = request.body as OutlineOperationBody;
      const mayEdit = decide('edit', facts).allowed;
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const answer = await editOutline(trx, {
        artifactId: id,
        openedFrom: body.openedFrom,
        author: principalId,
        operation: body.operation,
      });
      switch (answer.answer) {
        case 'recorded':
          return documentView(document, answer.version, mayEdit);
        case 'version.unchanged':
          // Decision K: putting something back where it was is not an error, and the chain keeps no
          // row for it - the same answer `cutVersion` gives for a cut with nothing in it.
          return documentView(document, answer.current, mayEdit);
        case 'version.precondition':
          throw stale(documentView(document, answer.current, mayEdit));
        case 'artifact.missing':
          // The document is there - it was read above - so it is the opened-from version that is not.
          throw stale(await latestView(trx, id, mayEdit));
        case 'outline.invalid': {
          // Versions are only ever appended, so a latest that is not the opened-from version now
          // never will be again: no lock is needed to know the caller is stale.
          const current = await latestView(trx, id, mayEdit);
          if (current.version.id !== body.openedFrom) throw stale(current);
          // A fixed message; the reason is one of the domain's own constants, never an exception's
          // text (operations.ts), so it is safe to carry as a member.
          throw new AppError(
            400,
            wireCode('outline.invalid'),
            'This change does not apply to the outline as it stands.',
            undefined,
            { reason: answer.reason },
          );
        }
      }
    },
  };
}
