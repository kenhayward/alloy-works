import { initialState } from '@alloy-works/domain';
import { sql } from 'kysely';
import { artifactPlace, recordEvent } from './audit.js';
import { isDeleted } from './deletion.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion, lockArtifact, readVersion, type StoredVersion } from './versions.js';
import { newestDefinition, workflowStored } from './workflow.js';

/**
 * **Divergent lines** (storage-and-versioning.md, "Lines"; the R16 plan, R16-A to R16-H; ADR-0063): a
 * component's second head of revisions, begun from a designated revision, its versions numbered below
 * the main line's - `revision_no` its ordinal negated - so a read that takes the latest by the numbers
 * takes the main line.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const linesKnown = new WeakMap<TenantTransaction, boolean>();

/** Whether this schema has 0112's lines: migration tests run this code on older ones. */
export async function linesStored(trx: TenantTransaction): Promise<boolean> {
  const known = linesKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('artifact_line') is not null as present`.execute(trx);
  const present = rows[0]?.present === true;
  linesKnown.set(trx, present);
  return present;
}

/** A line as read: its name, its place, what it diverged from and when, and whether it is closed. */
export interface Line {
  readonly id: string;
  readonly artifactId: string;
  readonly ordinal: number;
  readonly name: string;
  readonly divergedFrom: { readonly revision: number; readonly version: string };
  readonly by: string;
  readonly at: Date;
  readonly closed: boolean;
}

interface LineRow {
  id: string;
  artifact_id: string;
  ordinal: number;
  name: string;
  revision_no: number;
  diverged_from: string;
  by: string;
  at: Date;
  closed: boolean;
}

const lineOf = (row: LineRow): Line => ({
  id: row.id,
  artifactId: row.artifact_id,
  ordinal: row.ordinal,
  name: row.name,
  divergedFrom: { revision: row.revision_no, version: row.diverged_from },
  by: row.by,
  at: row.at,
  closed: row.closed,
});

const lines = (trx: TenantTransaction, where: ReturnType<typeof sql>) =>
  sql<LineRow>`
    select l.id, l.artifact_id, l.ordinal, l.name, d.revision_no, l.diverged_from, l.by, l.at,
           exists (select 1 from line_closed c where c.line_id = l.id) as closed
      from artifact_line l
      join revision_designation d on d.version_id = l.diverged_from
     where ${where}
     order by l.ordinal`.execute(trx);

/** An artifact's lines, in the order they were begun; none before 0112. */
export async function readLines(trx: TenantTransaction, artifactId: string): Promise<Line[]> {
  if (!UUID.test(artifactId) || !(await linesStored(trx))) return [];
  return (await lines(trx, sql`l.artifact_id = ${artifactId}::uuid`)).rows.map(lineOf);
}

/** One line of an artifact, or undefined where it holds no such line. */
export async function readLine(
  trx: TenantTransaction,
  artifactId: string,
  lineId: string,
): Promise<Line | undefined> {
  if (!UUID.test(lineId) || !(await linesStored(trx))) return undefined;
  const { rows } = await lines(
    trx,
    sql`l.id = ${lineId}::uuid and l.artifact_id = ${artifactId}::uuid`,
  );
  return rows[0] && lineOf(rows[0]);
}

/** A line's newest version's id, or the version it diverged from where it has none yet. */
export async function lineHead(trx: TenantTransaction, line: Line): Promise<string> {
  const row = await trx
    .selectFrom('artifact_version')
    .select('id')
    .where('line_id', '=', line.id)
    .orderBy('version_no', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.id ?? line.divergedFrom.version;
}

export type DivergeAnswer =
  | { readonly answer: 'diverged'; readonly line: Line }
  | { readonly answer: 'artifact.missing' | 'revision.missing' | 'line.name_taken' };

/**
 * Begins a line of a component's revisions from one of its designated revisions (LIF-044; R16-B),
 * under its lock: the next ordinal, a name the component's lines do not hold, in its kind's initial
 * state, audited `line.diverged`. Whether the caller may is theirs to have decided.
 */
export async function diverge(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly revision: number;
    readonly name: string;
    readonly by: string;
  },
): Promise<DivergeAnswer> {
  if (!UUID.test(input.artifactId)) return { answer: 'artifact.missing' };
  await lockArtifact(trx, input.artifactId);
  const artifact = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', input.artifactId)
    .executeTakeFirst();
  if (artifact?.kind !== 'component' || (await isDeleted(trx, input.artifactId))) {
    return { answer: 'artifact.missing' };
  }
  const designated = await trx
    .selectFrom('revision_designation')
    .select('version_id')
    .where('artifact_id', '=', input.artifactId)
    .where('revision_no', '=', input.revision)
    .executeTakeFirst();
  if (!designated) return { answer: 'revision.missing' };
  const name = input.name.normalize('NFC').trim();
  const held = await trx
    .selectFrom('artifact_line')
    .select(['name', 'ordinal'])
    .where('artifact_id', '=', input.artifactId)
    .execute();
  if (held.some((each) => each.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    return { answer: 'line.name_taken' };
  }
  const row = await trx
    .insertInto('artifact_line')
    .values({
      artifact_id: input.artifactId,
      kind: 'component',
      ordinal: Math.max(0, ...held.map((each) => each.ordinal)) + 1,
      name,
      diverged_from: designated.version_id,
      by: input.by,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  // Its own workflow, from the kind's initial state (R16-C).
  if (await workflowStored(trx)) {
    const definition = await newestDefinition(trx, 'component');
    await trx
      .insertInto('workflow_transition')
      .values({
        artifact_id: input.artifactId,
        kind: 'component',
        line_id: row.id,
        version_id: designated.version_id,
        to_state: initialState(definition.body).key,
        definition_id: definition.id,
        by: input.by,
      })
      .execute();
  }
  const line = (await readLine(trx, input.artifactId, row.id))!;
  const place = await artifactPlace(trx, input.artifactId);
  await recordEvent(
    trx,
    {
      kind: 'line.diverged',
      subject: { kind: 'component', id: input.artifactId, version: place.version },
      space: place.space,
      detail: {
        kind: 'component',
        line: line.id,
        name: line.name,
        from: { revision: input.revision, version: designated.version_id },
      },
    },
    place.labels,
  );
  return { answer: 'diverged', line };
}

/**
 * The version a write on an artifact's line, or its main line, is made against: a line's head, or the
 * main line's latest. Undefined where it holds no such line, or the line is closed (R16-G).
 */
export async function headVersion(
  trx: TenantTransaction,
  artifactId: string,
  line?: string,
): Promise<StoredVersion | undefined> {
  if (line === undefined) return latestVersion(trx, artifactId);
  const begun = await readLine(trx, artifactId, line);
  if (!begun || begun.closed) return undefined;
  return readVersion(trx, await lineHead(trx, begun));
}

/**
 * How each of these versions on a line is shown (LIF-046; ADR-0063): its line's name, the revision it
 * counts from - the line's newest designated at or before it, else the one it diverged from - and its
 * own version, `US 2.3`. A main-line version is not in the answer: it is shown as `revision.version`.
 */
export async function lineNumbers(
  trx: TenantTransaction,
  versionIds: readonly string[],
): Promise<Map<string, { readonly line: { readonly id: string; readonly name: string }; readonly number: string }>> {
  const ids = [...new Set(versionIds.filter((id) => UUID.test(id)))];
  if (ids.length === 0 || !(await linesStored(trx))) return new Map();
  const { rows } = await sql<{ id: string; line_id: string; name: string; version_no: number; base: number }>`
    select v.id, v.line_id, l.name, v.version_no,
           coalesce(
             (select max(d.revision_no) from revision_designation d
                join artifact_version dv on dv.id = d.version_id
               where dv.line_id = v.line_id and dv.version_no <= v.version_no),
             (select d.revision_no from revision_designation d where d.version_id = l.diverged_from)
           ) as base
      from artifact_version v
      join artifact_line l on l.id = v.line_id
     where v.id = any(${ids}::uuid[])`.execute(trx);
  return new Map(
    rows.map((row) => [
      row.id,
      { line: { id: row.line_id, name: row.name }, number: `${row.name} ${row.base}.${row.version_no}` },
    ]),
  );
}
