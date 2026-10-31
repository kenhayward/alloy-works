import {
  decide,
  obtainedFrom,
  readOutline,
  walkOutline,
  type CslItem,
  type EntryCheck,
  type EntryCheckOutcome,
  type ReferenceExtensionTarget,
  type ReferenceNotice,
  type EntryFlag,
  type ReferenceSourceKey,
  ENTRY_FLAGS,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFacts } from './access-facts.js';
import { notDeletedAs } from './deletion.js';
import { notifyTenant } from './realtime.js';
import { extensionTarget, tenantReferenceSources } from './reference-sources.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion } from './versions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * An entry's status (reference-sources.md, "The status"; the XR plan, XR-F): the system's word about
 * it from its last check against its source, beside it and never a version.
 */
export interface EntryStatus {
  readonly source: ReferenceSourceKey;
  readonly checkedAt: Date;
  readonly outcome: EntryCheckOutcome;
  readonly differs: readonly string[];
  readonly notice: ReferenceNotice | null;
}

/** The outcomes flagged on each citation (XR-G, LIB-035). */
export type { EntryFlag } from '@alloy-works/domain';

interface StatusRow {
  source: ReferenceSourceKey;
  checked_at: Date;
  outcome: EntryCheckOutcome;
  differs: string[];
  notice: ReferenceNotice | null;
  notified: string[];
}

const view = (row: StatusRow): EntryStatus => ({
  source: row.source,
  checkedAt: row.checked_at,
  outcome: row.outcome,
  differs: row.differs,
  notice: row.notice,
});

/** An entry's status, or undefined where it was never checked. */
export async function readEntryStatus(
  trx: TenantTransaction,
  entryId: string,
): Promise<EntryStatus | undefined> {
  if (!UUID.test(entryId)) return undefined;
  const { rows } = await sql<StatusRow>`
    select source, checked_at, outcome, differs, notice, notified
      from bibliography_entry_status where entry_id = ${entryId}`.execute(trx);
  return rows[0] && view(rows[0]);
}

/** Which of these entries are flagged, retracted, superseded or corrected (XR-G); whoever may read them. */
export async function citedFlags(
  trx: TenantTransaction,
  entryIds: readonly string[],
): Promise<Map<string, EntryFlag>> {
  const asked = [...new Set(entryIds.filter((each) => UUID.test(each)))];
  if (asked.length === 0) return new Map();
  const { rows } = await sql<{ entry_id: string; outcome: EntryFlag }>`
    select entry_id, outcome from bibliography_entry_status
     where entry_id = any(${asked}::uuid[]) and outcome = any(${ENTRY_FLAGS}::text[])`.execute(trx);
  return new Map(rows.map((row) => [row.entry_id, row.outcome]));
}

/** What a check asks of an entry's source: where its latest version was obtained, and its CSL. */
export interface CheckableEntry {
  readonly entryId: string;
  readonly source: ReferenceSourceKey;
  readonly identifier: string;
  readonly csl: CslItem;
  /** Where an extension source is reached, while it is installed (XR-J). */
  readonly extension?: ReferenceExtensionTarget;
}

/** An entry checkable against its source, an extension's target with it. */
const checkable = (
  entryId: string,
  from: { readonly source: ReferenceSourceKey; readonly identifier: string },
  csl: CslItem,
  sources: Awaited<ReturnType<typeof tenantReferenceSources>>,
): CheckableEntry => {
  const target = extensionTarget(sources.find((each) => each.id === from.source));
  return { entryId, ...from, csl, ...(target === undefined ? {} : { extension: target }) };
};

const LATEST_ENTRY = sql`(select v.content from artifact_version v
    where v.artifact_id = e.id order by v.revision_no desc, v.version_no desc limit 1)`;

