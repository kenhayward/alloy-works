import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

import {
  childRequestSchema,
  type ChildRequest,
  type Column,
  type DescribeSqlAnswer,
  type RunAnswer,
  type TestAnswer,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { builtInDenied } from './config.js';
import type { Lookup } from './guard.js';
import { ChecksumCheck, crc32c, crc64nvme } from './s3.js';
import { childSpawn, createSupervisor } from './supervisor.js';
import { CONNECT_TIMEOUT_MS } from './supervisor.js';
import {
  field,
  fileDraft,
  keyOf,
  PRIVATE_BUCKET,
  READER,
  S3_SOURCE_PORT,
  s3DescribeRequest,
  s3RequestFor,
  s3RunRequest,
  s3Settings,
  SEEDER,
  SOURCES_CA,
  startFakeStore,
  type FakeAnswer,
  type FakeStore,
} from './testing/s3.js';
import {
  LOADED_TIMEOUT_MS,
  SEALING_KEY,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';
import { answerRequest } from './work.js';

const supervisor = createSupervisor({
  sealingKey: SEALING_KEY,
  deny: suiteDeny,
  maxChildren: 8,
  spec: childSpawn(suiteChild, suiteIsolation),
  ca: SOURCES_CA,
});

const FAILED_TO_REACH = {
  outcome: 'failed',
  failure: { code: 'connection_failed', attribution: 'connector' },
};

/** The seeded readings' columns, as every format of them declares them. */
const readings = (from: (name: string) => Column['from']): Column[] => [
  { name: 'id', from: from('id'), type: { base: 'integer' } },
  { name: 'site', from: from('site'), type: { base: 'text' } },
  { name: 'depth', from: from('depth'), type: { base: 'decimal', precision: 8, scale: 2 } },
  { name: 'measured', from: from('measured'), type: { base: 'date' } },
  { name: 'taken', from: from('taken'), type: { base: 'instant', fraction: 3 } },
  { name: 'active', from: from('active'), type: { base: 'boolean' } },
  { name: 'note', from: from('note'), type: { base: 'text' } },
];
const byHeader = readings((name) => ({ header: name }));
const byPointer = readings((name) => ({ pointer: `/${name}` }));

const ok = (answer: RunAnswer | 'busy') => {
  if (answer === 'busy' || answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
  return answer;
};

describe('an S3 source', { timeout: LOADED_TIMEOUT_MS }, () => {
  const source = s3Settings(S3_SOURCE_PORT);

  it('DAT-074 reads an S3 object as CSV, JSON and JSON Lines into one canonical result, and reports the bucket and the key it read', async () => {
    const csv = ok(
      await supervisor.run(
        'run',
        s3RunRequest(source, fileDraft(keyOf('readings/2026/readings.csv'), byHeader)),
      ),
    );
    expect(csv.result.rows).toEqual([
      ['1', 'North weir', '12.5', '2026-01-02', '2026-01-02T03:04:05.5Z', true, ''],
      ['2', 'South weir', '7.25', '2026-01-03', '2026-01-03T04:05:06Z', false, null],
      [
        '3',
        'East gauge',
        '0.75',
        '2026-01-04',
        '2026-01-04T05:06:07.25Z',
        true,
        'Gauge, east bank',
      ],
    ]);
    expect(csv.ran).toEqual({
      object: { bucket: 'alloy-readings', key: 'readings/2026/readings.csv' },
    });
    const json = ok(
      await supervisor.run(
        'run',
        s3RunRequest(
          source,
          fileDraft(keyOf('readings/2026/readings.json'), byPointer, {
            format: { kind: 'json', rows: '/items', count: '/count' },
          }),
        ),
      ),
    );
    const lines = ok(
      await supervisor.run(
        'run',
        s3RunRequest(
          source,
          fileDraft(keyOf('readings/2026/readings.jsonl'), byPointer, {
            format: { kind: 'jsonLines' },
          }),
        ),
      ),
    );
    // One table, three formats, one checksum: the quoted empty field is the JSON's empty text, and
    // the unquoted one its null.
    expect(json.checksum).toBe(csv.checksum);
    expect(lines.checksum).toBe(csv.checksum);
    // A key segment with a space in it is encoded once and signed as sent.
    const spaced = ok(
      await supervisor.run(
        'run',
        s3RunRequest(
          source,
          fileDraft(
            [{ fixed: 'sites' }, { fixed: 'North weir.csv' }],
            [field('river', { base: 'text' })],
          ),
        ),
      ),
    );
    expect(spaced.result.rows).toEqual([['Avon']]);
  });

  it("DAT-077 applies the store's own access rules: the reader's key reads the bucket its policy allows and is refused another, which the seeder's key reads", async () => {
    const draft = fileDraft(keyOf('readings/2026/readings.csv'), [field('site', { base: 'text' })]);
    const elsewhere = s3Settings(S3_SOURCE_PORT, { bucket: PRIVATE_BUCKET });
    expect(await supervisor.run('run', s3RunRequest(elsewhere, draft))).toEqual(FAILED_TO_REACH);
    const seeded = ok(
      await supervisor.run('run', s3RunRequest(elsewhere, draft, {}, { pair: SEEDER })),
    );
    expect(seeded.result.rows).toEqual([['Private weir']]);
    // Not vacuous: the reader reads its own bucket.
    expect(
      ok(await supervisor.run('run', s3RunRequest(source, draft, {}, { pair: READER }))).result
        .rows,
    ).toHaveLength(3);
  });

  it('tests a connection by HeadBucket: its key pair signs in, and a wrong secret reads as a failure to reach', async () => {
    expect(await supervisor.run('test', s3RequestFor(source))).toEqual({
      outcome: 'ok',
      findings: [],
    });
    expect(
      await supervisor.run(
        'test',
        s3RequestFor(source, { accessKeyId: READER.accessKeyId, secretAccessKey: 'not-it' }),
      ),
    ).toEqual(FAILED_TO_REACH);
    expect(await supervisor.run('describe', s3RequestFor(source))).toEqual({
      failure: { code: 'describe_not_supported', attribution: 'product' },
    });
  });

  it('applies typed filters to the canonical rows and imposes the declared order, a time compared by its value', async () => {
    const draft = fileDraft(keyOf('readings/2026/readings.csv'), byHeader, {
      parameters: [
        { name: 'after', type: { base: 'instant', fraction: 3 }, required: true, list: false },
      ],
      // The text of 2026-01-02T03:04:05.5Z sorts before ...05Z; its value does not.
      where: {
        and: [
          { column: 'taken', is: 'greater', to: { parameter: 'after' } },
          { column: 'note', is: 'isNotNull' },
        ],
      },
      key: ['id'],
      order: [
        { column: 'depth', direction: 'ascending' },
        { column: 'id', direction: 'ascending' },
      ],
    });
    const run = ok(
      await supervisor.run('run', s3RunRequest(source, draft, { after: '2026-01-02T03:04:05Z' })),
    );
    expect(run.result.rows.map((row) => row[0])).toEqual(['3', '1']);
  });

  it('DAT-105 proposes the columns of a sampled object by its headers', async () => {
    const described = (await supervisor.run(
      'describeSql',
      s3DescribeRequest(source, keyOf('readings/2026/readings.csv')),
    )) as DescribeSqlAnswer;
    expect('columns' in described && described.columns.map((each) => each.header)).toEqual([
      'id',
      'site',
      'depth',
      'measured',
      'taken',
      'active',
      'note',
    ]);
  });
});

describe('an S3 exchange', () => {
  let store: FakeStore;
  let next: (path: string) => FakeAnswer;
  beforeAll(async () => {
    store = await startFakeStore((request) => next(request.url ?? ''));
  });
  afterAll(async () => {
    await store.close();
  });

  const CSV_BODY = Buffer.from('site\nNorth weir\n');
  const draft = fileDraft(keyOf('readings/2026/readings.csv'), [field('site', { base: 'text' })]);
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');
  /** Any name resolves to 127.0.0.1, where the fake listens. */
  const loopback: Lookup = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);

  /** A request answered in this process, as the child answers it. */
  async function answered(
    kind: 'run' | 'test',
    request: ChildRequest['request'],
    deny: readonly string[] = suiteDeny,
  ) {
    return answerRequest(
      childRequestSchema.parse({
        kind,
        request,
        secret: JSON.stringify(READER),
        deny: [...deny],
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        failureFloorMs: 0,
        ca: SOURCES_CA,
      }),
      { lookup: loopback },
    ) as Promise<RunAnswer & TestAnswer>;
  }
  const code = (answer: RunAnswer) => (answer.outcome === 'ok' ? 'ok' : answer.failure.code);

  it('reads an object from a store over plain http, signed for http and its port (ADR-0048)', async () => {
    const plain = await startFakeStore(() => ({ body: CSV_BODY }), { plain: true });
    try {
      const source = s3Settings(plain.port, { endpoint: `http://127.0.0.1:${plain.port}` });
      expect(code(await answered('run', s3RunRequest(source, draft)))).toBe('ok');
      const asked = plain.seen.at(-1)!;
      expect(asked.headers.host).toBe(`127.0.0.1:${plain.port}`);
      expect(String(asked.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 /);
    } finally {
      await plain.close();
    }
  });

  it('DAT-108 refuses an object shorter than its Content-Length, or not the checksum its store states, result_incomplete; an ETag is never read', async () => {
    const source = s3Settings(store.port);
    const run = () => answered('run', s3RunRequest(source, draft));
    next = () => 'short';
    expect(code(await run())).toBe('result_incomplete');
    next = () => ({
      body: CSV_BODY,
      headers: { 'x-amz-checksum-sha256': sha256(Buffer.from('other')) },
    });
    expect(code(await run())).toBe('result_incomplete');
    next = () => ({ body: CSV_BODY, headers: { 'x-amz-checksum-crc32c': 'AAAAAA==' } });
    expect(code(await run())).toBe('result_incomplete');
    // Each checksum that holds, a composite one passed over, and an ETag that is no MD5 of the body.
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(CSV_BODY));
    next = () => ({
      body: CSV_BODY,
      headers: {
        'x-amz-checksum-sha256': sha256(CSV_BODY),
        'x-amz-checksum-crc32': crc.toString('base64'),
        'x-amz-checksum-crc64nvme': 'AAAAAAAAAAA=-3',
        etag: '"00000000000000000000000000000000-2"',
        'x-amz-version-id': 'v-3',
      },
    });
    const right = await run();
    expect(code(right)).toBe('ok');
    expect(right.outcome === 'ok' && right.ran).toEqual({
      object: { bucket: 'alloy-readings', key: 'readings/2026/readings.csv', versionId: 'v-3' },
    });
    next = () => ({
      body: CSV_BODY,
      headers: { 'x-amz-checksum-type': 'COMPOSITE', 'x-amz-checksum-sha256': 'AAAA' },
    });
    expect(code(await run())).toBe('ok');
  });

  it('DAT-109 stops an exchange the store abandons at the deadline, timeout', async () => {
    next = () => 'abandon';
    const started = Date.now();
    const answer = await answered(
      'run',
      s3RunRequest(s3Settings(store.port), draft, {}, { deadlineMs: 2000 }),
    );
    expect(code(answer)).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('signs each request with the key pair for the host it is sent to, checksum mode on, and sends the secret in no header', async () => {
    next = () => ({ body: CSV_BODY });
    const before = store.seen.length;
    // Virtual-hosted: the bucket is the host's first label, and the key alone is the path.
    const virtual = s3Settings(store.port, {
      endpoint: `https://s3.source.test:${store.port}`,
      pathStyle: false,
    });
    expect(code(await answered('run', s3RunRequest(virtual, draft)))).toBe('ok');
    expect(code(await answered('run', s3RunRequest(s3Settings(store.port), draft)))).toBe('ok');
    const [hosted, pathed] = store.seen.slice(before);
    expect(hosted!.rawPath).toBe('/readings/2026/readings.csv');
    expect(hosted!.headers.host).toBe(`alloy-readings.s3.source.test:${store.port}`);
    expect(pathed!.rawPath).toBe('/alloy-readings/readings/2026/readings.csv');
    expect(pathed!.headers.host).toBe(`127.0.0.1:${store.port}`);
    for (const seen of [hosted!, pathed!]) {
      expect(seen.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=source-s3-reader\/[0-9]{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-checksum-mode;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
      );
      expect(seen.headers['x-amz-checksum-mode']).toBe('ENABLED');
      expect(JSON.stringify(seen)).not.toContain(READER.secretAccessKey);
    }
  });

  it('refuses a virtual-hosted bucket whose name resolves to loopback, and a redirect, as failures to reach; a missing object is its status alone', async () => {
    next = () => ({ body: CSV_BODY });
    const before = store.seen.length;
    const virtual = s3Settings(store.port, {
      endpoint: `https://s3.source.test:${store.port}`,
      pathStyle: false,
    });
    // Production's ranges: the bucket's name resolves to loopback, so nothing is sent.
    expect(await answered('run', s3RunRequest(virtual, draft), builtInDenied)).toEqual(
      FAILED_TO_REACH,
    );
    expect(store.seen.length).toBe(before);
    next = () => ({ status: 301, headers: { location: 'https://127.0.0.1:1/' } });
    expect(code(await answered('run', s3RunRequest(s3Settings(store.port), draft)))).toBe(
      'connection_failed',
    );
    next = () => ({ status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' });
    const missing = await answered('run', s3RunRequest(s3Settings(store.port), draft));
    expect(missing.outcome === 'failed' && missing.failure).toEqual({
      code: 'source_refused',
      attribution: 'query',
      status: 404,
    });
  });
});

describe("S3's checksums", () => {
  it('computes CRC-32C and CRC-64/NVME by their check values, over any split of the bytes', () => {
    const check = Buffer.from('123456789');
    const once = crc32c();
    once.update(check);
    expect(once.digest().toString('hex')).toBe('e3069283');
    const split = crc64nvme();
    split.update(check.subarray(0, 4));
    split.update(check.subarray(4));
    expect(split.digest().toString('hex')).toBe('ae8b14860a799888');
    const all = new ChecksumCheck();
    all.update(check);
    expect(
      all.holds({
        'x-amz-checksum-crc64nvme': Buffer.from('ae8b14860a799888', 'hex').toString('base64'),
      }),
    ).toBe(true);
    expect(all.holds({ 'x-amz-checksum-sha1': 'not base64!' })).toBe(false);
  });

  it('the compose CA bundle holds both development source CAs', () => {
    const at = (path: string) =>
      readFileSync(
        fileURLToPath(new URL(`../../../deploy/sources/${path}`, import.meta.url)),
        'utf8',
      );
    expect(at('ca-bundle.pem')).toBe(`${at('http/ca.pem')}${at('s3/ca.pem')}`);
    expect(SOURCES_CA).toBe(at('ca-bundle.pem'));
  });
});
