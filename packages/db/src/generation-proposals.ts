import type { ContentDocument } from '@alloy-works/domain';
import { sql } from 'kysely';

import { recordEvent } from './audit.js';
import type { TenantTransaction } from './tables.js';

/**
 * The edits a run proposes (generation.md, "Proposals"; the G2 plan, G2-E): each a row of its own,
 * open until its requester accepts it, keeps it as a suggestion or discards it, once; a kept one is
 * resolved once, by whatever resolves its suggestion. Each act is recorded as the person's.
 */

export type ProposalState = 'open' | 'accepted' | 'kept' | 'discarded' | 'resolved';

export interface GenerationProposal {
  readonly id: string;
  readonly runId: string;
  readonly number: number;
  readonly componentId: string;
  readonly madeAgainst: string;
  readonly proposed: ContentDocument;
  readonly state: ProposalState;
  readonly suggestionId: string | null;
  readonly actedBy: string | null;
  readonly actedAt: Date | null;
  readonly madeAt: Date;
  /** The run's requester, who alone acts on it, and its digest, which a suggestion copies. */
  readonly requestedBy: string | null;
  readonly contextDigest: string;
  /** Its run's outcome: `running` until the run ends. */
  readonly runOutcome: string;
}

interface Row {
  id: string;
  run_id: string;
  number: number;
  component_id: string;
  made_against: string;
  proposed: ContentDocument;
  state: ProposalState;
  suggestion_id: string | null;
  acted_by: string | null;
  acted_at: Date | null;
  made_at: Date;
  requested_by: string | null;
  context_digest: string;
  run_outcome: string;
}

const proposalOf = (row: Row): GenerationProposal => ({
  id: row.id,
  runId: row.run_id,
  number: row.number,
  componentId: row.component_id,
  madeAgainst: row.made_against,
  proposed: row.proposed,
  state: row.state,
  suggestionId: row.suggestion_id,
  actedBy: row.acted_by,
  actedAt: row.acted_at,
  madeAt: row.made_at,
  requestedBy: row.requested_by,
  contextDigest: row.context_digest,
  runOutcome: row.run_outcome,
});

const selected = sql`select p.*, r.requested_by, r.context_digest, r.outcome as run_outcome
  from generation_proposal p join generation_run r on r.id = p.run_id`;

/** A proposal made by a run while it runs, numbered in order. */
export async function makeProposal(
  trx: TenantTransaction,
  input: {
    readonly run: string;
    readonly component: string;
    readonly against: string;
    readonly proposed: ContentDocument;
  },
): Promise<GenerationProposal> {
  const { rows } = await sql<{ id: string }>`insert into generation_proposal
      (run_id, number, component_id, made_against, proposed)
    values (${input.run},
      (select coalesce(max(number), 0) + 1 from generation_proposal where run_id = ${input.run}),
      ${input.component}, ${input.against}, ${JSON.stringify(input.proposed)}::jsonb)
    returning id`.execute(trx);
  return (await readProposal(trx, rows[0]!.id))!;
}

export async function readProposal(
  trx: TenantTransaction,
  id: string,
  held = false,
): Promise<GenerationProposal | undefined> {
  const { rows } = await sql<Row>`${selected} where p.id = ${id}
    ${held ? sql`for update of p` : sql``}`.execute(trx);
  return rows[0] && proposalOf(rows[0]);
}

export async function proposalsOfRun(
  trx: TenantTransaction,
  run: string,
): Promise<GenerationProposal[]> {
  const { rows } = await sql<Row>`${selected} where p.run_id = ${run} order by p.number`.execute(
    trx,
  );
  return rows.map(proposalOf);
}

async function generationEvent(
  trx: TenantTransaction,
  kind: 'generation.accepted' | 'generation.discarded',
  proposal: GenerationProposal,
  detail: Readonly<Record<string, unknown>>,
): Promise<void> {
  await recordEvent(trx, {
    kind,
    subject: { kind: 'component', id: proposal.componentId, version: proposal.madeAgainst },
    detail: { run: proposal.runId, proposal: proposal.id, ...detail },
  });
}

/**
 * Acts on an open proposal, once: `accepted` or `kept` with the suggestion made from it, or
 * `discarded`. Its acceptance and its discard are events of their own, as the person's (GEN-024,
 * GEN-040; LIF-071).
 */
export async function actOnProposal(
  trx: TenantTransaction,
  input: {
    readonly proposal: GenerationProposal;
    readonly act: 'accepted' | 'kept' | 'discarded';
    readonly suggestion?: string;
    readonly by: string;
  },
): Promise<void> {
  await sql`update generation_proposal set state = ${input.act},
      suggestion_id = ${input.suggestion ?? null}, acted_by = ${input.by}, acted_at = now()
    where id = ${input.proposal.id}`.execute(trx);
  if (input.act === 'accepted') {
    await generationEvent(trx, 'generation.accepted', input.proposal, {
      suggestion: input.suggestion!,
    });
  } else if (input.act === 'discarded') {
    await generationEvent(trx, 'generation.discarded', input.proposal, {});
  }
}

/**
 * A suggestion resolved, by any route (the G2 plan, G2-E): where a kept proposal made it, the
 * proposal is resolved with it, and its acceptance or its discard recorded as the resolver's.
 */
export async function suggestionResolved(
  trx: TenantTransaction,
  suggestion: string,
  act: 'accepted' | 'rejected' | 'withdrawn',
  by: string,
): Promise<void> {
  const { rows } = await sql<Row>`${selected} where p.suggestion_id = ${suggestion}
    and p.state = 'kept' for update of p`.execute(trx);
  const proposal = rows[0] && proposalOf(rows[0]);
  if (!proposal) return;
  await sql`update generation_proposal set state = 'resolved', acted_by = ${by}, acted_at = now()
    where id = ${proposal.id}`.execute(trx);
  if (act === 'accepted') {
    await generationEvent(trx, 'generation.accepted', proposal, { suggestion });
  } else {
    await generationEvent(trx, 'generation.discarded', proposal, { suggestion });
  }
}
