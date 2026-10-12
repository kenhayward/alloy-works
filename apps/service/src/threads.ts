import type {
  CommentBody,
  CommentParams,
  StartThreadBody,
  ThreadList,
  ThreadListQuery,
  ThreadParams,
  ThreadSummaryView,
  ThreadView,
} from '@alloy-works/api-contract';
import {
  addComment,
  editComment,
  latestVersion,
  listThreads,
  readThread,
  readVersion,
  resolveOccurrences,
  resolveThread,
  startThread,
  type StoredThread,
  type TenantTransaction,
  type ThreadAnswer,
  type ThreadSummary,
} from '@alloy-works/db';
import { anchorStands, readContent, readOutline, type ThreadAnchor } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { AppError } from './errors.js';
import { refused } from './wire-codes.js';

const PAGE = 50;

const person = (who: { readonly id: string; readonly name: string | null }) => ({
  id: who.id,
  name: who.name,
});

const threadView = (thread: StoredThread): ThreadView => ({
  id: thread.id,
  on: { id: thread.on, kind: thread.onKind },
  anchor: thread.anchor as unknown as Record<string, unknown>,
  madeAgainst: thread.madeAgainst,
  startedBy: person(thread.createdBy),
  startedAt: thread.createdAt.toISOString(),
  resolution:
    thread.resolution === null
      ? null
      : { by: person(thread.resolution.by), at: thread.resolution.at.toISOString() },
  comments: thread.comments.map((comment) => ({
    id: comment.id,
    author: person(comment.author),
    at: comment.createdAt.toISOString(),
    texts: comment.texts.map((text) => ({
      parts: text.parts as unknown as Record<string, unknown>[],
      at: text.writtenAt.toISOString(),
    })),
  })),
});

async function viewOf(trx: TenantTransaction, thread: string): Promise<ThreadView> {
  const read = await readThread(trx, thread);
  if (!read) throw new Error(`The thread ${thread} was not recorded`);
  return threadView(read);
}

/** A store's refusal as the wire carries it; `done` is the caller's to answer. */
function refuse(answer: Exclude<ThreadAnswer, { answer: 'done' }>): AppError {
  switch (answer.answer) {
    case 'anchor.invalid':
      return refused(400, 'anchor.invalid', 'That place is not in this version.');
    case 'parts.invalid':
      return refused(400, 'parts.invalid', `${answer.problem}.`);
    case 'missing':
      return notFound();
    case 'thread.resolved':
      return refused(409, 'thread.resolved', 'This thread is resolved.');
    case 'comment.not_yours':
      return refused(403, 'comment.not_yours', 'Only its author edits a comment.');
  }
}

/** The kind of the artifact a path names, which a route of the other kind answers as not found. */
async function kindOf(trx: TenantTransaction, id: string): Promise<string | undefined> {
  const row = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', id)
    .executeTakeFirst();
  return row?.kind;
}

/** A thread listing's cursor: the last thread's start, to the millisecond, and id. */
function cursorOf(thread: ThreadSummary): string {
  return Buffer.from(
    JSON.stringify({ v: 1, l: 'threads', a: thread.createdAt.toISOString(), i: thread.id }),
    'utf8',
  ).toString('base64url');
}

function afterOf(cursor: string | undefined): { at: Date; id: string } | undefined {
  if (cursor === undefined) return undefined;
  const refusal = new AppError(
    400,
    'invalid_request',
    'The cursor is not one this listing gave out.',
  );
  let written: { v?: unknown; l?: unknown; a?: unknown; i?: unknown };
  try {
    written = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as typeof written;
  } catch {
    throw refusal;
  }
  const at = typeof written?.a === 'string' ? new Date(written.a) : undefined;
  if (
    written?.v !== 1 ||
    written.l !== 'threads' ||
    at === undefined ||
    Number.isNaN(at.getTime()) ||
    typeof written.i !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(written.i)
  ) {
    throw refusal;
  }
  return { at, id: written.i };
}

/** Whether an anchor stands on a version, each version read once (TH-D). */
function standing(trx: TenantTransaction) {
  const read = new Map<string, Promise<Parameters<typeof anchorStands>[1] | undefined>>();
  const on = (version: string) => {
    let found = read.get(version);
    if (!found) {
      found = readVersion(trx, version).then((stored) => {
        if (!stored) return undefined;
        const context = { artifact: stored.artifactId, version: stored.id };
        const content = readContent(stored.content, context);
        if (content.ok) return { content: content.document };
        const outline = readOutline(stored.content, context);
        return outline.ok ? { outline: outline.outline } : undefined;
      });
      read.set(version, found);
    }
    return found;
  };
  return async (anchor: ThreadAnchor, version: string) => {
    const target = await on(version);
    return target !== undefined && anchorStands(anchor, target);
  };
}

