import { decide, type AccessFacts } from '@alloy-works/domain';
import { loadFacts } from './access-facts.js';
import type { TenantTransaction } from './tables.js';

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
 * The spaces a principal may read, in name order, each saying whether they may create a component
 * there (access.md, "Routes"). A space they may not read is left out entirely, the way an unreadable
 * component is: a listing never says a thing exists that its reader may not address.
 *
 * `loadFacts` per space rather than one query, because `decide`'s answer is the chain walk and a
 * predicate over grants would be a second implementation of it. A tenant with hundreds of spaces would
 * want the facts loaded once and the chain synthesised per space; nothing has hundreds, and doing it
 * now would put the walk in two places before anything needed it.
 */
export async function listSpacesFor(
  trx: TenantTransaction,
  principalId: string,
): Promise<readonly SpaceForPrincipal[]> {
  const rows = await trx.selectFrom('space').select(['id', 'name']).orderBy('name').execute();
  const shown: SpaceForPrincipal[] = [];
  for (const row of rows) {
    const facts: AccessFacts | undefined = await loadFacts(trx, principalId, {
      kind: 'space',
      id: row.id,
    });
    if (!facts || !decide('read', facts).allowed) continue;
    shown.push({ id: row.id, name: row.name, mayCreate: decide('create', facts).allowed });
  }
  return shown;
}
