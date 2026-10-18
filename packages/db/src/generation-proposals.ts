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
  /** The component it edits; for a creation, the one made once it is accepted, else null. */
  readonly componentId: string | null;
  /** The version it is against; null for a creation, which is against none. */
  readonly madeAgainst: string | null;
  /** Where and what a creation would make (G5-E); null for an edit. */
  readonly creates: ProposedComponent | null;
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
  component_id: string | null;
  made_against: string | null;
  creates?: ProposedComponent | null;
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
  creates: row.creates ?? null,
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

/** Where and what a proposed component would be made (G5-E). */
export interface ProposedComponent {
  readonly space: string;
  /** Absent: the environment's default type. */
  readonly componentType?: string;
  readonly title: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
}

/** A proposal to make a component, made by a run while it runs, numbered with its edits (G5-E). */
export async function makeCreationProposal(
  trx: TenantTransaction,
  input: {
    readonly run: string;
    readonly creates: ProposedComponent;
    readonly proposed: ContentDocument;
  },
): Promise<GenerationProposal> {
  const { rows } = await sql<{ id: string }>`insert into generation_proposal
      (run_id, number, creates, proposed)
    values (${input.run},
      (select coalesce(max(number), 0) + 1 from generation_proposal where run_id = ${input.run}),
      ${JSON.stringify(input.creates)}::jsonb, ${JSON.stringify(input.proposed)}::jsonb)
    returning id`.execute(trx);
  return (await readProposal(trx, rows[0]!.id))!;
}

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
  made?: { readonly component: string; readonly version: string },
): Promise<void> {
  // An edit is the component's; a creation the component it made, or where it would have been.
  const subject =
    made !== undefined
      ? { kind: 'component', id: made.component, version: made.version }
      : proposal.creates !== null
        ? { kind: 'space', id: proposal.creates.space }
        : { kind: 'component', id: proposal.componentId!, version: proposal.madeAgainst! };
  await recordEvent(trx, {
    kind,
    subject,
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
    /** A creation accepted: the component it made, at its first version (G5-E). */
    readonly made?: { readonly component: string; readonly version: string };
    readonly by: string;
  },
): Promise<void> {
  await sql`update generation_proposal set state = ${input.act},
      suggestion_id = ${input.suggestion ?? null}, acted_by = ${input.by}, acted_at = now()
      ${input.made === undefined ? sql`` : sql`, component_id = ${input.made.component}`}
    where id = ${input.proposal.id}`.execute(trx);
  if (input.act === 'accepted' && input.made !== undefined) {
    await generationEvent(
      trx,
      'generation.accepted',
      input.proposal,
      { created: true },
      input.made,
    );
  } else if (input.act === 'accepted') {
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
