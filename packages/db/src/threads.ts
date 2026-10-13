import {
  anchorStands,
  commentPartsSchema,
  labelFor,
  mentionsIn,
  readContent,
  readOutline,
  threadAnchorSchema,
  type CommentParts,
  type ThreadAnchor,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { tell } from './inbox.js';
import { AUDIT_LOG_KEPT, labelled, labels, recordEvent } from './audit.js';
import { indexMessage, indexThreadStarted, reindexMessage } from './search-threads.js';
import type { TenantTransaction } from './tables.js';
import { lockArtifact, readVersion } from './versions.js';

/** A comment as a thread holds it: who, when, and every text it has had, the latest last. */
export interface StoredComment {
  readonly id: string;
  readonly author: { readonly id: string; readonly name: string | null };
  readonly createdAt: Date;
  readonly texts: readonly { readonly parts: CommentParts; readonly writtenAt: Date }[];
}

/** A thread read whole (COL-013, COL-014, COL-051). */
export interface StoredThread {
  readonly id: string;
  readonly on: string;
  readonly onKind: 'component' | 'document';
  readonly anchor: ThreadAnchor;
  readonly madeAgainst: string;
  readonly createdBy: { readonly id: string; readonly name: string | null };
  readonly createdAt: Date;
  readonly resolution: {
    readonly by: { readonly id: string; readonly name: string | null };
    readonly at: Date;
  } | null;
  readonly comments: readonly StoredComment[];
}

/** A thread as a list shows it (COL-018). */
export interface ThreadSummary {
  readonly id: string;
  readonly on: string;
  readonly onKind: 'component' | 'document';
  readonly anchor: ThreadAnchor;
  readonly madeAgainst: string;
  readonly createdBy: { readonly id: string; readonly name: string | null };
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly comments: number;
  readonly lastAt: Date;
}

/** What starting a thread or adding to one answers. */
export type ThreadAnswer =
  | {
      readonly answer: 'done';
      readonly thread: string;
      readonly comment: string;
      readonly mentioned: readonly string[];
      /** Those it names who may not read what the thread is on, and so were told nothing (COL-015). */
      readonly untold: readonly string[];
    }
  /** The anchor does not stand on the version named (TH-C). */
  | { readonly answer: 'anchor.invalid' }
  /** The version is not one of what the thread is to be on, or there is no such thread. */
  | { readonly answer: 'missing' }
  /** A comment's text cannot be stored (TH-B), or it names somebody this environment does not hold. */
  | { readonly answer: 'parts.invalid'; readonly problem: string }
  /** The thread is resolved and takes nothing more (TH-K). */
  | { readonly answer: 'thread.resolved' }
  /** Only a comment's author edits it (COL-051). */
  | { readonly answer: 'comment.not_yours' };

/** The parts held to their shape, and every mention a principal of this environment. */
async function checkedParts(
  trx: TenantTransaction,
  given: unknown,
): Promise<{ parts: CommentParts } | { problem: string }> {
  const parsed = commentPartsSchema.safeParse(given);
  if (!parsed.success)
    return { problem: parsed.error.issues[0]?.message ?? 'A comment does not read' };
  const named = mentionsIn(parsed.data);
  if (named.length > 0) {
    const found = await trx.selectFrom('principal').select('id').where('id', 'in', named).execute();
    if (found.length !== named.length)
      return { problem: 'A comment names somebody this environment does not hold' };
  }
  return { parts: parsed.data };
}

async function recordThreadEvent(
  trx: TenantTransaction,
  kind: 'thread.started' | 'comment.added' | 'comment.edited' | 'thread.resolved',
  thread: string,
  detail: Readonly<Record<string, unknown>>,
): Promise<void> {
  const row = await trx
    .selectFrom('thread as t')
    .innerJoin('artifact_version as v', 'v.id', 't.made_against')
    .innerJoin('artifact as a', 'a.id', 't.on_id')
    .leftJoin('space as s', 's.id', 'a.space_id')
    .select([
      't.on_id',
      't.on_kind',
      't.made_against',
      'v.content',
      'a.space_id',
      's.name as space_name',
      AUDIT_LOG_KEPT.as('logged'),
    ])
    .where('t.id', '=', thread)
    .executeTakeFirstOrThrow();
  if (row.logged === false) return;
  await recordEvent(
    trx,
    {
      kind,
      subject: { kind: row.on_kind, id: row.on_id, version: row.made_against },
      space: row.space_id,
      detail,
    },
    labels(
      labelled('subject', labelFor(row.on_kind, row.content as Record<string, unknown>), row.on_id),
      labelled('space', row.space_name, row.space_id),
    ),
  );
}

/**
 * A thread started on `on` at `version` (COL-012; TH-C): the version is one of `on`'s, and the anchor
 * stands on it - a span's block holds its text, a cell's first block is in its table, a node is in the
 * outline - and its first comment with it, all in the caller's transaction, where `comment` on `on`
 * has been decided. Answers the people its comment names, for the inbox to tell (TH2).
 */
export async function startThread(
  trx: TenantTransaction,
  input: {
    readonly on: string;
    readonly version: string;
    readonly anchor: unknown;
    readonly parts: unknown;
    readonly author: string;
  },
): Promise<ThreadAnswer> {
  // Under its artifact's lock, as an archival or a deletion takes it, so its search row is flagged as
  // the acts leave it (the SV plan, SV-K).
  await lockArtifact(trx, input.on);
  const version = await readVersion(trx, input.version);
  if (!version || version.artifactId !== input.on) return { answer: 'missing' };
  if (version.kind !== 'component' && version.kind !== 'document') return { answer: 'missing' };
  const anchor = threadAnchorSchema.safeParse(input.anchor);
  if (!anchor.success) return { answer: 'anchor.invalid' };
  if (version.kind === 'component') {
    if (anchor.data.kind === 'node') return { answer: 'anchor.invalid' };
    const read = readContent(version.content, { artifact: input.on, version: version.id });
    if (!read.ok || !anchorStands(anchor.data, { content: read.document })) {
      return { answer: 'anchor.invalid' };
    }
  } else {
    if (anchor.data.kind !== 'node') return { answer: 'anchor.invalid' };
    const read = readOutline(version.content, { artifact: input.on, version: version.id });
    if (!read.ok || !anchorStands(anchor.data, { outline: read.outline })) {
      return { answer: 'anchor.invalid' };
    }
  }
  const checked = await checkedParts(trx, input.parts);
  if ('problem' in checked) return { answer: 'parts.invalid', problem: checked.problem };
  const thread = await trx
    .insertInto('thread')
    .values({
      on_id: input.on,
      on_kind: version.kind,
      made_against: version.id,
      anchor: JSON.stringify(anchor.data),
      created_by: input.author,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await recordThreadEvent(trx, 'thread.started', thread.id, {
    thread: thread.id,
    anchor: anchor.data.kind,
  });
  const comment = await insertComment(trx, thread.id, input.author, checked.parts);
  await indexThreadStarted(trx, thread.id, { comment, parts: checked.parts });
  const mentioned = mentionsIn(checked.parts);
  const { untold } = await tell(trx, {
    kind: 'mention',
    actor: input.author,
    thread: thread.id,
    artifact: input.on,
    recipients: mentioned,
  });
  return { answer: 'done', thread: thread.id, comment, mentioned, untold };
}

async function insertComment(
  trx: TenantTransaction,
  thread: string,
  author: string,
  parts: CommentParts,
): Promise<string> {
  const comment = await trx
    .insertInto('thread_comment')
    .values({ thread_id: thread, author })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('thread_comment_text')
    .values({ comment_id: comment.id, parts: JSON.stringify(parts) })
    .execute();
  await recordThreadEvent(trx, 'comment.added', thread, {
    thread,
    comment: comment.id,
    mentions: mentionsIn(parts).length,
  });
  return comment.id;
}

/** The thread, locked against a resolution racing what is being added, or none. */
/**
 * The thread, read under a transaction advisory lock on it: nobody holds update on a thread, so
 * `FOR UPDATE` is refused, and a reply and a resolution must not pass each other (TH-K).
 */
async function lockedThread(trx: TenantTransaction, thread: string) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:thread:${thread}`}, 0))`.execute(
    trx,
  );
  return trx
    .selectFrom('thread as t')
    .leftJoin('thread_resolution as r', 'r.thread_id', 't.id')
    .select(['t.id', 'r.thread_id as resolved'])
    .where('t.id', '=', thread)
    .executeTakeFirst();
}

/** A reply (COL-014): a comment on an open thread; a resolved one takes nothing (TH-K). */
export async function addComment(
  trx: TenantTransaction,
  input: { readonly thread: string; readonly parts: unknown; readonly author: string },
): Promise<ThreadAnswer> {
  const found = await lockedThread(trx, input.thread);
  if (!found) return { answer: 'missing' };
  if (found.resolved !== null) return { answer: 'thread.resolved' };
  const checked = await checkedParts(trx, input.parts);
  if ('problem' in checked) return { answer: 'parts.invalid', problem: checked.problem };
  const earlier = await threadCommenters(trx, input.thread);
  const comment = await insertComment(trx, input.thread, input.author, checked.parts);
  await indexMessage(trx, { thread: input.thread, comment, parts: checked.parts });
  const mentioned = mentionsIn(checked.parts);
  const on = (await threadOn(trx, input.thread))!;
  const { untold, told } = await tell(trx, {
    kind: 'mention',
    actor: input.author,
    thread: input.thread,
    artifact: on,
    recipients: mentioned,
  });
  // A reply tells every earlier commenter but its author, and none it has told of a mention already:
  // one whose mentions are never told is told of the reply as their reply cadence says.
  await tell(trx, {
    kind: 'reply',
    actor: input.author,
    thread: input.thread,
    artifact: on,
    recipients: earlier.filter((each) => !told.includes(each)),
  });
  return { answer: 'done', thread: input.thread, comment, mentioned, untold };
}

/**
 * A comment edited by its author (COL-051): a new text, the earlier kept. Answers the people the new
 * text names that the last did not, for the inbox to tell.
 */
export async function editComment(
  trx: TenantTransaction,
  input: {
    readonly thread: string;
    readonly comment: string;
    readonly parts: unknown;
    readonly author: string;
  },
): Promise<ThreadAnswer> {
  const found = await lockedThread(trx, input.thread);
  if (!found) return { answer: 'missing' };
  const comment = await trx
    .selectFrom('thread_comment')
    .select(['id', 'author'])
    .where('id', '=', input.comment)
    .where('thread_id', '=', input.thread)
    .executeTakeFirst();
  if (!comment) return { answer: 'missing' };
  if (comment.author !== input.author) return { answer: 'comment.not_yours' };
  if (found.resolved !== null) return { answer: 'thread.resolved' };
  const checked = await checkedParts(trx, input.parts);
  if ('problem' in checked) return { answer: 'parts.invalid', problem: checked.problem };
  const last = await trx
    .selectFrom('thread_comment_text')
    .select('parts')
    .where('comment_id', '=', input.comment)
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('thread_comment_text')
    .values({ comment_id: input.comment, parts: JSON.stringify(checked.parts) })
    .execute();
  await recordThreadEvent(trx, 'comment.edited', input.thread, {
    thread: input.thread,
    comment: input.comment,
  });
  // The first message - the first text written - titles the thread, so its edit titles it again (SV-K).
  const first = await trx
    .selectFrom('thread_comment as m')
    .innerJoin('thread_comment_text as x', 'x.comment_id', 'm.id')
    .select('m.id')
    .where('m.thread_id', '=', input.thread)
    .orderBy('x.id')
    .limit(1)
    .executeTakeFirstOrThrow();
  await reindexMessage(trx, {
    thread: input.thread,
    comment: input.comment,
    parts: checked.parts,
    first: first.id === input.comment,
  });
  // A mention an edit adds tells its person; one already there tells nobody again (TH-E).
  const before = new Set(mentionsIn(last.parts as CommentParts));
  const mentioned = mentionsIn(checked.parts).filter((each) => !before.has(each));
  const { untold } = await tell(trx, {
    kind: 'mention',
    actor: input.author,
    thread: input.thread,
    artifact: (await threadOn(trx, input.thread))!,
    recipients: mentioned,
  });
  return { answer: 'done', thread: input.thread, comment: input.comment, mentioned, untold };
}

/** A thread resolved, once (COL-013): who and when. */
export async function resolveThread(
  trx: TenantTransaction,
  input: { readonly thread: string; readonly by: string },
): Promise<'resolved' | 'resolved.already' | 'missing'> {
  const found = await lockedThread(trx, input.thread);
  if (!found) return 'missing';
  if (found.resolved !== null) return 'resolved.already';
  await trx
    .insertInto('thread_resolution')
    .values({ thread_id: input.thread, resolved_by: input.by })
    .execute();
  await tell(trx, {
    kind: 'resolution',
    actor: input.by,
    thread: input.thread,
    artifact: (await threadOn(trx, input.thread))!,
    recipients: await threadCommenters(trx, input.thread),
  });
  await recordThreadEvent(trx, 'thread.resolved', input.thread, { thread: input.thread });
  return 'resolved';
}

/** What a thread is on, which a route on it is decided on, or none. */
export async function threadOn(
  trx: TenantTransaction,
  thread: string,
): Promise<string | undefined> {
  const row = await trx
    .selectFrom('thread')
    .select('on_id')
    .where('id', '=', thread)
    .executeTakeFirst();
  return row?.on_id;
}

/** Everybody who has commented on a thread, each once, in the order they first did. */
export async function threadCommenters(trx: TenantTransaction, thread: string): Promise<string[]> {
  const rows = await trx
    .selectFrom('thread_comment')
    .select(['author'])
    .where('thread_id', '=', thread)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return [...new Set(rows.map((row) => row.author))];
}

/** A thread read whole, every comment and every text each has had (COL-014, COL-051). */
export async function readThread(
  trx: TenantTransaction,
  thread: string,
): Promise<StoredThread | undefined> {
  const row = await trx
    .selectFrom('thread as t')
    .innerJoin('principal as c', 'c.id', 't.created_by')
    .leftJoin('thread_resolution as r', 'r.thread_id', 't.id')
    .leftJoin('principal as rp', 'rp.id', 'r.resolved_by')
    .select([
      't.id',
      't.on_id',
      't.on_kind',
      't.anchor',
      't.made_against',
      't.created_by',
      'c.display_name as created_name',
      't.created_at',
      'r.resolved_by',
      'rp.display_name as resolved_name',
      'r.resolved_at',
    ])
    .where('t.id', '=', thread)
    .executeTakeFirst();
  if (!row) return undefined;
  const comments = await trx
    .selectFrom('thread_comment as m')
    .innerJoin('principal as p', 'p.id', 'm.author')
    .innerJoin('thread_comment_text as x', 'x.comment_id', 'm.id')
    .select(['m.id', 'm.author', 'p.display_name', 'm.created_at', 'x.parts', 'x.written_at'])
    .where('m.thread_id', '=', thread)
    .orderBy('m.created_at')
    .orderBy('m.id')
    .orderBy('x.id')
    .execute();
  const byId = new Map<
    string,
    StoredComment & { texts: { parts: CommentParts; writtenAt: Date }[] }
  >();
  for (const each of comments) {
    let comment = byId.get(each.id);
    if (!comment) {
      comment = {
        id: each.id,
        author: { id: each.author, name: each.display_name },
        createdAt: each.created_at,
        texts: [],
      };
      byId.set(each.id, comment);
    }
    comment.texts.push({ parts: each.parts as CommentParts, writtenAt: each.written_at });
  }
  return {
    id: row.id,
    on: row.on_id,
    onKind: row.on_kind,
    anchor: row.anchor as ThreadAnchor,
    madeAgainst: row.made_against,
    createdBy: { id: row.created_by, name: row.created_name },
    createdAt: row.created_at,
    resolution:
      row.resolved_by === null
        ? null
        : { by: { id: row.resolved_by, name: row.resolved_name }, at: row.resolved_at! },
    comments: [...byId.values()],
  };
}

/**
 * The threads on these artifacts (COL-018), newest first and paged by start and id, filtered by state, by who started them and
 * by whether anything was said since an instant. Who may read which is the caller's to have decided.
 */
export async function listThreads(
  trx: TenantTransaction,
  input: {
    readonly on: readonly string[];
    readonly state?: 'open' | 'resolved';
    readonly author?: string;
    readonly since?: Date;
    /** Where the previous page ended: the last thread's start and id. */
    readonly after?: { readonly at: Date; readonly id: string };
    readonly limit?: number;
  },
): Promise<ThreadSummary[]> {
  if (input.on.length === 0) return [];
  let query = trx
    .selectFrom('thread as t')
    .innerJoin('principal as c', 'c.id', 't.created_by')
    .leftJoin('thread_resolution as r', 'r.thread_id', 't.id')
    .innerJoin(
      (eb) =>
        eb
          .selectFrom('thread_comment')
          .select((inner) => [
            'thread_id',
            inner.fn.countAll<string>().as('comments'),
            inner.fn.max('created_at').as('last_at'),
          ])
          .groupBy('thread_id')
          .as('m'),
      (join) => join.onRef('m.thread_id', '=', 't.id'),
    )
    .select([
      't.id',
      't.on_id',
      't.on_kind',
      't.anchor',
      't.made_against',
      't.created_by',
      'c.display_name',
      't.created_at',
      'r.resolved_at',
      'm.comments',
      'm.last_at',
    ])
    .where('t.on_id', 'in', [...input.on]);
  if (input.state === 'open') query = query.where('r.thread_id', 'is', null);
  if (input.state === 'resolved') query = query.where('r.thread_id', 'is not', null);
  if (input.author !== undefined) query = query.where('t.created_by', '=', input.author);
  if (input.since !== undefined) query = query.where('m.last_at', '>', input.since);
  // Keyed to the millisecond a cursor can carry, not Postgres' microsecond.
  const started = sql<Date>`date_trunc('milliseconds', t.created_at)`;
  if (input.after !== undefined) {
    const { at, id } = input.after;
    query = query.where(sql<boolean>`(${started}, t.id) < (${at}, ${id}::uuid)`);
  }
  if (input.limit !== undefined) query = query.limit(input.limit);
  const rows = await query.orderBy(started, 'desc').orderBy('t.id', 'desc').execute();
  return rows.map((row) => ({
    id: row.id,
    on: row.on_id,
    onKind: row.on_kind,
    anchor: row.anchor as ThreadAnchor,
    madeAgainst: row.made_against,
    createdBy: { id: row.created_by, name: row.display_name },
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    comments: Number(row.comments),
    lastAt: row.last_at as Date,
  }));
}
