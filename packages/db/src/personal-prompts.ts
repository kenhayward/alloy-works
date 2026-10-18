import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Personal prompts (generation.md, "The conversation"; the G5 plan, G5-G; GEN-054): a person's own
 * saved words, read, changed and run by them alone. Never an artifact: no template binds one, no
 * library lists one, and nobody else is told one exists. Promotion (GEN-055) is the route's act, which
 * makes a prompt from one and records it here.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The most a person keeps. */
export const PERSONAL_PROMPTS_MOST = 200;

export interface PersonalPrompt {
  readonly id: string;
  readonly title: string;
  readonly instructions: string;
  readonly madeAt: Date;
  readonly changedAt: Date;
  /** The prompt it became, once promoted. */
  readonly promotedTo: string | null;
}

interface Row {
  id: string;
  title: string;
  instructions: string;
  made_at: Date;
  changed_at: Date;
  promoted_to: string | null;
}

const personalOf = (row: Row): PersonalPrompt => ({
  id: row.id,
  title: row.title,
  instructions: row.instructions,
  madeAt: new Date(row.made_at),
  changedAt: new Date(row.changed_at),
  promotedTo: row.promoted_to,
});

/** A person's own, the latest changed first. */
export async function listPersonalPrompts(
  trx: TenantTransaction,
  owner: string,
): Promise<PersonalPrompt[]> {
  const { rows } = await sql<Row>`select * from personal_prompt where owner = ${owner}
    order by changed_at desc, id limit ${PERSONAL_PROMPTS_MOST}`.execute(trx);
  return rows.map(personalOf);
}

/** One of the owner's own, or undefined: anybody else's is none. */
export async function readPersonalPrompt(
  trx: TenantTransaction,
  owner: string,
  id: string,
): Promise<PersonalPrompt | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`select * from personal_prompt
    where id = ${id} and owner = ${owner}`.execute(trx);
  return rows[0] && personalOf(rows[0]);
}

/** Saves a personal prompt; `full` where its owner keeps as many as they may. */
export async function savePersonalPrompt(
  trx: TenantTransaction,
  owner: string,
  words: { readonly title: string; readonly instructions: string },
): Promise<PersonalPrompt | 'full'> {
  const { rows: held } = await sql<{ n: string }>`select count(*) as n from personal_prompt
    where owner = ${owner}`.execute(trx);
  if (Number(held[0]!.n) >= PERSONAL_PROMPTS_MOST) return 'full';
  const { rows } = await sql<Row>`insert into personal_prompt (owner, title, instructions)
    values (${owner}, ${words.title.normalize('NFC')}, ${words.instructions.normalize('NFC')})
    returning *`.execute(trx);
  return personalOf(rows[0]!);
}

/** Changes one of the owner's own; undefined where they have none by that id. */
export async function changePersonalPrompt(
  trx: TenantTransaction,
  owner: string,
  id: string,
  words: { readonly title: string; readonly instructions: string },
): Promise<PersonalPrompt | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`update personal_prompt
      set title = ${words.title.normalize('NFC')}, instructions = ${words.instructions.normalize('NFC')},
          changed_at = now()
    where id = ${id} and owner = ${owner} returning *`.execute(trx);
  return rows[0] && personalOf(rows[0]);
}

/** Deletes one of the owner's own; false where they have none by that id. */
export async function deletePersonalPrompt(
  trx: TenantTransaction,
  owner: string,
  id: string,
): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const { rows } = await sql<{ id: string }>`delete from personal_prompt
    where id = ${id} and owner = ${owner} returning id`.execute(trx);
  return rows.length > 0;
}

/** Records the prompt a personal prompt became, once (GEN-055). */
export async function recordPromotion(
  trx: TenantTransaction,
  owner: string,
  id: string,
  prompt: string,
): Promise<void> {
  await sql`update personal_prompt set promoted_to = ${prompt}, promoted_kind = 'prompt',
      promoted_at = now()
    where id = ${id} and owner = ${owner} and promoted_to is null`.execute(trx);
}

/** Deletes every personal prompt of a person erased (G5-G): their own words, nobody else's record. */
export async function erasePersonalPrompts(trx: TenantTransaction, person: string): Promise<void> {
  const { rows } = await sql<{ found: boolean }>`
    select to_regclass(current_schema() || '.personal_prompt') is not null as found`.execute(trx);
  if (rows[0]?.found !== true) return;
  await sql`delete from personal_prompt where owner = ${person}`.execute(trx);
}
