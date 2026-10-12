import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';

/** An artifact with versions cut since the instant (SCH-025). */
export interface ChangedArtifact {
  readonly artifact: string;
  readonly kind: string;
  readonly title: string;
  /** How many versions were cut since. */
  readonly versions: number;
  readonly latest: { readonly id: string; readonly number: string; readonly at: Date };
}

/** A value a document holds resolved or accepted since the instant. */
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
}

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

  const { rows } = await sql<{
    artifact_id: string;
    versions: string;
    id: string;
    revision_no: number;
    version_no: number;
    created_at: Date;
    title: string | null;
  }>`
    select v.artifact_id, count(*) over (partition by v.artifact_id) as versions,
           v.id, v.revision_no, v.version_no, v.created_at, v.content->>'title' as title
      from artifact_version v
     where v.artifact_id = any(${ids}::uuid[]) and v.created_at > ${input.since}
     order by v.artifact_id, v.revision_no desc, v.version_no desc`.execute(trx);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.artifact_id)) latest.set(row.artifact_id, row);
  const artifacts = [...latest.values()]
    .sort((left, right) => right.created_at.getTime() - left.created_at.getTime())
    .map((row) => ({
      artifact: row.artifact_id,
      kind: kindOf.get(row.artifact_id) ?? '',
      title: row.title ?? '',
      versions: Number(row.versions),
      latest: { id: row.id, number: `${row.revision_no}.${row.version_no}`, at: row.created_at },
    }));

  const documents = inScope.filter((row) => row.kind === 'document').map((row) => row.id);
  const values =
    documents.length === 0
      ? []
      : await trx
          .selectFrom('binding_resolution')
          .select(['document_id', 'node_id', 'binding_id', 'act', 'resolved_at'])
          .where('document_id', 'in', documents)
          .where('resolved_at', '>', input.since)
          .orderBy('resolved_at', 'desc')
          .orderBy('id', 'desc')
          .execute();
  return {
    recordBegins,
    fromRecordStart: recordBegins !== null && input.since < recordBegins,
    artifacts,
    values: values.map((row) => ({
      document: row.document_id,
      node: row.node_id,
      binding: row.binding_id,
      act: row.act,
      at: row.resolved_at,
    })),
  };
}
