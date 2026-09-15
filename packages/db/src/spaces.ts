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
