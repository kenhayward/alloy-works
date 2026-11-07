import { supportActive, type SupportGrant, type SupportScope } from '@alloy-works/domain';
import { sql } from 'kysely';
import { lockAccessForChange } from './access-facts.js';
import { labelled, labels, recordEvent } from './audit.js';
import { accessPolicy } from './grants.js';
import {
  invite,
  invitedAddress,
  recordInvitationEvent,
  type StoredInvitation,
} from './invitations.js';
import type { TenantTransaction } from './tables.js';

/**
 * Support access (docs/design/support.md; the SA plan, SA-D): a `support_grant` row, decided apart from
 * `access_grant` so an outsider's tenant-level allow stays refused (IAM-071). Granting and revoking take
 * the access epoch, and the row's trigger tells open streams.
 */

/** A support grant as Administration lists it, active or not by the clock and cap it was read with. */
export interface StoredSupport extends SupportGrant {
  readonly principal: { readonly id: string; readonly name: string | null; readonly email: string };
  readonly grantedBy: { readonly id: string; readonly name: string | null };
  readonly grantedAt: Date;
  readonly revokedBy: { readonly id: string; readonly name: string | null } | null;
  readonly active: boolean;
}

export type SupportRefusal =
  | 'support.member'
  | 'support.signed_in'
  | 'support.kind_differs'
  | 'support.erased'
  | 'support.active'
  | 'support.expiry_past'
  | 'support.past_cap'
  | 'support.spaces_required'
  | 'support.space_missing';

export type SupportAnswer =
  | { readonly granted: StoredSupport; readonly invitation: StoredInvitation | null }
  | { readonly refused: SupportRefusal };

function listed(trx: TenantTransaction) {
  return trx
    .selectFrom('support_grant as s')
    .innerJoin('principal as p', 'p.id', 's.principal_id')
    .innerJoin('principal as by', 'by.id', 's.granted_by')
    .leftJoin('principal as end', 'end.id', 's.revoked_by')
    .select([
      's.id',
      's.scope',
      's.spaces',
      's.purpose',
      's.expires_at',
      's.granted_at',
      's.revoked_at',
      's.revoked_by',
      'p.id as principal_id',
      'p.display_name as principal_name',
      'p.email as principal_email',
      'by.id as granted_by',
      'by.display_name as granted_by_name',
      'end.display_name as revoked_by_name',
    ]);
}

type Row = Awaited<ReturnType<ReturnType<typeof listed>['execute']>>[number];

