import { createStewardDatabase, createTenantDatabase, createTenantMaker } from '@alloy-works/db';
import { sealingKey } from '@alloy-works/objects';
import { decodedSecret, runSteward } from './steward-commands.js';

/** The steward's command line: holds `STEWARD_DATABASE_URL`, which nothing else in the image reads. */
const url = process.env['STEWARD_DATABASE_URL'];
if (!url) throw new Error('STEWARD_DATABASE_URL is not set');
const db = createTenantDatabase(url);
const steward = createStewardDatabase(url);
const maker = createTenantMaker(url);
try {
  process.exitCode = await runSteward(process.argv.slice(2), {
    db,
    steward,
    maker,
    out: (line) => process.stdout.write(`${line}\n`),
    readSecret: async () => {
      // Typed at a terminal it would show, and stay on the screen.
      if (process.stdin.isTTY) return '';
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
      return decodedSecret(Buffer.concat(chunks));
    },
    key: () => {
      const held = process.env['SECRET_OBJECT_STORE_KEY'];
      if (!held) throw new Error('SECRET_OBJECT_STORE_KEY is not set');
      return sealingKey(held);
    },
  });
} finally {
  await maker.close();
  await steward.close();
  await db.close();
}
