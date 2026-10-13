import type { ReadableSet } from '@alloy-works/domain';
import { sql, type RawBuilder, type SqlBool } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { artifactPlace, recordEvent } from './audit.js';
import { readLock } from './editing.js';
import { isHeld } from './holds.js';
import { visibleIn } from './listing.js';
import { mayReadArtifact } from './queryDefinitions.js';
import type { TenantTransaction } from './tables.js';
import { lockArtifact } from './versions.js';

/**
 * **Deletion** (lifecycle.md; the DL plan, DL-A to DL-F): a component or a document deleted is a
 * tombstone, `artifact_deletion`'s latest act. Nothing is removed: its versions, iterations, threads,
 * suggestions, rounds and events stay, unreachable, and an undelete brings all of it back. Refused
 * while anything depends on it, every reason listed. Who may - `retire` - is the caller's to decide.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The tenant's one deletion lock (DL-D): exclusive to delete and undelete, shared by dependants. */
const DELETION_LOCK = sql`hashtextextended('alloy-works:deletion:' || current_schema(), 0)`;

/**
 * Taken by every writer of something a deletion asks about - a reference, a baseline, a request, a
 * hold - before it reads what it depends on, and before any artifact's lock: a delete takes this, then
 * the artifact's, so the reverse order would deadlock against it.
 */
export async function shareDeletion(trx: TenantTransaction): Promise<void> {
  await sql`select pg_advisory_xact_lock_shared(${DELETION_LOCK})`.execute(trx);
}

/**
 * Whether the artifact aliased `alias` is deleted: its latest act, as `snapshot` sees it where a walk
 * gives one, else as the statement does, is `deleted`.
 */
export function deletedAs(alias: string, snapshot?: string): RawBuilder<SqlBool> {
  const seen = snapshot === undefined ? sql<SqlBool>`true` : visibleIn('x.written_by', snapshot);
  return sql<SqlBool>`coalesce((select x.act = 'deleted' from artifact_deletion x
    where x.artifact_id = ${sql.ref(`${alias}.id`)} and ${seen}
    order by x.id desc limit 1), false)`;
}

/** What every reader keeps: the artifact aliased `alias` not deleted (DL-B). */
export function notDeletedAs(alias: string, snapshot?: string): RawBuilder<SqlBool> {
  return sql<SqlBool>`not ${deletedAs(alias, snapshot)}`;
}

/**
 * Whether this tenant stores deletion yet (0085): a migration's own test runs today's code on a schema
 * short of it, where nothing is deleted.
 */
