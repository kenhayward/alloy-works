import {
  decide,
  labelFor,
  type ConnectionSettings,
  type Permission,
  type ReadableSet,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFactsFor, loadReadableSet } from './access-facts.js';
import { notArchivedAs } from './archival.js';
import { notDeletedAs } from './deletion.js';
import { CREDENTIAL_CURRENT, credentialSetFor } from './connections.js';
import { readableArtifactsAs } from './readable-artifacts.js';
import { newestUncutIteration } from './recovery.js';
import { iterationRetained } from './retention.js';
import type { TenantTransaction } from './tables.js';

/**
 * **What waits on a person** (home.md, Needs your attention; the HM plan, HM-A to HM-F): computed when
 * asked, stored nowhere; nothing archived (lifecycle.md). Each condition is found in SQL over their readable set, the act it asks is
 * decided on what was found alone, then one item per artifact, the most pressing kind first.
 */

/** The most pressing first (HM-A). */
export const ATTENTION_KINDS = [
  'publish_failed',
  'changes_not_in_version',
  'published_earlier',
  'connection_untested',
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** How many items are answered; the total counts the rest. */
export const ATTENTION_LIMIT = 20;

/**
 * How many components, those holding a person's newest changes, are asked whether a version holds
 * them (HM-C): each asking reads the component's versions.
 */
export const ATTENTION_CHANGES_CHECKED = 50;

export interface AttentionItem {
  readonly kind: AttentionKind;
  readonly artifact: {
    readonly id: string;
    readonly kind: 'document' | 'component' | 'connection';
    /** As the reader reads it now; null where it has none. */
    readonly title: string | null;
  };
  /** A failed publish's: its first stored failure's code. */
  readonly reason?: string;
  /** A failed publish's: the request, which its requester reads with every failure. */
  readonly request?: string;
}

/** The act that resolves each kind, decided before it is listed (HM-F). */
const ACT: Readonly<Record<AttentionKind, Permission>> = {
  publish_failed: 'publish',
  changes_not_in_version: 'edit',
  published_earlier: 'publish',
  connection_untested: 'use_connection',
};

interface Found {
  readonly kind: AttentionKind;
  readonly id: string;
  readonly at: Date;
  readonly reason?: string;
  readonly request?: string;
}

/**
 * HM-B: their latest publish of a readable document failed, and nothing later they read or made. A
 * baseline's publish is of a pinned version (0073), so it neither fails nor clears one. Requests made
 * in one transaction share their time and `made_tx` (all made before 0074 share one), so `id` breaks
 * the tie, here and in what clears.
 */
async function publishFailed(trx: TenantTransaction, me: string, readable: ReadableSet) {
  const { rows } = await sql<{ id: string; at: Date; reason: string | null; request: string }>`
    select r.document_id as id, r.finished_at as at, r.failures -> 0 ->> 'code' as reason,
      r.id as request
    from (
      select distinct on (document_id)
        id, document_id, state, failures, finished_at, requested_at, made_tx
      from publication_request
      where requested_by = ${me} and kind = 'publish' and baseline_id is null
      order by document_id, requested_at desc, made_tx desc, id desc
    ) r
    join artifact a on a.id = r.document_id
    where r.state = 'failed' and ${readableArtifactsAs('a', readable)} and ${notArchivedAs('a')}
      and ${notDeletedAs('a')}
      and not exists (
        select 1 from publication p
        join publication_request pr on pr.id = p.request_id
        join artifact pa on pa.id = p.id
        where p.document_id = r.document_id and p.baseline_id is null
          and (pr.requested_at, pr.made_tx, pr.id) > (r.requested_at, r.made_tx, r.id)
          and (p.publisher = ${me} or ${readableArtifactsAs('pa', readable)})
      )
  `.execute(trx);
  return rows.map((row): Found => ({
    kind: 'publish_failed',
    id: row.id,
    at: row.at,
    ...(row.reason === null ? {} : { reason: row.reason }),
    request: row.request,
  }));
}

/**
 * HM-C: readable components holding retained iterations of theirs newer than any discard, the
 * `ATTENTION_CHANGES_CHECKED` holding the newest; whether a version holds them is
 * `newestUncutIteration`'s, asked of the permitted ones alone.
 */
async function withIterations(trx: TenantTransaction, me: string, readable: ReadableSet) {
  const { rows } = await sql<{ id: string }>`
    select i.artifact_id as id
    from iteration i
    join artifact a on a.id = i.artifact_id
    left join unsaved_discarded d on d.artifact_id = i.artifact_id and d.principal_id = ${me}
    where i.principal_id = ${me} and ${iterationRetained('i')}
      and ${readableArtifactsAs('a', readable)} and ${notArchivedAs('a')} and ${notDeletedAs('a')}
    group by i.artifact_id, d.up_to
    having d.up_to is null or max(i.created_at) > d.up_to
    order by max(i.created_at) desc, i.artifact_id
    limit ${ATTENTION_CHANGES_CHECKED}
  `.execute(trx);
  return rows.map((row) => row.id);
}

/**
 * HM-D: the latest publication they read or made is of a version older than the document's latest. A
 * baseline pins an older version on purpose (0073), so a publication of one neither lists nor clears.
 */
async function publishedEarlier(trx: TenantTransaction, me: string, readable: ReadableSet) {
  const { rows } = await sql<{ id: string; at: Date }>`
    select a.id, lv.created_at as at
    from artifact a
    join lateral (
      select v.revision_no, v.version_no, v.created_at from artifact_version v
      where v.artifact_id = a.id
      order by v.revision_no desc, v.version_no desc limit 1
    ) lv on true
    join lateral (
      select pv.revision_no, pv.version_no from publication p
      join artifact pa on pa.id = p.id
      join artifact_version pv on pv.id = p.document_version_id
      where p.document_id = a.id and p.baseline_id is null
        and (p.publisher = ${me} or ${readableArtifactsAs('pa', readable)})
      order by p.published_at desc, pa.created_at desc, p.id desc limit 1
    ) lp on true
    where a.kind = 'document' and ${readableArtifactsAs('a', readable)} and ${notArchivedAs('a')}
      and ${notDeletedAs('a')}
      and (lp.revision_no, lp.version_no) < (lv.revision_no, lv.version_no)
  `.execute(trx);
  return rows.map((row): Found => ({ kind: 'published_earlier', id: row.id, at: row.at }));
}

/**
 * HM-E: readable connections not retired, whose credential is set by the listing's rule
 * (`credentialSetFor`) and whose latest test was not made with it (`CREDENTIAL_CURRENT`).
 */
async function connectionUntested(trx: TenantTransaction, readable: ReadableSet) {
  const { rows } = await sql<{
    id: string;
    settings: ConnectionSettings;
    digest: string | null;
    at: Date;
  }>`
    select a.id, lv.content as settings, c.target_digest as digest, c.set_at as at
    from artifact a
    join lateral (
      select v.content from artifact_version v
      where v.artifact_id = a.id
      order by v.revision_no desc, v.version_no desc limit 1
    ) lv on true
    join lateral (
      select c.target_digest, c.set_at from connection_credential c
      where c.connection_id = a.id order by c.id desc limit 1
    ) c on true
    left join lateral (
      select ${CREDENTIAL_CURRENT} as current from connection_test t
      where t.connection_id = a.id order by t.id desc limit 1
    ) t on true
    where a.kind = 'connection' and ${readableArtifactsAs('a', readable)}
      and not coalesce((lv.content ->> 'retired')::boolean, false)
      and t.current is not true
  `.execute(trx);
  return rows
    .filter((row) => credentialSetFor(row.digest, row.settings))
    .map((row): Found => ({ kind: 'connection_untested', id: row.id, at: row.at }));
}

/** Each listed artifact's kind and title, at its latest version. */
async function titlesOf(trx: TenantTransaction, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, { kind: string; title: string | null }>();
  const rows = await trx
    .selectFrom('artifact_version as v')
    .innerJoin('artifact as a', 'a.id', 'v.artifact_id')
    .select(['v.artifact_id', 'a.kind', 'v.content'])
    .distinctOn('v.artifact_id')
    .where('v.artifact_id', 'in', [...ids])
    .orderBy('v.artifact_id')
    .orderBy('v.revision_no', 'desc')
    .orderBy('v.version_no', 'desc')
    .execute();
  return new Map(
    rows.map((row) => [
      row.artifact_id,
      {
        kind: row.kind,
        title:
          row.kind === 'document' || row.kind === 'component' || row.kind === 'connection'
            ? (labelFor(row.kind, row.content as Record<string, unknown>) ?? null)
            : null,
      },
    ]),
  );
}

/**
 * What waits on a person that they may resolve (HM-A): one item per artifact, the most pressing kind
 * first and newest first within it, at most `limit`, with how many in all. Nothing they may not read is
 * listed or counted (SCH-032).
 */
export async function whatWaits(
  trx: TenantTransaction,
  principalId: string,
  limit = ATTENTION_LIMIT,
): Promise<{ readonly items: AttentionItem[]; readonly total: number }> {
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return { items: [], total: 0 };
  const failed = await publishFailed(trx, principalId, readable);
  const edited = await withIterations(trx, principalId, readable);
  const earlier = await publishedEarlier(trx, principalId, readable);
  const untested = await connectionUntested(trx, readable);

  const facts = await loadFactsFor(trx, principalId, [
    ...failed.map((each) => each.id),
    ...edited,
    ...earlier.map((each) => each.id),
    ...untested.map((each) => each.id),
  ]);
  const permitted = (id: string, kind: AttentionKind) => {
    const known = facts.get(id);
    return known !== undefined && decide(ACT[kind], known).allowed;
  };
  const changes: Found[] = [];
  for (const id of edited) {
    if (!permitted(id, 'changes_not_in_version')) continue;
    const at = await newestUncutIteration(trx, { artifactId: id, principalId });
    if (at !== null) changes.push({ kind: 'changes_not_in_version', id, at });
  }

  const seen = new Set<string>();
  const found: Found[] = [];
  for (const kind of ATTENTION_KINDS) {
    const ofKind = (
      kind === 'changes_not_in_version'
        ? changes
        : [...failed, ...earlier, ...untested].filter(
            (each) => each.kind === kind && permitted(each.id, kind),
          )
    ).sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? -1 : 1));
    for (const each of ofKind) {
      if (seen.has(each.id)) continue;
      seen.add(each.id);
      found.push(each);
    }
  }

  const listed = found.slice(0, limit);
  const titles = await titlesOf(
    trx,
    listed.map((each) => each.id),
  );
  return {
    items: listed.map((each) => ({
      kind: each.kind,
      artifact: {
        id: each.id,
        kind: titles.get(each.id)!.kind as AttentionItem['artifact']['kind'],
        title: titles.get(each.id)!.title,
      },
      ...(each.reason === undefined ? {} : { reason: each.reason }),
      ...(each.request === undefined ? {} : { request: each.request }),
    })),
    total: found.length,
  };
}