/** An entry its source can check: its latest version obtained from one; else undefined. */
export async function entryCheckable(
  trx: TenantTransaction,
  entryId: string,
): Promise<CheckableEntry | undefined> {
  if (!UUID.test(entryId)) return undefined;
  const { rows } = await sql<{ content: { csl: CslItem; obtained?: { from: string } } }>`
    select ${LATEST_ENTRY} as content from artifact e
     where e.id = ${entryId} and e.kind = 'bibliographyEntry'`.execute(trx);
  const content = rows[0]?.content;
  const from = content?.obtained === undefined ? undefined : obtainedFrom(content.obtained.from);
  return from && checkable(entryId, from, content!.csl, await tenantReferenceSources(trx));
}

/**
 * The entries a nightly sweep checks (XR-E): cited by a component's latest version (the reference
 * index), obtained from a source the tenant has on, at most `limit` from each source, never attempted
 * first and then the longest since, so one that keeps failing goes to the back and a source that keeps
 * failing crowds out no other; then never checked first. An entry obtained before 0150 has no status,
 * so is among the first.
 */
export async function entriesDue(trx: TenantTransaction, limit: number): Promise<CheckableEntry[]> {
  const all = await tenantReferenceSources(trx);
  const sources = all.filter((each) => each.enabled).map((each) => each.id);
  if (sources.length === 0) return [];
  const { rows } = await sql<{
    id: string;
    content: { csl: CslItem; obtained?: { from: string } };
  }>`
    select id, content from (
      select e.id, l.content, a.last_attempt_at, s.checked_at,
             row_number() over (partition by k.source order by a.last_attempt_at asc nulls first,
                                s.checked_at asc nulls first, e.id) as n
        from artifact e
        cross join lateral (select ${LATEST_ENTRY} as content) l
        cross join lateral (select case when f like 'ext:%' then left(f, 40)
                                        else split_part(f, ':', 1) end as source
                              from (select l.content -> 'obtained' ->> 'from' as f) obtained) k
        left join bibliography_entry_status s on s.entry_id = e.id
        left join bibliography_entry_attempt a on a.entry_id = e.id
       where e.kind = 'bibliographyEntry'
         and ${notDeletedAs('e')}
         and exists (select from reference r where r.to_id = e.id and r.to_kind = 'bibliographyEntry')
         and k.source = any(${sources}::text[])
    ) due
     where n <= ${limit}
     order by last_attempt_at asc nulls first, checked_at asc nulls first, id`.execute(trx);
  return rows.flatMap((row) => {
    const from = row.content.obtained && obtainedFrom(row.content.obtained.from);
    return from ? [checkable(row.id, from, row.content.csl, all)] : [];
  });
}

/**
 * Records an attempt to check an entry (XR-E), answered or not. Refused, recording nothing, where the
 * last was within `gap` seconds: Check now's once a minute.
 */
export async function attemptEntryCheck(
  trx: TenantTransaction,
  entryId: string,
  gap = 0,
): Promise<boolean> {
  if (!UUID.test(entryId)) return false;
  const { rows } = await sql<{ entry_id: string }>`
    insert into bibliography_entry_attempt (entry_id, last_attempt_at) values (${entryId}, now())
    on conflict (entry_id) do update set last_attempt_at = excluded.last_attempt_at
     where bibliography_entry_attempt.last_attempt_at <= now() - make_interval(secs => ${gap})
    returning entry_id`.execute(trx);
  return rows.length > 0;
}

/**
 * Whether somebody may be told: held, neither erased nor a disabled service identity (XR-G).
 */
async function tellable(trx: TenantTransaction, principal: string | null): Promise<boolean> {
  if (principal === null) return false;
  const { rows } = await sql<{ ok: boolean }>`
    select p.erased_at is null and not exists (
      select from service_identity i where i.principal_id = p.id and i.disabled_at is not null
    ) as ok from principal p where p.id = ${principal}`.execute(trx);
  return rows[0]?.ok === true;
}

/** Those who administer a space, decided on their grants as every decision is. */
async function administrators(trx: TenantTransaction, space: string): Promise<string[]> {
  const { rows } = await sql<{ id: string }>`
    select distinct coalesce(g.principal_id, m.principal_id) as id
      from access_grant g
      join role r on r.id = g.role_id and 'administer' = any (r.permissions)
      left join group_member m on m.group_id = g.group_id
     where g.effect = 'allow'
       and (g.level = 'tenant' or (g.level = 'space' and g.space_id = ${space}))
       and coalesce(g.principal_id, m.principal_id) is not null
     order by id`.execute(trx);
  const found: string[] = [];
  for (const { id } of rows) {
    const facts = await loadFacts(trx, id, { kind: 'space', id: space });
    if (facts && decide('administer', facts).allowed && (await tellable(trx, id))) found.push(id);
  }
  return found;
}

