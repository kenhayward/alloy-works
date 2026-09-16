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
