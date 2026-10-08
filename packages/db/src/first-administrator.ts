import type pg from 'pg';
import { asAdministrator } from './admin.js';
import { labelled, labels, recordEventSql } from './audit.js';
import {
  INVITATION_DAYS,
  INVITED_PRINCIPAL_CLEANUP_TABLES,
  invitedAddress,
  invitedAddressLockQuery,
} from './invitations.js';
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
        | 'first_administrator.external'
        | 'first_administrator.no_administrator_role';
    };

/**
 * Invites a tenant's first administrator by address (IAM-059): an invitation, as any administrator
 * makes, whose principal is granted Administrator at the tenant now, so the first sign-in the provider
 * verifies the address for is that administrator. Run by whoever provisions the tenant, as an
 * administrator of the database - `named_by` is what records that, and 0014 revokes the runtime role's
 * privilege to write that one column, table-level, so nothing a request through the service does can
 * make an invitation carry provisioning's own provenance - and best run before any sign-in route is
 * permitted, so nobody can have signed in with the address first.
 *
 * Refused once somebody who has signed in administers the tenant; while another address's invitation
 * to administer waits unexpired; and where somebody who has signed in already shows this address,
 * since a sign-in that finds its principal never claims an invitation; and where the address's waiting
 * invitation is from outside the organisation, which the external rules keep from administering. Inviting the same address again
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
    // The address's lock, as `invite` and a first sign-in take it: a sign-in making a principal for
    // this address, verified, commits before the checks below read, or waits until this commits.
    // Keyed by the schema's name, unescaped, as `current_schema()` names it inside `withTenant`.
    await client.query(invitedAddressLockQuery('$2::text'), [email, tenant.schema]);

    // A claim of another address (`claimInvitation`) takes no epoch, by design (invitations.ts), nor
    // this address's lock, so it can commit between any two statements here. Each of these two
    // checks is run again below, right after a `for update` that a concurrent claim of the tenant's
    // waiting administrator invitation blocks behind - which is exactly what would let its commit slip past a check made only once, before
    // the wait, still holding this address's or another's answer as it stood before that commit.
    const checkAdministered = async (): Promise<boolean> => {
      const { rows } = await client.query<{ administered: boolean }>(
        administeredQuery(`${schema}.`),
      );
      return rows[0]?.administered ?? false;
    };
    const checkSignedIn = async (): Promise<boolean> => {
      const { rowCount } = await client.query(signedInAddressQuery(`${schema}.`), [email]);
      return (rowCount ?? 0) > 0;
    };

    if (await checkAdministered()) {
      answer = { refused: 'first_administrator.administrator_exists' };
      return;
    }
    if (await checkSignedIn()) {
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
    // Re-checked: this wait is exactly where a concurrent claim of one of these rows would have
    // blocked us, so its commit - now visible to the fresh statements above - must be answered here,
    // before the loop below ever treats the claimed row as still merely "waiting".
    if (await checkAdministered()) {
      answer = { refused: 'first_administrator.administrator_exists' };
      return;
    }
    if (await checkSignedIn()) {
      answer = { refused: 'first_administrator.signed_in' };
      return;
    }
    for (const other of waiting.rows) {
      if (other.email === email) continue;
      if (!other.lapsed) {
        answer = { refused: 'first_administrator.already_invited' };
        return;
      }
      // One event for each row the replacement removes, before any delete (the AU1 plan, AU1-H).
      await recordWithdrawal(client, schema, other);
      for (const table of INVITED_PRINCIPAL_CLEANUP_TABLES) {
        await client.query(`delete from ${schema}.${table} where principal_id = $1`, [
          other.principal_id,
        ]);
      }
      await client.query(`delete from ${schema}.principal where id = $1`, [other.principal_id]);
    }

    const open = await client.query<{ id: string; principal_id: string; kind: string }>(
      `select i.id, i.principal_id, p.kind
       from ${schema}.invitation i
       join ${schema}.principal p on p.id = i.principal_id
       where i.email = $1 and i.accepted_at is null for update of i`,
      [email],
    );
    // Re-checked again, over this address's own row. A claim of this address can no longer be in
    // flight here - it takes the address's lock above first, so it committed before the first checks
    // or waits for this transaction - and no test fails without these two; kept so that nothing reads
    // an answer from before a wait on a row lock, should the address's lock ever be moved.
    if (await checkAdministered()) {
      answer = { refused: 'first_administrator.administrator_exists' };
      return;
    }
    if (await checkSignedIn()) {
      answer = { refused: 'first_administrator.signed_in' };
      return;
    }
    // Only a user is renewed into the first administrator. Somebody invited from outside the
    // organisation is held to the external rules `grant` applies, which this raw insert below would
    // step round - and a renewed invitation would then block every other address for its lifetime.
    if (open.rows[0] && open.rows[0].kind !== 'user') {
      answer = { refused: 'first_administrator.external' };
      return;
    }
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
    const granted = await client.query<{ id: string }>(
      `insert into ${schema}.access_grant (role_id, principal_id, level, effect, granted_by)
       values ($1, $2, 'tenant', 'allow', $2)
       on conflict on constraint access_grant_once do nothing
       returning id`,
      [role.rows[0].id, principalId],
    );
    // The vendor's naming, in the tenant's own log (IAM-060), by whom it was named as a label.
    const invitee = labelled('invitee', email, principalId!);
    await recordEventSql(
      client,
      {
        kind: 'tenant.administrator_named',
        subject: { kind: 'principal', id: principalId! },
        detail: { principal: principalId! },
      },
      // `named_by` is the vendor's own words for its authority, naming no principal of the tenant's,
      // so no erasure of a person reaches it (the AU1 review, L9).
      labels(invitee, labelled('named_by', input.namedBy)),
    );
    if (granted.rows[0]) {
      await recordEventSql(
        client,
        {
          kind: 'access.granted',
          subject: { kind: 'grant', id: granted.rows[0].id },
          detail: {
            role: role.rows[0].id,
            level: 'tenant',
            effect: 'allow',
            grantee: principalId!,
            granteeKind: 'principal',
          },
        },
        labels(
          labelled('role', 'Administrator', role.rows[0].id),
          invitee && { ...invitee, role: 'grantee' },
        ),
      );
    }
  });
  return answer;
}

/**
 * Records the withdrawal of a lapsed administrator invitation: each grant and membership its principal
 * holds, then the invitation itself, over the administrator's own connection.
 */
