import { describe, expect, it } from 'vitest';

import { capabilitiesOf, type ConnectionSettings } from './connection.js';
import {
  capabilityProblems,
  checkQueryDefinition,
  draftDefinitionSchema,
  type DraftDefinition,
} from './definition.js';
import { parseProvenance } from './provenance.js';
import {
  childRequestSchema,
  REVISION_MAX_CHARACTERS,
  revisionAnswerSchema,
  revisionRequestSchema,
  runAnswerSchema,
  runRequestSchema,
} from './protocol.js';

/**
 * A source's revision (the FR plan, FR-B to FR-D): declared by its type, written by a PostgreSQL
 * definition's author, carried by a run's answer and its provenance, and asked by a request of its own.
 */

const postgres: ConnectionSettings = {
  schemaVersion: 1,
  name: 'Readings',
  description: '',
  type: 'postgres',
  source: { host: 'source-postgres', port: 5432, database: 'r', account: 'reader', tls: 'require' },
  identity: { kind: 'service' },
  retired: false,
};

const CONNECTION = '0b6a3c4d-1e2f-4a5b-8c7d-9e0f1a2b3c4d';

const draft = (over: Partial<DraftDefinition> = {}): DraftDefinition => ({
  schemaVersion: 1,
  connection: CONNECTION,
  parameters: [],
  fetch: { kind: 'sql', text: 'select id from sample.site' },
  columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'valid',
  limits: { rows: 100, bytes: 1_000_000, seconds: 10 },
  ...over,
});

const REVISION = { text: 'select max(changed) from sample.site' };

