import { guardrailSchema, type Guardrail, type GuardrailRule } from '@alloy-works/domain';
import { sql } from 'kysely';
import { recordEvent } from './audit.js';
import type { TenantTransaction } from './tables.js';

/**
 * A tenant's guardrails (generation.md, "Guardrails"; the G5 plan, G5-F): phrases forbidden in what a
 * model is sent and what it returns. Who may set one is the route's to decide; every one set and
 * retired is audited, and none is deleted, so a run refused by one can always say which.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface StoredGuardrail extends GuardrailRule {
  readonly madeAt: Date;
  readonly retiredAt: Date | null;
}

interface Row {
  id: string;
  phrase: string;
  applies: Guardrail['applies'];
  reason: string;
  made_at: Date;
  retired_at: Date | null;
}

const stored = (row: Row): StoredGuardrail => ({
  id: row.id,
  phrase: row.phrase,
  applies: row.applies,
  reason: row.reason,
  madeAt: new Date(row.made_at),
  retiredAt: row.retired_at === null ? null : new Date(row.retired_at),
});

/** Whether this schema holds guardrails: one before 0128 has none, and runs refuse nothing. */
async function guardrailsStored(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{ found: boolean }>`
    select to_regclass(current_schema() || '.guardrail') is not null as found`.execute(trx);
  return rows[0]?.found === true;
}

/** The tenant's guardrails, those in force first, each the newest first; with the retired, all. */
export async function listGuardrails(
  trx: TenantTransaction,
  options: { readonly retired?: boolean } = {},
): Promise<StoredGuardrail[]> {
  if (!(await guardrailsStored(trx))) return [];
  const { rows } = await sql<Row>`select * from guardrail
     ${options.retired === true ? sql`` : sql`where retired_at is null`}
     order by retired_at is not null, made_at desc, id`.execute(trx);
  return rows.map(stored);
}

/** Sets a guardrail, its shape checked again here, whatever wrote it. */
export async function setGuardrail(
  trx: TenantTransaction,
  rule: Guardrail,
  by: string,
): Promise<StoredGuardrail> {
  const checked = guardrailSchema.parse(rule);
  const { rows } = await sql<Row>`insert into guardrail (phrase, applies, reason, made_by)
    values (${checked.phrase.normalize('NFC')}, ${checked.applies}, ${checked.reason.normalize('NFC')}, ${by})
    returning *`.execute(trx);
  const made = stored(rows[0]!);
  await recordEvent(trx, {
    kind: 'guardrail.set',
    subject: { kind: 'guardrail', id: made.id },
    detail: { applies: made.applies },
  });
  return made;
}

/** Retires a guardrail in force; undefined where none in force is by that id. */
export async function retireGuardrail(
  trx: TenantTransaction,
  id: string,
): Promise<StoredGuardrail | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`update guardrail set retired_at = now()
    where id = ${id} and retired_at is null returning *`.execute(trx);
  if (!rows[0]) return undefined;
  await recordEvent(trx, {
    kind: 'guardrail.retired',
    subject: { kind: 'guardrail', id },
    detail: {},
  });
  return stored(rows[0]);
}
