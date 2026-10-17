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
  TakeAnswer,
  TakeBody,
  DiscardAnswer,
  DiscardBody,
} from '@alloy-works/api-contract';
import {
  claimLock,
  cutVersion,
  labels,
  principalLabel,
  recordEvent,
  takeLock,
  holding,
  isHolderRefusal,
  headVersion,
  latestVersion,
  discardUnsaved,
  listIterations,
  newestUncutIteration,
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
import { lockView, shownVersionView, versionView } from './components.js';
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

/**
 * The columns a bound table names: those it shows, those it sorts by, and those its notes anchor to -
 * a keyed note's key columns among them, which it need not show (TB3.3).
 */
const namedBy = (table: BoundTableNode) =>
  new Set([
    ...table.columns.map((each) => each.column),
    ...(table.sort ?? []).map((each) => each.column),
    // A grouped column prints its values as headings, and a subtotal column decides which rows are
    // totals (TG1): each is a column named.
    ...(table.groups ?? []).flatMap((each) =>
      each.subtotal === undefined ? [each.column] : [each.column, each.subtotal],
    ),
    // A transposed table's header column heads its columns (TG2).
    ...(table.transpose === undefined ? [] : [table.transpose.header]),
    ...(table.notes ?? []).flatMap(({ anchor }) =>
      anchor.kind === 'keyed'
        ? [anchor.column, ...Object.keys(anchor.key)]
        : anchor.kind === 'column'
          ? [anchor.column]
          : [],
    ),
  ]);

/**
 * Each keyed note a bound table holds, by its key and column: a key held in a note is a question asked
 * of the result - whether a row has it - which the rows route answers (the TB3 final review, M1).
 */
const keyedBy = (table: BoundTableNode) =>
  new Set(
    (table.notes ?? []).flatMap(({ anchor }) =>
      anchor.kind === 'keyed'
        ? [
            JSON.stringify([
              Object.entries(anchor.key).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
              anchor.column,
            ]),
          ]
        : [],
    ),
  );

/**
 * Content a save, a suggestion or an acceptance may store (the SG plan, SG-B): the content model's
 * parse, and two rules it does not hold and every other way in does - a title that trims to nothing,
 * which creating a component and the header both refuse (issue #116), and a string Postgres cannot
 * store, a NUL or half a surrogate pair, which would otherwise fail the insert and be answered as our
 * failure (issue #127). Neither is narrowed in the parse itself, which also reads what is stored.
 */
export function storableContent(value: unknown): ContentDocument {
  try {
    const content = parseContentDocument(value);
    if (!storable(content)) throw new Error('unstorable');
    return content;
  } catch {
    // A fixed message: what failed to parse is the author's content, and never goes back as prose.
    throw refused(400, 'content.invalid', 'The content is not a document this product can store.');
  }
}

/** `storableContent`'s two rules beyond the parse, for content already read (the RS final review). */
export function storable(content: ContentDocument): boolean {
  return hasText(content.title) && storableEverywhere(content);
}

/**
 * **A column is named only by whoever may read its definition** (the TB2 final review): a bound table's
 * columns and sort stand outside its binding's digest, so a result already held would otherwise show a
 * column chosen by an author who may not read the definition - which the Value dialog asks of whoever
 * places one. A save naming, in a bound table, a column the version it opened from did not name there
 * under the same definition is refused `definition_unreadable` unless the saver may read the definition.
 * A header renamed, a column moved or removed, is never refused. **A keyed note is a question too**:
 * one whose key and column the version it opened from did not hold there is refused the same way, so
 * nobody who may not read the definition probes a key value through the rows route's `notes`.
 */
export async function mayNameColumns(
  trx: TenantTransaction,
  request: FastifyRequest,
  content: ContentDocument,
  openedFrom: string,
): Promise<void> {
  if (await namesUnreadableColumn(trx, request, content, openedFrom)) {
    throw refused(
      403,
      'definition.unreadable',
      'A bound table names a column of a query definition you may not read.',
    );
  }
}

/** Whether `mayNameColumns` refuses this content, answered rather than thrown. */
export async function namesUnreadableColumn(
  trx: TenantTransaction,
  request: FastifyRequest,
  content: ContentDocument,
  openedFrom: string,
): Promise<boolean> {
  const tables = boundTablesIn(content.content);
  if (tables.length === 0) return false;
  const before = new Map(
    boundTablesIn((await readVersion(trx, openedFrom))?.content ?? null).map((table) => [
      table.id,
      table,
    ]),
  );
  const reads = definitionReader(trx, callerOf(request));
  for (const table of tables) {
    const was = before.get(table.id);
    const same = was?.binding.query === table.binding.query;
    const named = same ? namedBy(was) : new Set<string>();
    const keyed = same ? keyedBy(was) : new Set<string>();
    const added =
      [...namedBy(table)].some((column) => !named.has(column)) ||
      [...keyedBy(table)].some((asked) => !keyed.has(asked));
    if (added && !(await reads(table.binding.query))) return true;
  }
  return false;
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
    case 'lock.taken':
      return refused(409, 'lock.taken', 'Somebody has taken over this component.', {
        holder: { id: refusal.lock.holder, name: refusal.lock.holderName },
        expectedRelease: refusal.lock.expiresAt.toISOString(),
      });
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

    /**
     * Taking a lock from an idle holder (COL-009, COL-046, COL-047; collaboration.md, Taking): asked,
     * then taken once the holder's grace has passed with them idle, and the taking recorded.
     */
    takeLock: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TakeAnswer> => {
      const { id } = request.params as ComponentParams;
      const { session } = request.body as TakeBody;
      const answer = await takeLock(trx, { artifactId: id, principal: principalId, session });
      switch (answer.answer) {
        case 'taken':
          await recordEvent(
            trx,
            {
              kind: 'lock.taken',
              subject: { kind: 'component', id },
              detail: { from: answer.from.holder, session: answer.from.session },
            },
            labels(await principalLabel(trx, 'holder', answer.from.holder)),
          );
          return { taken: true, lock: lockView(answer.lock, principalId) };
        case 'asked':
          return {
            taken: false,
            lock: lockView(answer.lock, principalId),
            retryAfterMs: answer.retryAfterMs,
          };
        case 'lock.free':
          throw refused(
            409,
            'lock.free',
            'Nobody holds this component: begin editing to claim it.',
          );
        case 'lock.own':
          throw refused(409, 'lock.own', 'You hold this component already: continue here instead.');
        case 'lock.active':
          throw refused(
            409,
            'lock.active',
            'Its holder has been working on it too recently to ask for it.',
            {
              holder: { id: answer.lock.holder, name: answer.lock.holderName },
              takeableAt: answer.lock.takeableAt.toISOString(),
            },
          );
        case 'lock.taking':
          throw refused(409, 'lock.taking', 'Somebody else has asked for this component.', {
            taking: { id: answer.lock.taking!.by, name: answer.lock.taking!.byName },
          });
        case 'artifact.missing':
          throw notFound();
      }
    },

    saveIteration: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const params = request.params as IterationParams;
      const body = request.body as IterationBody;
      const content = storableContent(body.content);
      await mayNameColumns(trx, request, content, body.openedFrom);
      const answer = await saveIteration(trx, {
        artifactId: params.id,
        principal: principalId,
        session: params.session,
        sequence: Number(params.sequence),
        openedFrom: body.openedFrom,
        content,
        ...(body.values === undefined ? {} : { values: body.values }),
        ...(body.line === undefined ? {} : { line: body.line }),
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

    /**
     * Discard (the R2 plan): the caller's unversioned work, saved up to `upTo`, no longer offered. No
     * lock is needed: it changes what is offered to the caller alone, and deletes nothing.
     */
    discardUnsaved: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<DiscardAnswer> => {
      const { id } = request.params as ComponentParams;
      const { upTo } = request.body as DiscardBody;
      const owner = { artifactId: id, principalId };
      await discardUnsaved(trx, owner, new Date(upTo));
      const unsaved = await newestUncutIteration(trx, owner);
      return { unsaved: unsaved === null ? null : { savedAt: unsaved.toISOString() } };
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
        ...(body.line === undefined ? {} : { line: body.line }),
      });
      if (answer.answer === 'recorded') {
        return { outcome: 'cut', version: await shownVersionView(trx, answer.version) };
      }
      if (answer.answer === 'version.unchanged') {
        return { outcome: 'unchanged', version: await shownVersionView(trx, answer.current) };
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
        ...(query.line === undefined ? {} : { line: query.line }),
      });
      if (answer.answer !== 'released') throw refuse(answer);
      if (answer.version)
        return { outcome: 'cut', version: await shownVersionView(trx, answer.version) };
      const current = await headVersion(trx, id, query.line);
      if (!current) throw notFound();
      return { outcome: 'unchanged', version: await shownVersionView(trx, current) };
    },
  };
}
