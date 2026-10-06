import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { canonicalResultBytes, type RunAnswer } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CSV_MAX_BYTES, JSON_LINES_MAX_BYTES, JSON_MAX_BYTES } from './http-source.js';
import { exchange } from './https.js';
import { childSpawn, createSupervisor, runChild, type SpawnChild } from './supervisor.js';
import {
  DEV_CA,
  DEV_KEY,
  get,
  httpDescribeRequest,
  httpDraft,
  httpRequestFor,
  httpRunRequest,
  httpSettings,
  member,
  startFakeApi,
  type FakeApi,
} from './testing/http.js';
import {
  LOADED_TIMEOUT_MS,
  SEALING_KEY,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';

const supervisor = createSupervisor({
  sealingKey: SEALING_KEY,
  deny: suiteDeny,
  maxChildren: 8,
  spec: childSpawn(suiteChild, suiteIsolation),
  ca: DEV_CA,
});

const failure = (answer: RunAnswer | 'busy') =>
  answer !== 'busy' && answer.outcome === 'failed'
    ? answer.failure
    : { unexpected: answer === 'busy' ? answer : answer.outcome };

/** A port nothing listens on: bound, then let go. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * The widest bodies measured, of a decimal and text in turn: JSON just under its own ceiling, and
 * JSON Lines just under the byte ceiling, at the row ceiling less one.
 */
const WIDE_COLUMNS = 15;
const JSON_ROWS = 16_750;
const LINES_ROWS = 49_500;
const CSV_ROWS = 37_800;

const readings = [
  member('id', { base: 'integer' }),
  member('site', { base: 'text' }),
  member('depth', { base: 'decimal', precision: 8, scale: 2 }),
  member('measured', { base: 'date' }),
  member('taken', { base: 'instant', fraction: 3 }),
  member('active', { base: 'boolean' }),
  member('detail', { base: 'text' }),
];

describe('an HTTP source', { timeout: LOADED_TIMEOUT_MS }, () => {
  let api: FakeApi;
  beforeAll(async () => {
    api = await startFakeApi();
  });
  afterAll(async () => {
    await api.close();
  });

  it('runs a request template into a canonical result, JSON at a pointer and JSON Lines alike, and reports the template it ran', async () => {
    const definition = httpDraft(get(['readings']), readings, {
      key: ['id'],
      order: [{ column: 'id', direction: 'ascending' }],
    });
    const answer = await supervisor.run(
      'run',
      httpRunRequest(httpSettings(api.port), DEV_KEY, definition),
    );
    if (answer === 'busy' || answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
    expect(answer.result.rows).toEqual([
      [
        '1',
        'North weir',
        '12.5',
        '2026-01-02',
        '2026-01-02T03:04:05.5Z',
        true,
        '{"a":[2,3],"b":1}',
      ],
      ['2', 'South weir', '7.25', '2026-01-03', '2026-01-03T04:05:06Z', false, null],
      ['3', 'East gauge', '0.75', '2026-01-04', '2026-01-04T05:06:07.25Z', true, '{"a":"x"}'],
    ]);
    expect(answer.checksum).toBe(
      createHash('sha256').update(canonicalResultBytes(answer.result), 'utf8').digest('hex'),
    );
    expect(answer.ran).toEqual({ request: get(['readings']) });
    // The same rows as JSON Lines, and through gzip, give the same checksum.
    const lines = await supervisor.run(
      'run',
      httpRunRequest(
        httpSettings(api.port),
        DEV_KEY,
        httpDraft(get(['readings.jsonl']), readings, {
          key: ['id'],
          order: [{ column: 'id', direction: 'ascending' }],
          format: { kind: 'jsonLines' },
        }),
      ),
    );
    expect(lines !== 'busy' && lines.outcome === 'ok' && lines.checksum).toBe(answer.checksum);
    const zipped = await supervisor.run(
      'run',
      httpRunRequest(
        httpSettings(api.port),
        DEV_KEY,
        httpDraft(
          get(['readings'], { query: [{ name: 'gzip', value: { fixed: '' } }] }),
          readings,
          {
            key: ['id'],
            order: [{ column: 'id', direction: 'ascending' }],
          },
        ),
      ),
    );
    expect(zipped !== 'busy' && zipped.outcome === 'ok' && zipped.checksum).toBe(answer.checksum);
  });

  it('DAT-074 reads a CSV response into a canonical result, an unquoted empty field null and a quoted one empty text', async () => {
    const columns = ['id', 'site', 'depth', 'measured', 'taken', 'active'].map(
      (name, at) => ({ ...readings[at]!, from: { header: name } }),
    );
    const answer = await supervisor.run(
      'run',
      httpRunRequest(
        httpSettings(api.port),
        DEV_KEY,
        httpDraft(get(['readings.csv']), [...columns, { name: 'note', from: { letter: 'G' }, type: { base: 'text' } }], {
          key: ['id'],
          order: [{ column: 'id', direction: 'ascending' }],
          format: { kind: 'csv', delimiter: 'comma', headerRow: true, null: 'empty' },
        }),
      ),
    );
    if (answer === 'busy' || answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
    expect(answer.result.rows).toEqual([
      ['1', 'North weir', '12.5', '2026-01-02', '2026-01-02T03:04:05.5Z', true, ''],
      ['2', 'South weir', '7.25', '2026-01-03', '2026-01-03T04:05:06Z', false, null],
      ['3', 'East gauge', '0.75', '2026-01-04', '2026-01-04T05:06:07.25Z', true, null],
    ]);
  });

  it('DAT-108 refuses a response whose stated row count disagrees with its rows, result_incomplete', async () => {
    const counted = (path: string) =>
      httpDraft(get([path]), [member('id', { base: 'integer' })], {
        format: { kind: 'json', rows: '/data/items', count: '/count' },
      });
    const wrong = await supervisor.run(
      'run',
      httpRunRequest(httpSettings(api.port), DEV_KEY, counted('count-wrong')),
    );
    expect(failure(wrong)).toEqual({ code: 'result_incomplete', attribution: 'connector' });
    const right = await supervisor.run(
      'run',
      httpRunRequest(httpSettings(api.port), DEV_KEY, counted('readings')),
    );
    expect(right !== 'busy' && right.outcome).toBe('ok');
  });

  it('DAT-075 answers connection_failed alike for a guarded host, a refused port, a 401 and a redirect to loopback, and no sooner than the floor', async () => {
    const refused = await closedPort();
    const prodDeny = createSupervisor({
      sealingKey: SEALING_KEY,
      // Production's own ranges: loopback refused, as the redirect's target would be.
      deny: [...suiteDeny, '127.0.0.0/8'],
      maxChildren: 2,
      spec: childSpawn(suiteChild, suiteIsolation),
      ca: DEV_CA,
    });
    const cases = [
      ['a guarded host', prodDeny, httpSettings(api.port), DEV_KEY],
      ['a refused port', supervisor, httpSettings(refused), DEV_KEY],
      ['a 401', supervisor, httpSettings(api.port), 'not-the-key'],
      [
        'a redirect to loopback',
        supervisor,
        httpSettings(api.port, { baseUrl: `https://127.0.0.1:${api.port}/v1/redirect` }),
        DEV_KEY,
      ],
    ] as const;
    const answers = await Promise.all(
      cases.map(async ([what, through, source, secret]) => {
        const started = Date.now();
        const answer = await through.run('test', httpRequestFor(source, secret));
        return { what, answer: JSON.stringify(answer), ms: Date.now() - started };
      }),
    );
    for (const { what, answer, ms } of answers) {
      expect(answer, what).toBe(
        '{"outcome":"failed","failure":{"code":"connection_failed","attribution":"connector"}}',
      );
      expect(ms, what).toBeGreaterThanOrEqual(4950);
      expect(answer, what).not.toMatch(/127\.0\.0\.1|redirect|not-the-key|x-api-key/);
    }
    // A test that reaches and signs in passes, with nothing to find of a database's account.
    expect(await supervisor.run('test', httpRequestFor(httpSettings(api.port), DEV_KEY))).toEqual({
      outcome: 'ok',
      findings: [],
    });
  });

  it('answers a status the source refused with as that status alone, and a describe of relations as not supported', async () => {
    const refused = await supervisor.run(
      'run',
      httpRunRequest(
        httpSettings(api.port),
        DEV_KEY,
        httpDraft(get(['status', '500']), [member('id', { base: 'integer' })]),
      ),
    );
    expect(failure(refused)).toEqual({ code: 'source_refused', attribution: 'query', status: 500 });
    expect(
      await supervisor.run('describe', httpRequestFor(httpSettings(api.port), DEV_KEY)),
    ).toEqual({ failure: { code: 'describe_not_supported', attribution: 'product' } });
  });

  /**
   * A run of the widest body measured, in a child that reports its peak resident set: its body's
   * size, and the peak. D2's run at the ceilings peaked at 371 MiB, which `MAX_RUNS` is sized by.
   */
  async function measuredRun(rows: number, lines: boolean | 'csv') {
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
      ca: DEV_CA,
    });
    const query = [
      { name: 'rows', value: { fixed: String(rows) } },
      { name: 'columns', value: { fixed: String(WIDE_COLUMNS) } },
      ...(lines === true ? [{ name: 'lines', value: { fixed: '' } }] : []),
      ...(lines === 'csv' ? [{ name: 'csv', value: { fixed: '' } }] : []),
    ];
    const sized = await exchange(
      {
        host: '127.0.0.1',
        port: api.port,
        path: `/v1/wide?rows=${rows}&columns=${WIDE_COLUMNS}${lines === true ? '&lines=' : lines === 'csv' ? '&csv=' : ''}`,
        method: 'GET',
        headers: [['x-api-key', DEV_KEY]],
      },
      {
        deny: suiteDeny,
        ca: DEV_CA,
        deadline: Date.now() + 60_000,
        connectTimeoutMs: 5000,
        maxBytes: 25 * 1024 * 1024,
      },
    );
    const columns = Array.from({ length: WIDE_COLUMNS }, (_, at) => {
      const type = at % 2 === 0
        ? ({ base: 'decimal', precision: 20, scale: 2 } as const)
        : ({ base: 'text' } as const);
      return lines === 'csv'
        ? { name: `c${at}`, from: { header: `c${at}` }, type }
        : member(`c${at}`, type);
    });
    const id =
      lines === 'csv'
        ? { name: 'id', from: { header: 'id' }, type: { base: 'integer' } as const }
        : member('id', { base: 'integer' });
    const answer = await measured.run(
      'run',
      httpRunRequest(
        httpSettings(api.port),
        DEV_KEY,
        httpDraft(get(['wide'], { query }), [id, ...columns], {
          format:
            lines === 'csv'
              ? { kind: 'csv', delimiter: 'comma', headerRow: true, null: 'empty' }
              : lines
                ? { kind: 'jsonLines' }
                : { kind: 'json', rows: '/items' },
          // Keyed and ordered, as D2's run at the ceilings was: checked, never sorted.
          key: ['id'],
          order: [{ column: 'id', direction: 'ascending' }],
        }),
        {},
        { limits: { rows: 100_000, bytes: 25 * 1024 * 1024, seconds: 120 }, deadlineMs: 120_000 },
      ),
    );
    const bytes = sized.ok ? sized.body.length : 0;
    const peakMiB = Math.round((peaks[0] ?? 0) / 1048576);
    // The measurement, recorded in data.md and the PR.
    process.stdout.write(`${JSON.stringify({ lines, rows, bytes, peakMiB })}\n`);
    return { answer, bytes, peaks };
  }

  it('reads a JSON body at its ceiling, 4 MiB, and JSON Lines at its own, 12 MiB, within the memory a run at the ceilings takes', async () => {
    const json = await measuredRun(JSON_ROWS, false);
    const jsonLines = await measuredRun(LINES_ROWS, true);
    // Not vacuous: within a megabyte of its ceiling, every row read.
    expect(json.bytes).toBeGreaterThan(JSON_MAX_BYTES - 512 * 1024);
    expect(json.bytes).toBeLessThanOrEqual(JSON_MAX_BYTES);
    expect(json.answer !== 'busy' && json.answer.outcome === 'ok' && json.answer.rowCount).toBe(
      JSON_ROWS,
    );
    expect(json.peaks).toHaveLength(1);
    expect(json.peaks[0]).toBeLessThan(371 * 1024 * 1024);
    expect(jsonLines.bytes).toBeGreaterThan(JSON_LINES_MAX_BYTES - 512 * 1024);
    expect(jsonLines.bytes).toBeLessThanOrEqual(JSON_LINES_MAX_BYTES);
    expect(
      jsonLines.answer !== 'busy' && jsonLines.answer.outcome === 'ok' && jsonLines.answer.rowCount,
    ).toBe(LINES_ROWS);
    expect(jsonLines.peaks).toHaveLength(1);
    expect(jsonLines.peaks[0]).toBeLessThan(371 * 1024 * 1024);
  });

  it('reads a CSV body at its ceiling, 6 MiB, within the memory a run at the ceilings takes, and refuses one past it', async () => {
    const csv = await measuredRun(CSV_ROWS, 'csv');
    expect(csv.bytes).toBeGreaterThan(CSV_MAX_BYTES - 512 * 1024);
    expect(csv.bytes).toBeLessThanOrEqual(CSV_MAX_BYTES);
    expect(csv.answer !== 'busy' && csv.answer.outcome === 'ok' && csv.answer.rowCount).toBe(
      CSV_ROWS,
    );
    expect(csv.peaks).toHaveLength(1);
    expect(csv.peaks[0]).toBeLessThan(371 * 1024 * 1024);
    const past = await measuredRun(Math.ceil(CSV_ROWS * 1.1), 'csv');
    expect(past.bytes).toBeGreaterThan(CSV_MAX_BYTES);
    expect(failure(past.answer)).toEqual({ code: 'byte_limit', attribution: 'query' });
  });

  it('refuses a JSON or JSON Lines body past its ceiling, byte_limit, whatever the byte limit says', async () => {
    const past = await measuredRun(Math.ceil(JSON_ROWS * 1.1), false);
    expect(past.bytes).toBeGreaterThan(JSON_MAX_BYTES);
    expect(failure(past.answer)).toEqual({ code: 'byte_limit', attribution: 'query' });
    const pastLines = await measuredRun(Math.ceil(LINES_ROWS * 1.1), true);
    expect(pastLines.bytes).toBeGreaterThan(JSON_LINES_MAX_BYTES);
    expect(failure(pastLines.answer)).toEqual({ code: 'byte_limit', attribution: 'query' });
  });

  it('DAT-105 proposes columns from a sample: each member of the first rows, by its pointer, a number by its digits', async () => {
    const described = await supervisor.run(
      'describeSql',
      httpDescribeRequest(httpSettings(api.port), DEV_KEY, get(['readings'])),
    );
    expect(described).toEqual({
      columns: [
        { name: 'id', sourceType: 'number', proposed: { base: 'integer' }, pointer: '/id' },
        { name: 'site', sourceType: 'string', proposed: { base: 'text' }, pointer: '/site' },
        {
          name: 'depth',
          sourceType: 'number',
          proposed: { base: 'decimal', precision: 32, scale: 2 },
          pointer: '/depth',
        },
        {
          name: 'measured',
          sourceType: 'string',
          proposed: { base: 'date' },
          pointer: '/measured',
        },
        {
          name: 'taken',
          sourceType: 'string',
          proposed: { base: 'instant', fraction: 6 },
          pointer: '/taken',
        },
        {
          name: 'active',
          sourceType: 'boolean',
          proposed: { base: 'boolean' },
          pointer: '/active',
        },
        { name: 'detail', sourceType: 'object', proposed: { base: 'text' }, pointer: '/detail' },
      ],
      parameters: [],
    });
  });
});
