import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { childSpawn, createSupervisor } from './supervisor.js';
import { fakeSource, type AskedFor } from './testing/fake-postgres.js';
import {
  requestFor,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';

/** An invented password, which a source the connector should not trust asks for in a form it can read. */
const PASSWORD = 'fake-source-canary-password';

describe("the connector's authentication", () => {
  const supervisor = createSupervisor({
    sealingKey: SEALING_KEY,
    deny: suiteDeny,
    maxChildren: 8,
    spec: childSpawn(suiteChild, suiteIsolation),
  });

  it('never sends a password to a source that asks for it in the clear or as MD5, and answers connection_failed as for any failure to sign in', async () => {
    for (const asking of ['cleartext', 'md5'] as AskedFor[]) {
      const source = await fakeSource(asking);
      try {
        const answer = await supervisor.run(
          'test',
          requestFor(settings({ port: source.port, account: 'reader' }), PASSWORD),
        );
        expect(answer, asking).toEqual({
          outcome: 'failed',
          failure: { code: 'connection_failed', attribution: 'connector' },
        });
        // Nothing at all came back after the source asked: no password message, and so neither the
        // password nor its MD5 digest.
        const md5 = createHash('md5')
          .update(PASSWORD + 'reader')
          .digest('hex');
        expect(
          source.received.map((each) => each.type),
          asking,
        ).not.toContain('p');
        for (const { body } of source.received) {
          expect(body.includes(Buffer.from(PASSWORD)), asking).toBe(false);
          expect(body.includes(Buffer.from(md5)), asking).toBe(false);
        }
      } finally {
        await source.close();
      }
    }
  });
});
