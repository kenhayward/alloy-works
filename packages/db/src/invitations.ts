import { CompiledQuery, sql } from 'kysely';
import { lockAccessForChange } from './access-facts.js';
import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
import type { SignInRoute } from './sign-in.js';
import type { TenantTransaction } from './tables.js';

/** How long an invitation made through the service waits for its sign-in (access.md, "Invitations"). */
export const INVITATION_DAYS = 14;

/** What a sign-in knows of who has just authenticated, as far as an invitation needs it. */
export interface ClaimingIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | null;
  /** Whether the provider asserted the address as verified: nothing unverified ever claims. */
  readonly emailVerified: boolean;
  readonly name: string | null;
}

export interface StoredInvitation {
  readonly id: string;
  readonly email: string;
  /** The principal the invitation made: grants name it, and its first sign-in becomes it. */
  readonly principalId: string;
  readonly kind: 'user' | 'service' | 'external';
  readonly invitedBy: { readonly id: string; readonly name: string | null } | null;
  /** Whoever provisioned the tenant, for an invitation made outside the service. */
  readonly namedBy: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly acceptedThrough: SignInRoute | null;
}

export type InvitationRefusal = 'invitation.signed_in' | 'invitation.kind_differs';

export type InvitationAnswer =
  | { readonly invited: StoredInvitation; readonly renewed: boolean }
  | { readonly refused: InvitationRefusal };

export type WithdrawalAnswer =
  | { readonly withdrawn: string }
  | { readonly refused: 'invitation.missing' | 'invitation.accepted' };

