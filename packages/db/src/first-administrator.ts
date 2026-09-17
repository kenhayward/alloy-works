import { asAdministrator } from './admin.js';
import { INVITATION_DAYS, invitedAddress } from './invitations.js';
import type { Tenant } from './provision.js';
import { signedInAddressQuery } from './sign-in.js';

/**
 * Whether anybody administers the tenant, counted as the lock-out guard counts (access.md, "Roles"): a
 * principal who has signed in and is not external, holding `administer` at the tenant through a direct
 * allow with no expiry. `prefix` qualifies each table for a connection outside `withTenant`.
 *
 * The same rule `administeringGrants` (grants.ts) counts under a `TenantTransaction`, kept here in raw
 * SQL only for `inviteFirstAdministrator`, which runs as an administrator of the database over its own
 * connection. `first-administrator.test.ts` holds both against the same grants.
 */
export const administeredQuery = (prefix: string) => `
  select exists (
    select 1
    from ${prefix}access_grant g
    join ${prefix}role r on r.id = g.role_id
    join ${prefix}principal p on p.id = g.principal_id
    where g.level = 'tenant' and g.effect = 'allow' and g.expires_at is null
      and 'administer' = any (r.permissions) and p.kind <> 'external' and p.issuer is not null
  ) as administered`;

export interface FirstAdministratorInvitation {
  /** The address the first administrator will sign in with, verified by the provider. */
  readonly email: string;
  /** Who invited them, for the record: an operator, or `pnpm dev:setup`. */
  readonly namedBy: string;
}

export type FirstAdministratorAnswer =
  | { readonly invited: true; readonly renewed: boolean }
  | {
      readonly refused:
        | 'first_administrator.administrator_exists'
        | 'first_administrator.already_invited'
        | 'first_administrator.signed_in'
        | 'first_administrator.no_administrator_role';
    };

/**
 * Invites a tenant's first administrator by address (IAM-059): an invitation, as any administrator
 * makes, whose principal is granted Administrator at the tenant now, so the first sign-in the provider
 * verifies the address for is that administrator. Run by whoever provisions the tenant, as an
 * administrator of the database - the runtime role cannot make an invitation nobody inside the tenant
 * made - and best run before any sign-in route is permitted, so nobody can have signed in with the
 * address first.
 *
 * Refused once somebody who has signed in administers the tenant; while another address's invitation
 * to administer waits unexpired; and where somebody who has signed in already shows this address,
 * since a sign-in that finds its principal never claims an invitation. Inviting the same address again
 * renews the invitation for another `INVITATION_DAYS`; one that lapsed for another address is
 * withdrawn and replaced. It lapses like any other, so no invitation outlives the bootstrap unused.
 */
export async function inviteFirstAdministrator(
  adminUrl: string,
  tenant: Tenant,
  input: FirstAdministratorInvitation,
): Promise<FirstAdministratorAnswer> {
  const email = invitedAddress(input.email);
  let answer: FirstAdministratorAnswer = { invited: true, renewed: false };
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(`select 1 from ${schema}.access_epoch for update`);

    const { rows: held } = await client.query<{ administered: boolean }>(
      administeredQuery(`${schema}.`),
    );
    if (held[0]?.administered) {
      answer = { refused: 'first_administrator.administrator_exists' };
      return;
    }
    const signedIn = await client.query(signedInAddressQuery(`${schema}.`), [email]);
    if (signedIn.rowCount) {
      answer = { refused: 'first_administrator.signed_in' };
      return;
    }
    const role = await client.query<{ id: string }>(
      `select id from ${schema}.role
       where name = 'Administrator' and 'administer' = any (permissions) and 'read' = any (permissions)`,
    );
    if (!role.rows[0]) {
      answer = { refused: 'first_administrator.no_administrator_role' };
      return;
    }

    const waiting = await client.query<{
      id: string;
      email: string;
      lapsed: boolean;
      principal_id: string;
    }>(
      `select i.id, i.email, i.principal_id,
              (i.expires_at is not null and i.expires_at <= now()) as lapsed
       from ${schema}.invitation i
       join ${schema}.access_grant g on g.principal_id = i.principal_id
       join ${schema}.role r on r.id = g.role_id
       where i.accepted_at is null and g.level = 'tenant' and g.effect = 'allow'
         and 'administer' = any (r.permissions)
       for update of i`,
    );
    for (const other of waiting.rows) {
      if (other.email === email) continue;
      if (!other.lapsed) {
        answer = { refused: 'first_administrator.already_invited' };
        return;
      }
      await client.query(`delete from ${schema}.access_grant where principal_id = $1`, [
        other.principal_id,
      ]);
      await client.query(`delete from ${schema}.principal where id = $1`, [other.principal_id]);
    }

    const open = await client.query<{ id: string; principal_id: string }>(
      `select id, principal_id from ${schema}.invitation
       where email = $1 and accepted_at is null for update`,
      [email],
    );
    let principalId = open.rows[0]?.principal_id;
    if (open.rows[0]) {
      await client.query(
        `update ${schema}.invitation set expires_at = now() + make_interval(days => $2) where id = $1`,
        [open.rows[0].id, INVITATION_DAYS],
      );
      answer = { invited: true, renewed: true };
    } else {
      const made = await client.query<{ id: string }>(
        `insert into ${schema}.principal (email) values ($1) returning id`,
        [email],
      );
      principalId = made.rows[0]!.id;
      await client.query(
        `insert into ${schema}.invitation (email, principal_id, named_by, expires_at)
         values ($1, $2, $3, now() + make_interval(days => $4))`,
        [email, principalId, input.namedBy, INVITATION_DAYS],
      );
    }
    // Granted by the principal it is granted to, as the naming it replaces granted: nobody else has
    // acted inside the tenant yet.
    await client.query(
      `insert into ${schema}.access_grant (role_id, principal_id, level, effect, granted_by)
       values ($1, $2, 'tenant', 'allow', $2)
       on conflict on constraint access_grant_once do nothing`,
      [role.rows[0].id, principalId],
    );
  });
  return answer;
}
