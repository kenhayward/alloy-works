// The process: read the configuration, wait for work, and stop cleanly. Everything it decides lives
// in modules with tests of their own; this file only wires them and loops.
import { createJobQueue, createTenantDatabase, JOB_CHANNEL } from '@alloy-works/db';
import { createObjectStores } from '@alloy-works/objects';
import pg from 'pg';
import pino from 'pino';
import { describeWorkerConfig, loadWorkerConfig } from './config.js';
import { loadPinnedFonts, PINNED_FONT_FILES } from './fonts.js';
import { checkJob } from './jobs/check.js';
import { ingestJob } from './jobs/ingest.js';
import { publishJob } from './jobs/publish.js';
import { sampleJob } from './jobs/sample.js';
import {
  sweepExpiredIterations,
  sweepExpiredPreviews,
  sweepExpiredSignIns,
  sweepUncheckedPublications,
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
const handlers: Record<string, JobHandler> = {
  sample_pdf: sampleJob({ db, stores, typst }),
  publish,
  preview: publish,
  ingest: ingestJob({ db, stores }),
  check_pdf: checkJob({ db, stores, checker }),
};

// A connection of its own, held open: NOTIFY wakes the worker between polls.
const listener = new pg.Client({ connectionString: config.databaseUrl });
await listener.connect();
await listener.query(`listen ${JOB_CHANNEL}`);
let wake: () => void = () => {};
listener.on('notification', () => wake());

let running = true;
const sweep = setInterval(() => {
  void sweepExpiredSignIns(db)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept expired sign-ins'))
    .catch((error: unknown) => log.error({ err: error }, 'sweep failed'));
  // Previews an hour after they finished, in every tenant, and their PDFs (W10.2, PV-F).
  void sweepExpiredPreviews(db, stores, log)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept expired previews'))
    .catch((error: unknown) => log.error({ err: error }, 'preview sweep failed'));
  // Iterations past the tenant's window after the next cut, in every tenant (W11.1, VER-003).
  void sweepExpiredIterations(db, log)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept expired iterations'))
    .catch((error: unknown) => log.error({ err: error }, 'iteration sweep failed'));
  // Checks that gave up, five minutes after their publication was recorded, queued again, and those
  // that gave up three times left (W14.1).
  void sweepUncheckedPublications(db, queue, log)
    .then(
      ({ queued }) =>
        queued > 0 && log.warn({ queued }, 'queued checks that had given up or never ran'),
    )
    .catch((error: unknown) => log.error({ err: error }, 'check sweep failed'));
}, config.sweepIntervalMs);

const stop = async (signal: string) => {
  running = false;
  wake();
  clearInterval(sweep);
  log.info({ signal }, 'stopping');
  await listener.end();
  await checker.close();
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
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, config.pollIntervalMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
