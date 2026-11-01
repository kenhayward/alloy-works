import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Conversations (generation.md, "The conversation"; the G5 plan, G5-A): a person's sequence of runs,
 * on a document or on none. Who may read one is its owner alone, which the routes decide; each turn
 * is a run naming it, kept as every run is.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The most turns one conversation takes (G5-A): past it, a new one is started. */
export const CONVERSATION_TURNS_MOST = 20;

export interface Conversation {
  readonly id: string;
  readonly owner: string | null;
  readonly documentId: string | null;
  readonly title: string;
  readonly madeAt: Date;
  /** Kept by its owner, and so listed (the DQ plan); one not kept stays with its runs, unlisted. */
  readonly kept: boolean;
}

/** One turn as the conversation shows it: its words, how it ended, and what it ran on. */
export interface Turn {
  readonly run: string;
  readonly ask: string | null;
  readonly reply: string | null;
  readonly outcome: string;
  readonly endpoint: { readonly name: string; readonly boundary: string };
  readonly model: string | null;
  readonly startedAt: Date;
}

interface Row {
  id: string;
  owner: string | null;
  document_id: string | null;
  title: string;
  made_at: Date;
  kept: boolean;
}

const conversationOf = (row: Row): Conversation => ({
  id: row.id,
  owner: row.owner,
  documentId: row.document_id,
  title: row.title,
  madeAt: new Date(row.made_at),
  kept: row.kept,
});

/** A conversation's title: its first words, trimmed to 200 characters, or a plain one. */
export function titleFrom(words: string): string {
  const flat = words.replace(/\s+/g, ' ').trim();
  if (flat === '') return 'A conversation';
  const characters = [...flat];
  return characters.length <= 200 ? flat : `${characters.slice(0, 199).join('')}…`;
}

/** Starts a conversation of `owner`'s, on a document or on none. The caller decided they may. */
export async function startConversation(
  trx: TenantTransaction,
  input: { readonly owner: string; readonly documentId: string | null; readonly title: string },
): Promise<Conversation> {
  const { rows } = await sql<Row>`insert into conversation (owner, document_id, title)
    values (${input.owner}, ${input.documentId}, ${titleFrom(input.title)})
    returning *`.execute(trx);
  return conversationOf(rows[0]!);
}

/** A conversation, or undefined where none is by that id. Whose it is the caller decides. */
export async function readConversation(
  trx: TenantTransaction,
  id: string,
): Promise<Conversation | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`select * from conversation where id = ${id}`.execute(trx);
  return rows[0] && conversationOf(rows[0]);
}

/**
 * A person's conversations they kept, the newest first: on one document, or every one where none is
 * named. One not kept is never listed again (the DQ plan).
 */
export async function listConversations(
  trx: TenantTransaction,
  owner: string,
  filter: { readonly documentId?: string } = {},
): Promise<Conversation[]> {
  if (filter.documentId !== undefined && !UUID.test(filter.documentId)) return [];
  const { rows } = await sql<Row>`select * from conversation
     where owner = ${owner} and kept
       ${filter.documentId === undefined ? sql`` : sql`and document_id = ${filter.documentId}`}
     order by made_at desc, id
     limit 200`.execute(trx);
  return rows.map(conversationOf);
}

/**
 * A conversation named, or kept or let go, by its owner (the DQ plan): the title as given, which the
 * caller trimmed and bounded. Undefined where none is by that id. Whose it is the caller decides.
 */
export async function updateConversation(
  trx: TenantTransaction,
  id: string,
  change: { readonly title?: string; readonly kept?: boolean },
): Promise<Conversation | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`update conversation set
      title = coalesce(${change.title ?? null}, title),
      kept = coalesce(${change.kept ?? null}::boolean, kept)
    where id = ${id}
    returning *`.execute(trx);
  return rows[0] && conversationOf(rows[0]);
}

/** A conversation's turns, oldest first. */
export async function turnsOf(trx: TenantTransaction, conversation: string): Promise<Turn[]> {
  const { rows } = await sql<{
    id: string;
    ask: string | null;
    reply: string | null;
    outcome: string;
    endpoint: Record<string, unknown>;
    model: string | null;
    started_at: Date;
  }>`select id, ask, reply, outcome, endpoint, model, started_at from generation_run
      where conversation_id = ${conversation}
      order by started_at, id`.execute(trx);
  return rows.map((row) => ({
    run: row.id,
    ask: row.ask,
    reply: row.reply,
    outcome: row.outcome,
    endpoint: {
      name: String(row.endpoint.name ?? ''),
      boundary: String(row.endpoint.boundary ?? ''),
    },
    model: row.model,
    startedAt: new Date(row.started_at),
  }));
}

/** The most parts a conversation's tray holds (G5-D). */
export const TRAY_PARTS_MOST = 50;

/** A part in a tray: the component, and how it came there. */
export interface TrayPart {
  readonly component: string;
  /** The run whose read added it, or null where the person did. */
  readonly addedByRun: string | null;
  readonly addedAt: Date;
}

/** A conversation's tray, the oldest added first. Whether its person may read each is decided again. */
export async function trayOf(trx: TenantTransaction, conversation: string): Promise<TrayPart[]> {
  const { rows } = await sql<{ component_id: string; added_by_run: string | null; added_at: Date }>`
    select component_id, added_by_run, added_at from conversation_context
     where conversation_id = ${conversation} and removed_at is null
     order by id`.execute(trx);
  return rows.map((row) => ({
    component: row.component_id,
    addedByRun: row.added_by_run,
    addedAt: new Date(row.added_at),
  }));
}

/**
 * Adds a component to a tray, once: `added` where it was put there, `held` where it already was,
 * `full` where the tray holds as many as it may. The caller decided its person may read it.
 */
export async function addToTray(
  trx: TenantTransaction,
  input: { readonly conversation: string; readonly component: string; readonly run?: string },
): Promise<'added' | 'held' | 'full'> {
  if (!UUID.test(input.component)) return 'held';
  const held = await trayOf(trx, input.conversation);
  if (held.some((each) => each.component === input.component)) return 'held';
  if (held.length >= TRAY_PARTS_MOST) return 'full';
  await sql`insert into conversation_context (conversation_id, component_id, added_by_run)
    values (${input.conversation}, ${input.component}, ${input.run ?? null})
    on conflict do nothing`.execute(trx);
  return 'added';
}

/** Removes a component from a tray; false where it was not in it. */
export async function removeFromTray(
  trx: TenantTransaction,
  conversation: string,
  component: string,
): Promise<boolean> {
  if (!UUID.test(component)) return false;
  const { rows } = await sql<{ id: string }>`update conversation_context set removed_at = now()
     where conversation_id = ${conversation} and component_id = ${component} and removed_at is null
     returning id`.execute(trx);
  return rows.length > 0;
}
