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

/** A grant that has not ended: its role's permissions, level and effect. */
export async function grantInForce(
  trx: TenantTransaction,
  id: string,
): Promise<GrantInForce | undefined> {
  const { rows } = await sql<InForceRow>`
    select r.permissions, g.level, g.space_id, g.artifact_id, g.effect
      from access_grant g join role r on r.id = g.role_id
     where g.id = ${id}::uuid and ${live}`.execute(trx);
  return rows[0] && inForce(rows[0]);
}

/** An act that may leave nobody holding an administrative permission. */
export type HolderChange =
  | { readonly removingGrant: string }
  | { readonly disabling: string }
  | { readonly leavingGroup: string; readonly principals: readonly string[] }
  | { readonly deletingGroup: string }
  | {
      readonly denying: readonly Permission[];
      readonly subject: { readonly principal: string } | { readonly group: string };
    };

interface HolderRow {
  readonly permission: Permission;
  readonly effect: 'allow' | 'deny';
  readonly grant_id: string;
  readonly group_id: string | null;
  readonly principal_id: string;
}

/**
 * **The last-holder guard** (the GL plan, GL-H): false where this change takes the last person who holds
 * some administrative permission at the environment, directly or through a group. Since a grant is limited
 * to what its maker holds, nobody could ever give that permission again. A holder must be able to sign in
 * through an open way in, hold it with no expiry, and not be denied it there. Somebody invited, who has
 * never signed in, holds nothing yet. A permission nobody holds today has no holder to lose. The caller has
 * taken the access epoch.
 */
export async function lastHolderRemains(
  trx: TenantTransaction,
  change: HolderChange,
): Promise<boolean> {
  const { rows } = await sql<HolderRow>`
    select unnest(r.permissions) as permission, g.effect, g.id as grant_id, g.group_id, p.id as principal_id
      from access_grant g
      join role r on r.id = g.role_id
      left join group_member m on m.group_id = g.group_id
      join principal p on p.id = coalesce(g.principal_id, m.principal_id)
     where g.level = 'tenant' and (g.effect = 'deny' or g.expires_at is null) and ${live}
       and p.kind = 'user' and p.disabled_at is null and p.erased_at is null
       and (
         (exists (select from sign_in_route where route = 'organisation')
          and p.issuer in (select issuer from identity_provider where closed_at is null))
         or (exists (select from sign_in_route where route = 'google')
             and p.issuer is not null
             and p.issuer not in (select issuer from identity_provider))
       )`.execute(trx);
  const joined =
    'denying' in change && 'group' in change.subject
      ? new Set(
          (
            await trx
              .selectFrom('group_member')
              .select('principal_id')
              .where('group_id', '=', change.subject.group)
              .execute()
          ).map((row) => row.principal_id),
        )
      : new Set<string>();
  const gone = (row: HolderRow, permission: Permission): boolean => {
    if ('removingGrant' in change) return row.grant_id === change.removingGrant;
    if ('disabling' in change) return row.principal_id === change.disabling;
    if ('deletingGroup' in change) return row.group_id === change.deletingGroup;
    if ('leavingGroup' in change) {
      return row.group_id === change.leavingGroup && change.principals.includes(row.principal_id);
    }
    if (!change.denying.includes(permission)) return false;
    return 'principal' in change.subject
      ? row.principal_id === change.subject.principal
      : joined.has(row.principal_id);
  };
  return administrativePermissions.every((permission) => {
    const about = rows.filter((row) => row.permission === permission);
    const denied = new Set(
      about.filter((row) => row.effect === 'deny').map((row) => row.principal_id),
    );
    const holders = about.filter((row) => row.effect === 'allow' && !denied.has(row.principal_id));
    return holders.length === 0 || holders.some((row) => !gone(row, permission));
  });
}
