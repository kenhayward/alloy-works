import { allowable, externalCap, type Level, type Permission } from '@alloy-works/domain';
import { sql } from 'kysely';
import { lockAccessForChange } from './access-facts.js';
import type { TenantTransaction } from './tables.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NewGrant {
  readonly roleId: string;
  readonly subject: { readonly principal: string } | { readonly group: string };
  readonly level: Level;
  readonly effect: 'allow' | 'deny';
  /** Omitted or null: none - which, for an external principal, takes the tenant's default. */
  readonly expiresAt?: Date | null;
  readonly grantedBy: string;
}

export interface StoredGrant {
  readonly id: string;
  readonly roleId: string;
  readonly subject: { readonly principal: string } | { readonly group: string };
  readonly level: Level;
  readonly effect: 'allow' | 'deny';
  readonly expiresAt: Date | null;
  readonly grantedBy: string;
  readonly grantedAt: Date;
}

export type ExternalRefusal =
  'grant.external_at_tenant' | 'grant.external_capped' | 'grant.external_past_cap';

export type GrantRefusal =
  | ExternalRefusal
  | 'grant.role_missing'
  | 'grant.subject_missing'
  | 'grant.duplicate'
  | 'grant.allow_without_read'
  | 'grant.administer_denied_at_tenant';

export type GrantAnswer = { readonly granted: StoredGrant } | { readonly refused: GrantRefusal };

export interface AccessPolicy {
  readonly now: Date;
  readonly externalDefaultDays: number;
  readonly externalCapDays: number;
}

/** The tenant's external expiry policy, with the transaction's own clock to measure it from. */
export async function accessPolicy(trx: TenantTransaction): Promise<AccessPolicy> {
  const row = await trx
    .selectFrom('access_policy')
    .select((eb) => [eb.fn<Date>('now').as('now'), 'external_default_days', 'external_cap_days'])
    .executeTakeFirstOrThrow();
  return {
    now: row.now,
    externalDefaultDays: row.external_default_days,
    externalCapDays: row.external_cap_days,
  };
}

/**
 * Why a grant may not reach an external principal where it is made (access.md, "External
 * principals"): at the tenant (IAM-071), allowing a capped permission, or reaching past the cap
 * (IAM-049). These refusals, and the default expiry that comes with them, apply to an allow only -
 * `decide` counts every unexpired denial whatever it names, because a denial can only remove access,
 * so none of these reasons to refuse ever apply to one.
 */
export function externalRefusal(
  held: { readonly permissions: readonly Permission[]; readonly level: Level['kind'] },
  effect: 'allow' | 'deny',
  expiresAt: Date | null,
  policy: AccessPolicy,
): ExternalRefusal | undefined {
  if (effect === 'deny') return undefined;
  if (held.level === 'tenant') return 'grant.external_at_tenant';
  if (held.permissions.some((permission) => externalCap.includes(permission))) {
    return 'grant.external_capped';
  }
  const cap = policy.now.getTime() + policy.externalCapDays * DAY_MS;
  if (expiresAt !== null && expiresAt.getTime() > cap) return 'grant.external_past_cap';
  return undefined;
}

