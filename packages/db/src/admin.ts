import pg from 'pg';
import { AUDIT_SETTING, auditContextSetting } from './audit.js';
import { assertTenantRole } from './names.js';
import type { Tenant } from './provision.js';

/**
 * Runs `work` in one transaction as an administrator, given the tenant's schema, escaped. The work is
 * the vendor's (the AU1 plan, AU1-D): the transaction's audit context says so, and its search path is
 * the tenant's, so `recordEventSql` writes into the tenant's own log.
 */
export async function asAdministrator<T = void>(
  adminUrl: string,
  tenant: Tenant,
  work: (client: pg.Client, schema: string) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const schema = client.escapeIdentifier(assertTenantRole(tenant.schema));
  try {
    await client.query('begin');
    await client.query(
      `select set_config('search_path', $1, true), set_config('${AUDIT_SETTING}', $2, true)`,
      [`${schema}, extensions`, auditContextSetting({ actorKind: 'vendor' })],
    );
    // The steward works in a tenant as its owner, its membership not inheriting; a superuser has no need.
    const { rows } = await client.query<{ steward: boolean }>(
      `select current_user = 'aw_steward' as steward`,
    );
    if (rows[0]?.steward) {
      await client.query(`set local role ${client.escapeIdentifier(`${tenant.role}_owner`)}`);
    }
    const answer = await work(client, schema);
    await client.query('commit');
    return answer;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}
