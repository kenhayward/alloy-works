import { decide, type AccessFacts, type Permission } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFacts, loadReadableSet } from './access-facts.js';
import { isPlainName } from './plain-name.js';
import { inSavepoint } from './savepoint.js';
import type { TenantTransaction } from './tables.js';
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

export interface Space {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
}

/** A space as Administration shows it: whether it is archived, and by whom (the SP1 plan, SP-C). */
export interface SpaceState extends Space {
  readonly archivedAt: Date | null;
  readonly archivedBy: string | null;
}

/** Why an act on a space is refused (SP-B, SP-D). */
export type SpaceRefusal = 'space.name_invalid' | 'space.name_taken' | 'space.last';

/** An act on a space the rules refuse; the transaction it was tried in is the caller's to abandon. */
export class SpaceRefused extends Error {
  constructor(readonly refusal: SpaceRefusal) {
    super(`The space is refused: ${refusal}`);
  }
}

/**
 * A spaced artifact made in an archived space (SP-C): thrown by `createArtifact`, the one place an
 * artifact is made, whatever made it.
 */
export class SpaceArchived extends Error {
  constructor(readonly spaceId: string) {
    super(`Space ${spaceId} is archived: nothing new is made in it`);
  }
}

function checkedName(name: string): string {
  if (!isPlainName(name)) throw new SpaceRefused('space.name_invalid');
  return name;
}

/** Whether a failure is the one `space_name_key` raises, and no other (SP-B). */
function isNameTaken(error: unknown): boolean {
  const failure = error as { code?: string; constraint?: string };
  return failure.code === '23505' && failure.constraint === 'space_name_key';
}

/**
 * Creates a space in the tenant the transaction belongs to. The name follows the plain-name rule, the
 * caller having normalised and trimmed it, and is unique within the tenant, archived spaces included,
 * compared exactly as the table compares it (SP-B); either refused throws `SpaceRefused`. Who may
 * create a space is access.md's `administer`, which the caller decides before calling this. A new
 * space holds no grant and changes no decision, so it takes no lock on the access epoch.
 */
export async function createSpace(trx: TenantTransaction, name: string): Promise<Space> {
  const row = await trx
    .insertInto('space')
    .values({ name: checkedName(name) })
    .onConflict((conflict) => conflict.constraint('space_name_key').doNothing())
    .returning(['id', 'name', 'created_at'])
    .executeTakeFirst();
  if (!row) throw new SpaceRefused('space.name_taken');
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

const stateColumns = ['id', 'name', 'created_at', 'archived_at', 'archived_by'] as const;

function stateOf(row: {
  id: string;
  name: string;
  created_at: Date;
  archived_at: Date | null;
  archived_by: string | null;
}): SpaceState {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  };
}

/** A space as it now is, or undefined where the tenant has none of that id. */
export async function readSpace(
  trx: TenantTransaction,
  id: string,
): Promise<SpaceState | undefined> {
  const row = await trx
    .selectFrom('space')
    .select(stateColumns)
    .where('id', '=', id)
    .executeTakeFirst();
  return row && stateOf(row);
}

/**
 * Renames a space, archived or not: the new name by `createSpace`'s rule (SP-B), and only it judged.
 * Undefined where there is no such space. A name is no fact a decision reads.
 */
export async function renameSpace(
  trx: TenantTransaction,
  id: string,
  name: string,
): Promise<SpaceState | undefined> {
  const checked = checkedName(name);
  try {
    const row = await inSavepoint(trx, () =>
      trx
        .updateTable('space')
        .set({ name: checked })
        .where('id', '=', id)
        .returning(stateColumns)
        .executeTakeFirst(),
    );
    return row && stateOf(row);
  } catch (error) {
    if (isNameTaken(error)) throw new SpaceRefused('space.name_taken');
    throw error;
  }
}

/**
 * Archives a space (SP-C), recording who: nothing new is made in it from then on, and everything
 * already there stays as it was. The last space not archived is refused (SP-D), counted with every
 * live space's row held FOR UPDATE, in the order of their ids, so two archives at once cannot both
 * pass and cannot deadlock; the lock also waits for any creation holding the space FOR SHARE, so none
 * commits into a space archived a moment before. Archiving one already archived changes nothing.
 * Undefined where there is no such space.
 */
export async function archiveSpace(
  trx: TenantTransaction,
  id: string,
  by: string,
): Promise<SpaceState | undefined> {
  // Every live space is held, not only this one, so the count is of rows nobody else can archive
  // meanwhile. A creation holds its one space FOR SHARE, so this waits for it and it never waits on
  // this while holding another: no deadlock today. A transaction that ever created in two spaces would
  // hold the first while asking for the second, and could meet this holding the second and asking for
  // the first; Postgres would then refuse one of them with 40P01, and that path would need a retry.
  const held = await trx
    .selectFrom('space')
    .select(['id', 'archived_at'])
    .where((where) => where.or([where('archived_at', 'is', null), where('id', '=', id)]))
    .orderBy('id')
    .forUpdate()
    .execute();
  const target = held.find((row) => row.id === id);
  if (!target) return undefined;
  if (target.archived_at !== null) return readSpace(trx, id);
  if (held.filter((row) => row.archived_at === null).length <= 1) {
    throw new SpaceRefused('space.last');
  }
  const row = await trx
    .updateTable('space')
    .set({ archived_at: sql<Date>`now()`, archived_by: by })
    .where('id', '=', id)
    .returning(stateColumns)
    .executeTakeFirstOrThrow();
  return stateOf(row);
}

