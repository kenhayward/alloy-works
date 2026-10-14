import type { TransitionPermission, WorkflowKind } from '@alloy-works/domain';
import { sql } from 'kysely';
import { isArchived } from './archival.js';
import { artifactPlace, recordEvent } from './audit.js';
import { isDeleted } from './deletion.js';
import type { TenantTransaction } from './tables.js';
import { lockArtifact } from './versions.js';
import {
  gatesStored,
  latestRevision,
  latestVersionId,
  MAX_REASON,
  moved,
  workflowStanding,
  type WorkflowStanding,
} from './workflow.js';

/**
 * **Gates** (workflow.md; the WF2 plan, WF2-A to WF2-G): an approval or a rejection at a transition
 * that is a gate. The approval that makes the gate's count moves the artifact along it and designates
 * a revision where the gate says so; a rejection moves it to the gate's declared state. Who may decide
 * is the caller's, from `approve`, which `may` answers.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type GateAnswer =
  | { readonly answer: 'approved'; readonly standing: WorkflowStanding }
  | {
      readonly answer: 'passed';
      readonly standing: WorkflowStanding;
      /** The revision the artifact is at once passed; null where the gate designates none. */
      readonly revision: number | null;
    }
  | { readonly answer: 'rejected'; readonly standing: WorkflowStanding }
  | { readonly answer: 'artifact.missing' }
  | { readonly answer: 'transition.unknown' }
  | { readonly answer: 'state.moved'; readonly standing: WorkflowStanding }
  | { readonly answer: 'version.moved'; readonly standing: WorkflowStanding }
  | { readonly answer: 'artifact.archived' }
  | { readonly answer: 'permission.refused'; readonly permission: TransitionPermission }
  | { readonly answer: 'approval.author' }
  | { readonly answer: 'approval.given' }
  | { readonly answer: 'reason.required' | 'reason.invalid' };

/**
 * Whoever recorded a version of it since its latest revision, or since it was made where it has none:
 * its authors, whom a gate saying `notAuthor` refuses (LIF-010; WF2-D).
 */
async function authorsSince(trx: TenantTransaction, artifactId: string): Promise<Set<string>> {
  const revision = await latestRevision(trx, artifactId);
  let query = trx
    .selectFrom('artifact_version')
    .select('author_id')
    .distinct()
    .where('artifact_id', '=', artifactId);
  if (revision) query = query.where('created_at', '>', revision.at);
  const rows = await query.execute();
  return new Set(rows.flatMap((row) => (row.author_id === null ? [] : [row.author_id])));
}

/**
 * Approves or rejects a component or a document at a gate (WF2-C to WF2-E), under its lock, against the
 * version the decider saw: refused, by name, where it is not in the gate's from-state, the version was
 * replaced, it is archived, the decider may not approve, is an author where the gate says so, or has
 * approved this round already, or a rejection has no reason; a deleted one is missing.
 */
