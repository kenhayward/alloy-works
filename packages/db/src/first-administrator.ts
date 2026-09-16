import { sql } from 'kysely';
import { lockAccessForChange } from './access-facts.js';
import { asAdministrator } from './admin.js';
import type { Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';

/**
 * Whether anybody administers the tenant, counted as the lock-out guard counts (access.md, "Roles"):
 * a principal who is not external, holding `administer` at the tenant through a direct allow with no
 * expiry. `prefix` qualifies each table for a connection outside `withTenant`.
 */
const administered = (prefix: string) => `
  select exists (
    select 1
    from ${prefix}access_grant g
    join ${prefix}role r on r.id = g.role_id
    join ${prefix}principal p on p.id = g.principal_id
    where g.level = 'tenant' and g.effect = 'allow' and g.expires_at is null
      and 'administer' = any (r.permissions) and p.kind <> 'external'
  ) as administered`;

export interface NamedIdentity {
  /** The identity provider's issuer, exactly as its ID tokens carry it. */
  readonly issuer: string;
  /** The subject the provider assigns: never an address, which a user may be able to change. */
  readonly subject: string;
  /** Who named them, for the record: an operator, or `pnpm dev:setup`. */
  readonly namedBy: string;
}

export type NamingAnswer =
  | { readonly named: true }
  | {
      readonly refused:
        | 'first_administrator.already_named'
        | 'first_administrator.administrator_exists'
        | 'first_administrator.no_administrator_role';
    };

/**
 * Names the identity whose first sign-in will be granted Administrator at the tenant. Run by whoever
 * provisions the tenant, as an administrator of the database: the runtime role cannot insert a naming,
 * so nothing a user does through the service can name themselves. Refused while a naming waits, or
 * once somebody administers the tenant.
 */
export async function nameFirstAdministrator(
  adminUrl: string,
  tenant: Tenant,
  identity: NamedIdentity,
): Promise<NamingAnswer> {
  let answer: NamingAnswer = { named: true };
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(`select 1 from ${schema}.access_epoch for update`);
    const { rows: held } = await client.query<{ administered: boolean }>(
      administered(`${schema}.`),
    );
    if (held[0]?.administered) {
      answer = { refused: 'first_administrator.administrator_exists' };
      return;
    }
    const open = await client.query(
      `select 1 from ${schema}.first_administrator where claimed_at is null`,
    );
    if (open.rowCount) {
      answer = { refused: 'first_administrator.already_named' };
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
    await client.query(
      `insert into ${schema}.first_administrator (issuer, subject, role_id, named_by)
       values ($1, $2, $3, $4)`,
      [identity.issuer, identity.subject, role.rows[0].id, identity.namedBy],
    );
  });
  return answer;
}

export type ClaimAnswer = 'granted' | 'refused_administrator_exists' | undefined;

/**
 * Called in the transaction of every sign-in that finds or makes a principal. If the principal's issuer
 * and subject are the waiting naming's, grants the named role at the tenant and records the claim;
 * if somebody already administers the tenant, records the refusal instead. Either way the naming is
 * used, so it can never be claimed twice. Takes the access epoch FOR UPDATE first, because the grant
 * would take it exclusively anyway, and a shared lock taken first would have to be upgraded.
 */
export async function claimFirstAdministrator(
  trx: TenantTransaction,
  principal: { readonly id: string; readonly issuer: string; readonly subject: string },
): Promise<ClaimAnswer> {
  const naming = await trx
    .selectFrom('first_administrator')
    .select(['id', 'role_id'])
    .where('claimed_at', 'is', null)
    .where('issuer', '=', principal.issuer)
    .where('subject', '=', principal.subject)
    .executeTakeFirst();
  if (!naming) return undefined;

  await lockAccessForChange(trx);
  const claimable = await trx
    .selectFrom('first_administrator')
    .select('id')
    .where('id', '=', naming.id)
    .where('claimed_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  if (!claimable) return undefined;

  const { rows } = await sql<{ administered: boolean }>`${sql.raw(administered(''))}`.execute(trx);
  const outcome = rows[0]?.administered ? 'refused_administrator_exists' : 'granted';
  if (outcome === 'granted') {
    // An identical grant may already exist - held by a principal `administered()` does not count: an
    // external one, or one whose grant expires (both excluded by its `expires_at is null` and
    // `kind <> 'external'`). Only a permanent one (no expiry) administers the tenant the way this claim
    // would, so only that is treated as already satisfying it - inserting again would otherwise throw a
    // unique violation on `access_grant_once`, 500ing the sign-in. An expiring one is not equivalent:
    // recording `granted` over it would spend the naming on a grant that lapses, leaving the tenant
    // unadministered with nothing left to claim, so the naming is left open instead - a later sign-in,
    // once the temporary grant is gone or made permanent, can claim it for real. The epoch's already
    // held FOR UPDATE above rules out a race between this read and the insert below.
    const existing = await trx
      .selectFrom('access_grant')
      .select('expires_at')
      .where('role_id', '=', naming.role_id)
      .where('principal_id', '=', principal.id)
      .where('group_id', 'is', null)
      .where('level', '=', 'tenant')
      .where('space_id', 'is', null)
      .where('artifact_id', 'is', null)
      .where('effect', '=', 'allow')
      .executeTakeFirst();
    if (existing && existing.expires_at !== null) return undefined;
    if (!existing) {
      await trx
        .insertInto('access_grant')
        .values({
          role_id: naming.role_id,
          principal_id: principal.id,
          level: 'tenant',
          effect: 'allow',
          granted_by: principal.id,
        })
        .execute();
    }
  }
  await trx
    .updateTable('first_administrator')
    .set({ claimed_at: sql`now()`, claimed_by: principal.id, outcome })
    .where('id', '=', naming.id)
    .execute();
  return outcome;
}