/** Whether somebody may be told of a document: tellable, and may read it. */
async function tellableOf(
  trx: TenantTransaction,
  principal: string | null,
  document: string,
): Promise<boolean> {
  if (!(await tellable(trx, principal))) return false;
  const facts = await loadFacts(trx, principal!, { kind: 'artifact', id: document });
  return facts !== undefined && decide('read', facts).allowed;
}

/**
 * Who is told of an entry retracted, superseded or corrected (XR-G), each once with the first document by id:
 * each document placing a component whose latest version cites it, its review owner, else its maker,
 * else its space's administrators; the erased, the disabled and those who may not read it skipped.
 */
async function whoIsTold(trx: TenantTransaction, entryId: string): Promise<Map<string, string>> {
  const { rows } = await sql<{
    document: string;
    space_id: string | null;
    owner: string | null;
    maker: string | null;
  }>`
    select distinct d.id as document, d.space_id,
           (select x.owner from artifact_dates x where x.artifact_id = d.id
             order by x.id desc limit 1) as owner,
           (select v.author_id from artifact_version v where v.artifact_id = d.id
             order by v.revision_no, v.version_no limit 1) as maker
      from reference c
      join reference p on p.to_id = c.from_id and p.to_kind = 'component'
      join artifact d on d.id = p.from_id and d.kind = 'document'
     where c.to_id = ${entryId} and c.to_kind = 'bibliographyEntry' and ${notDeletedAs('d')}
     order by d.id`.execute(trx);
  const told = new Map<string, string>();
  for (const row of rows) {
    const people = (await tellableOf(trx, row.owner, row.document))
      ? [row.owner!]
      : (await tellableOf(trx, row.maker, row.document))
        ? [row.maker!]
        : row.space_id === null
          ? []
          : await administrators(trx, row.space_id);
    for (const each of people) {
      if (!told.has(each) && (await tellableOf(trx, each, row.document))) {
        told.set(each, row.document);
      }
    }
  }
  return told;
}

/**
 * A check recorded as the entry's status (XR-F), by the system: under the entry's advisory lock, so
 * two checks racing tell nobody twice. Flagged, those not yet told of that outcome are
 * told (XR-G), each at most once in thirty days however often it flaps: `bibliography_entry_told`
 * holds who was told what and when, `notified` who was of this outcome. Each notice is in a
 * savepoint, so a failure to tell never undoes the status. Answers who was told.
 */