/**
 * Restores an archived space: things may be made in it again, and nothing in it changed while it was
 * archived. Restoring a live space changes nothing. Undefined where there is no such space.
 */
export async function restoreSpace(
  trx: TenantTransaction,
  id: string,
): Promise<SpaceState | undefined> {
  const row = await trx
    .updateTable('space')
    .set({ archived_at: null, archived_by: null })
    .where('id', '=', id)
    .returning(stateColumns)
    .executeTakeFirst();
  return row && stateOf(row);
}

/**
 * Refuses a spaced artifact made in an archived space (SP-C), holding the space FOR SHARE until the
 * creation commits, so an archive waits for it and a creation after an archive sees it. Called by
 * `createArtifact` for every spaced kind but an asset (an image added to what is there is an edit), a
 * dataset (a refresh of a binding already there) and a publication, none of which is new content.
 */
export async function checkSpaceLive(trx: TenantTransaction, spaceId: string): Promise<void> {
  // Read through `to_jsonb`, so an environment migrated only to before 0059 - which only a test
  // writes - reads as live rather than failing, as `search.ts`'s `projected` reads a missing table.
  // The key is a string the compiler does not check, so the refusal tests pin it: a misspelling reads
  // every space as live, and `space-archive.test.ts` and the service's `space-routes.test.ts` fail.
  const { rows } = await sql<{ archived: string | null }>`
    select to_jsonb(space) ->> 'archived_at' as archived
      from space where id = ${spaceId} for share`.execute(trx);
  if (rows[0] && rows[0].archived !== null) throw new SpaceArchived(spaceId);
}

/** One space as the listing shows it, with what the caller may do about creating in it. */
export interface SpaceForPrincipal {
  readonly id: string;
  readonly name: string;
  /** Archived: listed to its readers, marked, and never one to create in (SP-E). */
  readonly archived: boolean;
  readonly mayCreate: boolean;
}

/**
 * The spaces a principal may read, a page at a time in name order and then id (API-007), each saying
 * whether they may create a component there (access.md, "Routes"). A space they may not read is left
 * out entirely, the way an unreadable component is: a listing never says a thing exists that its reader
 * may not address. Which they may read is the readable set, `decide`'s own answer per space, applied
 * inside the query so a page is never short; whether they may create is decided for each space shown,
 * and is false for an archived one (SP-E). `archived: false` leaves archived spaces out. A space renamed
 * between two pages of a walk may be skipped or shown twice: the lists that walk spaces are short, and
 * a snapshot would cost more than it saves (SP-E).
 *
 * `scopes` are the scopes of the token the listing was asked with, undefined for a session: a mask over
 * `mayCreate`, as over every decision (service-foundations.md, TK-A). Which spaces are listed is not
 * masked, since reading never is (TK-B). Required, and ahead of the page asked for, so no caller can
 * leave a token's scopes out by forgetting them (W12.1's final review).
 */
export async function listSpacesFor(
  trx: TenantTransaction,
  principalId: string,
  scopes: readonly Permission[] | undefined,
  request: ListingRequest<SortOf<'spaces'>> = { limit: 100 },
  options: { readonly archived?: false } = {},
): Promise<Listed<SpaceForPrincipal>> {
  const limit = checkedLimit(request.limit);
  const { types, order } = listingSorts.spaces.name;
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const snapshot = await snapshotFor(trx, request.snapshot);
  const readable = await loadReadableSet(trx, principalId);
  const spaces = readable?.spaces ?? [];
  if (spaces.length === 0) return { items: [], next: null, snapshot };
  let inner = trx
    .selectFrom('space as s')
    .select(['s.id', 's.name', 's.archived_at'])
    .select(sortColumns([sql`s.name`]))
    .where('s.id', 'in', [...spaces]);
  if (options.archived === false) inner = inner.where('s.archived_at', 'is', null);
  const { rows, next } = await keysetPage<{ id: string; name: string; archived_at: Date | null }>(
    trx,
    inner,
    types,
    request.order ?? order,
    limit,
    request.after,
  );
  const shown: SpaceForPrincipal[] = [];
  for (const row of rows) {
    const facts: AccessFacts | undefined = await loadFacts(trx, principalId, {
      kind: 'space',
      id: row.id,
    });
    const archived = row.archived_at !== null;
    shown.push({
      id: row.id,
      name: row.name,
      archived,
      mayCreate: !archived && facts !== undefined && decide('create', { ...facts, scopes }).allowed,
    });
  }
  return { items: shown, next, snapshot };
}
