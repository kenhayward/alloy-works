import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ConnectionSettings } from './connection.js';
import type { DraftDefinition } from './definition.js';
import {
  childRequestSchema,
  describeAnswerSchema,
  describeRequestSchema,
  describeSqlAnswerSchema,
  describeSqlRequestSchema,
  RUN_REQUEST_MAX_BYTES,
  runAnswerSchema,
  runRequestSchema,
  SEALED,
  sealAnswerSchema,
  sealRequestSchema,
  testAnswerSchema,
  testRequestSchema,
} from './protocol.js';

const settings: ConnectionSettings = {
  schemaVersion: 1,
  name: 'Readings',
  description: '',
  type: 'postgres',
  source: {
    host: 'source-postgres',
    port: 5432,
    database: 'readings',
    account: 'reader',
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
};

const sealed = 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.Q0NDQw';
const CONNECTION = '5c1d0c6e-8f9a-4b1e-9d6a-3f2b7c4e5a10';

const testRequest = {
  requestId: '6f1c2a0e-8a4b-4c1e-9d7a-1b2c3d4e5f60',
  tenant: 'acme',
  connection: {
    id: '0b6a3c4d-1e2f-4a5b-8c7d-9e0f1a2b3c4d',
    version: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  },
  settings,
  sealed,
  deadlineMs: 10_000,
};

describe("the connector's protocol", () => {
  it('round-trips each request and answer', () => {
    const cases: readonly [{ parse: (value: unknown) => unknown }, unknown][] = [
      [
        sealRequestSchema,
        { tenant: 'acme', connection: CONNECTION, secret: 'invented-password', settings },
      ],
      [sealAnswerSchema, { sealed }],
      [testRequestSchema, testRequest],
      [describeRequestSchema, testRequest],
      [testAnswerSchema, { outcome: 'ok', findings: [] }],
      [testAnswerSchema, { outcome: 'ok', findings: ['account_not_read_only'] }],
      [
        testAnswerSchema,
        { outcome: 'failed', failure: { code: 'connection_failed', attribution: 'connector' } },
      ],
      [describeAnswerSchema, { failure: { code: 'timeout', attribution: 'connector' } }],
      [
        describeAnswerSchema,
        {
          relations: [
            {
              schema: 'sample',
              name: 'site',
              kind: 'table',
              columns: [
                {
                  name: 'id',
                  sourceType: 'integer',
                  nullable: false,
                  proposed: { base: 'integer' },
                },
                {
                  name: 'depth',
                  sourceType: 'numeric(8,2)',
                  nullable: true,
                  proposed: { base: 'decimal', precision: 8, scale: 2 },
                },
                {
                  name: 'seen',
                  sourceType: 'timestamp with time zone',
                  nullable: true,
                  proposed: { base: 'instant', fraction: 6 },
                },
                { name: 'ratio', sourceType: 'double precision', nullable: true, proposed: null },
              ],
            },
          ],
          truncated: false,
          leftOut: { relations: 1, columns: 2 },
        },
      ],
      [
        childRequestSchema,
        {
          kind: 'describe',
          request: testRequest,
          secret: 'invented-password',
          deny: ['172.31.10.0/24', '::1/128'],
          connectTimeoutMs: 5000,
          failureFloorMs: 5000,
        },
      ],
    ];
    for (const [schema, value] of cases) {
      const text = JSON.stringify(value);
      expect(schema.parse(JSON.parse(text))).toEqual(value);
    }
  });

  it("holds SEALED to migration 0042's pattern, character for character", () => {
    const migration = readFileSync(
      join(import.meta.dirname, '../../../db/migrations/tenant/0042_sealed_sign_in_secret.sql'),
      'utf8',
    );
    const pattern = /sealed_secret ~ '([^']+)'/.exec(migration)?.[1];
    expect(pattern).toBeDefined();
    expect(SEALED.source).toBe(pattern);
    expect(SEALED.flags).toBe('');
  });

  it('refuses a secret with U+0000, an empty one, or one over 4,096 bytes, and takes 4,096', () => {
    const refused = [
      'pass\u0000word',
      '',
      'p'.repeat(4097),
      // 2,049 characters of two bytes each.
      'é'.repeat(2049),
    ];
    for (const secret of refused) {
      expect(
        sealRequestSchema.safeParse({ tenant: 'acme', connection: CONNECTION, secret, settings })
          .success,
      ).toBe(false);
    }
    expect(
      sealRequestSchema.safeParse({
        tenant: 'acme',
        connection: CONNECTION,
        secret: 'p'.repeat(4096),
        settings,
      }).success,
    ).toBe(true);
    expect(
      sealRequestSchema.safeParse({
        tenant: 'acme',
        connection: CONNECTION,
        secret: 'é'.repeat(2048),
        settings,
      }).success,
    ).toBe(true);
  });

  it('refuses a sealed value that is not the pattern or over 5,600 bytes, and a deadline out of range', () => {
    expect(sealAnswerSchema.safeParse({ sealed: 'v2.x.y.z' }).success).toBe(false);
    expect(
      sealAnswerSchema.safeParse({
        sealed: `v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.${'C'.repeat(5600)}`,
      }).success,
    ).toBe(false);
    for (const deadlineMs of [999, 60_001, 1.5]) {
      expect(testRequestSchema.safeParse({ ...testRequest, deadlineMs }).success).toBe(false);
    }
    expect(testRequestSchema.safeParse({ ...testRequest, tenant: 'Acme' }).success).toBe(false);
    expect(testRequestSchema.safeParse({ ...testRequest, extra: true }).success).toBe(false);
    // A failure attributed otherwise than its code is not an answer.
    expect(
      testAnswerSchema.safeParse({
        outcome: 'failed',
        failure: { code: 'connection_failed', attribution: 'product' },
      }).success,
    ).toBe(false);
    // An ok test with an unknown finding, or the same finding twice, is not an answer.
    for (const findings of [
      ['account_holds_privilege'],
      ['account_not_read_only', 'account_not_read_only'],
    ]) {
      expect(testAnswerSchema.safeParse({ outcome: 'ok', findings }).success).toBe(false);
    }
  });

  it("bounds what a source may say of its relations: names as PostgreSQL's own, a type's text, and no control character", () => {
    const relation = (
      over: Record<string, unknown> = {},
      column: Record<string, unknown> = {},
    ) => ({
      relations: [
        {
          schema: 'sample',
          name: 'site',
          kind: 'table',
          columns: [
            { name: 'id', sourceType: 'integer', nullable: false, proposed: null, ...column },
          ],
          ...over,
        },
      ],
      truncated: false,
      leftOut: { relations: 0, columns: 0 },
    });
    const takes = (value: unknown) => describeAnswerSchema.safeParse(value).success;
    // NAMEDATALEN less one, in bytes, is as long as a name PostgreSQL holds.
    expect(takes(relation({ schema: 's'.repeat(63), name: 'é'.repeat(31) + 'x' }))).toBe(true);
    expect(takes(relation({}, { name: 'c'.repeat(63), sourceType: 't'.repeat(1024) }))).toBe(true);
    // The longest type PostgreSQL names without a modifier: two names of 63 double quotes, quoted, and
    // an array's brackets.
    const quoted = `"${'""'.repeat(63)}"`;
    expect(takes(relation({}, { sourceType: `${quoted}.${quoted}[]` }))).toBe(true);
    // As many columns as a view's select list may hold.
    const columns = (length: number) =>
      Array.from({ length }, (_, n) => ({
        name: `c${n}`,
        sourceType: 'integer',
        nullable: true,
        proposed: null,
      }));
    expect(takes(relation({ columns: columns(1664) }))).toBe(true);
    for (const [what, value] of [
      ['a schema of 64 bytes', relation({ schema: 's'.repeat(64) })],
      ['a name of 64 bytes', relation({ name: 'é'.repeat(32) })],
      ['an empty name', relation({ name: '' })],
      ['a column of 64 bytes', relation({}, { name: 'c'.repeat(64) })],
      ['a type of 1,025 bytes', relation({}, { sourceType: 't'.repeat(1025) })],
      ['a name with a line feed', relation({ name: 'si\nte' })],
      ['a column with an escape', relation({}, { name: 'i\u001bd' })],
      ['a type with a C1 control', relation({}, { sourceType: 'int\u0085eger' })],
      ['a schema with a lone surrogate', relation({ schema: 'sam\ud800ple' })],
      ['more columns than a relation holds', relation({ columns: columns(1665) })],
      ['no count of what was left out', { ...relation(), leftOut: undefined }],
      ['a count that is not one', { ...relation(), leftOut: { relations: -1, columns: 0 } }],
    ] as const) {
      expect(takes(value), what).toBe(false);
    }
    const one = relation().relations[0];
    expect(
      takes({
        relations: Array.from({ length: 2001 }, () => one),
        truncated: true,
        leftOut: { relations: 0, columns: 0 },
      }),
      'more relations than a describe lists',
    ).toBe(false);
  });
});

