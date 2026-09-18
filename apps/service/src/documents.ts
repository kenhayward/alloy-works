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
  numberingInputs,
  readableComponents,
  readDocument,
  type StoredDocument,
  type StoredVersion,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  conditions,
  decide,
  defaultNumberingScheme,
  number,
  readOutline,
  resolve,
  walkOutline,
  withholdComponents,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { versionView } from './components.js';
import { AppError } from './errors.js';
import type { SessionPrincipal } from './sessions.js';
import { wireCode } from './wire-codes.js';

/** Who a document is being shown to, in the transaction their permission was decided in. */
interface Viewer {
  readonly trx: TenantTransaction;
  readonly principalId: string;
  readonly mayEdit: boolean;
}

/**
 * The outline as this viewer is shown it (structure.md, "Who is shown what"): a reference to a
 * component they may not read has its component and pinned version withheld, because access.md makes
 * a thing they may not read indistinguishable from one that does not exist. **Only the view**: the
 * stored outline, its digests and its versions are never computed from what this returns.
 *
 * An outline that does not read is shown as nothing at all - an empty member, which no renderer reads
 * as an outline - rather than as stored, because what cannot be parsed cannot have its references
 * withheld either. The page says it could not be read, as it did when the stored value came back.
 */
async function outlineView(
  viewer: Viewer,
  document: string,
  version: StoredVersion,
): Promise<Record<string, unknown>> {
  const read = readOutline(version.content, { artifact: document, version: version.id });
  if (!read.ok) return {};
  const components: string[] = [];
  walkOutline(read.outline.nodes, (node) => {
    if (node.type === 'reference') components.push(node.component);
  });
  const readable = await readableComponents(viewer.trx, viewer.principalId, components);
  return withholdComponents(read.outline, (component) => readable.has(component));
}

/**
 * A document as the API shows it: at one version, with whether the caller may restructure it. Every
 * answer that carries an outline is built here - the page, an act's answer, and a refusal's
 * `current` - so none can carry an outline that has not been through `outlineView`.
 */
async function documentView(
  viewer: Viewer,
  document: Pick<StoredDocument, 'id' | 'space'>,
  version: StoredVersion,
): Promise<DocumentView> {
  return {
    id: document.id,
    space: document.space,
    version: versionView(version),
    outline: await outlineView(viewer, document.id, version),
    mayEdit: viewer.mayEdit,
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
async function latestView(viewer: Viewer, id: string) {
  const latest = await readDocument(viewer.trx, id);
  if (!latest) throw notFound();
  return documentView(viewer, latest, latest.version);
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
        { trx, principalId, mayEdit: decide('edit', facts).allowed },
        { id: answer.version.artifactId, space: held },
        answer.version,
      );
    },

    getDocument: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { id } = request.params as DocumentParams;
      // `authorise` never looks at an artifact's kind, so a component's id authorises cleanly here;
      // `readDocument` answers nothing for it, and neither does this.
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const viewer = { trx, principalId, mayEdit: decide('edit', facts).allowed };
      return documentView(viewer, document, document.version);
    },

    /**
     * The latest version's numbering, as this caller is shown it (structure.md, "Numbering" and "Who
     * is shown what"). A component they may not read is never read (`numberingInputs`), so no number
     * here was computed from one, and every number such an occurrence could have moved is null rather
     * than guessed. A stored outline that does not read is a broken store, thrown as the outline route
     * throws it.
     */
    getNumbering: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DocumentParams;
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const read = readOutline(document.version.content, {
        artifact: id,
        version: document.version.id,
      });
      if (!read.ok) {
        throw new Error(
          `The document ${id} at ${document.version.id} does not read: ${read.failure}`,
        );
      }
      const inputs = await numberingInputs(trx, read.outline, principalId);
      const table = number(
        conditions(resolve(read.outline, inputs.contributions)),
        defaultNumberingScheme,
      );
      return {
        document: id,
        version: { id: document.version.id, number: versionView(document.version).number },
        scheme: table.scheme,
        // Copied, because the domain's answers are read-only and the wire's types are not.
        occurrences: inputs.occurrences.map((occurrence) => ({ ...occurrence })),
        entries: table.entries.map((entry) => ({ ...entry, sections: [...entry.sections] })),
      };
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
      const viewer = { trx, principalId, mayEdit: decide('edit', facts).allowed };
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
          return documentView(viewer, document, answer.version);
        case 'version.unchanged':
          // Decision K: putting something back where it was is not an error, and the chain keeps no
          // row for it - the same answer `cutVersion` gives for a cut with nothing in it.
          return documentView(viewer, document, answer.current);
        case 'version.precondition':
          throw stale(await documentView(viewer, document, answer.current));
        case 'artifact.missing':
          // The document is there - it was read above - so it is the opened-from version that is not.
          throw stale(await latestView(viewer, id));
        case 'outline.invalid': {
          // Versions are only ever appended, so a latest that is not the opened-from version now
          // never will be again: no lock is needed to know the caller is stale.
          const current = await latestView(viewer, id);
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
