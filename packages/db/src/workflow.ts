import {
  decidingDefinition,
  effectiveRevision,
  initialState,
  parseWorkflowBody,
  transitionsFrom,
  WORKFLOW_KINDS,
  workflowBodySchema,
  type TransitionPermission,
  type WorkflowBody,
  type WorkflowKind,
  type WorkflowProblem,
  type WorkflowTransition,
} from '@alloy-works/domain';
import { datesStored } from './dates.js';
import { lineHead, linesStored, readLine } from './lines.js';
import { revisionScopes, scopesStored } from './scopes.js';
import { unmetConditions, type UnmetCondition } from './workflow-conditions.js';
import { sql } from 'kysely';
import { isArchived } from './archival.js';
import { artifactPlace, recordEvent } from './audit.js';
import { isDeleted } from './deletion.js';
import { notifyTenant } from './realtime.js';
import { historyStored } from './search-history.js';
import type { TenantTransaction } from './tables.js';
import { lockArtifact } from './versions.js';

/**
 * **Workflow** (workflow.md; the WF1 plan, WF-A to WF-K): each kind's definition, versioned, the
 * newest in force; each component's and document's state, the latest of its insert-only moves; and
 * the moves themselves, audited. Who may move an artifact is the caller's to decide from the
 * transition's permission, which `moveArtifact` names; who may define, `administer`, likewise.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const storedKnown = new WeakMap<TenantTransaction, boolean>();

/**
 * Whether this tenant stores workflow yet (0095): a migration's test runs today's code on older
 * schemas, where nothing is written or read.
 */
export async function workflowStored(trx: TenantTransaction): Promise<boolean> {
  const known = storedKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('workflow_transition') is not null as present`.execute(trx);
  const present = rows[0]?.present === true;
  storedKnown.set(trx, present);
  return present;
}

const gatesKnown = new WeakMap<TenantTransaction, boolean>();

/** Whether this tenant stores approvals and revisions yet (0096), for older schemas likewise. */
export async function gatesStored(trx: TenantTransaction): Promise<boolean> {
  const known = gatesKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('revision_designation') is not null as present`.execute(trx);
  const present = rows[0]?.present === true;
  gatesKnown.set(trx, present);
  return present;
}

/** An artifact's latest revision: its number, the version designated, and when. */
export interface Revision {
  readonly number: number;
  readonly versionId: string;
  readonly at: Date;
}

/**
 * An artifact's latest revision on its main line, or null where none was ever designated (revision 0,
 * VER-015); on a line (R16-C), its latest, or the revision it diverged from. A line's versions are
 * numbered below the main line's (ADR-0063), so the main line's are those numbered from 0.
 */
