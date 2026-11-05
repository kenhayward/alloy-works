import {
  administrativePermissions,
  parseLevel,
  type Level,
  type Permission,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/** What a grant gives, where it stands, for holding a change to what its maker holds (the GL plan). */
export interface GrantInForce {
  readonly permissions: readonly Permission[];
  readonly level: Level;
  readonly effect: 'allow' | 'deny';
}

interface InForceRow {
  readonly permissions: readonly Permission[];
  readonly level: string;
  readonly space_id: string | null;
  readonly artifact_id: string | null;
  readonly effect: 'allow' | 'deny';
}

function inForce(row: InForceRow): GrantInForce {
  const level =
    row.level === 'tenant'
      ? { kind: 'tenant' as const }
      : parseLevel(`${row.level}:${row.space_id ?? row.artifact_id}`);
  if (!level) throw new Error(`A stored grant stands at no level: ${row.level}`);
  return { permissions: row.permissions, level, effect: row.effect };
}

const live = sql<boolean>`(g.expires_at is null or g.expires_at > clock_timestamp())`;

/** Every grant a group holds that has not ended, allow or deny. */
export async function groupGrantsInForce(
  trx: TenantTransaction,
  group: string,
): Promise<readonly GrantInForce[]> {
  const { rows } = await sql<InForceRow>`
    select r.permissions, g.level, g.space_id, g.artifact_id, g.effect
      from access_grant g join role r on r.id = g.role_id
     where g.group_id = ${group}::uuid and ${live}`.execute(trx);
  return rows.map(inForce);
}

/** Every allow a person holds that has not ended, directly or through a group. */
export async function principalAllowsInForce(
  trx: TenantTransaction,
  principal: string,
): Promise<readonly GrantInForce[]> {
  const { rows } = await sql<InForceRow>`
    select r.permissions, g.level, g.space_id, g.artifact_id, g.effect
      from access_grant g join role r on r.id = g.role_id
     where g.effect = 'allow' and ${live}
       and (g.principal_id = ${principal}::uuid
            or g.group_id in (select group_id from group_member where principal_id = ${principal}::uuid))`.execute(
    trx,
  );
  return rows.map(inForce);
}

/** A grant's role's permissions and its effect; undefined for no such grant. */
export async function grantInForce(
  trx: TenantTransaction,
  id: string,
): Promise<GrantInForce | undefined> {
  const { rows } = await sql<InForceRow>`
    select r.permissions, g.level, g.space_id, g.artifact_id, g.effect
      from access_grant g join role r on r.id = g.role_id
     where g.id = ${id}::uuid`.execute(trx);
  return rows[0] && inForce(rows[0]);
}

/** An act that may leave nobody holding an administrative permission. */
export type HolderChange = { readonly removingGrant: string } | { readonly disabling: string };

/**
 * **The last-holder guard** (the GL plan, GL-H): false where this change takes the last person able to
 * sign in who holds some administrative permission at the environment, directly or through a group. Since
 * a grant is limited to what its maker holds, nobody could ever give that permission again. Somebody
 * holding it only until an expiry is not counted, as the lockout guards do not count them. A permission
 * nobody holds today has no holder to lose. The caller has taken the access epoch.
 */
export async function lastHolderRemains(
  trx: TenantTransaction,
  change: HolderChange,
): Promise<boolean> {
  const { rows } = await sql<{ permission: Permission; grant_id: string; principal_id: string }>`
    select unnest(r.permissions) as permission, g.id as grant_id, p.id as principal_id
      from access_grant g
      join role r on r.id = g.role_id
      left join group_member m on m.group_id = g.group_id
      join principal p on p.id = coalesce(g.principal_id, m.principal_id)
     where g.level = 'tenant' and g.effect = 'allow' and g.expires_at is null
       and p.kind = 'user' and p.disabled_at is null and p.erased_at is null`.execute(trx);
  const gone = (row: { grant_id: string; principal_id: string }) =>
    'removingGrant' in change
      ? row.grant_id === change.removingGrant
      : row.principal_id === change.disabling;
  return administrativePermissions.every((permission) => {
    const holders = rows.filter((row) => row.permission === permission);
    return holders.length === 0 || holders.some((row) => !gone(row));
  });
}
