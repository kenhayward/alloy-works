// The process: read the configuration, wait for work, and stop cleanly. Everything it decides lives
// in modules with tests of their own; this file only wires them and loops.
import {
  createDeliveredStore,
  createJobQueue,
  createTenantDatabase,
  JOB_CHANNEL,
} from '@alloy-works/db';
import { createObjectStores } from '@alloy-works/objects';
import pg from 'pg';
import pino from 'pino';
import { describeWorkerConfig, loadWorkerConfig } from './config.js';
import { loadPinnedFonts, PINNED_FONT_FILES } from './fonts.js';
import { auditExportJob } from './jobs/audit-export.js';
import { bridgeDeliverJob } from './jobs/bridge-deliver.js';
import { tenantExportJob } from './jobs/tenant-export.js';
import { createWarmPool, rangePreviewJob } from './jobs/range-preview.js';
import { impactReportJob } from './jobs/impact-report.js';
import { cohortJob } from './jobs/cohort.js';
import { embedJob } from './jobs/embed.js';
import { importJob } from './jobs/import.js';
import { translationReturnJob } from './jobs/translation-return.js';
import { connectorDeliverer } from './deliverer.js';
import { nightDue, recheckEntries } from './rechecks.js';
import { connectorReferencer } from './referencer.js';
import { connectorEmbedder } from './embedder.js';
import { deliverWebhooks } from './webhooks.js';
import { checkJob } from './jobs/check.js';
import { deriveJob } from './jobs/derive.js';
import { ingestJob } from './jobs/ingest.js';
import { publishJob } from './jobs/publish.js';
import { sampleJob } from './jobs/sample.js';
import {
  foldNotificationDigests,
  sweepExpiredIterations,
  sweepExpiredQueryRuns,
  sweepExpiredPreviews,
  sweepExpiredTenantExports,
  sweepExpiredRangePreviews,
  sweepAbandonedGenerationRuns,
  sweepQueryEmbeddingsEverywhere,
  sweepEmbeddingLagEverywhere,
  sweepExpiredSignIns,
  sweepOldNotifications,
  sweepDates,
  sweepStalePresence,
  sweepUncheckedPublications,
  sweepWebhookDeliveriesEverywhere,
  sweepImportsEverywhere,
} from './sweep.js';
import { createTypst } from './typst.js';
import { removeStaleVeraPdfDirectories, startLocalVeraPdf, veraPdfTimeouts } from './verapdf.js';
import { processNext, type JobHandler } from './worker.js';

const config = loadWorkerConfig(process.env);
const log = pino({ level: config.logLevel });
// The pinned faces, checked before anything else: with none, Typst would compile blank pages (#145).
const fonts = await loadPinnedFonts();
const db = createTenantDatabase(config.databaseUrl);
const queue = createJobQueue(config.databaseUrl);
const stores = createObjectStores(config.objectStore, config.objectStoreKey);
const typst = createTypst({ binary: config.typstBinary, fonts });
// A preview is the publish handler's too, which reads which it is from the request (W10.1).
const publish = publishJob({ db, stores, typst, fonts });
// What a veraPDF of a worker that died left in the temporary directory, removed before this one's;
// a directory that will not go is no reason not to start.
const stale = await removeStaleVeraPdfDirectories().catch((error: unknown) => {
  log.warn({ err: error }, "a gone worker's veraPDF directories were not removed");
  return 0;
});
if (stale > 0) log.info({ removed: stale }, "removed a gone worker's veraPDF directories");
// One veraPDF for this worker, started on the first check and kept warm (W14.1, W-A), with little of
// this process's environment and none of its secrets, and waiting a third of the lease each for its
// start and for a check, so a check never outlives its job's lease.
const checker = startLocalVeraPdf({
  command: config.verapdfCommand,
  ...(config.verapdfJavaOptions === undefined ? {} : { javaOptions: config.verapdfJavaOptions }),
  ...veraPdfTimeouts(config.leaseMs),
});
// The warm range previews this worker holds between refreshes (the R22 plan, R22-B).
const warmPool = createWarmPool();
// Embedding through the connector's embed route alone (the G7 plan, G7-E); none configured, none.
const embedder =
  config.connector?.embedKey === undefined
    ? undefined
    : connectorEmbedder({ url: config.connector.url, key: config.connector.embedKey });
// Webhook delivery through the connector's deliver route alone (the WB plan, WB-F).
const deliverer =
  config.connector?.deliverKey === undefined
    ? undefined
    : connectorDeliverer({ url: config.connector.url, key: config.connector.deliverKey });
