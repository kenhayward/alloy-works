import { accessPolicy, externalRefusal, type ExternalRefusal } from './grants.js';
import type { TenantTransaction } from './tables.js';

export interface Group {
  readonly id: string;
  readonly name: string;
  readonly source: 'tenant' | 'provider';
}

export type GroupAnswer = { readonly group: Group } | { readonly refused: 'group.name_taken' };

/**
 * Creates a tenant-managed group, whose members an administrator adds. A group standing for a
 * provider's claim is made with the provider configuration, which is not built yet (IAM-009).
 */
export async function createGroup(trx: TenantTransaction, name: string): Promise<GroupAnswer> {
  const row = await trx
    .insertInto('access_group')
    .values({ name, source: 'tenant', provider_value: null })
    .onConflict((conflict) => conflict.column('name').doNothing())
    .returning(['id', 'name', 'source'])
    .executeTakeFirst();
  return row ? { group: row } : { refused: 'group.name_taken' };
}

export type MembershipAnswer =
  { readonly added: true } | { readonly refused: ExternalRefusal | 'group.from_provider' };

/**
 * Adds a principal to a tenant-managed group; adding one already there changes nothing. An external
 * principal is refused where any grant the group holds could not have been made to them directly
 * (access.md, "External principals"), so a group is never a way round those rules.
 */
export async function addToGroup(
  trx: TenantTransaction,
  groupId: string,
  principalId: string,
): Promise<MembershipAnswer> {
  const group = await trx
    .selectFrom('access_group')
    .select('source')
    .where('id', '=', groupId)
    .executeTakeFirstOrThrow();
  if (group.source === 'provider') return { refused: 'group.from_provider' };

  const principal = await trx
    .selectFrom('principal')
    .select('kind')
    .where('id', '=', principalId)
    .executeTakeFirstOrThrow();
  if (principal.kind === 'external') {
    const policy = await accessPolicy(trx);
    const held = await trx
      .selectFrom('access_grant as g')
      .innerJoin('role as r', 'r.id', 'g.role_id')
      .select(['r.permissions', 'g.level', 'g.effect', 'g.expires_at'])
      .where('g.group_id', '=', groupId)
      .execute();
    for (const grant of held) {
      const refusal = externalRefusal(
        { permissions: grant.permissions, level: grant.level },
        grant.effect,
        grant.expires_at,
        policy,
      );
      if (refusal) return { refused: refusal };
    }
  }

  await trx
    .insertInto('group_member')
    .values({ group_id: groupId, principal_id: principalId, asserted_at: null })
    .onConflict((conflict) => conflict.columns(['group_id', 'principal_id']).doNothing())
    .execute();
  return { added: true };
}
