import { decide } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFacts } from './access-facts.js';
import { recordEvent } from './audit.js';
import { personView, type PersonView } from './person-view.js';
import { notifyTenant } from './realtime.js';
import type { TenantTransaction } from './tables.js';

/**
 * The budget (generation.md, "Cost"; the G6 plan, G6-B to G6-D): the environment's monthly limit on
 * what models cost, in one currency, the percents it alerts at, and who is told, through the inbox.
 * Nothing stops when it is spent (ADM-014). Who may set it is the route's to decide; every change is
 * audited.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The most recipients a budget names. */
export const BUDGET_RECIPIENTS_MOST = 20;

export interface GenerationBudget {
  readonly currency: string;
  readonly limitMicros: bigint;
  /** Ascending percents, at least one below 100. */
  readonly thresholds: readonly number[];
  readonly setAt: Date;
}

/** What a budget notification says (G6-D), kept in its `counts`. */
export interface BudgetCounts {
  readonly threshold: number;
  readonly currency: string;
  readonly spentMicros: string;
  readonly limitMicros: string;
  /** The month, `YYYY-MM`, UTC. */
  readonly month: string;
}

/** Whether this schema holds a budget: one before 0133 has none, and nothing alerts. */
async function budgetStored(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{ found: boolean }>`
    select to_regclass(current_schema() || '.generation_budget') is not null as found`.execute(trx);
  return rows[0]?.found === true;
}

export async function readBudget(trx: TenantTransaction): Promise<GenerationBudget | null> {
  if (!(await budgetStored(trx))) return null;
  const { rows } = await sql<{
    currency: string;
    limit_micros: string;
    thresholds: number[];
    set_at: Date;
  }>`select currency, limit_micros, thresholds, set_at from generation_budget`.execute(trx);
  const row = rows[0];
  return row
    ? {
        currency: row.currency,
        limitMicros: BigInt(row.limit_micros),
        thresholds: row.thresholds,
        setAt: new Date(row.set_at),
      }
    : null;
}

export async function budgetRecipients(trx: TenantTransaction): Promise<PersonView[]> {
  if (!(await budgetStored(trx))) return [];
  const { rows } = await sql<{ id: string; display_name: string | null; kind: string | null }>`
    select p.id, p.display_name, p.kind
      from generation_budget_recipient r join principal p on p.id = r.principal_id
     order by r.added_at, p.id`.execute(trx);
  return rows.map((row) => personView(row.id, row.display_name, row.kind));
}

/** This month's spend, UTC, in a currency, and how many runs cost something in any other. */
export async function spendThisMonth(
  trx: TenantTransaction,
  currency: string,
): Promise<{ readonly micros: bigint; readonly otherCurrencyRuns: number }> {
  const { rows } = await sql<{ micros: string | null; other: string }>`
    select coalesce(sum(cost_micros) filter (where endpoint ->> 'currency' = ${currency}), 0) as micros,
           count(*) filter (where endpoint ->> 'currency' <> ${currency} and cost_micros > 0) as other
      from generation_run
     where started_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`.execute(
    trx,
  );
  return { micros: BigInt(rows[0]?.micros ?? '0'), otherCurrencyRuns: Number(rows[0]?.other ?? 0) };
}

/** The state recorded with each change: the budget whole, never a recipient's name. */
async function recordBudget(trx: TenantTransaction): Promise<void> {
  const budget = await readBudget(trx);
  const recipients = await budgetRecipients(trx);
  await recordEvent(trx, {
    kind: 'generation.budget_set',
    subject: { kind: 'tenant' },
    detail: {
      currency: budget?.currency ?? null,
      limit: budget === null ? null : budget.limitMicros.toString(),
      thresholds: budget === null ? [] : [...budget.thresholds],
      recipients: recipients.length,
    },
  });
}

