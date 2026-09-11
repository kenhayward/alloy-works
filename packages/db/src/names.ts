const TENANT_ID = /^[0-9a-z]{1,40}$/;
const TENANT_ROLE = /^t_[0-9a-z]{1,40}$/;

export interface TenantNames {
  readonly schema: string;
  readonly role: string;
  readonly owner: string;
}

/**
 * The names a tenant's schema and roles take. They are interpolated into DDL, where parameters are
 * not allowed, so the id is validated here and nowhere else builds a tenant identifier.
 */
export function tenantNames(id: string): TenantNames {
  if (!TENANT_ID.test(id)) {
    throw new Error(
      `A tenant id is 1 to 40 lower-case letters and digits, not ${JSON.stringify(id)}`,
    );
  }
  const role = `t_${id}`;
  return { schema: role, role, owner: `${role}_owner` };
}

/** A runtime tenant role name, checked before it reaches `SET ROLE`. Owner roles are refused. */
export function assertTenantRole(name: string): string {
  if (!TENANT_ROLE.test(name)) {
    throw new Error(`Not a tenant role name: ${JSON.stringify(name)}`);
  }
  return name;
}
