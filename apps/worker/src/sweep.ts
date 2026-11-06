import {
  advanceClosure,
  archiveHeldElsewhere,
  expiredRestorationArchives,
  forgetRestorationArchive,
  restorationJobGaveUp,
  type Tenant,
  restoreUnderReview,
  CHECK_GIVE_UPS,
  enqueueJob,
  foldDigests,
  principalLabel,
  publicationsToCheckAgain,
  queueClosureReminders,
  rollUpMeasurements,
  recordEvent,
  recordCheckGivenUp,
  recordEffected,
  recordLapses,
  sweepIterations,
  sweepNotifications,
  sweepPresence,
  sweepPreviews,
  sweepQueryRuns,
  sweepRangePreviews,
  sweepAbandonedRuns,
  sweepQueryEmbeddings,
  sweepEmbeddingLag,
  sweepWebhookDeliveries,
  sweepMail,
  sweepImports,
  expireTenantExport,
  tenantExportsDue,
  type JobQueue,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores, TenantStore } from '@alloy-works/objects';
import { inEachTenant, PAUSED } from './background.js';
import type { WorkerLog } from './worker.js';

/** A restored tenant, whose dates and reminders wait until someone has looked (EI-M). */
const held = (db: TenantDatabase, tenant: Tenant) =>
  db.withTenant(tenant, (trx) => restoreUnderReview(trx));

/**
 * Which sweeps a restored tenant holds, and which run regardless, because what they tidy cannot surprise
 * anyone: a sweep added must say which it is (the EI plan, EI-M).
 */
export const SWEEPS_UNDER_REVIEW = {
  held: [
    'foldNotificationDigests',
    'sweepDates',
    'sweepExpiredIterations',
    'sweepOldNotifications',
    'sweepUncheckedPublications',
  ],
  running: [
    'sweepAbandonedGenerationRuns',
    'sweepEmbeddingLagEverywhere',
    'sweepExpiredPreviews',
    'sweepExpiredQueryRuns',
    'sweepExpiredRangePreviews',
    'sweepExpiredSignIns',
    'sweepExpiredTenantExports',
    'sweepImportsEverywhere',
    'sweepClosures',
    'sweepQueryEmbeddingsEverywhere',
    'sweepRestorations',
    'sweepStalePresence',
    'sweepWebhookDeliveriesEverywhere',
    'sweepMailEverywhere',
    'sweepMeasurementsEverywhere',
  ],
} as const;

/**
 * Which sweeps run in a tenant that is not active (ADM-045; tenant-lifecycle.md, TL-C). None yet, since
 * a suspended tenant's dates and retention wait for the suspension to lift: a sweep added must say.
 */
export const SWEEPS_BY_STATE: {
  readonly activeOnly: readonly string[];
  readonly anyState: readonly string[];
} = {
  activeOnly: [...SWEEPS_UNDER_REVIEW.held, ...SWEEPS_UNDER_REVIEW.running].filter(
    (sweep) => sweep !== 'sweepClosures',
  ),
  anyState: ['sweepClosures'],
};

/**
 * What sign-ins leave behind: attempts and hand-offs nobody came back for, and sessions past their
 * last hour. All are refused once expired; this is what stops the rows accumulating for ever. Each
 * session ended is a sign-out by the system (IAM-013; the AU1 plan, AU1-F), recorded in the
 * transaction that removes it, with when it expired.
 */
export async function sweepExpiredSignIns(
  db: TenantDatabase,
  now: Date = new Date(),
  // A tenant failing is recorded as its background work, logged only when a log is given.
  log: WorkerLog = { info() {}, warn() {}, error() {} },
): Promise<number> {
  let removed = 0;
  await inEachTenant(db, log, 'sweepExpiredSignIns', async (tenant) => {
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
          // Nobody erased is named (the ER plan, ER-D).
          const label = await principalLabel(trx, 'subject', session.principal_id);
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
  });
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
  await inEachTenant(db, log, 'sweepExpiredIterations', async (tenant) => {
    if (await held(db, tenant)) return PAUSED;
    removed += await db.withTenant(tenant, (trx) => sweepIterations(trx));
  });
  return removed;
}

