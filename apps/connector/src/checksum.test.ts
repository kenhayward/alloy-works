import { describe, expect, it } from 'vitest';

import { childSpawn, createSupervisor } from './supervisor.js';
import {
  column,
  draft,
  PASSWORDS,
  runRequest,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';

/**
 * The checksum of case 6's three rows in canonical form version 1, as packages/domain's
 * `canonical.test.ts` pins it, computed there apart from the code that makes it.
 */
const CASE_6_CHECKSUM = '985fbb2b96898288bbcd686a7cc1cd452d8d1c15280184abcc86b8c2d9c043e2';

const typed = draft(
  'select k, dec, big, amount, d, ldt, inst, tm, flag, note, empty, txt from sample.typed order by k',
  [
    column('k', { base: 'integer' }),
    column('dec', { base: 'decimal', precision: 28, scale: 10 }),
    column('big', { base: 'integer' }),
    column('amount', { base: 'decimal', precision: 19, scale: 4 }),
    column('d', { base: 'date' }),
    column('ldt', { base: 'localDateTime', fraction: 6 }),
    column('inst', { base: 'instant', fraction: 6 }),
    column('tm', { base: 'time', fraction: 6 }),
    column('flag', { base: 'boolean' }),
    column('note', { base: 'text' }),
    column('empty', { base: 'text' }),
    column('txt', { base: 'text' }),
  ],
);

describe("a result's checksum", () => {
  it('one result reads to one checksum in every time zone', async () => {
    const checksums = await Promise.all(
      ['Pacific/Kiritimati', 'Europe/London', 'America/St_Johns'].map(async (zone) => {
        // A child whose own zone is this one: nothing of a value may pass through it.
        const supervisor = createSupervisor({
          sealingKey: SEALING_KEY,
          deny: suiteDeny,
          maxChildren: 1,
          spec: { ...childSpawn(suiteChild, suiteIsolation), env: { TZ: zone } },
        });
        const answer = await supervisor.run('run', runRequest(settings(), PASSWORDS.reader, typed));
        if (answer === 'busy' || answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
        expect(answer.result.rows[0]!.slice(5, 8), zone).toEqual([
          '2026-03-29T01:30:00.123456',
          '2026-03-29T00:30:00.123456Z',
          '23:59:59.999999',
        ]);
        return answer.checksum;
      }),
    );
    expect(checksums).toEqual([CASE_6_CHECKSUM, CASE_6_CHECKSUM, CASE_6_CHECKSUM]);
  });
});
