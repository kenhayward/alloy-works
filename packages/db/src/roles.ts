import { checkRole, type Permission, type RoleProblem } from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';

export interface Role {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

export type RoleAnswer =
  { readonly role: Role } | { readonly refused: RoleProblem | 'role.name_taken' };

/**
 * Creates a role in the tenant the transaction belongs to (IAM-021). The permissions are checked by
 * the domain's `checkRole` before anything is written; the table checks the closed set again. Who may
 * create one - `administer` at the tenant - is the caller's to decide first.
 */
export async function createRole(
  trx: TenantTransaction,
  name: string,
  held: readonly string[],
): Promise<RoleAnswer> {
  const problem = checkRole(held);
  if (problem) return { refused: problem };
  const row = await trx
    .insertInto('role')
    .values({ name, permissions: [...held] as Permission[] })
    .onConflict((conflict) => conflict.column('name').doNothing())
    .returning(['id', 'name', 'permissions'])
    .executeTakeFirst();
  return row ? { role: row } : { refused: 'role.name_taken' };
}

/** The tenant's role of that name, exactly as written. */
export async function findRole(trx: TenantTransaction, name: string): Promise<Role | undefined> {
  return trx
    .selectFrom('role')
    .select(['id', 'name', 'permissions'])
    .where('name', '=', name)
    .executeTakeFirst();
}