function stored(row: Row, now: Date, externalCapDays: number): StoredSupport {
  const grant: SupportGrant = {
    id: row.id,
    scope: row.scope,
    spaces: row.spaces,
    purpose: row.purpose,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
  return {
    ...grant,
    principal: { id: row.principal_id, name: row.principal_name, email: row.principal_email ?? '' },
    grantedBy: { id: row.granted_by, name: row.granted_by_name },
    grantedAt: row.granted_at,
    revokedBy: row.revoked_by === null ? null : { id: row.revoked_by, name: row.revoked_by_name },
    // Read from the decision's own rule, never the row alone (SA-D).
    active: supportActive(grant, now, externalCapDays),
  };
}

/** The most grants a listing answers: a tenant gives support a handful of times. */
export const SUPPORT_LISTED = 200;

/** Every support grant, active and ended, the newest first: the tenant's to see at any time (SA-G). */
export async function listSupport(trx: TenantTransaction): Promise<StoredSupport[]> {
  const policy = await accessPolicy(trx);
  const rows = await listed(trx)
    .orderBy('s.granted_at', 'desc')
    .orderBy('s.id')
    .limit(SUPPORT_LISTED)
    .execute();
  return rows.map((row) => stored(row, policy.now, policy.externalCapDays));
}

/**
 * The principal's active support grant at `now`, by the tenant's cap as it stands, or undefined. Read by
 * every decision's loader under the epoch's lock, and by the service's route hook.
 */
export async function activeSupport(
  trx: TenantTransaction,
  principalId: string,
  now: Date,
  externalCapDays: number,
): Promise<SupportGrant | undefined> {
  // A schema before 0218, as a migration's own test reads it with today's code, holds no support.
  const { rows: kept } = await sql<{ kept: boolean }>`
    select to_regclass('support_grant') is not null as kept
  `.execute(trx);
  if (!kept[0]?.kept) return undefined;
  const rows = await trx
    .selectFrom('support_grant')
    .select(['id', 'scope', 'spaces', 'purpose', 'expires_at', 'revoked_at'])
    .where('principal_id', '=', principalId)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', now)
    .orderBy('granted_at', 'desc')
    .orderBy('id')
    .execute();
  return rows
    .map((row): SupportGrant => ({
      id: row.id,
      scope: row.scope,
      spaces: row.spaces,
      purpose: row.purpose,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    }))
    .find((grant) => supportActive(grant, now, externalCapDays));
}

/** `activeSupport` by the true clock and the cap as they stand: what a request's route hook asks. */
export async function supportNow(
  trx: TenantTransaction,
  principalId: string,
): Promise<SupportGrant | undefined> {
  const { rows } = await sql<{ now: Date; cap: number }>`
    select clock_timestamp() as now, external_cap_days as cap from access_policy
  `.execute(trx);
  const policy = rows[0];
  return policy && activeSupport(trx, principalId, policy.now, policy.cap);
}

/**
 * Grants support access to an address (ADM-042): somebody from outside who signed in with it, verified,
 * or else the address invited as such, the invitation lasting as long as the grant (IAM-072). Refused for
 * anybody in the organisation, for somebody already holding active support, for an expiry past or beyond
 * the tenant's cap on outside access (IAM-049), and for a metadata or content grant naming no space or
 * one the tenant does not hold. Who may grant - `grant_support` at the tenant - is the caller's to decide.
 */
export async function grantSupport(
  trx: TenantTransaction,
  input: {
    readonly email: string;
    readonly scope: SupportScope;
    readonly spaces: readonly string[];
    readonly purpose: string;
    readonly expiresAt: Date;
    readonly grantedBy: string;
  },
): Promise<SupportAnswer> {
  await lockAccessForChange(trx);
  const policy = await accessPolicy(trx);
  if (input.expiresAt.getTime() <= policy.now.getTime()) return { refused: 'support.expiry_past' };
  if (input.expiresAt.getTime() > policy.now.getTime() + policy.externalCapDays * 86_400_000) {
    return { refused: 'support.past_cap' };
  }
  const spaces = [...new Set(input.spaces)].sort();
  if (input.scope !== 'diagnostics' && spaces.length === 0) {
    return { refused: 'support.spaces_required' };
  }
  if (spaces.length > 0) {
    const held = await trx.selectFrom('space').select('id').where('id', 'in', spaces).execute();
    if (held.length !== spaces.length) return { refused: 'support.space_missing' };
  }

  const email = invitedAddress(input.email);
  const known = await trx
    .selectFrom('principal')
    .select(['id', 'kind', 'email_verified', sql<boolean>`issuer is not null`.as('signed_in')])
    .select(sql<boolean>`(to_jsonb(principal) ->> 'erased_at') is not null`.as('erased'))
    .where(sql<string>`lower(email)`, '=', email)
    .orderBy('created_at')
    .execute();
  if (known.some((each) => each.kind !== 'external')) return { refused: 'support.member' };
  const signedIn = known.find((each) => each.signed_in && each.email_verified && !each.erased);
  let principal = signedIn?.id;
  let invitation: StoredInvitation | null = null;
  /** The invitation this grant answers for: one it made, or renewed holding nothing but support. */
  let madeFor: string | null = null;
  if (principal === undefined) {
    if (known.some((each) => each.erased)) return { refused: 'support.erased' };
    const invited = await invite(trx, {
      email,
      external: true,
      invitedBy: input.grantedBy,
      expiresAt: input.expiresAt,
    });
    if ('refused' in invited) {
      return {
        refused:
          invited.refused === 'invitation.signed_in' ? 'support.signed_in' : 'support.kind_differs',
      };
    }
    invitation = invited.invited;
    principal = invited.invited.principalId;
    if (!invited.renewed || !(await holdsBeyondSupport(trx, principal))) madeFor = invitation.id;
  }
  if (await activeSupport(trx, principal, policy.now, policy.externalCapDays)) {
    return { refused: 'support.active' };
  }

  const made = await trx
    .insertInto('support_grant')
    .values({
      principal_id: principal,
      scope: input.scope,
      spaces,
      purpose: input.purpose.trim(),
      expires_at: input.expiresAt,
      granted_by: input.grantedBy,
      invitation_id: madeFor,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const granted = stored(
    (await listed(trx).where('s.id', '=', made.id).executeTakeFirstOrThrow()) as Row,
    policy.now,
    policy.externalCapDays,
  );
  await recordSupportEvent(trx, 'support.granted', granted);
  return { granted, invitation };
}

/** Revokes a support grant at once: refused where there is none, or it has already been revoked. */
export async function revokeSupport(
  trx: TenantTransaction,
  id: string,
  revokedBy: string,
): Promise<
  { readonly revoked: StoredSupport } | { readonly refused: 'support.missing' | 'support.revoked' }
> {
  await lockAccessForChange(trx);
  const row = await trx
    .selectFrom('support_grant')
    .select(['id', 'revoked_at', 'invitation_id'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) return { refused: 'support.missing' };
  if (row.revoked_at !== null) return { refused: 'support.revoked' };
  await trx
    .updateTable('support_grant')
    .set({ revoked_at: sql<Date>`now()`, revoked_by: revokedBy, revoked_reason: 'revoked' })
    .where('id', '=', id)
    .execute();
  // The invitation it made, still waiting, ends with it: lapsed, and audited as withdrawn, so its
  // person cannot sign in afterwards holding nothing. The person and the grant stay.
  if (row.invitation_id !== null) {
    const lapsed = await trx
      .updateTable('invitation')
      .set({ expires_at: sql<Date>`now()` })
      .where('id', '=', row.invitation_id)
      .where('accepted_at', 'is', null)
      .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql<Date>`now()`)]))
      .returning(['id', 'email', 'principal_id'])
      .executeTakeFirst();
    if (lapsed) {
      await recordInvitationEvent(trx, 'invitation.withdrawn', {
        id: lapsed.id,
        email: lapsed.email,
        principalId: lapsed.principal_id,
      });
    }
  }
  const policy = await accessPolicy(trx);
  const revoked = stored(
    (await listed(trx).where('s.id', '=', id).executeTakeFirstOrThrow()) as Row,
    policy.now,
    policy.externalCapDays,
  );
  await recordSupportEvent(trx, 'support.revoked', revoked);
  return { revoked };
}

