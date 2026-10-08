import {
  CHECK_GIVE_UPS,
  enqueueJob,
  labelled,
  publicationsToCheckAgain,
  recordEvent,
  recordCheckGivenUp,
  sweepIterations,
  sweepPreviews,
  type JobQueue,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores, TenantStore } from '@alloy-works/objects';
import type { WorkerLog } from './worker.js';

/**
 * What sign-ins leave behind: attempts and hand-offs nobody came back for, and sessions past their
 * last hour. All are refused once expired; this is what stops the rows accumulating for ever. Each
 * session ended is a sign-out by the system (IAM-013; the AU1 plan, AU1-F), recorded in the
 * transaction that removes it, with when it expired.
 */
export async function sweepExpiredSignIns(
  db: TenantDatabase,
  now: Date = new Date(),
): Promise<number> {
  let removed = 0;
  for (const tenant of await db.tenants()) {
    removed += await db.withTenant(
      tenant,
      async (trx) => {
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
          .returning(['id', 'principal_id', 'expires_at', 'idle_expires_at'])
          .execute();
        for (const session of sessions) {
          const holder = await trx
            .selectFrom('principal')
            .select(['display_name', 'email'])
            .where('id', '=', session.principal_id)
            .executeTakeFirst();
          const label = labelled(
            'subject',
            holder && (holder.display_name ?? holder.email),
            session.principal_id,
          );
          const expiredAt =
            session.idle_expires_at < session.expires_at
              ? session.idle_expires_at
              : session.expires_at;
          await recordEvent(
            trx,
            {
              kind: 'authentication.signed_out',
              subject: { kind: 'principal', id: session.principal_id },
              detail: { ended: 'expired', session: session.id, expiredAt: expiredAt.toISOString() },
            },
            label === undefined ? [] : [label],
          );
        }
        return Number(attempts.numDeletedRows + handoffs.numDeletedRows) + sessions.length;
      },
      { actorKind: 'system' },
    );
  }
  return removed;
}

/**
 * The iteration sweep (storage-and-versioning.md, VER-003 and VER-004), in every tenant: each iteration
 * whose component has had the next version cut after the one it was opened from, the tenant's window
 * ago or more, is deleted by `sweepIterations`, under the trigger that refuses any other. A tenant
 * whose sweep fails is logged and passed over, and the rest are swept. Answers how many were removed.
 */
export async function sweepExpiredIterations(db: TenantDatabase, log: WorkerLog): Promise<number> {
  let removed = 0;
  for (const tenant of await db.tenants()) {
    try {
      removed += await db.withTenant(tenant, (trx) => sweepIterations(trx));
    } catch (error) {
      log.error({ tenant: tenant.id, err: error }, 'the iteration sweep failed in a tenant');
    }
  }
  return removed;
}

/**
 * The check sweep (W14.1, ADR-0030), in every tenant: each publication with a PDF still unchecked five
 * minutes after it was recorded, with no `check_pdf` job waiting or running for it, has one queued
 * again. Its check gave up after its last attempt - veraPDF would not start, the store would not
 * answer - and nothing else would ever try it again, leaving its page saying it is not yet checked. A
 * publication recorded before 0040, when nothing queued a check, is one with no check at all, and is
 * queued the same way: the first sweep after 0040 checks them, a hundred in each tenant at a time.
 *
 * But only so often: once a publication's checks have given up `CHECK_GIVE_UPS` times, the sweep
 * queues no more, and records that it left it (0041), so its page says it could not be checked rather
 * than that it is not checked yet. A check that can never succeed - a PDF that sends veraPDF past its
 * time every time - is tried nine times, not for ever.
 *
 * The queue is read by the worker's own role, which may, before the tenant's publications are: a
 * tenant's role may enqueue and never read the queue, and this widens neither. Read in that order, a
 * check that finishes between the two has recorded its row before its job was finished, so it is not
 * asked for again; and a publication recorded between them is under five minutes old. Two workers
 * sweeping at once may each queue one, which costs one check that finds it checked and asks veraPDF
 * nothing, and a give-up counted twice the next time.
 *
 * A tenant whose sweep fails is logged and passed over. Answers how many checks were queued, and how
 * many publications were left.
 */
export async function sweepUncheckedPublications(
  db: TenantDatabase,
  queue: Pick<JobQueue, 'waiting' | 'givenUp'>,
  log: WorkerLog,
  now: Date = new Date(),
): Promise<{ readonly queued: number; readonly left: number }> {
  let queued = 0;
  let left = 0;
  for (const tenant of await db.tenants()) {
    try {
      const waiting = await queue.waiting(tenant.id, 'check_pdf');
      const givenUp = await queue.givenUp(tenant.id, 'check_pdf');
      const swept = await db.withTenant(tenant, async (trx) => {
        const again = await publicationsToCheckAgain(trx, { now, waiting });
        const done = { queued: 0, left: 0 };
        for (const publication of again) {
          const giveUps = givenUp.get(publication) ?? 0;
          if (giveUps >= CHECK_GIVE_UPS) {
            await recordCheckGivenUp(trx, publication, giveUps);
            done.left += 1;
          } else {
            await enqueueJob(trx, 'check_pdf', publication);
            done.queued += 1;
          }
        }
        return done;
      });
      queued += swept.queued;
      left += swept.left;
      if (swept.left > 0) {
        log.warn(
          { tenant: tenant.id, left: swept.left },
          'left publications whose checks gave up every time',
        );
      }
    } catch (error) {
      log.error({ tenant: tenant.id, err: error }, 'the check sweep failed in a tenant');
    }
  }
  return { queued, left };
}

/**
 * The preview sweep (publishing.md, "Preview"; PV-F), in every tenant: each preview request finished
 * an hour ago or more is deleted, done or failed, by `sweepPreviews`, and once that has committed, the
 * PDF of each done one is removed from the tenant's store, unless something else still names its key.
 * Removed after the commit, so a sweep that fails part way removes nothing a request still names.
 *
 * A tenant whose sweep or store fails is logged and passed over, and the rest are swept: one tenant's
 * store being away is no reason to keep another's previews. A PDF whose removal fails, or whose
 * tenant's store cannot be reached once its request is gone, is left in the store, named by nothing,
 * and logged by its key, which is a hash and says nothing of the document.
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
      let store: TenantStore;
      try {
        store = await db.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
      } catch (error) {
        // The requests are gone, so nothing will name these keys again: said here, or never.
        log.error(
          { tenant: tenant.id, keys, err: error },
          "the swept previews' PDFs were not removed: the tenant's store was not reached",
        );
        continue;
      }
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
