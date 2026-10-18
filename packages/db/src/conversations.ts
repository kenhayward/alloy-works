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
}

const conversationOf = (row: Row): Conversation => ({
  id: row.id,
  owner: row.owner,
  documentId: row.document_id,
  title: row.title,
  madeAt: new Date(row.made_at),
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

/** A person's conversations, the newest first: on one document, or every one where none is named. */
export async function listConversations(
  trx: TenantTransaction,
  owner: string,
  filter: { readonly documentId?: string } = {},
): Promise<Conversation[]> {
  if (filter.documentId !== undefined && !UUID.test(filter.documentId)) return [];
  const { rows } = await sql<Row>`select * from conversation
     where owner = ${owner}
       ${filter.documentId === undefined ? sql`` : sql`and document_id = ${filter.documentId}`}
     order by made_at desc, id
     limit 200`.execute(trx);
  return rows.map(conversationOf);
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
