import { isLabelledKind, labelFor, type ReadableSet } from '@alloy-works/domain';
import { loadReadableSet } from './access-facts.js';
import { deletedAmong } from './deletion.js';
import { mayReadArtifact } from './queryDefinitions.js';
import { referencesStored } from './reference-index.js';
import type { TenantTransaction } from './tables.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The deepest a traversal may ask for (REL-017): there is no default. */
export const IMPACT_MAX_DEPTH = 10;
/** The most an interactive traversal returns, nearest first (REL-030). */
export const IMPACT_LIMIT = 1000;

/** One artifact a change reaches, at the least depth it is reached, and through which. */
export interface Reached {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly depth: number;
  /** The artifact it references, one hop nearer the start. */
  readonly via: string;
  /** Reached by a chain of references alone, which would break or change (REL-023). */
  readonly hard: true;
}

export interface Impact {
  readonly reached: readonly Reached[];
  /** How many depths were walked: fewer than asked only where a step stopped it (R3-F). */
  readonly depths: number;
  /** Whether an edge led to something the caller may not read: never what (REL-020). */
  readonly cut: boolean;
  /** Whether the walk stopped at the limit with more to say (REL-030). */
  readonly more: boolean;
}

/** One artifact one hop away, readable by the caller, or flagged where not. */
export interface Neighbours {
  readonly items: readonly { readonly id: string; readonly kind: string; readonly title: string }[];
  readonly unreadable: boolean;
}

interface Edge {
  readonly from_id: string;
  readonly to_id: string;
  readonly kind: string;
  readonly space_id: string | null;
}

/**
 * What a change to an artifact reaches (relationships.md, "Impact"; the R2 plan, R2-C, R2-D): the
 * artifacts whose latest versions reference it, and those referencing them, to `depth`. A depth at a
 * time, each artifact taken once, at the least depth it is reached (REL-018), so a cycle ends the walk.
 * Each is tested against `by`'s readable set as it is reached: one that fails, or is deleted, is
 * neither returned nor expanded, and an unreadable one says the walk was cut (REL-019, REL-020). It
 * stops at the nearest `limit` (REL-030). The caller has decided `by` may read the start.
 */
export async function impact(
  trx: TenantTransaction,
  by: string,
  id: string,
  depth: number,
  limit = IMPACT_LIMIT,
  /**
   * After each depth, told how many it has walked and found: false stops the walk there. A
   * background report records progress and hears a cancel here (the R3 plan, R3-F).
   */
  step?: (walked: number, reached: number) => Promise<boolean>,
): Promise<Impact> {
  if (!Number.isInteger(depth) || depth < 1 || depth > IMPACT_MAX_DEPTH) {
    throw new Error(`An impact walk declares a depth from 1 to ${IMPACT_MAX_DEPTH}, not ${depth}`);
  }
  const none: Impact = { reached: [], depths: 0, cut: false, more: false };
  if (!UUID.test(id) || !(await referencesStored(trx))) return none;
  const readable = await loadReadableSet(trx, by);
  const seen = new Set([id]);
  const reached: Omit<Reached, 'title'>[] = [];
  let cut = false;
  let more = false;
  let frontier = [id];
  let walked = 0;
  for (let at = 1; at <= depth && frontier.length > 0 && !more; at += 1) {
    const edges = await edgesInto(trx, frontier);
    const fresh = edges.filter((edge) => !seen.has(edge.from_id));
    const deleted = await deletedAmong(
      trx,
      fresh.map((edge) => edge.from_id),
    );
    const next: string[] = [];
    for (const edge of fresh) {
      if (seen.has(edge.from_id)) continue;
      seen.add(edge.from_id);
      if (deleted.has(edge.from_id)) continue;
      if (!readableBy(readable, edge)) {
        cut = true;
        continue;
      }
      if (reached.length === limit) {
        more = true;
        break;
      }
      reached.push({ id: edge.from_id, kind: edge.kind, depth: at, via: edge.to_id, hard: true });
      next.push(edge.from_id);
    }
    frontier = next;
    walked = at;
    if (step && !(await step(at, reached.length))) break;
  }
  // A walk that ran out of artifacts before its depth has walked every depth there was.
  if (frontier.length === 0 || more) walked = depth;
  const titles = await titlesOf(
    trx,
    reached.map((each) => each.id),
  );
  return {
    reached: reached.map((each) => ({ ...each, title: titles.get(each.id) ?? '' })),
    depths: walked,
    cut,
    more,
  };
}

/**
 * What an artifact's latest version references, one hop forwards (SCH-024; R2-E): those `by` may
 * read, and whether there are others. A deleted one is neither.
 */
export async function referencesFrom(
  trx: TenantTransaction,
  by: string,
  id: string,
): Promise<Neighbours> {
  if (!UUID.test(id) || !(await referencesStored(trx))) return { items: [], unreadable: false };
  const rows = await trx
    .selectFrom('reference as r')
    .innerJoin('artifact as a', 'a.id', 'r.to_id')
    .select(['r.to_id as id', 'a.kind', 'a.space_id'])
    .where('r.from_id', '=', id)
    .distinct()
    .execute();
  const readable = await loadReadableSet(trx, by);
  const deleted = await deletedAmong(
    trx,
    rows.map((row) => row.id),
  );
  const live = rows.filter((row) => !deleted.has(row.id));
  const shown = live.filter((row) =>
    readableBy(readable, { from_id: row.id, to_id: id, kind: row.kind, space_id: row.space_id }),
  );
  const titles = await titlesOf(
    trx,
    shown.map((row) => row.id),
  );
  const items = shown
    .map((row) => ({ id: row.id, kind: row.kind, title: titles.get(row.id) ?? '' }))
    .sort((a, b) => compare(a.title, b.title) || compare(a.id, b.id));
  return { items, unreadable: shown.length < live.length };
}

/** Each reference into these, from whatever holds it now, nearest-first order kept stable by id. */
async function edgesInto(trx: TenantTransaction, targets: readonly string[]): Promise<Edge[]> {
  return trx
    .selectFrom('reference as r')
    .innerJoin('artifact as a', 'a.id', 'r.from_id')
    .select(['r.from_id', 'r.to_id', 'a.kind', 'a.space_id'])
    .where('r.to_id', 'in', [...targets])
    .orderBy('r.from_id')
    .orderBy('r.to_id')
    .execute();
}

function readableBy(readable: ReadableSet | undefined, edge: Edge): boolean {
  return (
    readable !== undefined &&
    edge.space_id !== null &&
    mayReadArtifact(readable, { id: edge.from_id, spaceId: edge.space_id })
  );
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Each artifact's title or name, from its latest version, as the audit labels it. */
async function titlesOf(trx: TenantTransaction, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, string>();
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
      (isLabelledKind(row.kind)
        ? labelFor(row.kind, (row.content ?? {}) as Record<string, unknown>)
        : undefined) ?? '',
    ]),
  );
}