const summaryView = (
  thread: ThreadSummary,
  orphaned: boolean,
  places?: { node: string; orphaned: boolean }[],
): ThreadSummaryView => ({
  id: thread.id,
  on: { id: thread.on, kind: thread.onKind },
  anchor: thread.anchor as unknown as Record<string, unknown>,
  madeAgainst: thread.madeAgainst,
  startedBy: person(thread.createdBy),
  startedAt: thread.createdAt.toISOString(),
  resolvedAt: thread.resolvedAt?.toISOString() ?? null,
  comments: thread.comments,
  lastAt: thread.lastAt.toISOString(),
  orphaned,
  ...(places === undefined ? {} : { places }),
});

/**
 * Threads (collaboration.md, Threads; the TH plan, Task 1): each decided by `authorise` on what the
 * thread is on - its path's artifact, or the thread's (TH-J) - in the transaction the handler then
 * runs in. A thread is beside the content: nothing here makes a version.
 */
export function threadHandlers() {
  const start =
    (kind: 'component' | 'document') =>
    async (request: FastifyRequest, { trx, principalId }: Authorised): Promise<ThreadView> => {
      const { id } = request.params as { id: string };
      if ((await kindOf(trx, id)) !== kind) throw notFound();
      const body = request.body as StartThreadBody;
      const answer = await startThread(trx, {
        on: id,
        version: body.version,
        anchor: body.anchor,
        parts: body.parts,
        author: principalId,
      });
      if (answer.answer === 'missing')
        throw refused(400, 'version.not_held', `That version is not one of this ${kind}'s.`);
      if (answer.answer !== 'done') throw refuse(answer);
      return viewOf(trx, answer.thread);
    };

  const list =
    (kind: 'component' | 'document') =>
    async (request: FastifyRequest, { trx, principalId }: Authorised): Promise<ThreadList> => {
      const { id } = request.params as { id: string };
      if ((await kindOf(trx, id)) !== kind) throw notFound();
      const query = request.query as ThreadListQuery;
      const limit = query.limit === undefined ? PAGE : Number(query.limit);
      const latest = await latestVersion(trx, id);
      if (!latest) throw notFound();
      const stands = standing(trx);
      // In a document's list, every readable component it places, at the version each occurrence
      // resolves to (TH-D): a component placed twice may stand in one place and not the other.
      const occurrences = new Map<string, { node: string; version: string }[]>();
      if (kind === 'document') {
        const outline = readOutline(latest.content, { artifact: id, version: latest.id });
        if (!outline.ok) throw new Error(`The document ${id} does not read`);
        for (const each of await resolveOccurrences(trx, outline.outline, principalId)) {
          if (each.outcome !== 'resolved') continue;
          const placed = occurrences.get(each.component) ?? [];
          placed.push({ node: each.node, version: each.version });
          occurrences.set(each.component, placed);
        }
      }
      const page = await listThreads(trx, {
        on: [id, ...occurrences.keys()],
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.author === undefined ? {} : { author: query.author }),
        ...(query.since === undefined ? {} : { since: new Date(query.since) }),
        ...(afterOf(query.cursor) === undefined ? {} : { after: afterOf(query.cursor)! }),
        limit: limit + 1,
      });
      const shown = page.slice(0, limit);
      const threads: ThreadSummaryView[] = [];
      for (const thread of shown) {
        if (thread.on === id) {
          threads.push(summaryView(thread, !(await stands(thread.anchor, latest.id))));
          continue;
        }
        const places = [];
        for (const placed of occurrences.get(thread.on) ?? []) {
          places.push({
            node: placed.node,
            orphaned: !(await stands(thread.anchor, placed.version)),
          });
        }
        threads.push(
          summaryView(
            thread,
            places.every((place) => place.orphaned),
            places,
          ),
        );
      }
      return {
        threads,
        next: page.length > limit ? cursorOf(shown[shown.length - 1]!) : null,
      };
    };

  return {
    startComponentThread: start('component'),
    startDocumentThread: start('document'),
    listComponentThreads: list('component'),
    listDocumentThreads: list('document'),

    getThread: async (request: FastifyRequest, { trx }: Authorised): Promise<ThreadView> => {
      const { id } = request.params as ThreadParams;
      const read = await readThread(trx, id);
      if (!read) throw notFound();
      return threadView(read);
    },

    addComment: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ThreadView> => {
      const { id } = request.params as ThreadParams;
      const { parts } = request.body as CommentBody;
      const answer = await addComment(trx, { thread: id, parts, author: principalId });
      if (answer.answer !== 'done') throw refuse(answer);
      return viewOf(trx, id);
    },

    editComment: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ThreadView> => {
      const { id, comment } = request.params as CommentParams;
      const { parts } = request.body as CommentBody;
      const answer = await editComment(trx, { thread: id, comment, parts, author: principalId });
      if (answer.answer !== 'done') throw refuse(answer);
      return viewOf(trx, id);
    },

    resolveThread: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ThreadView> => {
      const { id } = request.params as ThreadParams;
      const answer = await resolveThread(trx, { thread: id, by: principalId });
      if (answer === 'missing') throw notFound();
      if (answer === 'resolved.already')
        throw refused(409, 'thread.resolved', 'This thread is resolved.');
      return viewOf(trx, id);
    },
  };
}
