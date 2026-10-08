import { fileURLToPath, pathToFileURL } from 'node:url';

import type { RunAnswer, RunRequest } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { childSpawn, createSupervisor, runChild, type SpawnChild } from './supervisor.js';
import {
  asSuperuser,
  column,
  draft,
  PASSWORDS,
  runRequest,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
  LOADED_TIMEOUT_MS,
} from './testing/source.js';

const supervisor = createSupervisor({
  sealingKey: SEALING_KEY,
  deny: suiteDeny,
  maxChildren: 8,
  spec: childSpawn(suiteChild, suiteIsolation),
});

const run = async (request: RunRequest): Promise<RunAnswer> => {
  const answer = await supervisor.run('run', request);
  if (answer === 'busy') throw new Error('busy');
  return answer;
};

const id = column('id', { base: 'integer' });

const asReader = (
  text: string,
  columns = [id],
  limits: { rows?: number; bytes?: number; seconds?: number } = {},
) => run(runRequest(settings(), PASSWORDS.reader, draft(text, columns), {}, { limits }));

/** The backends still at the source, from another session, whose query holds this marker. */
const backends = (marker: string) =>
  asSuperuser((client) =>
    client
      .query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
          where pid <> pg_backend_pid() and query like '%' || $1 || '%'`,
        [marker],
      )
      .then((result) => result.rows[0]!.n),
  );

/** How long, up to a second and a half, until no backend holds the marker: at the most, 1,500. */
async function goneWithin(marker: string): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < 1500) {
    if ((await backends(marker)) === 0) return Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return 1500;
}

describe("a run's limits", { timeout: LOADED_TIMEOUT_MS }, () => {
  it('DAT-051 DAT-045 fails a run past its row, byte or time limit by name and answers no rows', async () => {
    const failed = (code: string, attribution = 'query') => ({
      outcome: 'failed',
      failure: { code, attribution },
    });
    // Rows: one past the limit fails, and the limit itself does not.
    expect(
      await asReader('select g as id from generate_series(1, 1000) g', [id], { rows: 100 }),
    ).toEqual(failed('row_limit'));
    expect(
      await asReader('select g as id from generate_series(1, 101) g', [id], { rows: 100 }),
    ).toEqual(failed('row_limit'));
    expect(
      await asReader('select g as id from generate_series(1, 100) g', [id], { rows: 100 }),
    ).toMatchObject({ outcome: 'ok', rowCount: 100 });
    // Bytes, as they arrive from the source.
    const pad = column('pad', { base: 'text' });
    expect(
      await asReader(
        `select g as id, repeat('x', 1000) as pad from generate_series(1, 10000) g`,
        [id, pad],
        { bytes: 100_000 },
      ),
    ).toEqual(failed('byte_limit'));
    // And as they are kept: a quote arrives as one byte and is kept as two.
    expect(
      await asReader(`select 1 as id, repeat('"', 60000) as pad`, [id, pad], { bytes: 100_000 }),
    ).toEqual(failed('byte_limit'));
    expect(
      await asReader(`select 1 as id, repeat('"', 40000) as pad`, [id, pad], { bytes: 100_000 }),
    ).toMatchObject({ outcome: 'ok', rowCount: 1 });
    // Time: the deadline over the whole run.
    expect(await asReader('select 1 as id from pg_sleep(5)', [id], { seconds: 1 })).toEqual(
      failed('timeout', 'connector'),
    );
  });

  it('DAT-109 cancels the statement at the source when a limit or the deadline is reached', async () => {
    const cases = [
      ['dat109-sleep', 'select 1 as id from pg_sleep(20)', { seconds: 2 }, 'timeout'],
      [
        'dat109-sum',
        'select sum(g)::int8 as id from generate_series(1, 50000000000) g',
        { seconds: 2 },
        'timeout',
      ],
      [
        'dat109-rows',
        // In the select list, where a set-returning function streams its rows, and never in FROM,
        // where it would compute every one of them first.
        'select generate_series(1, 1000000000000) as id',
        { rows: 1000 },
        'row_limit',
      ],
      [
        // The author's own SQL turns off the source's check that its client is gone: a limit still
        // stops the statement, because the child cancels it rather than trusting the check.
        'dat109-unchecked',
        `select g::int8 as id, repeat('x', 1000) as pad from generate_series(1, 5000) g
          where set_config('client_connection_check_interval', '0', false) is not null
            and (g <= 100 or pg_sleep(20) is not null)`,
        { bytes: 50_000 },
        'byte_limit',
      ],
      [
        // And the statement timeout too, which the source re-arms at each page it is asked for: the
        // deadline still stops the statement, by the child's own timer and its cancel.
        'dat109-untimed',
        `select g::int8 as id, '' as pad from generate_series(1, 100000) g
          where set_config('client_connection_check_interval', '0', false) is not null
            and set_config('statement_timeout', '0', false) is not null
            and (g <= 600 or pg_sleep(20) is not null)`,
        { seconds: 2 },
        'timeout',
      ],
    ] as const;
    const pad = column('pad', { base: 'text' });
    for (const [marker, text, limits, code] of cases) {
      const columns = text.includes(' as pad ') ? [id, pad] : [id];
      const answer = await asReader(`${text} /* ${marker} */`, columns, limits);
      expect(answer, marker).toMatchObject({ outcome: 'failed', failure: { code } });
      expect(await goneWithin(marker), marker).toBeLessThan(1000);
    }

    // A child slow to start still reaches its deadline, and cancels, before the supervisor kills it
    // a second after: its deadline runs from when its process started, not from when it was ready.
    const slow = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 1,
      spec: childSpawn(
        {
          path: suiteChild.path,
          execArgv: [
            ...suiteChild.execArgv,
            '--import',
            pathToFileURL(fileURLToPath(new URL('./testing/slow-start.ts', import.meta.url))).href,
          ],
        },
        suiteIsolation,
      ),
    });
    const [, text, limits] = cases.find(([marker]) => marker === 'dat109-untimed')!;
    const started = Date.now();
    const answer = await slow.run(
      'run',
      runRequest(
        settings(),
        PASSWORDS.reader,
        draft(`${text} /* dat109-slow */`, [id, pad]),
        {},
        { limits },
      ),
    );
    expect(answer).toMatchObject({ outcome: 'failed', failure: { code: 'timeout' } });
    // Not vacuous: the child was slow to start, and still answered before the kill.
    expect(Date.now() - started).toBeGreaterThan(1500);
    expect(await goneWithin('dat109-slow')).toBeLessThan(1000);
  });

  it('DAT-110 fails a run whose single value is larger than the byte limit, byte_limit, with the child holding no more than the limit', async () => {
    const peaks: number[] = [];
    const measuring: SpawnChild = (spec, input, deadlineMs) =>
      runChild(spec, input, deadlineMs, (chunk) => {
        const line = /\{"peakBytes":(\d+)\}/.exec(chunk.toString('utf8'));
        if (line) peaks.push(Number(line[1]));
      });
    const measured = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 1,
      spec: childSpawn(
        {
          path: fileURLToPath(new URL('./testing/measured-child.ts', import.meta.url)),
          execArgv: suiteChild.execArgv,
        },
        suiteIsolation,
      ),
      spawn: measuring,
    });
    const marker = 'dat110-value';
    const request = runRequest(
      settings(),
      PASSWORDS.reader,
      draft(`select 1 as id, repeat('x', 104857600) as v /* ${marker} */`, [
        id,
        column('v', { base: 'text' }),
      ]),
      {},
      { limits: { bytes: 5 * 1024 * 1024 } },
    );
    expect(await measured.run('run', request)).toEqual({
      outcome: 'failed',
      failure: { code: 'byte_limit', attribution: 'query' },
    });
    // A 100 MiB value, stopped at the socket past 5 MiB: the child never held it.
    expect(peaks).toHaveLength(1);
    expect(peaks[0]).toBeLessThan(150 * 1024 * 1024);
    expect(await goneWithin(marker)).toBeLessThan(1000);
  });
});