const run = {
  requestId: '6f1c2a0e-8a4b-4c1e-9d7a-1b2c3d4e5f60',
  tenant: 'acme',
  connection: { id: CONNECTION, version: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f' },
  settings: postgres,
  sealed: 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.Q0NDQw',
  definition: draft({ revision: REVISION }),
  values: {},
  limits: { rows: 100, bytes: 1_000_000, seconds: 10 },
  deadlineMs: 10_000,
};

const answer = {
  outcome: 'ok',
  result: { columns: [['id', 'integer']], rows: [['1']] },
  checksum: 'a'.repeat(64),
  rowCount: 1,
  ran: { sql: 'select id from sample.site' },
  durationMs: 3,
};

describe("a source's revision (the FR plan)", () => {
  it('DAT-073 declares by type whether a source reports a revision: HTTP, S3 and PostgreSQL do, an extension does not', () => {
    for (const type of ['postgres', 'http', 's3'] as const) {
      expect(capabilitiesOf({ type, source: {} } as never).revision, type).toBe(true);
    }
    const extension = {
      type: 'extension',
      source: { capabilities: { parameters: true, keyColumns: true, rowLimit: true } },
    } as never;
    expect(capabilitiesOf(extension)).toEqual({ parameters: true, revision: false });
  });

  it("takes a PostgreSQL definition's revision statement of at most 4,000 characters, lexing whole and binding nothing", () => {
    expect(draftDefinitionSchema.parse(draft({ revision: REVISION })).revision).toEqual(REVISION);
    expect(checkQueryDefinition(draft({ revision: REVISION }))).toEqual([]);
    expect(
      draftDefinitionSchema.safeParse(draft({ revision: { text: 'x'.repeat(4001) } })).success,
    ).toBe(false);
    expect(draftDefinitionSchema.safeParse(draft({ revision: { text: '' } })).success).toBe(false);
    const paths = (revision: { text: string }, over: Partial<DraftDefinition> = {}) =>
      checkQueryDefinition(draft({ revision, ...over })).map((each) => each.path);
    expect(paths({ text: 'select {{site}}' })).toEqual(['revision.text']);
    expect(paths({ text: "select 'unclosed" })).toEqual(['revision.text']);
    // A stored result's query has no source to ask (R21-A).
    expect(
      paths(REVISION, {
        connection: undefined,
        fetch: {
          kind: 'dataset',
          format: 1,
          dataset: '2c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
          query: { sources: [], joins: [], select: [], groupBy: [] },
        } as never,
      }),
    ).toContain('revision');
  });

  it('refuses a revision statement on any source but PostgreSQL', () => {
    expect(capabilityProblems({ parameters: [], revision: REVISION }, postgres)).toEqual([]);
    for (const type of ['http', 's3'] as const) {
      expect(
        capabilityProblems({ parameters: [], revision: REVISION }, { type, source: {} } as never),
        type,
      ).toEqual([expect.objectContaining({ path: 'revision' })]);
    }
  });

  it("carries a run's revision of at most 256 characters, in its answer and its provenance", () => {
    expect(runAnswerSchema.parse({ ...answer, revision: '"v7"' })).toMatchObject({
      revision: '"v7"',
    });
    expect(runAnswerSchema.safeParse({ ...answer, revision: 'x'.repeat(257) }).success).toBe(false);
    expect(runAnswerSchema.safeParse({ ...answer, revision: '' }).success).toBe(false);
    const record = {
      schemaVersion: 1,
      queryDefinition: { artifact: CONNECTION, version: CONNECTION },
      connection: { artifact: CONNECTION, version: CONNECTION },
      parameters: {},
      ran: { sql: 'select 1' },
      identity: { kind: 'service' },
      at: '2026-10-22T09:15:00.123Z',
      durationMs: 1,
      rowCount: 0,
      columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
      canonical: 1,
      checksum: 'a'.repeat(64),
      images: {},
    };
    expect(parseProvenance({ ...record, revision: '"v7"' }).revision).toBe('"v7"');
    expect(parseProvenance(record).revision).toBeUndefined();
    expect(() => parseProvenance({ ...record, revision: 'x'.repeat(257) })).toThrow();
    expect(REVISION_MAX_CHARACTERS).toBe(256);
  });

  it('DAT-073 asks whether a source moved by the run it would send and the revision held, answering unchanged, changed or a failure', () => {
    const asked = { ...run, revision: '"v7"' };
    expect(revisionRequestSchema.parse(asked)).toEqual(asked);
    expect(revisionRequestSchema.safeParse({ ...run, revision: '' }).success).toBe(false);
    // Held to every rule a run is.
    expect(revisionRequestSchema.safeParse({ ...asked, deadlineMs: 10_000_000 }).success).toBe(
      false,
    );
    expect(runRequestSchema.safeParse(run).success).toBe(true);
    for (const each of [
      { outcome: 'unchanged' },
      { outcome: 'changed' },
      { outcome: 'failed', failure: { code: 'timeout', attribution: 'connector' } },
    ]) {
      expect(revisionAnswerSchema.parse(each)).toEqual(each);
    }
    expect(
      childRequestSchema.safeParse({
        kind: 'revision',
        request: asked,
        secret: 'secret',
        deny: [],
        connectTimeoutMs: 1000,
        failureFloorMs: 0,
      }).success,
    ).toBe(true);
  });

  it("runs no author's revision statement as a person: builder text alone runs as one (DAT-113)", () => {
    const asserting = {
      ...run,
      settings: {
        ...postgres,
        identity: { kind: 'endUser', mechanism: 'asserted', attribute: 'email' },
      },
      identity: { kind: 'asserted', role: 'ada' },
      definition: draft({
        fetch: {
          kind: 'builder',
          format: 1,
          query: {
            sources: [{ alias: 's', table: { schema: 'sample', name: 'site' } }],
            joins: [],
            select: [{ name: 'id', of: { source: 's', column: 'id' } }],
            groupBy: [],
          },
        },
      }),
    };
    const takes = runRequestSchema.safeParse(asserting).success;
    const withRevision = runRequestSchema.safeParse({
      ...asserting,
      definition: { ...asserting.definition, revision: REVISION },
    }).success;
    expect([takes, withRevision]).toEqual([true, false]);
  });
});