export async function latestRevision(
  trx: TenantTransaction,
  artifactId: string,
  line?: string,
): Promise<Revision | null> {
  if (!(await gatesStored(trx))) return null;
  const row = await trx
    .selectFrom('revision_designation as d')
    .innerJoin('artifact_version as v', 'v.id', 'd.version_id')
    .select(['d.revision_no', 'd.version_id', 'd.at'])
    .where('d.artifact_id', '=', artifactId)
    .$if(line === undefined, (query) => query.where('v.revision_no', '>=', 0))
    .$if(line !== undefined, (query) => query.where('v.line_id', '=', line!))
    .orderBy('d.revision_no', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (row) return { number: row.revision_no, versionId: row.version_id, at: row.at };
  if (line === undefined) return null;
  const begun = await readLine(trx, artifactId, line);
  return begun
    ? { number: begun.divergedFrom.revision, versionId: begun.divergedFrom.version, at: begun.at }
    : null;
}

/** The next revision's number, across every line (R16-C): revisions are one sequence. */
export async function nextRevisionNumber(
  trx: TenantTransaction,
  artifactId: string,
): Promise<number> {
  const row = await trx
    .selectFrom('revision_designation')
    .select(({ fn }) => fn.max('revision_no').as('newest'))
    .where('artifact_id', '=', artifactId)
    .executeTakeFirst();
  return Number(row?.newest ?? 0) + 1;
}

/**
 * Each of these artifacts' latest revision in effect, where it has one: what a reference tracking the
 * latest approved revision resolves to (LIF-038; the WF4 plan, WF4-A). One approved to take effect
 * later is not, until its instant (WF5-C; LIF-060). Under `profile`, the one effective in its scope
 * (LIF-042, LIF-043; the R15 plan, R15-C, R15-D): the newest scoped to a value it holds and accepted
 * there, else the newest unscoped; with none, the unscoped alone. The caller passes only those its
 * reader may read.
 */
export async function latestRevisionsOf(
  trx: TenantTransaction,
  artifactIds: readonly string[],
  now: Date = new Date(),
  profile: Readonly<Record<string, readonly string[]>> = {},
): Promise<Map<string, Revision>> {
  if (artifactIds.length === 0 || !(await gatesStored(trx))) return new Map();
  const dated = await datesStored(trx);
  const scoped = await scopesStored(trx);
  const rows = await trx
    .selectFrom('revision_designation as d')
    .$if(!scoped, (query) => query.distinctOn('d.artifact_id'))
    .select(['d.artifact_id', 'd.revision_no', 'd.version_id', 'd.at'])
    .where('d.artifact_id', 'in', [...artifactIds])
    .$if(dated, (query) =>
      query.where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('revision_effective as e')
              .select('e.version_id')
              .whereRef('e.version_id', '=', 'd.version_id')
              .where('e.effective_at', '>', now),
          ),
        ),
      ),
    )
    .orderBy('d.artifact_id')
    .orderBy('d.revision_no', 'desc')
    .execute();
  if (!scoped) {
    return new Map(
      rows.map((row) => [
        row.artifact_id,
        { number: row.revision_no, versionId: row.version_id, at: row.at },
      ]),
    );
  }
  const scopes = await revisionScopes(trx, artifactIds);
  const byArtifact = new Map<string, typeof rows>();
  for (const row of rows)
    byArtifact.set(row.artifact_id, [...(byArtifact.get(row.artifact_id) ?? []), row]);
  const chosen = new Map<string, Revision>();
  for (const [artifact, revisions] of byArtifact) {
    const number = effectiveRevision(
      revisions.map((row) => ({
        number: row.revision_no,
        scopes: scopes.get(row.version_id) ?? [],
      })),
      profile,
    );
    const row = revisions.find((each) => each.revision_no === number);
    if (row)
      chosen.set(artifact, { number: row.revision_no, versionId: row.version_id, at: row.at });
  }
  return chosen;
}

/** How far a gate from the artifact's state has got this round, on its current version (WF2-C). */
export interface GateProgress {
  readonly transition: string;
  readonly count: number;
  readonly required: number;
  /** Who approved it this round, on the current version. */
  readonly approvedBy: readonly string[];
}

/** One version of a kind's definition. */
export interface WorkflowDefinition {
  readonly id: string;
  readonly kind: WorkflowKind;
  readonly version: number;
  readonly body: WorkflowBody;
  /** Null for the seed. */
  readonly by: { readonly id: string; readonly name: string | null } | null;
  readonly at: Date;
}

const isKind = (kind: string): kind is WorkflowKind =>
  (WORKFLOW_KINDS as readonly string[]).includes(kind);

function definitionsQuery(trx: TenantTransaction) {
  return trx
    .selectFrom('workflow_definition as d')
    .leftJoin('principal as p', 'p.id', 'd.by')
    .select([
      'd.id',
      'd.kind',
      'd.version_no',
      'd.body',
      'd.by',
      'd.at',
      sql<string | null>`coalesce(p.display_name, p.email)`.as('by_name'),
    ]);
}