/** Query runs past their 13 months, in every tenant (the R18 plan, R18-D). */
export async function sweepExpiredQueryRuns(db: TenantDatabase, log: WorkerLog): Promise<number> {
  let removed = 0;
  await inEachTenant(db, log, 'sweepExpiredQueryRuns', async (tenant) => {
    removed += await db.withTenant(tenant, (trx) => sweepQueryRuns(trx));
  });
  return removed;
}

/** Range previews an hour past their last change, in every tenant, with their pages (the R22 plan). */
export async function sweepExpiredRangePreviews(
  db: TenantDatabase,
  log: WorkerLog,
): Promise<number> {
  let removed = 0;
  await inEachTenant(db, log, 'sweepExpiredRangePreviews', async (tenant) => {
    removed += await db.withTenant(tenant, (trx) => sweepRangePreviews(trx));
  });
  return removed;
}

/**
 * Runs of a model left running an hour, in every tenant, ended `abandoned` (the G2 plan, G2-B): their
 * service went away mid-run, and its steps so far stay on them.
 */
export async function sweepAbandonedGenerationRuns(
  db: TenantDatabase,
  log: WorkerLog,
): Promise<number> {
  let ended = 0;
  await inEachTenant(db, log, 'sweepAbandonedGenerationRuns', async (tenant) => {
    ended += await db.withTenant(tenant, (trx) => sweepAbandonedRuns(trx));
  });
  return ended;
}

/** A searcher's query vectors a day old and more, in every tenant (the G7 plan, G7-G). */
export async function sweepQueryEmbeddingsEverywhere(
  db: TenantDatabase,
  log: WorkerLog,
): Promise<number> {
  let removed = 0;
  await inEachTenant(db, log, 'sweepQueryEmbeddingsEverywhere', async (tenant) => {
    removed += await db.withTenant(tenant, (trx) => sweepQueryEmbeddings(trx));
  });
  return removed;
}

/** Meaning's lag measured 30 days ago and more, in every tenant (the FR plan, FR-E). */
export async function sweepEmbeddingLagEverywhere(
  db: TenantDatabase,
  log: WorkerLog,
): Promise<number> {
  let removed = 0;
  await inEachTenant(db, log, 'sweepEmbeddingLagEverywhere', async (tenant) => {
    removed += await db.withTenant(tenant, (trx) => sweepEmbeddingLag(trx));
  });
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
  await inEachTenant(db, log, 'sweepUncheckedPublications', async (tenant) => {
    if (await held(db, tenant)) return PAUSED;
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
  });
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
  await inEachTenant(db, log, 'sweepExpiredPreviews', async (tenant) => {
    const keys = await db.withTenant(tenant, (trx) => sweepPreviews(trx));
    if (keys.length === 0) return PAUSED;
    let store: TenantStore;
    try {
      store = await db.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    } catch (error) {
      // The requests are gone, so nothing will name these keys again: said here, or never.
      log.error(
        { tenant: tenant.id, keys, err: error },
        "the swept previews' PDFs were not removed: the tenant's store was not reached",
      );
      return PAUSED;
    }
    for (const key of keys) {
      try {
        await store.remove(key);
        removed += 1;
      } catch (error) {
        log.error({ tenant: tenant.id, key, err: error }, "a swept preview's PDF was not removed");
      }
    }
  });
  return removed;
}

/**
 * Presence past a minute, in every tenant (the PL plan, PL-C): tidying, since no stream shows a row
 * that old already; each row removed says so to the document's streams. Answers how many.
 */
export async function sweepStalePresence(db: TenantDatabase, log: WorkerLog): Promise<number> {
  let removed = 0;
  await inEachTenant(db, log, 'sweepStalePresence', async (tenant) => {
    removed += await db.withTenant(tenant, (trx) => sweepPresence(trx));
  });
  return removed;
}

