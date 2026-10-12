import { sql } from 'kysely';
import { readOutline } from '@alloy-works/domain';
import { loadReadableSet } from './access-facts.js';
import { resolveOccurrences } from './publishing.js';
import { revisionsKept } from './revisions.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion } from './versions.js';

/** An artifact with versions cut since the instant (SCH-025). */
export interface ChangedArtifact {
  readonly artifact: string;
  readonly kind: string;
  readonly title: string;
  /** How many versions were cut since. */
  readonly versions: number;
  readonly latest: { readonly id: string; readonly number: string; readonly at: Date };
}

/**
 * A value a document holds resolved or accepted since the instant, or revised by hand or its revision
 * withdrawn (`revise`, `withdraw`; the RV plan, RV-H).
 */
export interface ChangedValue {
  readonly document: string;
  readonly node: string;
  readonly binding: string;
  readonly act: string;
  readonly at: Date;
}

export interface ChangesSince {
  /** Where the record of what was asked about begins: its first version, or none where it is empty. */
  readonly recordBegins: Date | null;
  /** Whether `since` was before the record begins, so the answer is from there (SCH-048). */
  readonly fromRecordStart: boolean;
  readonly artifacts: readonly ChangedArtifact[];
  readonly values: readonly ChangedValue[];
  /** Whether there was more than `CHANGES_MAX` of either: the newest are answered. */
  readonly more: boolean;
}

/** The most artifacts, and the most values, one answer holds. */
export const CHANGES_MAX = 500;

/**
 * What changed since `since`, among `artifacts` or in `space`, as `reader` may read it (SCH-025):
 * each artifact with versions cut since, and each value a document among them resolved or accepted
 * since. Versions are never deleted (VER-036), so the record begins where the first of them was cut;
 * a `since` before that is answered from there, and says so (SCH-048).
 */
export async function changesSince(
  trx: TenantTransaction,
  input: {
    readonly since: Date;
    readonly reader: string;
    readonly artifacts?: readonly string[];
    readonly space?: string;
  },
): Promise<ChangesSince> {
  const empty: ChangesSince = {
    recordBegins: null,
    fromRecordStart: false,
    artifacts: [],
    values: [],
    more: false,
  };
  const readable = await loadReadableSet(trx, input.reader);
  if (!readable) return empty;
  if (input.artifacts !== undefined && input.artifacts.length === 0) return empty;
  const scoped = trx
    .selectFrom('artifact as a')
    .select(['a.id', 'a.kind'])
    .where((eb) => readableArtifacts(eb, readable))
    .$if(input.artifacts !== undefined, (query) => query.where('a.id', 'in', [...input.artifacts!]))
    .$if(input.space !== undefined, (query) => query.where('a.space_id', '=', input.space!));
  const inScope = await scoped.execute();
  if (inScope.length === 0) return empty;
  const ids = inScope.map((row) => row.id);
  const kindOf = new Map(inScope.map((row) => [row.id, row.kind]));

  const begins = await trx
    .selectFrom('artifact_version')
    .select((eb) => eb.fn.min('created_at').as('first'))
    .where('artifact_id', 'in', ids)
    .executeTakeFirst();
  const recordBegins = (begins?.first as Date | null | undefined) ?? null;

  // One row per artifact: how many versions since, by an index on the time, and only the latest's
  // title read (the CP final review), the newest first, CHANGES_MAX of them.
  const { rows } = await sql<{
    artifact_id: string;
    versions: string;
    id: string;
    revision_no: number;
    version_no: number;
    created_at: Date;
    title: string | null;
  }>`
    select c.artifact_id, c.versions, l.id, l.revision_no, l.version_no, l.created_at, l.title
      from (select artifact_id, count(*) as versions
              from artifact_version
             where artifact_id = any(${ids}::uuid[]) and created_at > ${input.since}
             group by artifact_id) c
      cross join lateral (
        select v.id, v.revision_no, v.version_no, v.created_at, v.content->>'title' as title
          from artifact_version v
         where v.artifact_id = c.artifact_id
         order by v.revision_no desc, v.version_no desc
         limit 1) l
     order by l.created_at desc, l.id
     limit ${CHANGES_MAX + 1}`.execute(trx);
  const artifacts = rows.slice(0, CHANGES_MAX).map((row) => ({
    artifact: row.artifact_id,
    kind: kindOf.get(row.artifact_id) ?? '',
    title: row.title ?? '',
    versions: Number(row.versions),
    latest: { id: row.id, number: `${row.revision_no}.${row.version_no}`, at: row.created_at },
  }));

  // Values only at nodes whose component the reader may read, as the Data tab answers them: a node
  // they may not read never says it was resolved (the CP final review).
  const documents = inScope.filter((row) => row.kind === 'document').map((row) => row.id);
  const readableNodes = new Map<string, ReadonlySet<string>>();
  for (const document of documents) {
    const version = await latestVersion(trx, document);
    const read =
      version && readOutline(version.content, { artifact: document, version: version.id });
    if (!read || !read.ok) continue;
    const outcomes = await resolveOccurrences(trx, read.outline, input.reader);
    readableNodes.set(
      document,
      new Set(outcomes.flatMap((each) => (each.outcome === 'resolved' ? [each.node] : []))),
    );
  }
  const values =
    documents.length === 0
      ? []
      : (
          await trx
            .selectFrom('binding_resolution')
            .select(['document_id', 'node_id', 'binding_id', 'act', 'resolved_at'])
            .where('document_id', 'in', documents)
            .where('resolved_at', '>', input.since)
            .orderBy('resolved_at', 'desc')
            .orderBy('id', 'desc')
            .execute()
        ).filter((row) => readableNodes.get(row.document_id)?.has(row.node_id) === true);
  // Each value revised by hand, or its revision withdrawn, since (DAT-115): a changed value is never
  // a change nobody can see.
  const revised =
    documents.length === 0 || !(await revisionsKept(trx))
      ? []
      : (
          await trx
            .selectFrom('binding_revision')
            .select(['document_id', 'node_id', 'binding_id', 'act', 'revised_at as resolved_at'])
            .where('document_id', 'in', documents)
            .where('revised_at', '>', input.since)
            .orderBy('revised_at', 'desc')
            .orderBy('id', 'desc')
            .execute()
        ).filter((row) => readableNodes.get(row.document_id)?.has(row.node_id) === true);
  const changed = [...values, ...(revised as unknown as typeof values)].sort(
    (a, b) => b.resolved_at.getTime() - a.resolved_at.getTime(),
  );
  return {
    recordBegins,
    fromRecordStart: recordBegins !== null && input.since < recordBegins,
    artifacts,
    more: rows.length > CHANGES_MAX || changed.length > CHANGES_MAX,
    values: changed.slice(0, CHANGES_MAX).map((row) => ({
      document: row.document_id,
      node: row.node_id,
      binding: row.binding_id,
      act: row.act,
      at: row.resolved_at,
    })),
  };
}