export async function recordEntryCheck(
  trx: TenantTransaction,
  input: {
    readonly entryId: string;
    readonly source: ReferenceSourceKey;
    readonly check: EntryCheck;
  },
): Promise<{ readonly status: EntryStatus; readonly told: readonly string[] }> {
  const { entryId, source, check } = input;
  await sql`select pg_advisory_xact_lock(hashtext(${'entry-status:' + entryId}))`.execute(trx);
  const { rows: held } = await sql<StatusRow>`
    select outcome, notified from bibliography_entry_status where entry_id = ${entryId}
       for update`.execute(trx);
  const notified = held[0]?.outcome === check.outcome ? held[0].notified : [];
  const told: string[] = [];
  if ((ENTRY_FLAGS as readonly string[]).includes(check.outcome)) {
    const { rows: lately } = await sql<{ recipient: string }>`
      select recipient from bibliography_entry_told
       where entry_id = ${entryId} and outcome = ${check.outcome}
         and told_at > now() - interval '30 days'`.execute(trx);
    const recent = new Set(lately.map((row) => row.recipient));
    for (const [person, document] of await whoIsTold(trx, entryId)) {
      if (notified.includes(person) || recent.has(person)) continue;
      await sql`savepoint tell_of_entry`.execute(trx);
      try {
        await sql`insert into notification (recipient, kind, artifact_id, counts)
          values (${person}, 'reference', ${document},
                  ${JSON.stringify({ entry: entryId, outcome: check.outcome })}::jsonb)`.execute(
          trx,
        );
        await sql`insert into bibliography_entry_told (entry_id, recipient, outcome, told_at)
          values (${entryId}, ${person}, ${check.outcome}, now())
          on conflict (entry_id, recipient, outcome) do update set told_at = excluded.told_at`.execute(
          trx,
        );
        await notifyTenant(trx, { kind: 'inbox', recipient: person });
        await sql`release savepoint tell_of_entry`.execute(trx);
        told.push(person);
      } catch {
        await sql`rollback to savepoint tell_of_entry`.execute(trx);
      }
    }
  }
  const { rows } = await sql<StatusRow>`
    insert into bibliography_entry_status
      (entry_id, source, checked_at, outcome, differs, notice, notified)
    values (${entryId}, ${source}, now(), ${check.outcome}, ${check.differs}::text[],
            ${check.notice === null ? null : JSON.stringify(check.notice)}::jsonb,
            ${[...notified, ...told]}::uuid[])
    on conflict (entry_id) do update set source = excluded.source,
      checked_at = excluded.checked_at, outcome = excluded.outcome, differs = excluded.differs,
      notice = excluded.notice, notified = excluded.notified
    returning source, checked_at, outcome, differs, notice, notified`.execute(trx);
  return { status: view(rows[0]!), told };
}

/** A flagged entry cited by what a document places, and the components citing it. */
export interface FlaggedCitation {
  readonly entry: string;
  readonly outcome: EntryFlag;
  readonly components: readonly string[];
}

/**
 * The retracted, superseded and corrected entries the components a document places cite (XR-G, XR-H), each at
 * the version it places: a pinned one's, else the latest. Read by the system, whoever may read them;
 * by entry.
 */
export async function flaggedCited(
  trx: TenantTransaction,
  placed: readonly { readonly component: string; readonly version?: string }[],
): Promise<FlaggedCitation[]> {
  const pinned = placed.flatMap((each) => (each.version ? [each.version] : []));
  const latest = placed.flatMap((each) => (each.version ? [] : [each.component]));
  if (pinned.length === 0 && latest.length === 0) return [];
  const { rows } = await sql<{ entry: string; outcome: EntryFlag; components: string[] }>`
    with versions as (
      select id from artifact_version where id = any(${pinned}::uuid[])
      union
      select (select v.id from artifact_version v where v.artifact_id = a.id
               order by v.revision_no desc, v.version_no desc limit 1)
        from artifact a where a.id = any(${latest}::uuid[])
    )
    select s.entry_id as entry, s.outcome, array_agg(distinct v.artifact_id order by v.artifact_id) as components
      from versions w
      join artifact_version v on v.id = w.id
      cross join lateral jsonb_path_query(v.content,
        'strict $.** ? (@.type == "citation" || (@.type == "crossReference" && @.target.kind == "entry"))') c
      join bibliography_entry_status s
        on s.entry_id::text = coalesce(c ->> 'entry', c -> 'target' ->> 'entry')
       and s.outcome = any(${ENTRY_FLAGS}::text[])
     group by s.entry_id, s.outcome
     order by s.entry_id`.execute(trx);
  return rows;
}

/** The components a document's latest version places, each at its pin where it has one. */
export async function placedBy(
  trx: TenantTransaction,
  documentId: string,
): Promise<{ component: string; version?: string }[]> {
  const latest = await latestVersion(trx, documentId);
  if (latest?.kind !== 'document') return [];
  const read = readOutline(latest.content, { artifact: documentId, version: latest.id });
  if (!read.ok) return [];
  const placed: { component: string; version?: string }[] = [];
  walkOutline(read.outline.nodes, (node) => {
    if (node.type === 'reference') {
      placed.push({
        component: node.component,
        ...(node.mode.kind === 'pinned' ? { version: node.mode.version } : {}),
      });
    }
  });
  return placed;
}