/**
 * The inbox's daily digests (COL-035; the TH plan, TH-F), in every tenant: what each person has held
 * from before the latest 07:00 UTC, folded into one notification each, readability decided again.
 * Every tick asks; only the first after a boundary finds anything.
 */
export async function foldNotificationDigests(
  db: TenantDatabase,
  log: WorkerLog,
  now: Date = new Date(),
): Promise<number> {
  let made = 0;
  await inEachTenant(db, log, 'foldNotificationDigests', async (tenant) => {
    if (await held(db, tenant)) return PAUSED;
    made += await db.withTenant(tenant, (trx) => foldDigests(trx, now));
  });
  return made;
}

/**
 * Dates (the WF5 plan, WF5-D, WF5-G), in every tenant, as the system: each revision approved to take
 * effect later whose instant has passed recorded as taking effect (LIF-060), and each review date
 * passed unmet acted on as its workflow declares (LIF-059). Each tenant in its own transaction.
 */
export async function sweepDates(
  db: TenantDatabase,
  log: WorkerLog,
  now: Date = new Date(),
): Promise<{ readonly effected: number; readonly lapsed: number }> {
  let effected = 0;
  let lapsed = 0;
  await inEachTenant(db, log, 'sweepDates', async (tenant) => {
    if (await held(db, tenant)) return PAUSED;
    const done = await db.withTenant(
      tenant,
      async (trx) => ({
        effected: await recordEffected(trx, now),
        lapsed: await recordLapses(trx, now),
      }),
      { actorKind: 'system' },
    );
    effected += done.effected;
    lapsed += done.lapsed;
  });
  return { effected, lapsed };
}

/** Notifications past their 90 days (COL-062), in every tenant. */
export async function sweepOldNotifications(
  db: TenantDatabase,
  log: WorkerLog,
  now: Date = new Date(),
): Promise<number> {
  let removed = 0;
  await inEachTenant(db, log, 'sweepOldNotifications', async (tenant) => {
    if (await held(db, tenant)) return PAUSED;
    removed += await db.withTenant(tenant, (trx) => sweepNotifications(trx, now));
  });
  return removed;
}

/**
 * What restoring leaves behind, in every tenant: each uploaded archive past its seven days (IMP-044),
 * and each restoration whose job gave up where nobody could say so (the EI plan, EIc).
 */
export async function sweepClosures(db: TenantDatabase, log: WorkerLog): Promise<number> {
  let moved = 0;
  await inEachTenant(
    db,
    log,
    'sweepClosures',
    async (tenant) => {
      // The notice 7 days before the grace ends, in its own transaction, once to each (EM-V).
      await db.withTenant(tenant, (trx) => queueClosureReminders(trx), { actorKind: 'system' });
      const state = await db.withTenant(tenant, (trx) => advanceClosure(trx, tenant), {
        actorKind: 'system',
      });
      if (state === 'deleting') {
        moved += 1;
        log.info({ tenant: tenant.id }, 'a closed tenant has begun to be deleted');
      }
    },
    await db.closingTenants(),
  );
  return moved;
}

export async function sweepRestorations(
  db: TenantDatabase,
  stores: ObjectStores,
  queue: Pick<JobQueue, 'givenUp'>,
  log: WorkerLog,
  now: Date = new Date(),
): Promise<number> {
  let removed = 0;
  await inEachTenant(db, log, 'sweepRestorations', async (tenant) => {
    const gaveUp = await queue.givenUp(tenant.id, 'restoration');
    const { store, expired } = await db.withTenant(tenant, async (trx) => {
      for (const id of gaveUp.keys()) await restorationJobGaveUp(trx, id);
      return {
        store: await stores.forTenant(trx, tenant),
        expired: await expiredRestorationArchives(trx, now),
      };
    });
    for (const { id, key, sha256 } of expired) {
      await db.withTenant(tenant, async (trx) => {
        const elsewhere = await archiveHeldElsewhere(trx, { key, sha256 }, { restoration: id });
        if (!elsewhere) await store.remove(key);
        await forgetRestorationArchive(trx, id);
      });
      removed += 1;
    }
  });
  return removed;
}

