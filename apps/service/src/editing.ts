import type {
  ClaimBody,
  ComponentParams,
  CutAnswer,
  CutBody,
  IterationBody,
  IterationListQuery,
  IterationParams,
  ReleaseQuery,
  SavedIterationParams,
  SavedIterationQuery,
} from '@alloy-works/api-contract';
import {
  claimLock,
  cutVersion,
  holding,
  isHolderRefusal,
  latestVersion,
  listIterations,
  readIteration,
  readVersion,
  releaseLock,
  saveIteration,
  type HolderRefusal,
  type IterationSummary,
  type StoredVersion,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  hasText,
  parseContentDocument,
  storableEverywhere,
  type BoundTableNode,
  type ContentDocument,
  type MetadataFailure,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { callerOf, notFound, type Authorised } from './access.js';
import { lockView, versionView } from './components.js';
import { definitionReader } from './data/bindings.js';
import type { AppError } from './errors.js';
import { cursorFor, pageAsked } from './listing.js';
import { refused } from './wire-codes.js';

/** Every refusal a session's write can meet from the store. */
type Refusal =
  | HolderRefusal
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  | { readonly answer: 'iteration.stale' | 'iteration.conflict'; readonly latest: number }
  | { readonly answer: 'values.invalid'; readonly failures: readonly MetadataFailure[] }
  | { readonly answer: 'artifact.missing' };

/** Every bound table in some content, wherever it stands. */
function boundTablesIn(value: unknown): BoundTableNode[] {
  if (Array.isArray(value)) return value.flatMap(boundTablesIn);
  if (typeof value !== 'object' || value === null) return [];
  if ((value as { type?: unknown }).type === 'boundTable') return [value as BoundTableNode];
  return Object.values(value).flatMap(boundTablesIn);
}

/** The columns a bound table names: those it shows and those it sorts by. */
const namedBy = (table: BoundTableNode) =>
  new Set([
    ...table.columns.map((each) => each.column),
    ...(table.sort ?? []).map((each) => each.column),
  ]);

/**
 * **A column is named only by whoever may read its definition** (the TB2 final review): a bound table's
 * columns and sort stand outside its binding's digest, so a result already held would otherwise show a
 * column chosen by an author who may not read the definition - which the Value dialog asks of whoever
 * places one. A save naming, in a bound table, a column the version it opened from did not name there
 * under the same definition is refused `definition_unreadable` unless the saver may read the definition.
 * A header renamed, a column moved or removed, is never refused.
 */
async function mayNameColumns(
  trx: TenantTransaction,
  request: FastifyRequest,
  content: ContentDocument,
  openedFrom: string,
): Promise<void> {
  const tables = boundTablesIn(content.content);
  if (tables.length === 0) return;
  const before = new Map(
    boundTablesIn((await readVersion(trx, openedFrom))?.content ?? null).map((table) => [
      table.id,
      table,
    ]),
  );
  const reads = definitionReader(trx, callerOf(request));
  for (const table of tables) {
    const was = before.get(table.id);
    const named = was?.binding.query === table.binding.query ? namedBy(was) : new Set<string>();
    const added = [...namedBy(table)].some((column) => !named.has(column));
    if (added && !(await reads(table.binding.query))) {
      throw refused(
        403,
        'definition.unreadable',
        'A bound table names a column of a query definition you may not read.',
      );
    }
  }
}

/**
 * A refusal in the one error shape, with its members (component-editor.md, "The API"). Three refusals
 * stay apart: an unreadable component is 404 and an author without `edit` is 403, both decided before a
 * handler runs; a component somebody else holds is `lock_held`, which names them and when they are
 * expected to release it, and says nothing about permission (API-039). Every code crossing here is put
 * through `wireCode`: the store answers dotted, the wire spells it with an underscore (decision F).
 */
function refuse(refusal: Refusal): AppError {
  switch (refusal.answer) {
    case 'lock.held':
      return refused(409, 'lock.held', 'This component is being edited in another session.', {
        holder: { id: refusal.lock.holder, name: refusal.lock.holderName },
        expectedRelease: refusal.lock.expiresAt.toISOString(),
      });
    case 'lock.required':
      return refused(
        409,
        'lock.required',
        'This session does not hold the lock on this component.',
      );
    case 'version.precondition':
      return refused(
        409,
        'version.precondition',
        'This component has a newer version than the one this session opened.',
        { current: versionView(refusal.current) },
      );
    case 'iteration.stale':
      return refused(
        409,
        'iteration.stale',
        'A later save from this session has already been accepted.',
        { latest: refusal.latest },
      );
    case 'iteration.conflict':
      return refused(
        409,
        'iteration.conflict',
        'This save repeats an accepted one with different content.',
        { latest: refusal.latest },
      );
    // What cannot be stored honestly with the component (definitions.md, "A component's"): a fixed
    // value changed, a value of the wrong type, a user this environment does not hold.
    case 'values.invalid':
      return refused(400, 'values.invalid', 'A value does not fit its field.', {
        failures: refusal.failures,
      });
    case 'artifact.missing':
      return notFound();
  }
}

/** An iteration as the API lists it: when, from which of the caller's sessions, against what. */
function iterationView(iteration: IterationSummary) {
  return {
    id: iteration.id,
    session: iteration.sessionId,
    sequence: iteration.sequence,
    createdAt: iteration.createdAt.toISOString(),
    openedFrom: { ...iteration.openedFrom },
  };
}

/**
 * Reading an iteration back needs the lock, held by the session asking (RC-A): refused as a write
 * from a session that does not hold it is, `lock_held` naming the holder or `lock_required`.
 */
async function mustHold(
  trx: TenantTransaction,
  artifactId: string,
  principal: string,
  session: string,
): Promise<void> {
  const held = await holding(trx, { artifactId, principal, session });
  if (isHolderRefusal(held)) throw refuse(held);
}

/**
 * The handlers for writing in an editing session. Each runs in the transaction `edit` was decided in.
 * None changes a fact a decision reads - a lock, an iteration and a version are not grants, roles,
 * memberships, a principal's kind or an artifact's space - so none takes the access epoch for update,
 * and the shared lock the decision took first is never upgraded (the editor plan's decision 4).
 */
export function editingHandlers() {
  return {
    claimLock: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as ComponentParams;
      const body = request.body as ClaimBody;
      const answer = await claimLock(trx, {
        artifactId: id,
        principal: principalId,
        session: body.session,
        ...(body.move === undefined ? {} : { move: body.move }),
      });
      if (answer.answer !== 'claimed') throw refuse(answer);
      return { lock: lockView(answer.lock, principalId) };
    },

    saveIteration: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const params = request.params as IterationParams;
      const body = request.body as IterationBody;
      let content: ContentDocument;
      try {
        content = parseContentDocument(body.content);
        // Two rules the content model's own parse does not hold, and every other way in does: a
        // title that trims to nothing, which creating a component and the header both refuse
        // (issue #116), and a string Postgres cannot store - a NUL or half a surrogate pair - which
        // would otherwise fail the insert and be answered as our failure (issue #127). Neither is
        // narrowed in the parse itself, because the parse also reads what is already stored.
        if (!hasText(content.title) || !storableEverywhere(content)) throw new Error('unstorable');
      } catch {
        // A fixed message: what failed to parse is the author's content, and never goes back as prose.
        throw refused(
          400,
          'content.invalid',
          'The content is not a document this product can store.',
        );
      }
      await mayNameColumns(trx, request, content, body.openedFrom);
      const answer = await saveIteration(trx, {
        artifactId: params.id,
        principal: principalId,
        session: params.session,
        sequence: Number(params.sequence),
        openedFrom: body.openedFrom,
        content,
        ...(body.values === undefined ? {} : { values: body.values }),
      });
      if (answer.answer !== 'accepted') throw refuse(answer);
      return { sequence: answer.sequence, lock: lockView(answer.lock, principalId) };
    },

    /**
     * The caller's own retained iterations of the component, newest first, a page at a time, while
     * their session holds the lock (component-editor.md, "Recovery, as W11 builds it"). Only ever the
     * caller's own: another author who holds the lock later is answered theirs, never this one's.
     */
    listIterations: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as ComponentParams;
      const query = request.query as IterationListQuery;
      const asked = pageAsked('iterations', query);
      await mustHold(trx, id, principalId, query.session);
      const page = await listIterations(trx, { artifactId: id, principalId, ...asked });
      return {
        items: page.items.map(iterationView),
        next: cursorFor('iterations', asked.sort, asked.order, page.snapshot, page.next),
      };
    },

    /** One of them, content and values (RC-E); any other id is a 404, whoever's it is. */
    getIteration: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const params = request.params as SavedIterationParams;
      const query = request.query as SavedIterationQuery;
      await mustHold(trx, params.id, principalId, query.session);
      const iteration = await readIteration(trx, {
        artifactId: params.id,
        principalId,
        iterationId: params.iteration,
      });
      if (!iteration) throw notFound();
      return {
        ...iterationView(iteration),
        content: iteration.content as Record<string, unknown>,
        values: iteration.values,
      };
    },

    cutVersion: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<CutAnswer> => {
      const { id } = request.params as ComponentParams;
      const body = request.body as CutBody;
      const answer = await cutVersion(trx, {
        artifactId: id,
        principal: principalId,
        session: body.session,
        openedFrom: body.openedFrom,
        ...(body.note === undefined ? {} : { note: body.note }),
      });
      if (answer.answer === 'recorded') {
        return { outcome: 'cut', version: versionView(answer.version) };
      }
      if (answer.answer === 'version.unchanged') {
        return { outcome: 'unchanged', version: versionView(answer.current) };
      }
      throw refuse(answer);
    },

    releaseLock: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<CutAnswer> => {
      const { id } = request.params as ComponentParams;
      const query = request.query as ReleaseQuery;
      const answer = await releaseLock(trx, {
        artifactId: id,
        principal: principalId,
        session: query.session,
        openedFrom: query.openedFrom,
      });
      if (answer.answer !== 'released') throw refuse(answer);
      if (answer.version) return { outcome: 'cut', version: versionView(answer.version) };
      const current = await latestVersion(trx, id);
      if (!current) throw notFound();
      return { outcome: 'unchanged', version: versionView(current) };
    },
  };
}