/** Sets the budget, or with null lifts it. Its shape is the route's to check, and the table's. */
export async function setBudget(
  trx: TenantTransaction,
  budget: Omit<GenerationBudget, 'setAt'> | null,
  by: string,
): Promise<void> {
  if (budget === null) await sql`delete from generation_budget`.execute(trx);
  else {
    await sql`insert into generation_budget (only_one, currency, limit_micros, thresholds, set_by)
      values (true, ${budget.currency}, ${budget.limitMicros.toString()},
        ${[...budget.thresholds]}::integer[], ${by})
      on conflict (only_one) do update set currency = excluded.currency,
        limit_micros = excluded.limit_micros, thresholds = excluded.thresholds,
        set_by = excluded.set_by, set_at = now()`.execute(trx);
  }
  await recordBudget(trx);
}

/** Whether a person may be told of spend: from inside, and administering the environment now. */
export async function mayBeToldOfSpend(
  trx: TenantTransaction,
  principal: string,
): Promise<boolean> {
  if (!UUID.test(principal)) return false;
  const facts = await loadFacts(trx, principal, { kind: 'tenant' });
  return (
    facts !== undefined &&
    facts.principal.kind !== 'external' &&
    decide('administer', facts).allowed
  );
}

/**
 * Names who is told, replacing who was. Answers those who may not be told (G6-D), naming none of them
 * and changing nothing, where any is.
 */
export async function setBudgetRecipients(
  trx: TenantTransaction,
  principals: readonly string[],
  by: string,
): Promise<{ readonly refused: readonly string[] }> {
  const named = [...new Set(principals)];
  const refused: string[] = [];
  for (const each of named) if (!(await mayBeToldOfSpend(trx, each))) refused.push(each);
  if (refused.length > 0) return { refused };
  await sql`delete from generation_budget_recipient`.execute(trx);
  for (const each of named) {
    await sql`insert into generation_budget_recipient (principal_id, added_by)
      values (${each}, ${by})`.execute(trx);
  }
  await recordBudget(trx);
  return { refused: [] };
}

/**
 * Tells each recipient of every threshold this month's spend has crossed and not yet alerted at this
 * limit (G6-D), under the budget's lock so runs ending at once are summed one after another. In a
 * savepoint: a failure here is answered, never thrown, so it never un-ends the run that called it.
 */
export async function alertSpend(
  trx: TenantTransaction,
): Promise<{ readonly told: number } | { readonly failed: unknown }> {
  if (!(await budgetStored(trx))) return { told: 0 };
  await sql`savepoint alert_spend`.execute(trx);
  try {
    await sql`select pg_advisory_xact_lock(hashtextextended('generation_budget', 0))`.execute(trx);
    const budget = await readBudget(trx);
    let told = 0;
    if (budget !== null) {
      const { micros } = await spendThisMonth(trx, budget.currency);
      const { rows: months } = await sql<{ month: string }>`
        select to_char(now() at time zone 'utc', 'YYYY-MM') as month`.execute(trx);
      const month = months[0]!.month;
      for (const threshold of budget.thresholds) {
        if (micros * 100n < budget.limitMicros * BigInt(threshold)) continue;
        const { rows: fresh } = await sql<{ threshold: number }>`
          insert into generation_budget_alert (month, threshold, limit_micros)
          values (${`${month}-01`}::date, ${threshold}, ${budget.limitMicros.toString()})
          on conflict do nothing returning threshold`.execute(trx);
        if (fresh.length === 0) continue;
        const counts: BudgetCounts = {
          threshold,
          currency: budget.currency,
          spentMicros: micros.toString(),
          limitMicros: budget.limitMicros.toString(),
          month,
        };
        const { rows: recipients } = await sql<{ principal_id: string }>`
          select principal_id from generation_budget_recipient order by added_at`.execute(trx);
        for (const { principal_id: recipient } of recipients) {
          // Decided when told: somebody no longer administering is told nothing of spend.
          if (!(await mayBeToldOfSpend(trx, recipient))) continue;
          await sql`insert into notification (recipient, kind, counts)
            values (${recipient}, 'budget', ${JSON.stringify(counts)}::jsonb)`.execute(trx);
          await notifyTenant(trx, { kind: 'inbox', recipient });
          told += 1;
        }
      }
    }
    await sql`release savepoint alert_spend`.execute(trx);
    return { told };
  } catch (error) {
    await sql`rollback to savepoint alert_spend`.execute(trx);
    return { failed: error };
  }
}
