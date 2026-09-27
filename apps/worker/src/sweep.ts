import { sweepPreviews, type TenantDatabase } from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import type { WorkerLog } from './worker.js';

/**
 * What sign-ins leave behind: attempts and hand-offs nobody came back for, and sessions past their
 * last hour. All are refused once expired; this is what stops the rows accumulating for ever.
 */
export async function sweepExpiredSignIns(
  db: TenantDatabase,
  now: Date = new Date(),
): Promise<number> {
  let removed = 0;
  for (const tenant of await db.tenants()) {
    removed += await db.withTenant(tenant, async (trx) => {
      const attempts = await trx
        .deleteFrom('sign_in_attempt')
        .where('expires_at', '<=', now)
        .executeTakeFirst();
      const handoffs = await trx
        .deleteFrom('sign_in_handoff')
        .where('expires_at', '<=', now)
        .executeTakeFirst();
      const sessions = await trx
        .deleteFrom('session')
        .where((eb) => eb.or([eb('expires_at', '<=', now), eb('idle_expires_at', '<=', now)]))
        .executeTakeFirst();
      return Number(attempts.numDeletedRows + handoffs.numDeletedRows + sessions.numDeletedRows);
    });
  }
  return removed;
}

/**
 * The preview sweep (publishing.md, "Preview"; PV-F), in every tenant: each preview request finished
 * an hour ago or more is deleted, done or failed, by `sweepPreviews`, and once that has committed, the
 * PDF of each done one is removed from the tenant's store, unless something else still names its key.
 * Removed after the commit, so a sweep that fails part way removes nothing a request still names.
 *
 * A tenant whose sweep or store fails is logged and passed over, and the rest are swept: one tenant's
 * store being away is no reason to keep another's previews. A PDF whose removal fails is left in the
 * store, named by nothing, and logged by its key, which is a hash and says nothing of the document.
 * Answers how many PDFs were removed.
 */
export async function sweepExpiredPreviews(
  db: TenantDatabase,
  stores: ObjectStores,
  log: WorkerLog,
): Promise<number> {
  let removed = 0;
  for (const tenant of await db.tenants()) {
    try {
      const keys = await db.withTenant(tenant, (trx) => sweepPreviews(trx));
      if (keys.length === 0) continue;
      const store = await db.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
      for (const key of keys) {
        try {
          await store.remove(key);
          removed += 1;
        } catch (error) {
          log.error(
            { tenant: tenant.id, key, err: error },
            "a swept preview's PDF was not removed",
          );
        }
      }
    } catch (error) {
      log.error({ tenant: tenant.id, err: error }, 'the preview sweep failed in a tenant');
    }
  }
  return removed;
}