/** The address as an invitation holds it and as a claim compares it: trimmed and in lower case. */
export function invitedAddress(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The lock an address is invited, re-invited and first signed in with under, so that none of them
 * reads the others' work half done: a transaction-scoped advisory lock keyed by the tenant's schema
 * and the address as `invitedAddress` holds it. Qualified by the schema, not just the literal
 * "invitation": two tenants handling the same address at once must not contend on one lock they share
 * no row over. `schema` is an SQL expression naming the tenant's schema - `current_schema()` inside
 * `withTenant`, a bound parameter over an administrator's own connection - and `$1` is the address;
 * `lockInvitedAddress` and `inviteFirstAdministrator` (first-administrator.ts) both build it here, so
 * the two can never lock different keys for one address.
 */
export const invitedAddressLockQuery = (schema: string) =>
  `select pg_advisory_xact_lock(hashtextextended(${schema} || ' invitation ' || $1, 0))`;

/** Takes `invitedAddressLockQuery`'s lock for `email`, already normalised, inside `withTenant`. */
async function lockInvitedAddress(trx: TenantTransaction, email: string): Promise<void> {
  await trx.executeQuery(CompiledQuery.raw(invitedAddressLockQuery('current_schema()'), [email]));
}

/** Whether somebody has already signed in showing this address, verified by their provider. */
function signedInWith(trx: TenantTransaction, email: string) {
  return trx
    .selectFrom('principal')
    .select('id')
    .where('issuer', 'is not', null)
    .where('email_verified', '=', true)
    .where(sql<string>`lower(email)`, '=', email)
    .executeTakeFirst();
}

function invitations(trx: TenantTransaction) {
  return trx
    .selectFrom('invitation as i')
    .innerJoin('principal as p', 'p.id', 'i.principal_id')
    .leftJoin('principal as by', 'by.id', 'i.invited_by')
    .select([
      'i.id',
      'i.email',
      'i.principal_id',
      'p.kind',
      'i.invited_by',
      'by.display_name as invited_by_name',
      'i.named_by',
      'i.created_at',
      'i.expires_at',
      'i.accepted_at',
      'i.accepted_through',
    ]);
}

type InvitationRow = Awaited<ReturnType<ReturnType<typeof invitations>['execute']>>[number];

function stored(row: InvitationRow): StoredInvitation {
  return {
    id: row.id,
    email: row.email,
    principalId: row.principal_id,
    kind: row.kind,
    invitedBy: row.invited_by === null ? null : { id: row.invited_by, name: row.invited_by_name },
    namedBy: row.named_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedThrough: row.accepted_through,
  };
}

/**
 * One invitation, or undefined when the tenant holds no such invitation. An `id` that is not a uuid
 * throws Postgres error 22P02 here; the route above validates it as a `LowercaseUuid` first.
 */
export async function readInvitation(
  trx: TenantTransaction,
  id: string,
): Promise<StoredInvitation | undefined> {
  const row = await invitations(trx).where('i.id', '=', id).executeTakeFirst();
  return row && stored(row);
}

/** Every invitation, waiting or accepted, a page at a time in the order of their ids. */
export async function listInvitations(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<StoredInvitation>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const rows = await invitations(trx)
    .$if(page.after !== undefined, (query) => query.where('i.id', '>', page.after!))
    .orderBy('i.id')
    .limit(page.limit + 1)
    .execute();
  return paged(rows.map(stored), page.limit);
}

/**
 * Invites an address, making the principal a grant can name before anybody has signed in as it; or,
 * where an invitation already waits for the address, renews it for another `INVITATION_DAYS` and keeps
 * the grants it holds. Refused where somebody who has signed in already shows the address, verified by
 * their provider - they are granted directly, and an invitation for them would wait for a sign-in that
 * never claims it - and where the waiting invitation says the other thing about whether they are from
 * outside the organisation. Who may invite - `administer` at the tenant - is the caller's to decide
 * first.
 *
 * Changes no fact a decision reads: a new principal holds nothing, and inserting one fires no trigger.
 * Two invitations of one address at once take turns on a lock of the address, so the second renews
 * what the first made rather than failing on the index that keeps one waiting per address.
 */
export async function invite(
  trx: TenantTransaction,
  input: { readonly email: string; readonly external: boolean; readonly invitedBy: string },
): Promise<InvitationAnswer> {
  const email = invitedAddress(input.email);
  const kind = input.external ? 'external' : 'user';
  // Held until this transaction ends: another invitation of the address, and a first sign-in
  // showing it, verified, each wait here rather than reading this one half done.
  await lockInvitedAddress(trx, email);

  if (await signedInWith(trx, email)) return { refused: 'invitation.signed_in' };

  const waiting = await trx
    .selectFrom('invitation as i')
    .innerJoin('principal as p', 'p.id', 'i.principal_id')
    .select(['i.id', 'p.kind'])
    .where('i.email', '=', email)
    .where('i.accepted_at', 'is', null)
    .forUpdate('i')
    .executeTakeFirst();
  if (waiting) {
    if (waiting.kind !== kind) return { refused: 'invitation.kind_differs' };
    await trx
      .updateTable('invitation')
      .set({
        expires_at: sql<Date>`case when expires_at is null then null
          else now() + make_interval(days => ${INVITATION_DAYS}) end`,
      })
      .where('id', '=', waiting.id)
      .execute();
    return { invited: (await readInvitation(trx, waiting.id))!, renewed: true };
  }

  // A claim never takes the epoch, so it can commit between the check above and here - turning
  // nobody signed in into somebody who now is, if this transaction waited behind its FOR UPDATE of
  // the same invitation above and only then found it already accepted. Asked again before a new
  // principal is made for the address, so that window closes rather than making a second open
  // invitation for somebody who already signed in.
  if (await signedInWith(trx, email)) return { refused: 'invitation.signed_in' };

  const principal = await trx
    .insertInto('principal')
    .values({ issuer: null, subject: null, email, display_name: null, kind })
    .returning('id')
    .executeTakeFirstOrThrow();
  const made = await trx
    .insertInto('invitation')
    .values({
      email,
      principal_id: principal.id,
      invited_by: input.invitedBy,
      expires_at: sql<Date>`now() + make_interval(days => ${INVITATION_DAYS})`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { invited: (await readInvitation(trx, made.id))!, renewed: false };
}

/**
 * The tables cleared, in order, to remove an invitation's principal entirely - its grants, then its
 * group memberships - before the principal itself goes, cascading away the invitation row through its
 * own foreign key. Its own grants first: a first administrator's names the principal as its grantor
 * too, which the grant's `granted_by` restricts, so the principal cannot go while one stands.
 *
 * Shared between `withdrawInvitation` here, inside a `TenantTransaction`, and
 * `inviteFirstAdministrator`'s cleanup of another address's lapsed administrator invitation
 * (first-administrator.ts), which runs outside one, over an administrator's own raw connection - so
 * the two cannot list different tables, or a different order, without one of them changing here too.
 */
export const INVITED_PRINCIPAL_CLEANUP_TABLES = ['access_grant', 'group_member'] as const;

/**
 * Withdraws an invitation nobody has accepted: its principal goes, and every grant and membership that
 * named it. Refused once accepted, since the principal is then somebody who signs in, whose grants are
 * removed one by one. Who may withdraw - `administer` at the tenant - is the caller's to decide first.
 * An `id` that is not a uuid throws Postgres error 22P02 here; the route above validates it as a
 * `LowercaseUuid` first.
 *
 * Takes the epoch FOR UPDATE before it reads, because removing the grants changes access; then the
 * invitation's row, which is the order a claim cannot contradict - a claim never takes the epoch.
 */
export async function withdrawInvitation(
  trx: TenantTransaction,
  id: string,
): Promise<WithdrawalAnswer> {
  await lockAccessForChange(trx);
  const row = await trx
    .selectFrom('invitation')
    .select(['id', 'principal_id', 'accepted_at'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) return { refused: 'invitation.missing' };
  if (row.accepted_at !== null) return { refused: 'invitation.accepted' };
  for (const table of INVITED_PRINCIPAL_CLEANUP_TABLES) {
    await trx.deleteFrom(table).where('principal_id', '=', row.principal_id).execute();
  }
  // The invitation goes with it, by its key's cascade.
  await trx.deleteFrom('principal').where('id', '=', row.principal_id).execute();
  return { withdrawn: row.id };
}

/**
 * Called in the transaction of a sign-in that found no principal by issuer and subject, which makes
 * one in that same transaction when this returns nothing. Where the provider asserts an address as
 * verified and an invitation to it waits, unexpired, the invitation's principal takes this issuer and
 * subject and the invitation is accepted, through this route; its principal's id is returned, holding
 * whatever it was granted. Otherwise nothing changes and nothing is returned. An invitation is
 * accepted once: a second account presenting the address finds none.
 *
 * For a verified address, takes the address's lock (`invitedAddressLockQuery`), then the invitation's
 * row FOR UPDATE, then its principal's - and never the access epoch: giving a principal its identity
 * changes no fact a decision reads, so a claim cannot wait on a decision, and a withdrawal - epoch,
 * then this row, never the address's lock - can only wait on a claim, never the other way round. The
 * address's lock is held to the end of the sign-in's transaction, so the principal a sign-in that
 * claims nothing then makes is committed before an `invite` of the address reads, or made after it.
 */
export async function claimInvitation(
  trx: TenantTransaction,
  identity: ClaimingIdentity,
  route: SignInRoute,
): Promise<string | undefined> {
  if (!identity.emailVerified || !identity.email) return undefined;
  const address = invitedAddress(identity.email);
  // Held until the sign-in's transaction ends - past the principal a sign-in that claims nothing
  // makes next, in the same transaction - so an `invite` of this address cannot find nobody signed
  // in with it, and make an invitation beside them, while that principal is still uncommitted.
  await lockInvitedAddress(trx, address);
  const open = await trx
    .selectFrom('invitation')
    .select(['id', 'principal_id'])
    .where('email', '=', address)
    .where('accepted_at', 'is', null)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql<Date>`now()`)]))
    .forUpdate()
    .executeTakeFirst();
  if (!open) return undefined;
  const identified = await trx
    .updateTable('principal')
    .set({
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      email_verified: true,
      display_name: identity.name,
    })
    .where('id', '=', open.principal_id)
    .where('issuer', 'is', null)
    .executeTakeFirst();
  // No code path leaves an invitation pointing at a principal who already has an identity, but this
  // is the one place that would silently hand somebody else's signed-in account to a claim if it
  // ever did - so the invitation is left waiting rather than accepted over an update that matched
  // nothing.
  if (identified?.numUpdatedRows !== 1n) return undefined;
  await trx
    .updateTable('invitation')
    .set({ accepted_at: sql<Date>`now()`, accepted_through: route })
    .where('id', '=', open.id)
    .execute();
  return open.principal_id;
}