/** Whether the grant reaches an external principal; undefined when the tenant holds no such subject. */
async function reachesExternal(
  trx: TenantTransaction,
  subject: NewGrant['subject'],
): Promise<boolean | undefined> {
  if ('principal' in subject) {
    const row = await trx
      .selectFrom('principal')
      .select('kind')
      .where('id', '=', subject.principal)
      .executeTakeFirst();
    return row && row.kind === 'external';
  }
  const group = await trx
    .selectFrom('access_group')
    .select('id')
    .where('id', '=', subject.group)
    .executeTakeFirst();
  if (!group) return undefined;
  const row = await trx
    .selectFrom('group_member as m')
    .innerJoin('principal as p', 'p.id', 'm.principal_id')
    .select('m.principal_id')
    .where('m.group_id', '=', subject.group)
    .where('p.kind', '=', 'external')
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Makes a grant, or says why not. Who may make it - `administer` at its level or above - is the
 * caller's to decide first. A grant is never changed: making a different one is removing this one and
 * making another.
 */
export async function grant(trx: TenantTransaction, input: NewGrant): Promise<GrantAnswer> {
  // Locked before the first read: a concurrent grant or membership change on the same group must not
  // land unseen between this check and the write that acts on it (finding 7).
  await lockAccessForChange(trx);

  // A role or a subject named by id from a caller may not be this tenant's: answered, never thrown
  // as a foreign key violation, since each tenant's schema holds only its own.
  const role = await trx
    .selectFrom('role')
    .select('permissions')
    .where('id', '=', input.roleId)
    .executeTakeFirst();
  if (!role) return { refused: 'grant.role_missing' };
  const external = await reachesExternal(trx, input.subject);
  if (external === undefined) return { refused: 'grant.subject_missing' };
  // An allow must hold read; a denial may name any role (access.md, "Permissions").
  if (input.effect === 'allow' && !allowable(role.permissions)) {
    return { refused: 'grant.allow_without_read' };
  }
  // A denial of administer at the tenant cannot be undone by anybody it reaches, and the lock-out
  // guard counts only allows; so it is refused outright (access.md, "Roles").
  if (
    input.effect === 'deny' &&
    input.level.kind === 'tenant' &&
    role.permissions.includes('administer')
  ) {
    return { refused: 'grant.administer_denied_at_tenant' };
  }

  let expiresAt = input.expiresAt ?? null;
  if (external) {
    const policy = await accessPolicy(trx);
    const refusal = externalRefusal(
      { permissions: role.permissions, level: input.level.kind },
      input.effect,
      expiresAt,
      policy,
    );
    if (refusal) return { refused: refusal };
    // Defaulted for an allow to a principal only: a denial needs no expiry to stand, and a group's
    // other members keep what they are given, so the decision ignores a grant with no expiry for the
    // external member among them.
    if (expiresAt === null && input.effect === 'allow' && 'principal' in input.subject) {
      expiresAt = new Date(policy.now.getTime() + policy.externalDefaultDays * DAY_MS);
    }
  }

  const row = await trx
    .insertInto('access_grant')
    .values({
      role_id: input.roleId,
      principal_id: 'principal' in input.subject ? input.subject.principal : null,
      group_id: 'group' in input.subject ? input.subject.group : null,
      level: input.level.kind,
      space_id: input.level.kind === 'space' ? input.level.id : null,
      artifact_id: input.level.kind === 'artifact' ? input.level.id : null,
      effect: input.effect,
      expires_at: expiresAt,
      granted_by: input.grantedBy,
    })
    .onConflict((conflict) => conflict.constraint('access_grant_once').doNothing())
    .returning(['id', 'expires_at', 'granted_at'])
    .executeTakeFirst();
  if (!row) return { refused: 'grant.duplicate' };
  return {
    granted: {
      id: row.id,
      roleId: input.roleId,
      subject: input.subject,
      level: input.level,
      effect: input.effect,
      expiresAt: row.expires_at,
      grantedBy: input.grantedBy,
      grantedAt: row.granted_at,
    },
  };
}

type GrantRow = {
  id: string;
  role_id: string;
  principal_id: string | null;
  group_id: string | null;
  level: Level['kind'];
  space_id: string | null;
  artifact_id: string | null;
  effect: 'allow' | 'deny';
  expires_at: Date | null;
  granted_by: string;
  granted_at: Date;
};

function levelOf(row: Pick<GrantRow, 'level' | 'space_id' | 'artifact_id'>): Level {
  if (row.level === 'tenant') return { kind: 'tenant' };
  if (row.level === 'space') return { kind: 'space', id: row.space_id! };
  return { kind: 'artifact', id: row.artifact_id! };
}

function storedOf(row: GrantRow): StoredGrant {
  return {
    id: row.id,
    roleId: row.role_id,
    subject: row.principal_id !== null ? { principal: row.principal_id } : { group: row.group_id! },
    level: levelOf(row),
    effect: row.effect,
    expiresAt: row.expires_at,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
  };
}

/**
 * The level a grant was made at, which is what managing it is decided against; undefined when the
 * tenant holds no such grant. A caller that is going to remove it takes `lockAccessForChange` first,
 * so the grant it decided on is the grant it removes.
 */
export async function grantLevel(trx: TenantTransaction, id: string): Promise<Level | undefined> {
  const row = await trx
    .selectFrom('access_grant')
    .select(['level', 'space_id', 'artifact_id'])
    .where('id', '=', id)
    .executeTakeFirst();
  return row && levelOf(row);
}

/**
 * The grants that keep the tenant administered, as the lock-out guard counts them (access.md, "Roles"):
 * `administer` at the tenant, allowed directly to a principal who is not external, with no expiry. A
 * group's grant, an expiring one and an external principal's never count, so removing a member, a group
 * or an expiring grant can never be what leaves a tenant unadministered.
 */
export async function administeringGrants(trx: TenantTransaction): Promise<string[]> {
  const rows = await trx
    .selectFrom('access_grant as g')
    .innerJoin('role as r', 'r.id', 'g.role_id')
    .innerJoin('principal as p', 'p.id', 'g.principal_id')
    .select('g.id')
    .where('g.level', '=', 'tenant')
    .where('g.effect', '=', 'allow')
    .where('g.expires_at', 'is', null)
    .where('p.kind', '<>', 'external')
    // Somebody invited who has not signed in administers nothing yet, and may never.
    .where('p.issuer', 'is not', null)
    .where(sql<boolean>`'administer' = any (r.permissions)`)
    .orderBy('g.id')
    .execute();
  return rows.map((row) => row.id);
}

export type RemovalAnswer =
  | { readonly removed: StoredGrant }
  | { readonly refused: 'grant.missing' | 'grant.last_administrator' };

/**
 * Removes a grant, or says why not: it is not this tenant's, or it is the last grant keeping the tenant
 * administered. A removal that leaves the count where it was is never refused, whatever the count.
 * Who may remove it - `administer` at its level or above - is the caller's to decide first.
 *
 * Takes the epoch FOR UPDATE before it counts: two removals at once, of the last two administrators'
 * grants, would otherwise each count the other's still standing, and both land.
 */
export async function removeGrant(trx: TenantTransaction, id: string): Promise<RemovalAnswer> {
  await lockAccessForChange(trx);
  const row = await trx
    .selectFrom('access_grant')
    .select([
      'id',
      'role_id',
      'principal_id',
      'group_id',
      'level',
      'space_id',
      'artifact_id',
      'effect',
      'expires_at',
      'granted_by',
      'granted_at',
    ])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) return { refused: 'grant.missing' };
  const administering = await administeringGrants(trx);
  if (administering.includes(id) && administering.length === 1) {
    return { refused: 'grant.last_administrator' };
  }
  await trx.deleteFrom('access_grant').where('id', '=', id).execute();
  return { removed: storedOf(row) };
}