async function recordWithdrawal(
  client: pg.ClientBase,
  schema: string,
  invitation: { readonly id: string; readonly email: string; readonly principal_id: string },
): Promise<void> {
  const invitee = labelled('invitee', invitation.email, invitation.principal_id);
  const grants = await client.query<{
    id: string;
    role_id: string;
    role_name: string;
    level: 'tenant' | 'space' | 'artifact';
    space_id: string | null;
    artifact_id: string | null;
    space_name: string | null;
    effect: 'allow' | 'deny';
  }>(
    `select g.id, g.role_id, r.name as role_name, g.level, g.space_id, g.artifact_id,
            s.name as space_name, g.effect
     from ${schema}.access_grant g
     join ${schema}.role r on r.id = g.role_id
     left join ${schema}.space s on s.id = g.space_id
     where g.principal_id = $1 order by g.id`,
    [invitation.principal_id],
  );
  for (const grant of grants.rows) {
    const at = grant.level === 'space' ? grant.space_id : grant.artifact_id;
    await recordEventSql(
      client,
      {
        kind: 'access.revoked',
        subject: { kind: 'grant', id: grant.id },
        space: grant.space_id,
        detail: {
          role: grant.role_id,
          level: grant.level === 'tenant' ? 'tenant' : `${grant.level}:${at}`,
          effect: grant.effect,
          grantee: invitation.principal_id,
          granteeKind: 'principal',
        },
      },
      labels(
        labelled('role', grant.role_name, grant.role_id),
        invitee && { ...invitee, role: 'grantee' },
        labelled('space', grant.space_name, grant.space_id),
      ),
    );
  }
  const memberships = await client.query<{ group_id: string; name: string; source: string }>(
    `select m.group_id, g.name, g.source
     from ${schema}.group_member m join ${schema}.access_group g on g.id = m.group_id
     where m.principal_id = $1 order by m.group_id`,
    [invitation.principal_id],
  );
  for (const membership of memberships.rows) {
    await recordEventSql(
      client,
      {
        kind: 'group.member_removed',
        subject: { kind: 'group', id: membership.group_id },
        detail: {
          group: membership.group_id,
          principal: invitation.principal_id,
          through: membership.source === 'provider' ? 'provider' : 'manual',
        },
      },
      labels(
        labelled('subject', membership.name, membership.group_id),
        invitee && { ...invitee, role: 'member' },
      ),
    );
  }
  await recordEventSql(
    client,
    {
      kind: 'invitation.withdrawn',
      subject: { kind: 'invitation', id: invitation.id },
      detail: { principal: invitation.principal_id },
    },
    labels(invitee),
  );
}
