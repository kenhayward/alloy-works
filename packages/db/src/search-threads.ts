import {
  configurationFor,
  messageWords,
  threadTitle,
  type CommentParts,
  type ThreadAnchor,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { archivalStored, isArchived } from './archival.js';
import { deletionStored, isDeleted } from './deletion.js';
import type { TenantTransaction } from './tables.js';

/**
 * Threads in search (SCH-071; the SV plan, SV-K, SV-L): one `search_entry` per thread, on the artifact
 * it is anchored to, its messages places of their own. Written whole when a thread starts or the
 * projection is rebuilt; a message after that is appended, and an edit rebuilt from the entry's own
 * places, never by reading the thread again.
 */

const vectorKnown = new WeakMap<TenantTransaction, boolean>();

/**
 * Whether `search_entry.vector` is a plain column yet (0089), which every writer then sets, and threads
 * are indexed: a version written before then - which only a test migrated to an earlier point writes -
 * is indexed as it always was, and 0089's run writes every thread.
 */
export async function vectorStored(trx: TenantTransaction): Promise<boolean> {
  const known = vectorKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{ plain: boolean }>`
    select exists (
      select 1 from pg_attribute
       where attrelid = to_regclass('search_entry') and attname = 'vector'
         and not attisdropped and attgenerated = ''
    ) as plain`.execute(trx);
  const plain = rows[0]?.plain === true;
  vectorKnown.set(trx, plain);
  return plain;
}

const place = (comment: string) => `message:${comment}`;

/**
 * The most characters a thread's entry holds as a whole: a message past it is still a place of its own,
 * but adds nothing to the whole, so the entry's vector stays well inside the 1 MB a tsvector holds
 * (about three bytes of vector a character at worst) and no message is refused for the thread's length.
 */
export const THREAD_WORDS_MAX = 300_000;

/** The texts, in order, whose words the whole holds: each whole, until the next would pass the bound. */
function within(texts: readonly { readonly text: string }[]): string {
  let body = '';
  for (const each of texts) {
    const next = body === '' ? each.text : `${body} ${each.text}`;
    if (next.length > THREAD_WORDS_MAX) break;
    body = next;
  }
  return body;
}

/** A thread's entry whole, from its row and these messages, the first first. */
async function writeThread(
  trx: TenantTransaction,
  thread: string,
  messages: readonly { readonly comment: string; readonly parts: CommentParts }[],
  changedAt: Date,
): Promise<void> {
  const row = await trx
    .selectFrom('thread as t')
    .innerJoin('artifact as a', 'a.id', 't.on_id')
    .innerJoin('artifact_version as v', 'v.id', 't.made_against')
    .select([
      't.on_id',
      't.anchor',
      't.made_against',
      't.created_by',
      'a.space_id',
      sql<string | null>`v.content ->> 'language'`.as('language'),
    ])
    .where('t.id', '=', thread)
    .executeTakeFirstOrThrow();
  const anchor = row.anchor as ThreadAnchor;
  const configuration = configurationFor(row.language);
  const said = messages.map((each) => ({ comment: each.comment, text: messageWords(each.parts) }));
  // A span's quoted text is where it stands; each message a place of its own. Never a name (SV-J).
  const texts = [
    ...(anchor.kind === 'span' ? [{ place: 'anchor', text: anchor.quote }] : []),
    ...said.flatMap((each) =>
      each.text === '' ? [] : [{ place: place(each.comment), text: each.text }],
    ),
  ];
  const body = within(texts);
  // As the acts left its artifact, read under its lock (startThread, reindexSearch).
  const archived = (await archivalStored(trx)) && (await isArchived(trx, row.on_id));
  const deleted = (await deletionStored(trx)) && (await isDeleted(trx, row.on_id));
  const entry = await trx
    .insertInto('search_entry')
    .values({
      artifact_id: row.on_id,
      kind: 'thread',
      node: anchor.kind === 'node' ? anchor.node : null,
      thread_id: thread,
      version_id: row.made_against,
      space_id: row.space_id,
      title: threadTitle(said[0]?.text ?? ''),
      owner: row.created_by,
      changed_at: changedAt,
      component_type: null,
      field_values: '{}',
      configuration,
      body,
      vector: sql<string>`to_tsvector(${configuration}::regconfig, ${body})`,
      archived,
      deleted,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (texts.length > 0) {
    await trx
      .insertInto('search_text')
      .values(
        texts.map((each) => ({
          entry_id: entry.id,
          place: each.place,
          body: each.text,
          configuration,
        })),
      )
      .execute();
  }
}

/** A thread's entry as it starts, with its first message, in its transaction (SCH-066). */
export async function indexThreadStarted(
  trx: TenantTransaction,
  thread: string,
  first: { readonly comment: string; readonly parts: CommentParts },
): Promise<void> {
  if (!(await vectorStored(trx))) return;
  const { rows } = await sql<{ at: Date }>`select now() as at`.execute(trx);
  await writeThread(trx, thread, [first], rows[0]!.at);
}

/**
 * A message appended to its thread's entry (SV-L): its place inserted, and its words added to the
 * entry's body and vector. Reads nothing of the thread, nor any other message.
 */
export async function indexMessage(
  trx: TenantTransaction,
  input: { readonly thread: string; readonly comment: string; readonly parts: CommentParts },
): Promise<void> {
  if (!(await vectorStored(trx))) return;
  const text = messageWords(input.parts);
  // Past the bound, the message is a place alone (THREAD_WORDS_MAX).
  const fits = sql`length(body) + 1 + ${text.length}::int <= ${THREAD_WORDS_MAX}::int`;
  const { rows } = await sql<{ id: string; configuration: string }>`
    update search_entry
       set body = case when ${fits} then concat_ws(' ', nullif(body, ''), nullif(${text}, ''))
                       else body end,
           vector = case when ${fits} then vector || to_tsvector(configuration, ${text})
                         else vector end,
           changed_at = now()
     where thread_id = ${input.thread}
    returning id, configuration`.execute(trx);
  const entry = rows[0];
  if (!entry || text === '') return;
  await trx
    .insertInto('search_text')
    .values({
      entry_id: entry.id,
      place: place(input.comment),
      body: text,
      configuration: entry.configuration as never,
    })
    .execute();
}

/**
 * A message's new text (SV-L): its place replaced, and the entry's body and vector made again from its
 * own places, never the thread's words. Their order is the one they were written in, each message by
 * its first text's identity, as the start and the rebuild read it; that order is all it reads of the
 * thread. The first message's edit titles the thread again.
 */
export async function reindexMessage(
  trx: TenantTransaction,
  input: {
    readonly thread: string;
    readonly comment: string;
    readonly parts: CommentParts;
    readonly first: boolean;
  },
): Promise<void> {
  if (!(await vectorStored(trx))) return;
  const entry = await trx
    .selectFrom('search_entry')
    .select(['id', 'configuration'])
    .where('thread_id', '=', input.thread)
    .executeTakeFirst();
  if (!entry) return;
  const text = messageWords(input.parts);
  await trx
    .deleteFrom('search_text')
    .where('entry_id', '=', entry.id)
    .where('place', '=', place(input.comment))
    .execute();
  if (text !== '') {
    await trx
      .insertInto('search_text')
      .values({
        entry_id: entry.id,
        place: place(input.comment),
        body: text,
        configuration: entry.configuration,
      })
      .execute();
  }
  const { rows } = await sql<{ body: string }>`
    select t.body
      from search_text t
      left join lateral (
        select min(x.id) as first from thread_comment_text x
         where t.place like 'message:%' and x.comment_id = substr(t.place, 9)::uuid
      ) w on true
     where t.entry_id = ${entry.id}
     order by t.place = 'anchor' desc, w.first, t.place`.execute(trx);
  const body = within(rows.map((row) => ({ text: row.body })));
  await sql`
    update search_entry e
       set body = ${body},
           vector = to_tsvector(e.configuration, ${body}),
           title = ${input.first ? sql`${threadTitle(text)}` : sql`e.title`},
           changed_at = now()
     where e.id = ${entry.id}`.execute(trx);
}

/**
 * Every thread's entry again, from its tables (0089's run, and a whole rebuild): each message at its
 * latest text, changed when its last text was written. Each thread's artifact under its lock is the
 * caller's: a migration holds the whole schema.
 */
export async function indexEveryThread(trx: TenantTransaction): Promise<void> {
  if (!(await vectorStored(trx))) return;
  await trx.deleteFrom('search_entry').where('thread_id', 'is not', null).execute();
  // In the order each was first written: a text's identity is the order texts were written in.
  const texts = await trx
    .selectFrom('thread_comment as m')
    .innerJoin('thread_comment_text as x', 'x.comment_id', 'm.id')
    .select(['m.thread_id', 'm.id', 'x.parts', 'x.written_at'])
    .orderBy('x.id')
    .execute();
  const threads = new Map<string, { comment: string; parts: CommentParts; at: Date }[]>();
  for (const each of texts) {
    const held = threads.get(each.thread_id) ?? [];
    const message = { comment: each.id, parts: each.parts as CommentParts, at: each.written_at };
    // A later text replaces the message's earlier one: the latest is its own (COL-051).
    const at = held.findIndex((one) => one.comment === each.id);
    if (at < 0) held.push(message);
    else held[at] = message;
    threads.set(each.thread_id, held);
  }
  for (const [thread, held] of threads) {
    const changed = new Date(Math.max(...held.map((each) => each.at.getTime())));
    await writeThread(trx, thread, held, changed);
  }
}