// Re-checks through the connector's reference route alone (the XR plan, XR-E).
const referencer =
  config.connector?.referenceKey === undefined
    ? undefined
    : connectorReferencer({ url: config.connector.url, key: config.connector.referenceKey });
// The delivery store CT Studio's data packages are written to; none configured, none (the CS plan).
const delivered =
  config.deliveredUrl === undefined ? undefined : createDeliveredStore(config.deliveredUrl);
const bridgeDeliver = bridgeDeliverJob({
  db,
  stores,
  log,
  ...(delivered === undefined ? {} : { delivered }),
});
/** A returned file read within a third of the lease, as an import's is. */
const returnBudget = { timeMs: config.leaseMs / 3, memoryMb: 512 };

const handlers: Record<string, JobHandler> = {
  sample_pdf: sampleJob({ db, stores, typst }),
  publish,
  preview: publish,
  ingest: ingestJob({ db, stores }),
  derive: deriveJob({ db, stores }),
  check_pdf: checkJob({ db, stores, checker }),
  audit_export: auditExportJob({ db, stores }),
  impact_report: impactReportJob({ db, stores }),
  cohort: cohortJob({ db, stores }),
  tenant_export: tenantExportJob({ db, stores }),
  range: rangePreviewJob({ db, stores, fonts, binary: config.typstBinary, pool: warmPool }),
  embed: embedJob({ db, embedder }),
  // A read within a third of the lease, in a thread of its own (the IM plan, IM-C).
  import: importJob({ db, stores, budget: { timeMs: config.leaseMs / 3, memoryMb: 512 } }),
  // A translation job's returned file, read as an import's is (the XL plan, XL-F).
  translation_return: translationReturnJob({ db, stores, budget: returnBudget }),
  // A delivery CT Studio's bridge asked for, written end to end (the CS plan, Task 10).
  bridge_deliver: bridgeDeliver,
};

// A connection of its own, held open: NOTIFY wakes the worker between polls.
const listener = new pg.Client({ connectionString: config.databaseUrl });
await listener.connect();
await listener.query(`listen ${JOB_CHANNEL}`);
let wake: () => void = () => {};
listener.on('notification', () => wake());

let running = true;
let sweepingNonces = false;
const sweep = setInterval(() => {
  void sweepExpiredSignIns(db)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept expired sign-ins'))
    .catch((error: unknown) => log.error({ err: error }, 'sweep failed'));
  // Previews an hour after they finished, in every tenant, and their PDFs (W10.2, PV-F).
  void sweepExpiredPreviews(db, stores, log)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept expired previews'))
    .catch((error: unknown) => log.error({ err: error }, 'preview sweep failed'));
  // Range previews an hour past their last change (the R22 plan, R22-B).
  void sweepExpiredRangePreviews(db, log)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept range previews'))
    .catch((error: unknown) => log.error({ err: error }, 'range preview sweep failed'));
  // A searcher's query vectors a day old (the G7 plan, G7-G).
  void sweepQueryEmbeddingsEverywhere(db, log)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept old query vectors'))
    .catch((error: unknown) => log.error({ err: error }, 'sweep failed'));
  // Meaning's lag past 30 days (the FR plan, FR-E).
  void sweepEmbeddingLagEverywhere(db, log)
    .then((removed) => removed > 0 && log.info({ removed }, "swept meaning's old lag"))
    .catch((error: unknown) => log.error({ err: error }, "meaning's lag sweep failed"));
  // Model runs left running an hour, ended abandoned (the G2 plan, G2-B).
  void sweepAbandonedGenerationRuns(db, log)
    .then((ended) => ended > 0 && log.info({ ended }, 'ended abandoned runs'))
    .catch((error: unknown) => log.error({ err: error }, 'abandoned run sweep failed'));
  // Tenant exports seven days after they were written, and their archives (the R21 plan, R21-B).
  void sweepExpiredTenantExports(db, stores, log)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept expired exports'))
    .catch((error: unknown) => log.error({ err: error }, 'export sweep failed'));
  // Presence past a minute, which no stream shows already (the PL plan, PL-C).
  void sweepStalePresence(db, log)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept stale presence'))
    .catch((error: unknown) => log.error({ err: error }, 'presence sweep failed'));
  // Iterations past the tenant's window after the next cut, in every tenant (W11.1, VER-003).
  void sweepExpiredIterations(db, log)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept expired iterations'))
    .catch((error: unknown) => log.error({ err: error }, 'iteration sweep failed'));
  // Query runs past their 13 months (the R18 plan, R18-D).
  void sweepExpiredQueryRuns(db, log)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept query runs'))
    .catch((error: unknown) => log.error({ err: error }, 'query run sweep failed'));
  // The inbox's daily digests, after 07:00 UTC, and notifications past 90 days (the TH plan, TH-F, TH-H).
  void foldNotificationDigests(db, log)
    .then((made) => made > 0 && log.info({ made }, 'folded inbox digests'))
    .catch((error: unknown) => log.error({ err: error }, 'digest fold failed'));
  // Revisions taking effect and reviews lapsing, as the system (the WF5 plan, WF5-D, WF5-G).
  void sweepDates(db, log)
    .then(
      ({ effected, lapsed }) =>
        effected + lapsed > 0 && log.info({ effected, lapsed }, 'swept dates'),
    )
    .catch((error: unknown) => log.error({ err: error }, 'dates sweep failed'));
  void sweepOldNotifications(db, log)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept old notifications'))
    .catch((error: unknown) => log.error({ err: error }, 'notification sweep failed'));
  // Checks that gave up, five minutes after their publication was recorded, queued again, and those
  // that gave up three times left (W14.1).
  void sweepUncheckedPublications(db, queue, log)
    .then(
      ({ queued }) =>
        queued > 0 && log.warn({ queued }, 'queued checks that had given up or never ran'),
    )
    .catch((error: unknown) => log.error({ err: error }, 'check sweep failed'));
  // Proposals left alone: told at 23 days, abandoned at 30 (the IM plan, IM-F).
  void sweepImportsEverywhere(db, stores, log)
    .then(({ warned, swept }) => warned + swept > 0 && log.info({ warned, swept }, 'swept imports'))
    .catch((error: unknown) => log.error({ err: error }, 'import sweep failed'));
  // Webhook deliveries done with, past 30 days (the WB plan, WB-I).
  void sweepWebhookDeliveriesEverywhere(db, log)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept old webhook deliveries'))
    .catch((error: unknown) => log.error({ err: error }, 'webhook delivery sweep failed'));
}, config.sweepIntervalMs);

