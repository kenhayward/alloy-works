import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  INDEX_LAG_CEILING_SECONDS,
  SILENT_FAILURES,
  silentFailuresNow,
  silentFailuresToTell,
  type SilentReadings,
} from './silent.js';

const repo = new URL('../../../../', import.meta.url);
const holds = (file: string) => readFileSync(new URL(file, repo), 'utf8');

const kind = (name: string) => SILENT_FAILURES.find((each) => each.kind === name)!;

/** Each kind's person waiting is told where it says, the citation found in its file. */
const toldWhereItSays = (name: string) => {
  const each = kind(name);
  if (each.waiting.told) expect(holds(each.waiting.file), name).toContain(each.waiting.holds);
  else expect(each.waiting.why.length, name).toBeGreaterThan(0);
  if (each.administrators.by === 'own') {
    expect(holds(each.administrators.file), name).toContain(each.administrators.holds);
  }
};

const quiet: SilentReadings = {
  capabilities: [],
  work: [],
  jobs: [],
  connections: [],
  indexWaitSeconds: null,
  integrity: [],
};

describe('silent failures, kind by kind (the DG plan, pre-flight 7)', () => {
  it('lists each kind the design names, once', () => {
    expect(SILENT_FAILURES.map((each) => each.kind)).toEqual([
      'query_timeout',
      'source_down',
      'job_failed',
      'webhook_failing',
      'mail_failing',
      'index_lagging',
      'work_failing',
      'capability_failing',
      'integrity_failing',
      'secret_failing',
    ]);
  });

  it('tells the person running a query that timed out, at once, by its code', () => {
    toldWhereItSays('query_timeout');
  });

  it('tells the person running a query on a source that is down, at once, by its reason', () => {
    toldWhereItSays('source_down');
  });

  it('tells the submitter of a job that failed, on their job', () => {
    toldWhereItSays('job_failed');
  });

  it("tells a failing webhook's maker in their inbox, and leaves administrators to that", () => {
    toldWhereItSays('webhook_failing');
    expect(kind('webhook_failing').administrators.by).toBe('own');
  });

  it('tells those who configure services of mail failing in their inbox, and nobody twice', () => {
    toldWhereItSays('mail_failing');
    expect(kind('mail_failing').administrators.by).toBe('own');
  });

  it('tells a searcher by meaning while the index lags past its ceiling', () => {
    toldWhereItSays('index_lagging');
  });

  it('tells the person whose request a failing capability failed, at once', () => {
    toldWhereItSays('capability_failing');
  });

  it('tells the person whose act a replaced secret failed, at once, and administrators by inbox', () => {
    toldWhereItSays('secret_failing');
    expect(kind('secret_failing').administrators.by).toBe('inbox');
  });

  it('says why nobody waits on background work or on integrity, and tells administrators instead', () => {
    toldWhereItSays('work_failing');
    toldWhereItSays('integrity_failing');
    expect(kind('work_failing').administrators.by).toBe('inbox');
    expect(kind('integrity_failing').administrators.by).toBe('inbox');
  });
});

describe('the silent failures administrators are told of (the DG plan, DGe4)', () => {
  it('holds the index to its budget: lagging past five minutes, never at them', () => {
    expect(INDEX_LAG_CEILING_SECONDS).toBe(300);
    expect(silentFailuresNow({ ...quiet, indexWaitSeconds: 300 })).toEqual([]);
    expect(silentFailuresNow({ ...quiet, indexWaitSeconds: 301 })).toEqual([
      { kind: 'index_lagging', subject: '' },
    ]);
  });

  it('reads each kind told by inbox from what Diagnostics reads, and nothing healthy', () => {
    expect(
      silentFailuresNow({
        capabilities: [
          { capability: 'Search', health: 'failing' },
          { capability: 'Publishing', health: 'degraded' },
        ],
        work: [
          { work: 'sweepDates', health: 'failing' },
          { work: 'sweepMail', health: 'paused' },
        ],
        jobs: [
          { kind: 'publish', state: 'failed' },
          { kind: 'preview', state: 'done' },
        ],
        connections: [
          { connection: 'c1', down: true },
          { connection: 'c2', down: false },
        ],
        indexWaitSeconds: 12,
        integrity: [
          { class: 'asset', failing: 2 },
          { class: 'version', failing: 0 },
        ],
      }),
    ).toEqual([
      { kind: 'capability_failing', subject: 'Search' },
      { kind: 'work_failing', subject: 'sweepDates' },
      { kind: 'job_failed', subject: 'publish' },
      { kind: 'source_down', subject: 'c1' },
      { kind: 'integrity_failing', subject: 'asset' },
    ]);
    // Only kinds whose administrators are told by inbox are read.
    const read = new Set(
      SILENT_FAILURES.filter((each) => each.administrators.by === 'inbox').map((each) => each.kind),
    );
    expect(read).toEqual(
      new Set([
        'capability_failing',
        'work_failing',
        'job_failed',
        'source_down',
        'index_lagging',
        'integrity_failing',
        'secret_failing',
      ]),
    );
  });

  it('tells a secret failing since its replacement against the secret, keyed by that replacement', () => {
    const secret = {
      kind: 'connection_credential',
      name: 'Warehouse',
      consumers: ['Orders', 'Stock'],
    } as const;
    expect(
      silentFailuresNow({
        ...quiet,
        secrets: [
          { key: 'connection_credential:c1:1000', failing: true, secret },
          { key: 'connection_credential:c2:2000', failing: false, secret },
        ],
      }),
    ).toEqual([{ kind: 'secret_failing', subject: 'connection_credential:c1:1000', secret }]);
  });

  it('tells each failure once until it clears, and a cleared one again when it returns', () => {
    const search = { kind: 'capability_failing', subject: 'Search' } as const;
    const dates = { kind: 'work_failing', subject: 'sweepDates' } as const;
    expect(silentFailuresToTell([search, dates], ['capability_failing:Search'])).toEqual({
      tell: [dates],
      forget: [],
    });
    expect(
      silentFailuresToTell([dates], ['capability_failing:Search', 'work_failing:sweepDates']),
    ).toEqual({
      tell: [],
      forget: ['capability_failing:Search'],
    });
  });
});