/**
 * Tenant exports written more than seven days ago, in every tenant, and their archives (the R21 plan,
 * R21-B): each archive removed first, then its export marked `expired`, so one a removal missed is
 * named still and swept again; each row kept, so the list of past exports says it was made.
 */
export async function sweepExpiredTenantExports(
  db: TenantDatabase,
  stores: ObjectStores,
  log: WorkerLog,
  now: Date = new Date(),
): Promise<number> {
  let removed = 0;
  await inEachTenant(db, log, 'sweepExpiredTenantExports', async (tenant) => {
    const due = await db.withTenant(tenant, (trx) => tenantExportsDue(trx, now));
    if (due.length === 0) return PAUSED;
    const store = await db.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    for (const { id, key } of due) {
      try {
        await db.withTenant(tenant, async (trx) => {
          // An archive may be waiting to come back in, by the same key.
          const sha256 = key.slice(key.lastIndexOf('/') + 1);
          const elsewhere = await archiveHeldElsewhere(trx, { key, sha256 }, { tenantExport: id });
          if (!elsewhere) await store.remove(key);
        });
        await db.withTenant(tenant, (trx) => expireTenantExport(trx, id));
        removed += 1;
      } catch (error) {
        log.error(
          { tenant: tenant.id, key, err: error },
          "an expired export's archive was not removed",
        );
      }
    }
  });
  return removed;
}

/** Webhook deliveries done with, and their attempts, past 30 days, in every tenant (WB-I). */
export async function sweepWebhookDeliveriesEverywhere(
  db: TenantDatabase,
  log: WorkerLog,
): Promise<number> {
  let removed = 0;
  await inEachTenant(db, log, 'sweepWebhookDeliveriesEverywhere', async (tenant) => {
    removed += await db.withTenant(tenant, (trx) => sweepWebhookDeliveries(trx));
  });
  return removed;
}

/** Mail done with, and its attempts, past 30 days, in every tenant (the EM plan, EM-M). */
export async function sweepMailEverywhere(db: TenantDatabase, log: WorkerLog): Promise<number> {
  let removed = 0;
  await inEachTenant(db, log, 'sweepMailEverywhere', async (tenant) => {
    removed += await db.withTenant(tenant, (trx) => sweepMail(trx));
  });
  return removed;
}

/**
 * Measurements rolled up, in every live tenant (the DG plan, DG-B): minutes past 7 days into hours,
 * hours past 90 into days, days past 13 months gone. A suspended tenant's wait for it to lift.
 */
export async function sweepMeasurementsEverywhere(
  db: TenantDatabase,
  log: WorkerLog,
): Promise<number> {
  let rolled = 0;
  await inEachTenant(db, log, 'sweepMeasurementsEverywhere', async (tenant) => {
    rolled += await db.withTenant(tenant, (trx) => rollUpMeasurements(trx));
  });
  return rolled;
}

/**
 * Proposals left alone, in every tenant (the IM plan, IM-F): each importer told seven days before, and
 * each abandoned at 30 days as the system, its file removed from the store in the same transaction.
 */
export async function sweepImportsEverywhere(
  db: TenantDatabase,
  stores: ObjectStores,
  log: WorkerLog,
): Promise<{ readonly warned: number; readonly swept: number }> {
  let warned = 0;
  let swept = 0;
  await inEachTenant(db, log, 'sweepImportsEverywhere', async (tenant) => {
    const done = await db.withTenant(
      tenant,
      async (trx) => {
        const store = await stores.forTenant(trx, tenant);
        return sweepImports(trx, (key) => store.remove(key));
      },
      { actorKind: 'system' },
    );
    warned += done.warned;
    swept += done.swept;
  });
  return { warned, swept };
}