/** Whether the principal holds any grant, or belongs to any group: access beyond support. */
async function holdsBeyondSupport(trx: TenantTransaction, principal: string): Promise<boolean> {
  const grant = await trx
    .selectFrom('access_grant')
    .select('id')
    .where('principal_id', '=', principal)
    .executeTakeFirst();
  const member = await trx
    .selectFrom('group_member')
    .select('group_id')
    .where('principal_id', '=', principal)
    .executeTakeFirst();
  return grant !== undefined || member !== undefined;
}

async function recordSupportEvent(
  trx: TenantTransaction,
  kind: 'support.granted' | 'support.revoked',
  support: StoredSupport,
): Promise<void> {
  await recordEvent(
    trx,
    {
      kind,
      subject: { kind: 'support_grant', id: support.id },
      detail: {
        principal: support.principal.id,
        scope: support.scope,
        spaces: [...support.spaces],
        purpose: support.purpose,
        expiresAt: support.expiresAt.toISOString(),
      },
    },
    labels(labelled('support', support.principal.email, support.principal.id)),
  );
}

/**
 * Records support's use (ADM-024): once a person a UTC day a grant, so a scope, by the one request whose
 * stamp lands; a concurrent one waits on the row, then finds the day stamped and records nothing.
 */
export async function recordSupportUse(
  trx: TenantTransaction,
  support: Pick<SupportGrant, 'id' | 'scope'>,
): Promise<void> {
  const today = sql<string>`(now() at time zone 'utc')::date`;
  const stamped = await trx
    .updateTable('support_grant')
    .set({ used_on: today })
    .where('id', '=', support.id)
    .where((eb) => eb.or([eb('used_on', 'is', null), eb('used_on', '<', today)]))
    .returning('id')
    .executeTakeFirst();
  if (!stamped) return;
  await recordEvent(trx, {
    kind: 'support.used',
    subject: { kind: 'support_grant', id: support.id },
    detail: { scope: support.scope },
  });
}

/** Records one content read by support (ADM-024, ADM-026): the route, what its path names, and why. */
export async function recordSupportRead(
  trx: TenantTransaction,
  support: Pick<SupportGrant, 'id'>,
  read: {
    readonly route: string;
    readonly on: Readonly<Record<string, string>>;
    readonly purpose: string;
  },
): Promise<void> {
  await recordEvent(trx, {
    kind: 'support.used',
    subject: { kind: 'support_grant', id: support.id },
    detail: { scope: 'content', route: read.route, on: { ...read.on }, purpose: read.purpose },
  });
}
