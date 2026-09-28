import { parseContentDocument } from '@alloy-works/domain';
import { sql } from 'kysely';
import { iterationDigest } from './editing.js';
import {
  checkedLimit,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { iterationRetained } from './retention.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion } from './versions.js';

/**
 * Reading iterations back (component-editor.md, "Recovery, as W11 builds it"): each is its writer's
 * alone (RC-A), and only what the sweep keeps is ever answered (VER-003), so the panel never offers a
 * row the next sweep may already have taken. Whether the caller holds the lock is the handler's to ask
 * (`holding`, editing.ts): these read, and never decide who may.
 */

/** One iteration as the Recovery panel lists it: when, from which session, against which version. */
export interface IterationSummary {
  readonly id: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly createdAt: Date;
  /** The version the session had opened, by id and as `revision.version`. */
  readonly openedFrom: { readonly id: string; readonly number: string };
}

/** One iteration whole, content and values (RC-E): read on its own, never in a listing. */
export interface StoredIteration extends IterationSummary {
  /** As stored; the reader migrates and validates it before anything opens it (CNT-012, CNT-013). */
  readonly content: unknown;
  readonly values: Record<string, unknown>;
}

/** Whose iterations of which component: always one principal's own. */
export interface IterationOwner {
  readonly artifactId: string;
  readonly principalId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The rows a caller may be answered: their own, of this component, that the sweep keeps. */
function ownRetained(trx: TenantTransaction, owner: IterationOwner) {
  return trx
    .selectFrom('iteration as i')
    .innerJoin('artifact_version as v', 'v.id', 'i.opened_from')
    .where('i.artifact_id', '=', owner.artifactId)
    .where('i.principal_id', '=', owner.principalId)
    .where(iterationRetained('i'));
}

interface SummaryRow {
  readonly id: string;
  readonly session_id: string;
  readonly sequence: number;
  readonly created_at: Date;
  readonly opened_from: string;
  readonly revision_no: number;
  readonly version_no: number;
}

const summaryOf = (row: SummaryRow): IterationSummary => ({
  id: row.id,
  sessionId: row.session_id,
  sequence: row.sequence,
  createdAt: row.created_at,
  openedFrom: { id: row.opened_from, number: `${row.revision_no}.${row.version_no}` },
});

/**
 * The caller's own retained iterations of a component, newest first, a keyset page at a time
 * (API-007), with no content (RC-E). An iteration swept while a walk is under way is simply absent
 * from the pages after it: iterations are never changed, only removed, so nothing else moves.
 */
export async function listIterations(
  trx: TenantTransaction,
  request: IterationOwner & ListingRequest<SortOf<'iterations'>>,
): Promise<Listed<IterationSummary>> {
  const limit = checkedLimit(request.limit);
  const { types, order } = listingSorts.iterations.saved;
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const snapshot = await snapshotFor(trx, request.snapshot);
  if (!UUID.test(request.artifactId)) return { items: [], next: null, snapshot };
  const inner = ownRetained(trx, request)
    .select([
      'i.id',
      'i.session_id',
      'i.sequence',
      'i.created_at',
      'i.opened_from',
      'v.revision_no',
      'v.version_no',
    ])
    .select(sortColumns([sql`i.created_at`]));
  const { rows, next } = await keysetPage<SummaryRow>(
    trx,
    inner,
    types,
    request.order ?? order,
    limit,
    request.after,
  );
  return { items: rows.map(summaryOf), next, snapshot };
}

/**
 * One of the caller's own retained iterations of a component, whole; undefined where it is another
 * principal's, another component's, swept or past its window, or no iteration at all, alike.
 */
export async function readIteration(
  trx: TenantTransaction,
  request: IterationOwner & { readonly iterationId: string },
): Promise<StoredIteration | undefined> {
  if (!UUID.test(request.artifactId) || !UUID.test(request.iterationId)) return undefined;
  const row = await ownRetained(trx, request)
    .select([
      'i.id',
      'i.session_id',
      'i.sequence',
      'i.created_at',
      'i.opened_from',
      'v.revision_no',
      'v.version_no',
      'i.content',
      'i.metadata_values',
    ])
    .where('i.id', '=', request.iterationId)
    .executeTakeFirst();
  return (
    row && {
      ...summaryOf(row),
      content: row.content,
      values: { ...row.metadata_values },
    }
  );
}

/**
 * When the caller last saved work on a component that was never made a version (RC-F): their newest
 * iteration opened from its latest version, or null. Only the time: nothing of the work leaves the
 * store until the lock is held. An iteration opened from the latest version has no later cut, so the
 * sweep keeps it and there is no window to ask about.
 *
 * Null too where that newest iteration holds exactly what the latest version holds, content and
 * values, by the iteration's own digest: text changed and changed back, then Done editing with
 * nothing to cut, left nothing a version lacks, and offering to recover it would be noise.
 */
export async function newestUncutIteration(
  trx: TenantTransaction,
  owner: IterationOwner,
): Promise<Date | null> {
  if (!UUID.test(owner.artifactId)) return null;
  const latest = await latestVersion(trx, owner.artifactId);
  if (!latest) return null;
  const row = await trx
    .selectFrom('iteration')
    .select(['created_at', 'digest'])
    .where('artifact_id', '=', owner.artifactId)
    .where('principal_id', '=', owner.principalId)
    .where('opened_from', '=', latest.id)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  const latestHolds = iterationDigest(parseContentDocument(latest.content), latest.values);
  return row.digest === latestHolds ? null : row.created_at;
}
