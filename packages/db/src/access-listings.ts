import type { Level, Permission } from '@alloy-works/domain';
import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
import type { TenantTransaction } from './tables.js';

export type { Page, PageRequest };

/** A principal as somebody managing access chooses one: by name and address, and whether external. */
export interface PersonSummary {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly kind: 'user' | 'service' | 'external';
}

export interface ListedGrant {
  readonly id: string;
  readonly role: { readonly id: string; readonly name: string };
  readonly subject:
    | {
        readonly principal: {
          readonly id: string;
          readonly name: string | null;
          readonly email: string | null;
        };
      }
    | { readonly group: { readonly id: string; readonly name: string } };
  readonly level: Level;
  readonly effect: 'allow' | 'deny';
  readonly expiresAt: Date | null;
  readonly extends: string | null;
  readonly grantedBy: { readonly id: string; readonly name: string | null };
  readonly grantedAt: Date;
}

export interface ListedRole {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

/** Grants with their role, subject and grantor by name, for a listing or for one grant. */
function grantsWithNames(trx: TenantTransaction) {
  return trx
    .selectFrom('access_grant as g')
    .innerJoin('role as r', 'r.id', 'g.role_id')
    .innerJoin('principal as by', 'by.id', 'g.granted_by')
    .leftJoin('principal as p', 'p.id', 'g.principal_id')
    .leftJoin('access_group as grp', 'grp.id', 'g.group_id')
    .select([
      'g.id',
      'g.role_id',
      'r.name as role_name',
      'g.principal_id',
      'p.display_name as principal_name',
      'p.email as principal_email',
      'g.group_id',
      'grp.name as group_name',
      'g.level',
      'g.space_id',
      'g.artifact_id',
      'g.effect',
      'g.expires_at',
      'g.extends',
      'g.granted_by',
      'by.display_name as granted_by_name',
      'g.granted_at',
    ]);
}

type GrantWithNames = Awaited<ReturnType<ReturnType<typeof grantsWithNames>['execute']>>[number];

function listed(row: GrantWithNames): ListedGrant {
  return {
    id: row.id,
    role: { id: row.role_id, name: row.role_name },
    subject:
      row.principal_id !== null
        ? {
            principal: {
              id: row.principal_id,
              name: row.principal_name,
              email: row.principal_email,
            },
          }
        : { group: { id: row.group_id!, name: row.group_name! } },
    level:
      row.level === 'tenant'
        ? { kind: 'tenant' }
        : row.level === 'space'
          ? { kind: 'space', id: row.space_id! }
          : { kind: 'artifact', id: row.artifact_id! },
    effect: row.effect,
    expiresAt: row.expires_at,
    extends: row.extends,
    grantedBy: { id: row.granted_by, name: row.granted_by_name },
    grantedAt: row.granted_at,
  };
}

/**
 * The grants made at one level - not above it, not below it - a page at a time in the order of their
 * ids, each with its role, subject and grantor by name, so a person managing access reads who has what
 * without a second request per row. Whether the caller may see them - `administer` at the level or
 * above - is the caller's to decide first; a level the tenant does not hold lists nothing.
 */
export async function listGrants(
  trx: TenantTransaction,
  level: Level,
  request: PageRequest,
): Promise<Page<ListedGrant>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const spaceId = level.kind === 'space' ? level.id : null;
  const artifactId = level.kind === 'artifact' ? level.id : null;
  const rows = await grantsWithNames(trx)
    .where('g.level', '=', level.kind)
    .where((eb) =>
      spaceId === null ? eb('g.space_id', 'is', null) : eb('g.space_id', '=', spaceId),
    )
    .where((eb) =>
      artifactId === null ? eb('g.artifact_id', 'is', null) : eb('g.artifact_id', '=', artifactId),
    )
    .$if(page.after !== undefined, (query) => query.where('g.id', '>', page.after!))
    .orderBy('g.id')
    .limit(page.limit + 1)
    .execute();
  return paged(rows.map(listed), page.limit);
}

/** One grant as a listing shows it, or undefined when the tenant holds no such grant. */
export async function readGrant(
  trx: TenantTransaction,
  id: string,
): Promise<ListedGrant | undefined> {
  const row = await grantsWithNames(trx).where('g.id', '=', id).executeTakeFirst();
  return row && listed(row);
}

/** The tenant's roles, with what each holds, a page at a time in the order of their ids. */
export async function listRoles(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<ListedRole>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const rows = await trx
    .selectFrom('role')
    .select(['id', 'name', 'permissions'])
    .$if(page.after !== undefined, (query) => query.where('id', '>', page.after!))
    .orderBy('id')
    .limit(page.limit + 1)
    .execute();
  return paged(rows, page.limit);
}

/**
 * Everybody who is a principal of this tenant - who has signed in, or was made one before they did -
 * a page at a time in the order of their ids. Nobody who has not is anywhere to be chosen: a grant
 * names a principal, and inviting an address is not built.
 */
export async function listPrincipals(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<PersonSummary>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const rows = await trx
    .selectFrom('principal')
    .select(['id', 'display_name as name', 'email', 'kind'])
    .$if(page.after !== undefined, (query) => query.where('id', '>', page.after!))
    .orderBy('id')
    .limit(page.limit + 1)
    .execute();
  return paged(rows, page.limit);
}