const draft: DraftDefinition = {
  schemaVersion: 1,
  connection: '0b6a3c4d-1e2f-4a5b-8c7d-9e0f1a2b3c4d',
  parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
  fetch: { kind: 'sql', text: 'select id, name from sample.site where id = {{site}}' },
  columns: [
    { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
    { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
  ],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'valid',
  limits: { rows: 100, bytes: 1_000_000, seconds: 10 },
};

const runRequest = {
  ...testRequest,
  definition: draft,
  values: { site: '1' },
  limits: { rows: 100, bytes: 1_000_000, seconds: 10 },
  deadlineMs: 10_000,
};

const checksum = 'a'.repeat(64);

describe("the connector's protocol for a run and a SQL describe (the D2 plan)", () => {
  it('round-trips a run, its answer and its failure, and a SQL describe and its answer', () => {
    const cases: readonly [{ parse: (value: unknown) => unknown }, unknown][] = [
      [runRequestSchema, runRequest],
      [
        runAnswerSchema,
        {
          outcome: 'ok',
          result: {
            columns: [
              ['id', 'integer'],
              ['name', 'text'],
            ],
            rows: [['1', 'North weir']],
          },
          checksum,
          rowCount: 1,
          ran: { sql: 'select id, name from sample.site where id = $1::int8' },
          durationMs: 4,
        },
      ],
      [
        runAnswerSchema,
        {
          outcome: 'failed',
          failure: {
            code: 'source_refused',
            attribution: 'query',
            source: { sqlstate: '22012', message: 'division by zero' },
          },
        },
      ],
      [
        describeSqlRequestSchema,
        { ...testRequest, sql: { text: draft.fetch.text, parameters: draft.parameters } },
      ],
      [
        describeSqlAnswerSchema,
        {
          columns: [
            { name: 'id', sourceType: 'integer', proposed: { base: 'integer' } },
            { name: 'ratio', sourceType: 'double precision', proposed: null },
          ],
          parameters: ['bigint'],
        },
      ],
      [describeSqlAnswerSchema, { failure: { code: 'result_mismatch', attribution: 'query' } }],
      [
        childRequestSchema,
        {
          kind: 'run',
          request: runRequest,
          secret: 'invented-password',
          deny: [],
          connectTimeoutMs: 5000,
          failureFloorMs: 5000,
        },
      ],
      [
        childRequestSchema,
        {
          kind: 'describeSql',
          request: { ...testRequest, sql: { text: 'select 1 as one', parameters: [] } },
          secret: 'invented-password',
          deny: [],
          connectTimeoutMs: 5000,
          failureFloorMs: 5000,
        },
      ],
    ];
    for (const [schema, value] of cases) {
      expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
    }
  });

  it("refuses a run's answer that does not hold together: a row of the wrong width, a number, a count that is not its rows', a checksum that is not hex", () => {
    const ok = {
      outcome: 'ok',
      result: { columns: [['id', 'integer']], rows: [['1']] },
      checksum,
      rowCount: 1,
      ran: { sql: 'select 1' },
      durationMs: 4,
    };
    const takes = (value: unknown) => runAnswerSchema.safeParse(value).success;
    expect(takes(ok)).toBe(true);
    expect(takes({ ...ok, result: { ...ok.result, rows: [['1', '2']] } })).toBe(false);
    expect(takes({ ...ok, result: { ...ok.result, rows: [[1]] } })).toBe(false);
    expect(takes({ ...ok, result: { ...ok.result, columns: [['id', 'float']] } })).toBe(false);
    expect(takes({ ...ok, rowCount: 2 })).toBe(false);
    expect(takes({ ...ok, checksum: 'A'.repeat(64) })).toBe(false);
    expect(takes({ ...ok, durationMs: -1 })).toBe(false);
  });

  it("refuses a run whose definition, values or limits are not a run's, a deadline past the time ceiling, and a SQL describe of what does not lex or names nothing", () => {
    const takes = (value: unknown) => runRequestSchema.safeParse(value).success;
    expect(takes({ ...runRequest, deadlineMs: 120_000 })).toBe(true);
    expect(takes({ ...runRequest, deadlineMs: 120_001 })).toBe(false);
    expect(takes({ ...runRequest, definition: { ...draft, title: 'x' } })).toBe(false);
    expect(takes({ ...runRequest, limits: { rows: 0, bytes: 1, seconds: 1 } })).toBe(false);
    expect(takes({ ...runRequest, values: { site: 1 } })).toBe(false);
    // A definition that fails its checks, or values that fail their declarations, are no run: the
    // service checks both first, and the connector holds a request to them again at its door.
    expect(takes({ ...runRequest, definition: { ...draft, key: ['nothing'] } })).toBe(false);
    expect(takes({ ...runRequest, values: { site: '01' } })).toBe(false);
    expect(takes({ ...runRequest, values: {} })).toBe(false);
    const describing = (text: string, parameters = draft.parameters) =>
      describeSqlRequestSchema.safeParse({ ...testRequest, sql: { text, parameters } }).success;
    expect(describing(draft.fetch.text)).toBe(true);
    expect(describing("select 'open")).toBe(false);
    expect(describing('select {{nothing}}')).toBe(false);
    expect(describing('select {{#site}}')).toBe(false);
    expect(describing('select 1', [...draft.parameters, ...draft.parameters])).toBe(false);
    expect(RUN_REQUEST_MAX_BYTES).toBe(1024 * 1024 + 64 * 1024);
  });
});
