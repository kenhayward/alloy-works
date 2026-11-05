import { sql } from 'kysely';
import type { Tenant } from './provision.js';
import { openSecret, sealSecret } from '@alloy-works/sealing';
import { recordEvent } from './audit.js';
import type { TenantDatabase } from './tenant-database.js';
import type { TenantTransaction } from './tables.js';

/**
 * **A shared provider is copied** (tenant-lifecycle.md, TL-M; IAM-085). An organisation marks one of its
 * providers shared, and the steward copies it into each of its tenants, its secret resealed for that
 * tenant, and keeps the copies current. Sign-in reads only the copy, so losing the organisation's tenant
 * locks nobody out. A tenant may close a copy and may not edit it, since a tenant still decides who enters.
 */

/** Queues the copying, if this is a shared provider, in the transaction that changed it. */
export async function queueProviderCopy(trx: TenantTransaction): Promise<void> {
  await sql`insert into platform.job (tenant_id, kind)
            values (substring(current_user::text from 3), 'provider_share')`.execute(trx);
}

/** Marks or unmarks a provider of the organisation's. Answers false if it has none such open. */
export async function markProviderShared(
  trx: TenantTransaction,
  id: string,
  shared: boolean,
): Promise<boolean> {
  const row = await trx
    .updateTable('identity_provider')
    .set({ shared })
    .where('id', '=', id)
    .where('closed_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  if (!row) return false;
  await recordEvent(trx, {
    kind: 'sign_in.configured',
    subject: { kind: 'sign_in_route' },
    detail: { change: shared ? 'provider_shared' : 'provider_unshared', provider: id },
  });
  await queueProviderCopy(trx);
  return true;
}

/** Whether a tenant made now would have a way for its first administrator to sign in (IAM-059). */
export async function hasSharedProvider(trx: TenantTransaction): Promise<boolean> {
  const row = await trx
    .selectFrom('identity_provider')
    .select('id')
    .where('shared', '=', true)
    .where('closed_at', 'is', null)
    .executeTakeFirst();
  return row !== undefined;
}

export interface CopiedProviders {
  /** Copies made or brought up to date, across the tenants. */
  readonly copied: number;
  /** Where a tenant already has its own provider of that issuer or name, which it keeps. */
  readonly passedOver: number;
}

/**
 * Brings each tenant's copies into line with what the organisation shares. What is no longer shared
 * stays with each tenant as its own: nothing it does here can lock a tenant out (the TL plan, TLe).
 */
export async function copySharedProviders(
  db: TenantDatabase,
  key: Buffer,
  organisation: Tenant,
  tenants: readonly Tenant[],
): Promise<CopiedProviders> {
  const shared = await db.withTenant(
    organisation,
    (trx) =>
      trx
        .selectFrom('identity_provider')
        .select(['issuer', 'name', 'client_id', 'sealed_secret', 'groups_claim'])
        .where('shared', '=', true)
        .where('closed_at', 'is', null)
        .where('sealed_secret', 'is not', null)
        .orderBy('issuer')
        .execute(),
    { actorKind: 'system' },
  );
  let copied = 0;
  let passedOver = 0;
  for (const tenant of tenants) {
    await db.withTenant(
      tenant,
      async (trx) => {
        const issuers = shared.map((each) => each.issuer);
        await trx
          .updateTable('identity_provider')
          .set({ managed_by_organisation: false })
          .where('managed_by_organisation', '=', true)
          .$if(issuers.length > 0, (query) => query.where('issuer', 'not in', issuers))
          .execute();
        for (const provider of shared) {
          const held = await trx
            .selectFrom('identity_provider')
            .select([
              'id',
              'managed_by_organisation',
              'name',
              'client_id',
              'groups_claim',
              'sealed_secret',
            ])
            .where('issuer', '=', provider.issuer)
            .forUpdate()
            .executeTakeFirst();
          const nameIsAnother = await trx
            .selectFrom('identity_provider')
            .select('id')
            .where('name', '=', provider.name)
            .where('issuer', '<>', provider.issuer)
            .executeTakeFirst();
          if ((held && !held.managed_by_organisation) || nameIsAnother) {
            passedOver += 1;
            continue;
          }
          const secret = openSecret(key, 'sign-in', organisation.id, provider.sealed_secret!);
          const same =
            held !== undefined &&
            held.name === provider.name &&
            held.client_id === provider.client_id &&
            held.groups_claim === provider.groups_claim &&
            held.sealed_secret !== null &&
            openSecret(key, 'sign-in', tenant.id, held.sealed_secret) === secret;
          copied += 1;
          if (same) continue;
          const values = {
            name: provider.name,
            client_id: provider.client_id,
            sealed_secret: sealSecret(key, 'sign-in', tenant.id, secret),
            groups_claim: provider.groups_claim,
          };
          // A copy the tenant closed stays closed: whether it opens is the tenant's to say.
          const row = held
            ? await trx
                .updateTable('identity_provider')
                .set(values)
                .where('id', '=', held.id)
                .returning('id')
                .executeTakeFirstOrThrow()
            : await trx
                .insertInto('identity_provider')
                .values({ ...values, issuer: provider.issuer, managed_by_organisation: true })
                .returning('id')
                .executeTakeFirstOrThrow();
          await trx
            .insertInto('sign_in_route')
            .values({ route: 'organisation' })
            .onConflict((conflict) => conflict.doNothing())
            .execute();
          await recordEvent(trx, {
            kind: 'sign_in.configured',
            subject: { kind: 'sign_in_route' },
            detail: { change: 'provider_copied', provider: row.id },
          });
        }
      },
      { actorKind: 'organisation' },
    );
  }
  return { copied, passedOver };
}