export async function deletionStored(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('artifact_deletion') is not null as present`.execute(trx);
  return rows[0]?.present === true;
}

/** Whether the artifact is deleted now. */
export async function isDeleted(trx: TenantTransaction, artifactId: string): Promise<boolean> {
  if (!UUID.test(artifactId) || !(await deletionStored(trx))) return false;
  const latest = await trx
    .selectFrom('artifact_deletion')
    .select('act')
    .where('artifact_id', '=', artifactId)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return latest?.act === 'deleted';
}

/** Which of these artifacts are deleted now. */
export async function deletedAmong(
  trx: TenantTransaction,
  artifactIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const ids = [...new Set(artifactIds.filter((id) => UUID.test(id)))];
  if (ids.length === 0 || !(await deletionStored(trx))) return new Set();
  const { rows } = await sql<{ id: string }>`
    select a.id from artifact a where a.id = any(${ids}::uuid[]) and ${deletedAs('a')}`.execute(
    trx,
  );
  return new Set(rows.map((row) => row.id));
}

/** A dependant, by its id and its title or name, named only to whoever may read it. */
export interface Named {
  readonly id: string;
  readonly title: string;
}

/** Each reason a deletion is refused (DL-C), every one listed. */
export type DeletionRefusal =
  | {
      /** A baseline pins a version, superseded or not; a document's own baselines. */
      readonly reason: 'baselined';
      readonly named: readonly Named[];
      readonly unreadable: boolean;
    }
  | {
      /** A publication placed a version; a document's own publications. */
      readonly reason: 'published';
      readonly named: readonly Named[];
      readonly unreadable: boolean;
    }
  | {
      /** A queued request, a publish or a preview, places it; a document's own. */
      readonly reason: 'publishing';
      readonly named: readonly Named[];
      readonly unreadable: boolean;
    }
  | {
      /** A document's latest version references it, in any mode, deleted documents included. */
      readonly reason: 'referenced';
      readonly named: readonly Named[];
      readonly unreadable: boolean;
    }
  /** A hold on it or its space: no reason given (LIF-030). */
  | { readonly reason: 'held' }
  /** Somebody is editing it. */
  | {
      readonly reason: 'locked';
      readonly holder: { readonly id: string; readonly name: string | null };
    }
  /** A review round open on it. */
  | {
      readonly reason: 'in_review';
      readonly named: readonly Named[];
      readonly unreadable: boolean;
    };

/** What a deletion leaves (LIF-024, VER-048): counts of what stays, unreachable, and comes back. */
export interface Remains {
  readonly versions: number;
  readonly iterations: number;
  readonly threads: number;
  readonly suggestions: number;
  readonly rounds: number;
  readonly events: number;
}

export interface DeletionState {
  readonly kind: 'component' | 'document';
  readonly deleted: boolean;
  readonly remains: Remains;
  /** Why it may not be deleted now; empty where it may, or is deleted already. */
  readonly refusals: readonly DeletionRefusal[];
}

interface Row {
  readonly id: string;
  readonly title: string | null;
  /** The artifact whose readability names it, and its space. */
  readonly subject: string;
  readonly space_id: string | null;
}

/**
 * Each named where `readable` holds it, in the order read; of the rest only that there are any, never
 * how many or what (SCH-032).
 */
function split(rows: readonly Row[], readable: ReadableSet | undefined) {
  const named: Named[] = [];
  let unreadable = false;
  for (const row of rows) {
    if (readable && mayReadArtifact(readable, { id: row.subject, spaceId: row.space_id })) {
      named.push({ id: row.id, title: row.title ?? '' });
    } else unreadable = true;
  }
  return { named, unreadable };
}

const REFERENCES = `lax $.** ? (@.type == "reference" && @.component == $c)`;

/** Everything that depends on it now, every reason, `by`'s readable set naming what it may (DL-C). */
async function dependants(
  trx: TenantTransaction,
  id: string,
  kind: 'component' | 'document',
  by: string,
): Promise<DeletionRefusal[]> {
  const readable = await loadReadableSet(trx, by);
  const component = kind === 'component';
  const refusals: DeletionRefusal[] = [];
  const add = (
    reason: 'baselined' | 'published' | 'publishing' | 'referenced' | 'in_review',
    rows: readonly Row[],
  ) => {
    if (rows.length > 0) refusals.push({ reason, ...split(rows, readable) });
  };

  const { rows: baselines } = await sql<Row>`
    select distinct b.id, b.name as title, a.id as subject, a.space_id
      from baseline b join artifact a on a.id = b.document_id
     where ${
       component
         ? sql`b.id in (select baseline_id from baseline_pin where artifact_id = ${id})`
         : sql`b.document_id = ${id}`
     }
     order by b.name, b.id`.execute(trx);
  add('baselined', baselines);

  const { rows: publications } = await sql<Row>`
    select p.id, d.content ->> 'title' as title, a.id as subject, a.space_id
      from publication p join artifact a on a.id = p.id
      join artifact_version d on d.id = p.document_version_id
     where ${
       component
         ? sql`p.id in (select i.publication_id from publication_input i
             join artifact_version v on v.id = i.version_id where v.artifact_id = ${id})`
         : sql`p.document_id = ${id}`
     }
     order by p.published_at, p.id`.execute(trx);
  add('published', publications);

  const { rows: requests } = await sql<Row>`
    select r.id, d.content ->> 'title' as title, a.id as subject, a.space_id
      from publication_request r join artifact a on a.id = r.document_id
      join artifact_version d on d.id = r.document_version_id
     where r.state = 'queued' and ${
       component
         ? sql`r.id in (select request_id from publication_request_occurrence
             where component_id = ${id})`
         : sql`r.document_id = ${id}`
     }
     order by r.requested_at, r.id`.execute(trx);
  add('publishing', requests);

  if (component) {
    // Each document whose latest version references it, deleted or not (DL-C), found among those
    // any version of which ever did.
    const c = JSON.stringify({ c: id });
    const { rows: documents } = await sql<Row>`
      select latest.artifact_id as id, latest.content ->> 'title' as title,
             latest.artifact_id as subject, a.space_id
        from (
          select distinct on (v.artifact_id) v.artifact_id, v.content
            from artifact_version v
           where v.kind = 'document'
             and v.artifact_id in (
               select artifact_id from artifact_version
                where kind = 'document'
                  and jsonb_path_exists(content, ${REFERENCES}::jsonpath, ${c}::jsonb))
           order by v.artifact_id, v.revision_no desc, v.version_no desc
        ) latest
        join artifact a on a.id = latest.artifact_id
       where jsonb_path_exists(latest.content, ${REFERENCES}::jsonpath, ${c}::jsonb)
       order by latest.content ->> 'title', latest.artifact_id`.execute(trx);
    add('referenced', documents);
  }

  if (await isHeld(trx, id)) refusals.push({ reason: 'held' });

  if (component) {
    const lock = await readLock(trx, id);
    if (lock)
      refusals.push({ reason: 'locked', holder: { id: lock.holder, name: lock.holderName } });
  } else {
    const { rows: rounds } = await sql<Row>`
      select r.id, r.title, r.document_id as subject, a.space_id
        from review_round r join artifact a on a.id = r.document_id
       where r.document_id = ${id}
         and not exists (select from review_round_event e
                          where e.round_id = r.id and e.act = 'closed')
       order by r.opened_at, r.id`.execute(trx);
    add('in_review', rounds);
  }
  return refusals;
}

/** What stays of it, deleted or not (VER-048). */
async function remainsOf(trx: TenantTransaction, id: string): Promise<Remains> {
  const { rows } = await sql<Record<keyof Remains, string>>`
    select (select count(*) from artifact_version where artifact_id = ${id}) as versions,
           (select count(*) from iteration where artifact_id = ${id}) as iterations,
           (select count(*) from thread where on_id = ${id}) as threads,
           (select count(*) from suggestion where component_id = ${id}) as suggestions,
           (select count(*) from review_round where document_id = ${id}) as rounds,
           (select count(*) from audit_event where subject = ${id}) as events`.execute(trx);
  const row = rows[0]!;
  return {
    versions: Number(row.versions),
    iterations: Number(row.iterations),
    threads: Number(row.threads),
    suggestions: Number(row.suggestions),
    rounds: Number(row.rounds),
    events: Number(row.events),
  };
}

async function deletable(
  trx: TenantTransaction,
  artifactId: string,
): Promise<'component' | 'document' | undefined> {
  if (!UUID.test(artifactId)) return undefined;
  const artifact = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', artifactId)
    .executeTakeFirst();
  return artifact?.kind === 'component' || artifact?.kind === 'document'
    ? artifact.kind
    : undefined;
}

/**
 * What deleting it would leave and what refuses it now, as `by` may be told (LIF-024, VER-047): the
 * preview the page shows before **Delete**. Undefined for anything but a component or a document.
 */
export async function deletionOf(
  trx: TenantTransaction,
  artifactId: string,
  by: string,
): Promise<DeletionState | undefined> {
  const kind = await deletable(trx, artifactId);
  if (!kind) return undefined;
  const deleted = await isDeleted(trx, artifactId);
  return {
    kind,
    deleted,
    remains: await remainsOf(trx, artifactId),
    refusals: deleted ? [] : await dependants(trx, artifactId, kind, by),
  };
}

export type DeleteAnswer =
  | { readonly answer: 'deleted' | 'unchanged' }
  | { readonly answer: 'refused'; readonly refusals: readonly DeletionRefusal[] };

export type UndeleteAnswer = { readonly answer: 'undeleted' | 'unchanged' };

async function act(
  trx: TenantTransaction,
  artifactId: string,
  by: string,
  act: 'deleted' | 'undeleted',
): Promise<DeleteAnswer | UndeleteAnswer | undefined> {
  const kind = await deletable(trx, artifactId);
  if (!kind) return undefined;
  // Exclusive, then the artifact's (DL-D): every dependant's writer waits, or is waited for, and a
  // version or a lock on it is recorded before or after, never between.
  await sql`select pg_advisory_xact_lock(${DELETION_LOCK})`.execute(trx);
  await lockArtifact(trx, artifactId);
  if ((await isDeleted(trx, artifactId)) === (act === 'deleted')) return { answer: 'unchanged' };
  // An undelete is never refused (DL-G): a deleted document's references held what it references.
  if (act === 'deleted') {
    const refusals = await dependants(trx, artifactId, kind, by);
    if (refusals.length > 0) return { answer: 'refused', refusals };
  }
  await trx
    .insertInto('artifact_deletion')
    .values({ artifact_id: artifactId, kind, act, by })
    .execute();
  await trx
    .updateTable('search_entry')
    .set({ deleted: act === 'deleted' })
    .where('artifact_id', '=', artifactId)
    .execute();
  const place = await artifactPlace(trx, artifactId);
  await recordEvent(
    trx,
    {
      kind: act === 'deleted' ? 'artifact.deleted' : 'artifact.undeleted',
      subject: { kind, id: artifactId, version: place.version },
      space: place.space,
    },
    place.labels,
  );
  return { answer: act };
}

/**
 * Deletes a component or a document (LIF-023, VER-047): a tombstone, refused while anything depends
 * on it, every reason listed. Deleting the deleted changes nothing. Undefined for anything else.
 */
export function deleteArtifact(
  trx: TenantTransaction,
  artifactId: string,
  by: string,
): Promise<DeleteAnswer | undefined> {
  return act(trx, artifactId, by, 'deleted') as Promise<DeleteAnswer | undefined>;
}

/** Undeletes one, everything it kept back with it; never refused, by a hold or anything else. */
export async function undeleteArtifact(
  trx: TenantTransaction,
  artifactId: string,
  by: string,
): Promise<UndeleteAnswer | undefined> {
  return (await act(trx, artifactId, by, 'undeleted')) as UndeleteAnswer | undefined;
}