// The nightly re-check of cited entries against their sources, never overlapping itself (XR-E).
let checking = false;
let checkedNight: Date | undefined;
const rechecks = setInterval(() => {
  const now = new Date();
  if (referencer === undefined || checking || !nightDue(checkedNight, now)) return;
  checking = true;
  checkedNight = now;
  void recheckEntries(db, referencer, log)
    .then((recorded) => recorded > 0 && log.info({ recorded }, 're-checked cited entries'))
    .catch((error: unknown) => log.error({ err: error }, 'the re-check failed'))
    .finally(() => {
      checking = false;
    });
}, config.sweepIntervalMs);

// The webhook delivery loop, on its own interval and never overlapping itself (the WB plan, WB-I).
let delivering = false;
const deliveries = setInterval(() => {
  if (deliverer === undefined || delivering) return;
  delivering = true;
  void deliverWebhooks(db, deliverer, log)
    .catch((error: unknown) => log.error({ err: error }, 'webhook delivery failed'))
    .finally(() => {
      delivering = false;
    });
}, config.deliverIntervalMs);

const stop = async (signal: string) => {
  running = false;
  wake();
  clearInterval(sweep);
  clearInterval(deliveries);
  clearInterval(rechecks);
  log.info({ signal }, 'stopping');
  await listener.end();
  await checker.close();
  await warmPool.close();
  await delivered?.close();
  await queue.close();
  await db.close();
};
process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

log.info(
  {
    config: describeWorkerConfig(config),
    typst: await typst.version(),
    fonts: PINNED_FONT_FILES.map((each) => each.file),
  },
  'starting',
);
while (running) {
  const outcome = await processNext({
    queue,
    db,
    handlers,
    workerId: config.workerId,
    leaseMs: config.leaseMs,
    log,
  }).catch((error: unknown) => {
    log.error({ err: error }, 'the worker could not take a job');
    return 'idle' as const;
  });
  if (outcome === 'idle' && running) {
    // The bridge's nonces past the signing window, while there is nothing else to do (API-066),
    // never two sweeps at once.
    if (!sweepingNonces) {
      sweepingNonces = true;
      void queue
        .sweepBridgeNonces()
        .catch((error: unknown) => log.error({ err: error }, 'nonce sweep failed'))
        .finally(() => {
          sweepingNonces = false;
        });
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, config.pollIntervalMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