function definitionOf(row: {
  id: string;
  kind: WorkflowKind;
  version_no: number;
  body: unknown;
  by: string | null;
  at: Date;
  by_name: string | null;
}): WorkflowDefinition {
  return {
    id: row.id,
    kind: row.kind,
    version: row.version_no,
    // Validated as it was saved; read by its shape alone.
    body: workflowBodySchema.parse(row.body),
    by: row.by === null ? null : { id: row.by, name: row.by_name },
    at: row.at,
  };
}

/** A kind's definition in force: its newest version. */
export async function newestDefinition(
  trx: TenantTransaction,
  kind: WorkflowKind,
): Promise<WorkflowDefinition> {
  const row = await definitionsQuery(trx)
    .where('d.kind', '=', kind)
    .orderBy('d.version_no', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();
  return definitionOf(row);
}

/** One version of a kind's definition, every one kept (LIF-054); undefined for none. */
export async function workflowVersion(
  trx: TenantTransaction,
  kind: WorkflowKind,
  version: number,
): Promise<WorkflowDefinition | undefined> {
  if (!Number.isSafeInteger(version) || version < 1 || !(await workflowStored(trx))) {
    return undefined;
  }
  const row = await definitionsQuery(trx)
    .where('d.kind', '=', kind)
    .where('d.version_no', '=', version)
    .executeTakeFirst();
  return row && definitionOf(row);
}

async function definitionById(trx: TenantTransaction, id: string): Promise<WorkflowDefinition> {
  return definitionOf(await definitionsQuery(trx).where('d.id', '=', id).executeTakeFirstOrThrow());
}

/** A kind's workflow as Administration lists it: its definition in force and how many sit where. */
export interface WorkflowSummary {
  readonly definition: WorkflowDefinition;
  /** Each state's key by how many of the kind, deleted ones aside, are in it now. */
  readonly counts: Readonly<Record<string, number>>;
}

/** Each kind's workflow, components first (LIF-001). */
export async function listWorkflows(trx: TenantTransaction): Promise<WorkflowSummary[]> {
  if (!(await workflowStored(trx))) return [];
  const { rows } = await sql<{ kind: WorkflowKind; state: string; n: number }>`
    select t.kind, t.to_state as state, count(*)::int as n
      from (select distinct on (artifact_id) artifact_id, kind, to_state
              from workflow_transition
             where ${(await linesStored(trx)) ? sql`line_id is null` : sql`true`}
             order by artifact_id, id desc) t
     where not coalesce((select d.act = 'deleted' from artifact_deletion d
                          where d.artifact_id = t.artifact_id order by d.id desc limit 1), false)
     group by t.kind, t.to_state`.execute(trx);
  const summaries: WorkflowSummary[] = [];
  for (const kind of WORKFLOW_KINDS) {
    const counts: Record<string, number> = {};
    for (const row of rows) if (row.kind === kind) counts[row.state] = row.n;
    summaries.push({ definition: await newestDefinition(trx, kind), counts });
  }
  return summaries;
}

export type DefineAnswer =
  | { readonly answer: 'defined' | 'unchanged'; readonly definition: WorkflowDefinition }
  | { readonly answer: 'invalid'; readonly problems: readonly WorkflowProblem[] }
  | { readonly answer: 'behind'; readonly version: number };

/**
 * Saves a kind's definition as its next version (LIF-001, LIF-002, LIF-007), under the kind's lock so
 * two saves at once take turns; the same body again changes nothing. Audited as `workflow.defined`.
 * An artifact in a state the new version drops keeps it, under the version it moved under (WF-E).
 */
export async function defineWorkflow(
  trx: TenantTransaction,
  input: {
    readonly kind: WorkflowKind;
    readonly body: unknown;
    readonly by: string;
    /** The version the edit began from: refused if another has replaced it since. */
    readonly basedOn?: number;
  },
): Promise<DefineAnswer> {
  const parsed = parseWorkflowBody(input.body, input.kind);
  if (!parsed.ok) return { answer: 'invalid', problems: parsed.problems };
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:workflow:${input.kind}`} || current_schema(), 0))`.execute(
    trx,
  );
  const newest = await newestDefinition(trx, input.kind);
  if (input.basedOn !== undefined && input.basedOn !== newest.version) {
    return { answer: 'behind', version: newest.version };
  }
  if (JSON.stringify(newest.body) === JSON.stringify(parsed.body)) {
    return { answer: 'unchanged', definition: newest };
  }
  const row = await trx
    .insertInto('workflow_definition')
    .values({
      kind: input.kind,
      version_no: newest.version + 1,
      body: JSON.stringify(parsed.body),
      by: input.by,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await recordEvent(trx, {
    kind: 'workflow.defined',
    subject: { kind: 'workflow' },
    space: null,
    detail: { kind: input.kind, version: newest.version + 1 },
  });
  return { answer: 'defined', definition: await definitionById(trx, row.id) };
}

/** Where an artifact stands: its state, the definition deciding its next move, and the move's row. */
export interface WorkflowStanding {
  readonly kind: WorkflowKind;
  readonly state: { readonly key: string; readonly name: string; readonly approved: boolean };
  /** The definition its moves are decided under now (WF-E). */
  readonly definition: WorkflowDefinition;
  /** The transitions the definition declares from its state, whoever may take them. */
  readonly transitions: readonly WorkflowTransition[];
  /** The version current at its latest move; null for one made since and never moved. */
  readonly version: string | null;
  /** The move that put it in its state: a gate's round began there (WF2-C). */
  readonly round: string;
  /** Its latest revision, or null for revision 0 (WF2-F); a line's, or what it diverged from. */
  readonly revision: Revision | null;
  /** The line it is the standing of (R16-C), or null for the main line. */
  readonly line: string | null;
  /** Each gate from its state, and how far it has got. */
  readonly gates: readonly GateProgress[];
}

/**
 * The id of an artifact's latest version: what a move, an approval and a designation name. On a line,
 * its head (R16-B).
 */
export async function latestVersionId(
  trx: TenantTransaction,
  artifactId: string,
  line?: string,
): Promise<string> {
  if (line !== undefined) {
    const begun = await readLine(trx, artifactId, line);
    if (!begun) throw new Error(`Artifact ${artifactId} has no line ${line}`);
    return lineHead(trx, begun);
  }
  const latest = await trx
    .selectFrom('artifact_version')
    .select('id')
    .where('artifact_id', '=', artifactId)
    .orderBy('revision_no', 'desc')
    .orderBy('version_no', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();
  return latest.id;
}

/** Each gate's approvals this round on the current version; none before 0096. */
async function gateProgress(
  trx: TenantTransaction,
  artifactId: string,
  round: string,
  transitions: readonly WorkflowTransition[],
  line?: string,
): Promise<GateProgress[]> {
  const gates = transitions.filter((each) => each.gate !== undefined);
  if (gates.length === 0) return [];
  const approvals = (await gatesStored(trx))
    ? await trx
        .selectFrom('workflow_approval')
        .select(['transition', 'by'])
        .where('round', '=', round)
        .where('decision', '=', 'approved')
        .where('version_id', '=', await latestVersionId(trx, artifactId, line))
        .orderBy('id')
        .execute()
    : [];
  return gates.map((each) => {
    const approvedBy = [
      ...new Set(approvals.filter((row) => row.transition === each.key).map((row) => row.by)),
    ];
    return {
      transition: each.key,
      count: approvedBy.length,
      required: each.gate!.approvals,
      approvedBy,
    };
  });
}

/** An artifact's state's key now, read alone: what indexing writes. */
export async function stateKey(
  trx: TenantTransaction,
  artifactId: string,
): Promise<string | undefined> {
  const lined = await linesStored(trx);
  const row = await trx
    .selectFrom('workflow_transition')
    .select('to_state')
    .where('artifact_id', '=', artifactId)
    // The main line's: a line's moves are its own (R16-C).
    .$if(lined, (query) => query.where('line_id', 'is', null))
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.to_state;
}

/** An artifact's standing now; undefined for anything but a component or a document, or before 0095. */
export async function workflowStanding(
  trx: TenantTransaction,
  artifactId: string,
  /** A line's standing (R16-C); the main line's where absent. */
  line?: string,
): Promise<WorkflowStanding | undefined> {
  if (!UUID.test(artifactId) || !(await workflowStored(trx))) return undefined;
  const lined = await linesStored(trx);
  if (line !== undefined && !lined) return undefined;
  const row = await trx
    .selectFrom('workflow_transition')
    .select(['id', 'kind', 'to_state', 'definition_id', 'version_id'])
    .where('artifact_id', '=', artifactId)
    .$if(lined && line === undefined, (query) => query.where('line_id', 'is', null))
    .$if(line !== undefined, (query) => query.where('line_id', '=', line!))
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return undefined;
  const newest = await newestDefinition(trx, row.kind);
  const definition = decidingDefinition(
    newest,
    newest.id === row.definition_id ? newest : await definitionById(trx, row.definition_id),
    row.to_state,
  );
  const state = definition.body.states.find((each) => each.key === row.to_state);
  const transitions = transitionsFrom(definition.body, row.to_state);
  return {
    kind: row.kind,
    state: {
      key: row.to_state,
      name: state?.name ?? row.to_state,
      approved: state?.approved ?? false,
    },
    definition,
    transitions,
    version: row.version_id,
    round: String(row.id),
    revision: await latestRevision(trx, artifactId, line),
    line: line ?? null,
    gates: await gateProgress(trx, artifactId, String(row.id), transitions, line),
  };
}

/**
 * Each artifact's state by its id, named by the definition deciding it: for lists, in one statement
 * and a definition read per version named. Those with none are left out.
 */
export async function workflowStates(
  trx: TenantTransaction,
  artifactIds: readonly string[],
): Promise<
  ReadonlyMap<string, { readonly key: string; readonly name: string; readonly approved: boolean }>
> {
  const ids = [...new Set(artifactIds.filter((id) => UUID.test(id)))];
  if (ids.length === 0 || !(await workflowStored(trx))) return new Map();
  const { rows } = await sql<{
    artifact_id: string;
    kind: WorkflowKind;
    to_state: string;
    definition_id: string;
  }>`select distinct on (artifact_id) artifact_id, kind, to_state, definition_id
       from workflow_transition where artifact_id = any(${ids}::uuid[])
        and ${(await linesStored(trx)) ? sql`line_id is null` : sql`true`}
      order by artifact_id, id desc`.execute(trx);
  const definitions = new Map<string, WorkflowDefinition>();
  const newest = new Map<WorkflowKind, WorkflowDefinition>();
  const states = new Map<string, { key: string; name: string; approved: boolean }>();
  for (const row of rows) {
    if (!newest.has(row.kind)) newest.set(row.kind, await newestDefinition(trx, row.kind));
    const latest = newest.get(row.kind)!;
    let recorded = row.definition_id === latest.id ? latest : definitions.get(row.definition_id);
    if (!recorded) {
      recorded = await definitionById(trx, row.definition_id);
      definitions.set(recorded.id, recorded);
    }
    const definition = decidingDefinition(latest, recorded, row.to_state);
    const state = definition.body.states.find((each) => each.key === row.to_state);
    states.set(row.artifact_id, {
      key: row.to_state,
      name: state?.name ?? row.to_state,
      approved: state?.approved ?? false,
    });
  }
  return states;
}

/** The name each state key has in each kind's definition in force: search's. */
export async function stateNames(
  trx: TenantTransaction,
): Promise<ReadonlyMap<WorkflowKind, ReadonlyMap<string, string>>> {
  const names = new Map<WorkflowKind, ReadonlyMap<string, string>>();
  if (!(await workflowStored(trx))) return names;
  for (const kind of WORKFLOW_KINDS) {
    const { states } = (await newestDefinition(trx, kind)).body;
    names.set(kind, new Map(states.map((each) => [each.key, each.name])));
  }
  return names;
}

/** Sets search's copy of the state on the artifact's rows, current and history (WF-H). */
async function setSearchState(
  trx: TenantTransaction,
  artifactId: string,
  state: string,
): Promise<void> {
  await trx
    .updateTable('search_entry')
    .set({ workflow_state: state })
    .where('artifact_id', '=', artifactId)
    .where('kind', 'in', ['component', 'document', 'section', 'term'])
    .execute();
  if (await historyStored(trx)) {
    await trx
      .updateTable('search_history')
      .set({ workflow_state: state })
      .where('artifact_id', '=', artifactId)
      .execute();
  }
}

/**
 * The first row of a component or a document (WF-D): its kind's initial state, under its definition in
 * force, before its first version is indexed. Called by `createArtifact` alone.
 */
export async function startWorkflow(
  trx: TenantTransaction,
  artifact: { readonly id: string; readonly kind: string; readonly by: string | null },
): Promise<void> {
  if (!isKind(artifact.kind) || !(await workflowStored(trx))) return;
  const definition = await newestDefinition(trx, artifact.kind);
  await trx
    .insertInto('workflow_transition')
    .values({
      artifact_id: artifact.id,
      kind: artifact.kind,
      to_state: initialState(definition.body).key,
      definition_id: definition.id,
      by: artifact.by,
    })
    .execute();
}

/** Writes a move's row, search's copy, the audit event and the stream's word of it. */
export async function moved(
  trx: TenantTransaction,
  standing: WorkflowStanding,
  move: {
    readonly artifactId: string;
    readonly version: string | null;
    readonly transition: string | null;
    readonly to: string;
    readonly reason: string | null;
    readonly by: string | null;
    readonly approved?: string;
  },
): Promise<void> {
  await trx
    .insertInto('workflow_transition')
    .values({
      artifact_id: move.artifactId,
      kind: standing.kind,
      version_id: move.version,
      transition: move.transition,
      from_state: standing.state.key,
      to_state: move.to,
      definition_id: standing.definition.id,
      reason: move.reason,
      by: move.by,
      // Named only on a line's move, so a schema before 0112 is asked for no column it lacks.
      ...(standing.line === null ? {} : { line_id: standing.line }),
    })
    .execute();
  // Search holds the main line's state (R16-H).
  if (standing.line === null) await setSearchState(trx, move.artifactId, move.to);
  const place = await artifactPlace(trx, move.artifactId);
  await recordEvent(
    trx,
    {
      kind: 'workflow.transitioned',
      subject: { kind: standing.kind, id: move.artifactId, version: place.version },
      space: place.space,
      detail: {
        kind: standing.kind,
        transition: move.transition,
        from: standing.state.key,
        to: move.to,
        definition: standing.definition.version,
        reason: move.reason !== null,
        ...(move.approved === undefined ? {} : { approved: move.approved }),
      },
    },
    place.labels,
  );
  await notifyTenant(trx, { kind: 'workflow', artifact: move.artifactId });
}

/**
 * A save of an approved component or document starts a draft (WF-F; LIF-040): it moves to its
 * definition's initial state in the save's transaction, naming the version that was approved, which is
 * unchanged. A save in any other state leaves it. Called by the chain for every version it records
 * after the first, under the artifact's lock.
 */
export async function draftOnSave(
  trx: TenantTransaction,
  version: {
    readonly artifactId: string;
    readonly id: string;
    readonly author: string | null;
    readonly line: string | null;
  },
  approved: string,
): Promise<void> {
  // A line's save moves the line alone (R16-C).
  const standing = await workflowStanding(trx, version.artifactId, version.line ?? undefined);
  if (!standing?.state.approved) return;
  await moved(trx, standing, {
    artifactId: version.artifactId,
    version: version.id,
    transition: null,
    to: initialState(standing.definition.body).key,
    reason: null,
    by: version.author,
    approved,
  });
}

export type MoveAnswer =
  | { readonly answer: 'conditions.unmet'; readonly unmet: readonly UnmetCondition[] }
  | { readonly answer: 'moved'; readonly standing: WorkflowStanding }
  | { readonly answer: 'artifact.missing' }
  | { readonly answer: 'transition.unknown' }
  | { readonly answer: 'transition.gated' }
  | { readonly answer: 'state.moved'; readonly standing: WorkflowStanding }
  | { readonly answer: 'artifact.archived' }
  | { readonly answer: 'permission.refused'; readonly permission: TransitionPermission }
  | { readonly answer: 'reason.required' | 'reason.invalid' };

/** A reason as kept: trimmed, NFC, at most 2000 characters; none where it is empty. */
export const MAX_REASON = 2000;

/**
 * Moves a component or a document along a transition (WF-F), under its lock: refused, by name, where it
 * moved meanwhile from the state the caller saw, is archived (WF-K), lacks a required reason, or the
 * caller may not take the transition, which `may` decides on its permission; a deleted one is missing.
 * The transition is taken from the definition deciding the artifact's state (WF-E).
 */
export async function moveArtifact(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly kind: WorkflowKind;
    readonly transition: string;
    /** The state the caller saw. */
    readonly from: string;
    readonly reason?: string | undefined;
    readonly by: string;
    readonly may: (permission: TransitionPermission) => boolean;
    /** A line's move (R16-C); the main line's where absent. */
    readonly line?: string | undefined;
  },
): Promise<MoveAnswer> {
  if (!UUID.test(input.artifactId)) return { answer: 'artifact.missing' };
  await lockArtifact(trx, input.artifactId);
  const standing = await workflowStanding(trx, input.artifactId, input.line);
  if (!standing || standing.kind !== input.kind || (await isDeleted(trx, input.artifactId))) {
    return { answer: 'artifact.missing' };
  }
  if (standing.state.key !== input.from) return { answer: 'state.moved', standing };
  const transition = standing.transitions.find((each) => each.key === input.transition);
  if (!transition) return { answer: 'transition.unknown' };
  // A gate passes by its approvals alone (WF2-C).
  if (transition.gate !== undefined) return { answer: 'transition.gated' };
  if (await isArchived(trx, input.artifactId)) return { answer: 'artifact.archived' };
  if (!input.may(transition.permission)) {
    return { answer: 'permission.refused', permission: transition.permission };
  }
  const reason = input.reason?.normalize('NFC').trim() ?? '';
  if (reason.length > MAX_REASON) return { answer: 'reason.invalid' };
  if (transition.reasonRequired && reason === '') return { answer: 'reason.required' };
  // What it requires, met now, before anything is recorded (LIF-004; WF3-B).
  const unmet = await unmetConditions(trx, {
    artifactId: input.artifactId,
    kind: standing.kind,
    requires: transition.requires ?? [],
    principal: input.by,
    version: await latestVersionId(trx, input.artifactId, input.line),
  });
  if (unmet.length > 0) return { answer: 'conditions.unmet', unmet };
  await moved(trx, standing, {
    artifactId: input.artifactId,
    version: await latestVersionId(trx, input.artifactId, input.line),
    transition: transition.key,
    to: transition.to,
    reason: reason === '' ? null : reason,
    by: input.by,
  });
  return {
    answer: 'moved',
    standing: (await workflowStanding(trx, input.artifactId, input.line))!,
  };
}
