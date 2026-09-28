import { decide, type AccessFacts, type Permission } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFacts, loadReadableSet } from './access-facts.js';
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

/**
 * Creates a space in the tenant the transaction belongs to. The name is unique within the tenant and
 * the table refuses a second one; who may create a space is access.md's `administer`, which the
 * caller decides before calling this.
 */
export async function createSpace(trx: TenantTransaction, name: string): Promise<Space> {
  const row = await trx
    .insertInto('space')
    .values({ name })
    .returning(['id', 'name', 'created_at'])
    .executeTakeFirstOrThrow();
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

/** One space as the listing shows it, with what the caller may do about creating in it. */
export interface SpaceForPrincipal {
  readonly id: string;
  readonly name: string;
  readonly mayCreate: boolean;
}

/**
 * The spaces a principal may read, a page at a time in name order and then id (API-007), each saying
 * whether they may create a component there (access.md, "Routes"). A space they may not read is left
 * out entirely, the way an unreadable component is: a listing never says a thing exists that its reader
 * may not address. Which they may read is the readable set, `decide`'s own answer per space, applied
 * inside the query so a page is never short; whether they may create is decided for each space shown.
 * Nothing renames a space, so a walk's order holds without a snapshot.
 *
 * `scopes` are the scopes of the token the listing was asked with, undefined for a session: a mask over
 * `mayCreate`, as over every decision (service-foundations.md, TK-A). Which spaces are listed is not
 * masked, since reading never is (TK-B).
 */
export async function listSpacesFor(
  trx: TenantTransaction,
  principalId: string,
  request: ListingRequest<SortOf<'spaces'>> = { limit: 100 },
  scopes?: readonly Permission[],
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
  const inner = trx
    .selectFrom('space as s')
    .select(['s.id', 's.name'])
    .select(sortColumns([sql`s.name`]))
    .where('s.id', 'in', [...spaces]);
  const { rows, next } = await keysetPage<{ id: string; name: string }>(
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
    shown.push({
      id: row.id,
      name: row.name,
      mayCreate: facts !== undefined && decide('create', { ...facts, scopes }).allowed,
    });
  }
  return { items: shown, next, snapshot };
}
