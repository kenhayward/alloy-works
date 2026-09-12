import type { TenantDatabase } from '@alloy-works/db';

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
