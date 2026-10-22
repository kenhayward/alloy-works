import { auditEvents, newestEvent, queryAs } from '@alloy-works/db/testing';
import { canonicalResultBytes, type RunAnswer } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  binding,
  definitionBody,
  ranOk,
  sha256,
  startHarness,
  type Harness,
} from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/**
 * A check asking the source's revision before it runs anything (DAT-073; the FR plan, FR-D): for an
 * HTTP API, an S3 bucket and a PostgreSQL definition with a revision statement alike.
 */
describe("a check asking a source's revision first", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  const ok = async (answer: Promise<{ statusCode: number; body: string }>) => {
    const answered = await answer;
    expect(answered.statusCode, answered.body).toBe(200);
    return answered as unknown as { json<T>(): T };
  };

  /** A run's answer of one site, its revision and what it ran as said. */
  const answer = (name: string, ran: unknown, revision?: string) => {
    const result = {
      columns: [
        ['id', 'integer'],
        ['name', 'text'],
      ] as [string, 'integer' | 'text'][],
      rows: [['1', name]],
    };
    return {
      outcome: 'ok',
      result,
      checksum: sha256(canonicalResultBytes(result)),
      rowCount: 1,
      ran,
      durationMs: 3,
      ...(revision === undefined ? {} : { revision }),
    } as RunAnswer;
  };

  const sources = {
    postgres: {
      settings: {},
      definition: {
        parameters: [],
        fetch: { kind: 'sql', text: 'select id, name from sample.site where id = 1' },
        revision: { text: 'select max(changed) from sample.site' },
      },
      ran: { sql: 'select id, name from sample.site where id = 1' },
    },
    http: {
      settings: {
        type: 'http',
        source: { baseUrl: 'https://source-http/v1', secretHeader: 'x-api-key' },
      },
      definition: {
        parameters: [],
        fetch: {
          kind: 'http',
          request: { method: 'GET', path: [{ fixed: 'sites' }], query: [], headers: [] },
          format: { kind: 'json', rows: '/items' },
        },
        columns: [
          { name: 'id', from: { pointer: '/id' }, type: { base: 'integer' } },
          { name: 'name', from: { pointer: '/name' }, type: { base: 'text' } },
        ],
      },
      ran: { request: { method: 'GET', path: [{ fixed: 'sites' }], query: [], headers: [] } },
    },
    s3: {
      settings: {
        type: 's3',
        source: {
          endpoint: 'https://source-s3:8333',
          region: 'us-east-1',
          bucket: 'alloy-readings',
          pathStyle: true,
        },
      },
      definition: {
        parameters: [],
        fetch: {
          kind: 'file',
          key: [{ fixed: 'sites.csv' }],
          format: { kind: 'csv', delimiter: 'comma', headerRow: true, null: 'empty' },
        },
        columns: [
          { name: 'id', from: { header: 'id' }, type: { base: 'integer' } },
          { name: 'name', from: { header: 'name' }, type: { base: 'text' } },
        ],
      },
      ran: { object: { bucket: 'alloy-readings', key: 'sites.csv' } },
    },
  } as const;

  /** A document holding one checked binding on a source of this type, resolved at a revision. */
  async function held(type: keyof typeof sources, revision: string | undefined) {
    const source = sources[type];
    const connection = await h.connection(
      `${type} ${revision}`,
      h.general,
      source.settings as Json,
    );
    const definition = await h.definition(connection.id, source.definition);
    const component = await h.component(h.general, `Sites on ${type}`);
    await h.place(
      component,
      { type: 'text', value: 'The site is ', marks: [] },
      binding('b1', definition.id, { parameters: {} }),
    );
    const document = await h.documentReferencing([component.id]);
    const node = document.nodes[0]!;
    h.connector.mode = 'answer';
    h.connector.run = answer('North', source.ran as never, revision);
    await ok(
      h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
        bindings: [{ node, binding: 'b1' }],
      }),
    );
    const state = await ok(h.call('ada', 'GET', `/v1/documents/${document.id}/bindings`));
    const holding = state.json<{ bindings: { held: { dataset: string; version: string } }[] }>()
      .bindings[0]!.held;
    return { document: document.id, node, holding, definition, connection: connection.id };
  }

  const asked = (path: string) => h.connector.asked.filter((each) => each.path === path).length;
  const datasetVersions = async () =>
    (
      await queryAs(
        h.db.adminUrl,
        `select count(*)::int as n from ${h.tenant.schema}.artifact_version where kind = 'dataset'`,
      )
    ).rows[0] as { n: number };
  const check = (document: string) =>
    ok(h.call('ada', 'POST', `/v1/documents/${document}/bindings/check`, {}));

  for (const type of ['postgres', 'http', 's3'] as const) {
    it(`DAT-073 reaches no run at the connector for a check of an unchanged ${type} source`, async () => {
      const { document, node, holding } = await held(type, `${type}:1`);
      h.connector.revision = { outcome: 'unchanged' };
      const runs = asked('/v1/run');
      const revisions = h.connector.asked.length;
      const versions = await datasetVersions();
      const before = await h.tenantDb.withTenant(h.tenant, newestEvent);
      const answered = await check(document);
      expect(answered.json()).toEqual({ results: [{ node, binding: 'b1', outcome: 'unchanged' }] });
      expect(asked('/v1/run')).toBe(runs);
      expect(await datasetVersions()).toEqual(versions);
      // Asked by the run it would have sent, and the revision the held result was made at.
      const sent = h.connector.asked.slice(revisions);
      expect(sent.map((each) => each.path)).toEqual(['/v1/revision']);
      expect(sent[0]!.body).toMatchObject({ revision: `${type}:1`, values: {} });
      const events = await h.tenantDb.withTenant(h.tenant, (trx) => auditEvents(trx, before));
      expect(events.map((event) => [event.kind, event.detail])).toEqual([
        [
          'binding.checked',
          {
            document,
            node,
            binding: 'b1',
            dataset: holding.dataset,
            version: holding.version,
            outcome: 'unchanged',
            by: 'revision',
          },
        ],
      ]);
    });
  }

  it('DAT-073 runs a check whose source changed, failed to say, or holds no revision', async () => {
    const { document, node } = await held('http', 'http:2');
    for (const revision of [
      { outcome: 'changed' },
      { outcome: 'failed', failure: { code: 'timeout', attribution: 'connector' } },
    ] as const) {
      h.connector.revision = revision;
      h.connector.run = answer('North Quay', sources.http.ran as never, 'http:3');
      const runs = asked('/v1/run');
      const answered = await check(document);
      expect(asked('/v1/run'), revision.outcome).toBe(runs + 1);
      expect(answered.json<{ results: Json[] }>().results[0]).toMatchObject({
        node,
        outcome: 'revision',
      });
    }
    // A result held at no revision is never asked about.
    const plain = await held('http', undefined);
    h.connector.revision = { outcome: 'unchanged' };
    const revisions = asked('/v1/revision');
    const runs = asked('/v1/run');
    await check(plain.document);
    expect([asked('/v1/revision'), asked('/v1/run')]).toEqual([revisions, runs + 1]);
  });

  it("holds a revision statement to SQL's rules: written only by one who may write SQL, and on PostgreSQL alone", async () => {
    const connection = await h.connection('Revised by whom');
    const built = {
      fetch: {
        kind: 'builder',
        format: 1,
        query: {
          sources: [{ alias: 's', table: { schema: 'sample', name: 'site' } }],
          joins: [],
          select: [
            { name: 'id', of: { source: 's', column: 'id' } },
            { name: 'name', of: { source: 's', column: 'name' } },
          ],
          groupBy: [],
        },
      },
      parameters: [],
    };
    const make = (as: string, over: Json) =>
      h.call(as, 'POST', `/v1/spaces/${h.general}/query-definitions`, {
        definition: definitionBody(connection.id, over),
      });
    // Grace uses the connection, and writes no SQL: a built query is hers, its revision statement not.
    expect((await make('grace', built)).statusCode).toBe(200);
    const revised = { ...built, revision: { text: 'select max(changed) from sample.site' } };
    expect((await make('grace', revised)).statusCode).toBe(403);
    expect((await make('ada', revised)).statusCode).toBe(200);
    const http = await h.connection('Revised API', h.general, sources.http.settings as Json);
    const onHttp = await h.call('ada', 'POST', `/v1/spaces/${h.general}/query-definitions`, {
      definition: definitionBody(http.id, {
        ...sources.http.definition,
        revision: { text: 'select 1' },
      }),
    });
    expect(onHttp.statusCode).toBe(400);
    expect(onHttp.json<{ problems: Json[] }>().problems).toContainEqual(
      expect.objectContaining({ path: 'revision' }),
    );
  });

  it('asks nothing where the definition has moved on since the held result was made', async () => {
    const { document, definition, connection } = await held('postgres', 'postgres:2');
    const next = await h.nextDefinition(
      definition.id,
      definition.version,
      definitionBody(connection, {
        ...sources.postgres.definition,
        revision: { text: 'select max(changed) + 0 from sample.site' },
      }),
    );
    expect(next).toEqual(expect.any(String));
    h.connector.revision = { outcome: 'unchanged' };
    h.connector.run = ranOk([['1', 'North']], sources.postgres.ran.sql);
    const revisions = asked('/v1/revision');
    const runs = asked('/v1/run');
    await check(document);
    expect([asked('/v1/revision'), asked('/v1/run')]).toEqual([revisions, runs + 1]);
  });
});
