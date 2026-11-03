import { administerOrAbove, decide, type Permission } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFactsFor } from './access-facts.js';
import { artifactPlace, labelled, labels, recordEvent, type AuditLabel } from './audit.js';
import { isArchived } from './archival.js';
import { deletedAmong, isDeleted, shareDeletion } from './deletion.js';
import { grantsOn, recordGrantEvent, type StoredGrant } from './grants.js';
import { heldPlace, isHeld, spaceHeld } from './holds.js';
import { keptAgainst } from './keeps.js';
import { sharedReaderRole } from './shares.js';
import { readSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { lockAll } from './versions.js';

/**
 * **Moving** (moving.md; the MV plan): an artifact goes to another space of its tenant. Nothing about
 * what it says changes and no version is cut. No decision is stored, so the next one reads the new
 * chain; what would outlive the move - its own grants, its search rows, its locks and presence - goes
 * or follows here. Who may - `administer` on it, `create` or `administer` at the target - is the
 * caller's to decide first (MV-C).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The most artifacts one move carries: a move holds the access epoch against every decision. */
export const MOVE_MOST = 500;

const MOVABLE: readonly string[] = ['component', 'document', 'template', 'asset'];

export interface MoveInput {
  readonly artifactId: string;
  /** The space the caller read it in: anywhere else, and they are told (MV-E). */
  readonly from: string;
  readonly to: string;
  readonly by: string;
  readonly scopes: readonly Permission[] | undefined;
  /** A document's components and images too, each decided for itself (MV-D). */
  readonly also: boolean;
}

export type MoveSkipReason =
  | 'not_permitted'
  | 'held'
  | 'kept'
  | 'placed_elsewhere'
  | 'archived'
  | 'in_use'
  | 'dataset'
  | 'uploading';

/** A component or an image that stays, and why; named only to whoever may read it. */
export interface MoveSkip {
  readonly id: string;
  readonly kind: 'component' | 'asset';
  readonly reason: MoveSkipReason;
  readonly title: string | null;
}

export type SpaceMoveRefusal =
  | {
      readonly answer:
        | 'artifact.missing'
        | 'artifact.archived'
        | 'artifact.not_movable'
        | 'asset.uploading'
        | 'space.moved'
        | 'space.archived'
        | 'held'
        | 'move.too_large';
    }
  | { readonly answer: 'kept'; readonly until: Date };

interface Counted {
  readonly moved: readonly string[];
  readonly skipped: readonly MoveSkip[];
  readonly grantsEnded: number;
  readonly sharesKept: number;
}

export type SpaceMoveAnswer =
  (Counted & { readonly answer: 'changed' }) | { readonly answer: 'unchanged' } | SpaceMoveRefusal;

/** What a move leaves behind (MV-G): counts, each refused or explained where it comes to matter. */
export interface MoveConsequences {
  readonly citations: number;
  readonly terms: number;
  readonly imagesStaying: number;
  readonly bound: number;
  readonly usingTemplate: number;
  readonly openRounds: number;
  readonly delivered: number;
}

export type SpaceMovePreview =
  | (Counted & { readonly answer: 'previewed'; readonly consequences: MoveConsequences })
  | { readonly answer: 'unchanged' }
  | SpaceMoveRefusal;

interface Moving {
  readonly id: string;
  readonly kind: string;
}

interface Plan {
  readonly moving: readonly Moving[];
  readonly skipped: readonly MoveSkip[];
  readonly ending: readonly StoredGrant[];
  readonly sharesKept: number;
}

/** Ids, as `any(...)` takes them. */
const ids = (list: readonly string[]) => sql`${[...list]}::uuid[]`;

/** A document's direct references of a kind, in the space it is leaving: read before any lock. */
async function referencedIn(
  trx: TenantTransaction,
  fromIds: readonly string[],
  kind: 'component' | 'asset',
  space: string,
): Promise<string[]> {
  if (fromIds.length === 0) return [];
  const { rows } = await sql<{ id: string }>`
    select distinct r.to_id as id from reference r join artifact a on a.id = r.to_id
     where r.from_id = any(${ids(fromIds)}) and r.to_kind = ${kind} and a.space_id = ${space}
     order by id`.execute(trx);
  return rows.map((row) => row.id);
}

/** The latest title of each, for what may be named. */
async function titlesOf(
  trx: TenantTransaction,
  list: readonly { readonly id: string; readonly kind: 'component' | 'asset' }[],
): Promise<Map<string, string | null>> {
  const titles = new Map<string, string | null>();
  for (const { id, kind } of list) {
    titles.set(id, (await heldPlace(trx, kind, id)).title);
  }
  return titles;
}

async function imageAnswer(
  trx: TenantTransaction,
  id: string,
): Promise<'dataset' | 'uploading' | undefined> {
  const { rows } = await sql<{ dataset: boolean; uploading: boolean }>`
    select
      exists (select from asset_upload u where u.asset_id = ${id} and u.origin = 'dataset') as dataset,
      exists (select from asset_upload u where u.replaces = ${id}
               and u.state in ('awaiting', 'checking')) as uploading`.execute(trx);
  if (rows[0]?.dataset) return 'dataset';
  return rows[0]?.uploading ? 'uploading' : undefined;
}

/** Whether anything that is not moving uses this image, its latest or a record of it (MV-D). */
async function imageInUse(
  trx: TenantTransaction,
  image: string,
  moving: readonly string[],
): Promise<boolean> {
  const { rows } = await sql<{ used: boolean }>`
    select exists (select from reference r
                    where r.to_id = ${image} and not r.from_id = any(${ids(moving)}))
        or exists (select from baseline_pin p join baseline b on b.id = p.baseline_id
                    where p.artifact_id = ${image} and not b.document_id = any(${ids(moving)}))
        or exists (select from publication_asset p join publication d on d.id = p.publication_id
                    where p.asset_id = ${image} and not d.document_id = any(${ids(moving)}))
       as used`.execute(trx);
  return rows[0]?.used === true;
}

/**
 * What this move would do, or why not, one answer for a preview and a move alike so the two cannot
 * differ. `locking` is the move's own: a preview holds nothing, and answers as things stand.
 */
async function planMove(
  trx: TenantTransaction,
  input: MoveInput,
  locking: boolean,
): Promise<Plan | SpaceMoveRefusal | { readonly answer: 'unchanged' }> {
  const { artifactId, from, to } = input;
  if (!UUID.test(artifactId)) return { answer: 'artifact.missing' };
  const listDependants = async () => {
    if (!input.also) return { components: [], images: [] };
    const components = await referencedIn(trx, [artifactId], 'component', from);
    const images = await referencedIn(trx, [artifactId, ...components], 'asset', from);
    return { components, images };
  };
  let locked: ReadonlySet<string> | undefined;
  if (locking) {
    // A deletion's dependant, before any artifact's lock (deletion.ts); then in id order.
    await shareDeletion(trx);
    const listed = await listDependants();
    await lockAll(trx, [artifactId, ...listed.components, ...listed.images]);
    locked = new Set([...listed.components, ...listed.images]);
  }

  const artifact = await trx
    .selectFrom('artifact')
    .select(['kind', 'space_id'])
    .where('id', '=', artifactId)
    .executeTakeFirst();
  if (!artifact || (await isDeleted(trx, artifactId))) return { answer: 'artifact.missing' };
  if (artifact.space_id !== from) return { answer: 'space.moved' };
  if (from === to) return { answer: 'unchanged' };
  if (!MOVABLE.includes(artifact.kind)) return { answer: 'artifact.not_movable' };
  if (await isArchived(trx, artifactId)) return { answer: 'artifact.archived' };
  const target = await readSpace(trx, to);
  if (!target || target.archivedAt !== null) return { answer: 'space.archived' };
  if (artifact.kind === 'asset') {
    const image = await imageAnswer(trx, artifactId);
    if (image === 'dataset') return { answer: 'artifact.not_movable' };
    if (image === 'uploading') return { answer: 'asset.uploading' };
  }
  if (await spaceHeld(trx, from)) return { answer: 'held' };
  const until = await keptAgainst(trx, artifactId, to);
  if (until) return { answer: 'kept', until };

  const isDocument = artifact.kind === 'document';
  const publications = isDocument
    ? await trx
        .selectFrom('publication')
        .select('id')
        .where('document_id', '=', artifactId)
        .orderBy('id')
        .execute()
    : [];
  for (const { id } of publications) {
    if (await isHeld(trx, id)) return { answer: 'held' };
  }

  const moving: Moving[] = [
    { id: artifactId, kind: artifact.kind },
    ...publications.map(({ id }) => ({ id, kind: 'publication' })),
  ];
  const skipped: MoveSkip[] = [];
  if (isDocument && input.also) {
    // Read again under the lock: one placed since waits for the next move, not locked in order.
    const now = await listDependants();
    const held = (id: string) => locked === undefined || locked.has(id);
    await carried(
      trx,
      input,
      { components: now.components.filter(held), images: now.images.filter(held) },
      moving,
      skipped,
    );
  }
  if (moving.length > MOVE_MOST) return { answer: 'move.too_large' };

  const fixed = (await sharedReaderRole(trx)).id;
  const standing = await grantsOn(
    trx,
    moving.map((each) => each.id),
  );
  const publicationIds = new Set(publications.map(({ id }) => id));
  const isShare = (grant: StoredGrant) =>
    grant.roleId === fixed && grant.level.kind === 'artifact' && publicationIds.has(grant.level.id);
  return {
    moving,
    skipped,
    // A share is one copy handed to a named recipient, not a route into a space (MV-B).
    ending: standing.filter((grant) => !isShare(grant)),
    sharesKept: standing.filter(isShare).length,
  };
}

/** Each of a document's components and images goes or stays by itself (MV-D); components first. */
async function carried(
  trx: TenantTransaction,
  input: MoveInput,
  listed: { readonly components: readonly string[]; readonly images: readonly string[] },
  moving: Moving[],
  skipped: MoveSkip[],
): Promise<void> {
  const { artifactId, to, by, scopes } = input;
  const facts = await loadFactsFor(trx, by, [...listed.components, ...listed.images]);
  const deleted = await deletedAmong(trx, listed.components);
  const titles = await titlesOf(trx, [
    ...listed.components.map((id) => ({ id, kind: 'component' as const })),
    ...listed.images.map((id) => ({ id, kind: 'asset' as const })),
  ]);
  const stay = (id: string, kind: 'component' | 'asset', reason: MoveSkipReason) => {
    const reading = facts.get(id);
    const named = reading !== undefined && decide('read', { ...reading, scopes }).allowed;
    skipped.push({ id, kind, reason, title: named ? (titles.get(id) ?? null) : null });
  };
  const permitted = (id: string) => {
    const reading = facts.get(id);
    return reading !== undefined && administerOrAbove({ ...reading, scopes }).allowed;
  };

  for (const id of listed.components) {
    if (deleted.has(id)) continue;
    if (!permitted(id)) {
      stay(id, 'component', 'not_permitted');
      continue;
    }
    if (await isArchived(trx, id)) {
      stay(id, 'component', 'archived');
      continue;
    }
    const { rows } = await sql<{ elsewhere: boolean }>`
      select exists (select from reference r
                      where r.to_id = ${id} and r.from_id <> ${artifactId}) as elsewhere`.execute(
      trx,
    );
    if (rows[0]?.elsewhere) {
      stay(id, 'component', 'placed_elsewhere');
      continue;
    }
    if (await isHeld(trx, id)) {
      stay(id, 'component', 'held');
      continue;
    }
    if (await keptAgainst(trx, id, to)) {
      stay(id, 'component', 'kept');
      continue;
    }
    moving.push({ id, kind: 'component' });
  }

  // Only what the components that go place, and the document itself; never a staying part's.
  const going = moving.map((each) => each.id);
  const images = new Set(await referencedIn(trx, going, 'asset', input.from));
  for (const id of listed.images) {
    if (!images.has(id)) continue;
    if (!permitted(id)) {
      stay(id, 'asset', 'not_permitted');
      continue;
    }
    const image = await imageAnswer(trx, id);
    if (image) {
      stay(id, 'asset', image);
      continue;
    }
    if (await imageInUse(trx, id, going)) {
      stay(id, 'asset', 'in_use');
      continue;
    }
    if (await isHeld(trx, id)) {
      stay(id, 'asset', 'held');
      continue;
    }
    moving.push({ id, kind: 'asset' });
  }
}

const isPlan = (plan: Plan | { readonly answer: string }): plan is Plan => !('answer' in plan);

/** What an audit event says of this artifact, read while it is still where it was (MV-H). */
async function placeOf(
  trx: TenantTransaction,
  each: Moving,
): Promise<{ readonly version: string | null; readonly title: readonly AuditLabel[] }> {
  if (each.kind === 'publication') {
    const held = await heldPlace(trx, 'publication', each.id);
    return { version: null, title: labels(labelled('subject', held.title, each.id)) };
  }
  const place = await artifactPlace(trx, each.id);
  return {
    version: place.version,
    title: place.labels.filter((label) => label.role === 'subject'),
  };
}

/** Moves it, and what is carried, in the caller's transaction; or says why not, nothing changing. */
export async function moveToSpace(
  trx: TenantTransaction,
  input: MoveInput,
): Promise<SpaceMoveAnswer> {
  const plan = await planMove(trx, input, true);
  if (!isPlan(plan)) return plan;
  const { from, to, by } = input;
  const moved = plan.moving.map((each) => each.id);

  const places = new Map<string, Awaited<ReturnType<typeof placeOf>>>();
  for (const each of plan.moving) places.set(each.id, await placeOf(trx, each));
  const fromName = (await readSpace(trx, from))?.name;
  const toName = (await readSpace(trx, to))?.name;

  // Written before each goes, its labels read while it stands (audit.md, "Writing").
  for (const grant of plan.ending) {
    await recordGrantEvent(trx, 'access.revoked', grant, undefined, from);
  }
  if (plan.ending.length > 0) {
    await trx
      .deleteFrom('access_grant')
      .where(
        'id',
        'in',
        plan.ending.map((grant) => grant.id),
      )
      .execute();
  }

  await sql`update artifact set space_id = ${to} where id = any(${ids(moved)})`.execute(trx);
  for (const table of ['search_entry', 'search_earlier', 'search_history']) {
    await sql`update ${sql.table(table)} set space_id = ${to}
               where artifact_id = any(${ids(moved)})`.execute(trx);
  }

  // Each as a dropped connection's (COL-069, COL-004): the presence trigger tells every stream.
  await trx.deleteFrom('component_lock').where('artifact_id', 'in', moved).execute();
  await trx
    .deleteFrom('presence')
    .where((where) =>
      where.or([where('component_id', 'in', moved), where('document_id', 'in', moved)]),
    )
    .execute();

  for (const each of plan.moving) {
    await trx
      .insertInto('artifact_move')
      .values({ artifact_id: each.id, from_space: from, to_space: to, by })
      .execute();
    const place = places.get(each.id)!;
    for (const [space, name] of [
      [from, fromName],
      [to, toName],
    ] as const) {
      await recordEvent(
        trx,
        {
          kind: 'artifact.moved',
          subject: { kind: each.kind, id: each.id, version: place.version },
          space,
          detail: { from, to },
        },
        [...place.title, ...labels(labelled('space', name, space))],
      );
    }
  }

  return {
    answer: 'changed',
    moved,
    skipped: plan.skipped,
    grantsEnded: plan.ending.length,
    sharesKept: plan.sharesKept,
  };
}

/** What `moveToSpace` would answer now, and what it would leave behind; writes nothing (MV-G). */
export async function previewMove(
  trx: TenantTransaction,
  input: MoveInput,
): Promise<SpaceMovePreview> {
  const plan = await planMove(trx, input, false);
  if (!isPlan(plan)) return plan;
  const moved = plan.moving.map((each) => each.id);
  const { rows } = await sql<Record<keyof MoveConsequences, number>>`
    select
      (select count(*)::int from reference r
        where r.from_id = any(${ids(moved)}) and r.to_kind = 'bibliographyEntry') as citations,
      (select count(*)::int from reference r
        where r.from_id = any(${ids(moved)}) and r.to_kind = 'term') as terms,
      (select count(distinct r.to_id)::int from reference r
        where r.from_id = any(${ids(moved)}) and r.to_kind = 'asset'
          and not r.to_id = any(${ids(moved)})) as "imagesStaying",
      (select count(distinct r.from_id)::int from reference r
        where r.from_id = any(${ids(moved)})
          and r.to_kind in ('queryDefinition', 'connection')) as bound,
      (select count(distinct r.from_id)::int from reference r
        where r.to_id = any(${ids(moved)}) and r.to_kind = 'template')
        + (select count(*)::int from cohort c where c.template_id = any(${ids(moved)}))
        as "usingTemplate",
      (select count(*)::int from review_round r
        where r.document_id = any(${ids(moved)})
          and not exists (select from review_round_event e
                           where e.round_id = r.id and e.act = 'closed')) as "openRounds",
      (select count(distinct b.artifact_id)::int from bridge_element b
        where b.artifact_id = any(${ids(moved)})) as delivered`.execute(trx);
  return {
    answer: 'previewed',
    moved,
    skipped: plan.skipped,
    grantsEnded: plan.ending.length,
    sharesKept: plan.sharesKept,
    consequences: rows[0]!,
  };
}

/**
 * Which of these components moved and have threads (MV-F): what a document may say of a part it
 * withholds, and nothing of how many, when or who. Moved at any time: `artifact_move` cannot say who
 * could read before, so one who never could learns as much, and no more.
 */
export async function movedWithThreads(
  trx: TenantTransaction,
  components: readonly string[],
): Promise<ReadonlySet<string>> {
  if (components.length === 0) return new Set();
  const { rows } = await sql<{ id: string }>`
    select distinct m.artifact_id as id from artifact_move m
     where m.artifact_id = any(${ids(components)})
       and exists (select from thread t where t.on_id = m.artifact_id)`.execute(trx);
  return new Set(rows.map((row) => row.id));
}
