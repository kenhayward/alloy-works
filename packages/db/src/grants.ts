import { allowable, externalCap, type Level, type Permission } from '@alloy-works/domain';
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

async function reachesExternal(
  trx: TenantTransaction,
  subject: NewGrant['subject'],
): Promise<boolean> {
  if ('principal' in subject) {
    const row = await trx
      .selectFrom('principal')
      .select('kind')
      .where('id', '=', subject.principal)
      .executeTakeFirstOrThrow();
    return row.kind === 'external';
  }
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

  const role = await trx
    .selectFrom('role')
    .select('permissions')
    .where('id', '=', input.roleId)
    .executeTakeFirstOrThrow();
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
  if (await reachesExternal(trx, input.subject)) {
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
