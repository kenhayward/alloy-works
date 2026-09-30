import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ConnectionSettings } from './connection.js';
import {
  childRequestSchema,
  describeAnswerSchema,
  describeRequestSchema,
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
      [sealRequestSchema, { tenant: 'acme', secret: 'invented-password', settings }],
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
      expect(sealRequestSchema.safeParse({ tenant: 'acme', secret, settings }).success).toBe(false);
    }
    expect(
      sealRequestSchema.safeParse({ tenant: 'acme', secret: 'p'.repeat(4096), settings }).success,
    ).toBe(true);
    expect(
      sealRequestSchema.safeParse({ tenant: 'acme', secret: 'é'.repeat(2048), settings }).success,
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
});
