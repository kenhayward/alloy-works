import { createStewardDatabase, createTenantDatabase } from '@alloy-works/db';
import { runSteward } from './steward-commands.js';

/** The steward's command line: holds `STEWARD_DATABASE_URL`, which nothing else in the image reads. */
const url = process.env['STEWARD_DATABASE_URL'];
if (!url) throw new Error('STEWARD_DATABASE_URL is not set');
const db = createTenantDatabase(url);
const steward = createStewardDatabase(url);
try {
  process.exitCode = await runSteward(process.argv.slice(2), {
    db,
    steward,
    out: (line) => process.stdout.write(`${line}\n`),
  });
} finally {
  await steward.close();
  await db.close();
}