export async function decideGate(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly kind: WorkflowKind;
    readonly transition: string;
    /** The version the decider saw. */
    readonly version: string;
    readonly decision: 'approved' | 'rejected';
    readonly reason?: string | undefined;
    readonly by: string;
    readonly may: (permission: TransitionPermission) => boolean;
  },
): Promise<GateAnswer> {
  if (!UUID.test(input.artifactId) || !UUID.test(input.version)) {
    return { answer: 'artifact.missing' };
  }
  await lockArtifact(trx, input.artifactId);
  const standing = await workflowStanding(trx, input.artifactId);
  if (!standing || standing.kind !== input.kind || (await isDeleted(trx, input.artifactId))) {
    return { answer: 'artifact.missing' };
  }
  const transition = standing.definition.body.transitions.find(
    (each) => each.key === input.transition,
  );
  const gate = transition?.gate;
  if (!transition || !gate) return { answer: 'transition.unknown' };
  if (transition.from !== standing.state.key) return { answer: 'state.moved', standing };
  const version = await latestVersionId(trx, input.artifactId);
  if (version !== input.version) return { answer: 'version.moved', standing };
  if (await isArchived(trx, input.artifactId)) return { answer: 'artifact.archived' };
  if (!input.may(transition.permission)) {
    return { answer: 'permission.refused', permission: transition.permission };
  }
  const reason = input.reason?.normalize('NFC').trim() ?? '';
  if (reason.length > MAX_REASON) return { answer: 'reason.invalid' };
  const progress = standing.gates.find((each) => each.transition === transition.key)!;
  const place = await artifactPlace(trx, input.artifactId);
  const subject = { kind: standing.kind, id: input.artifactId, version: place.version };

  if (input.decision === 'rejected') {
    if (reason === '') return { answer: 'reason.required' };
    await trx
      .insertInto('workflow_approval')
      .values({
        artifact_id: input.artifactId,
        kind: standing.kind,
        round: standing.round,
        version_id: version,
        definition_id: standing.definition.id,
        transition: transition.key,
        decision: 'rejected',
        reason,
        by: input.by,
      })
      .execute();
    await recordEvent(
      trx,
      {
        kind: 'gate.rejected',
        subject,
        space: place.space,
        detail: { kind: standing.kind, transition: transition.key, to: gate.reject.to },
      },
      place.labels,
    );
    await moved(trx, standing, {
      artifactId: input.artifactId,
      version,
      transition: transition.key,
      to: gate.reject.to,
      reason,
      by: input.by,
    });
    return { answer: 'rejected', standing: (await workflowStanding(trx, input.artifactId))! };
  }

  if (progress.approvedBy.includes(input.by)) return { answer: 'approval.given' };
  if (gate.notAuthor && (await authorsSince(trx, input.artifactId)).has(input.by)) {
    return { answer: 'approval.author' };
  }
  await trx
    .insertInto('workflow_approval')
    .values({
      artifact_id: input.artifactId,
      kind: standing.kind,
      round: standing.round,
      version_id: version,
      definition_id: standing.definition.id,
      transition: transition.key,
      decision: 'approved',
      by: input.by,
    })
    .execute();
  const count = progress.count + 1;
  await recordEvent(
    trx,
    {
      kind: 'approval.given',
      subject,
      space: place.space,
      detail: {
        kind: standing.kind,
        transition: transition.key,
        count,
        required: gate.approvals,
      },
    },
    place.labels,
  );
  if (count < gate.approvals) {
    return { answer: 'approved', standing: (await workflowStanding(trx, input.artifactId))! };
  }

  await moved(trx, standing, {
    artifactId: input.artifactId,
    version,
    transition: transition.key,
    to: transition.to,
    reason: null,
    by: input.by,
  });
  let revision = standing.revision;
  // A version is designated once: approved again unchanged, it keeps its revision (WF2-F).
  if (gate.designates && revision?.versionId !== version) {
    const number = (revision?.number ?? 0) + 1;
    await trx
      .insertInto('revision_designation')
      .values({
        artifact_id: input.artifactId,
        kind: standing.kind,
        version_id: version,
        revision_no: number,
        definition_id: standing.definition.id,
        transition: transition.key,
        by: input.by,
      })
      .execute();
    await recordEvent(
      trx,
      {
        kind: 'revision.designated',
        subject,
        space: place.space,
        detail: { kind: standing.kind, transition: transition.key, revision: number },
      },
      place.labels,
    );
    revision = await latestRevision(trx, input.artifactId);
  }
  return {
    answer: 'passed',
    standing: (await workflowStanding(trx, input.artifactId))!,
    revision: gate.designates ? (revision?.number ?? null) : null,
  };
}

/** One approval or rejection, as an artifact's history lists it (LIF-008, LIF-051). */
export interface Approval {
  readonly transition: string;
  readonly decision: 'approved' | 'rejected';
  readonly reason: string | null;
  readonly by: { readonly id: string; readonly name: string | null };
  readonly at: Date;
  readonly versionId: string;
}

/** Every approval and rejection of an artifact at its gates, newest first; none before 0096. */
export async function listApprovals(
  trx: TenantTransaction,
  artifactId: string,
): Promise<Approval[]> {
  if (!UUID.test(artifactId) || !(await gatesStored(trx))) return [];
  const rows = await trx
    .selectFrom('workflow_approval as a')
    .innerJoin('principal as p', 'p.id', 'a.by')
    .select([
      'a.transition',
      'a.decision',
      'a.reason',
      'a.by',
      'a.at',
      'a.version_id',
      sql<string | null>`coalesce(p.display_name, p.email)`.as('by_name'),
    ])
    .where('a.artifact_id', '=', artifactId)
    .orderBy('a.id', 'desc')
    .execute();
  return rows.map((row) => ({
    transition: row.transition,
    decision: row.decision,
    reason: row.reason,
    by: { id: row.by, name: row.by_name },
    at: row.at,
    versionId: row.version_id,
  }));
}
