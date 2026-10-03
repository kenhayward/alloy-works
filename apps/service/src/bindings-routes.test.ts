import { canonicalResultBytes } from '@alloy-works/domain';
import { queryAs } from '@alloy-works/db/testing';
import { removeGrant } from '@alloy-works/db';
import { tenantPrefix } from '@alloy-works/objects';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endSession } from './sessions.js';
import {
  binding,
  definitionBody,
  ranOk,
  sha256,
  startHarness,
  type Harness,
} from './test/bindings-harness.js';

type Json = Record<string, unknown>;

interface Held {
  dataset: string;
  version: string;
  number: string;
  provenance: Json & { checksum: string; queryDefinition: { artifact: string; version: string } };
  name: string | null;
  stale: boolean;
  act: string;
  by: string;
  at: string;
}
interface State {
  node: string;
  binding: Json & { id: string };
  held: Held | null;
  waiting: { version: string; provenance: Json & { checksum: string } } | null;
}

describe('bindings and datasets through the service', () => {
  let h: Harness;
  let connection: { id: string; version: string };

  beforeAll(async () => {
    h = await startHarness();
    connection = await h.connection('Readings');
  });

  afterAll(async () => {
    await h?.close();
  });

  /** A component holding these bindings, and a document placing it once. */
  const placed = async (...inlines: unknown[]) => {
    const component = await h.component(h.general, 'Readings');
    await h.place(component, { type: 'text', value: 'The site is ', marks: [] }, ...inlines);
    const document = await h.documentReferencing([component.id]);
    return { component, document, node: document.nodes[0]! };
  };
  const resolve = (as: string, document: string, bindings: { node: string; binding: string }[]) =>
    h.call(as, 'POST', `/v1/documents/${document}/bindings/resolve`, { bindings });
  const check = (as: string, document: string) =>
    h.call(as, 'POST', `/v1/documents/${document}/bindings/check`, {});
  const states = async (as: string, document: string) => {
    const answer = await h.call(as, 'GET', `/v1/documents/${document}/bindings`);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ bindings: State[] }>().bindings;
  };
  const stateOf = async (as: string, document: string, id: string) =>
    (await states(as, document)).find((each) => each.binding.id === id)!;
  const runs = () => h.connector.asked.filter((each) => each.path === '/v1/run');
  /** Every row of a table in the tenant's schema, as the platform's owner reads it. */
  const rowsOf = async (table: string) =>
    (await queryAs(h.db.adminUrl, `select * from ${h.tenant.schema}.${table} order by 1`))
      .rows as Json[];
  const datasetVersions = async () =>
    (
      await queryAs(
        h.db.adminUrl,
        `select count(*)::int as n from ${h.tenant.schema}.artifact_version where kind = 'dataset'`,
      )
    ).rows[0] as { n: number };

  it('DAT-083 resolves a binding to a dataset version stored with its provenance, whatever its mode', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id),
      binding('b2', definition.id, { mode: 'pinned', parameters: { site: { literal: '2' } } }),
    );
    h.connector.mode = 'answer';
    h.connector.run = ranOk([['1', 'North']]);
    const answer = await resolve('ada', document.id, [
      { node, binding: 'b1' },
      { node, binding: 'b2' },
    ]);
    expect(answer.statusCode, answer.body).toBe(200);
    const results = answer.json<{ results: { binding: string; held: Json }[] }>().results;
    expect(results).toEqual([
      {
        node,
        binding: 'b1',
        held: { dataset: expect.any(String), version: expect.any(String), reused: false },
      },
      {
        node,
        binding: 'b2',
        held: { dataset: expect.any(String), version: expect.any(String), reused: false },
      },
    ]);
    // Two questions - site 1 and site 2 - so two datasets, whatever each binding's mode.
    expect(results[0]!.held.dataset).not.toBe(results[1]!.held.dataset);
    const checksum = sha256(
      canonicalResultBytes({
        columns: [
          ['id', 'integer'],
          ['name', 'text'],
        ],
        rows: [['1', 'North']],
      }),
    );
    for (const [id, site] of [
      ['b1', '1'],
      ['b2', '2'],
    ] as const) {
      const state = await stateOf('ada', document.id, id);
      expect(state.held, id).toMatchObject({
        number: '0.1',
        stale: false,
        act: 'resolve',
        by: h.ids.ada,
        name: null,
        provenance: {
          schemaVersion: 1,
          queryDefinition: { artifact: definition.id, version: definition.version },
          connection: { artifact: connection.id, version: connection.version },
          parameters: { site },
          ran: { sql: 'select id, name from sample.site where id = $1::int8 order by id' },
          identity: { kind: 'service' },
          durationMs: 12,
          rowCount: 1,
          columns: definitionBody(connection.id).columns,
          canonical: 1,
          checksum,
          images: {},
        },
      });
      expect(state.waiting, id).toBeNull();
    }
  });

  it('stores a result once, under its checksum, and refuses one whose bytes do not match it, recording nothing', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(binding('b1', definition.id));
    const rows = [['7', 'Harbour']];
    h.connector.run = ranOk(rows);
    expect((await resolve('ada', document.id, [{ node, binding: 'b1' }])).statusCode).toBe(200);
    const held = (await stateOf('ada', document.id, 'b1')).held!;
    const bytes = canonicalResultBytes({
      columns: [
        ['id', 'integer'],
        ['name', 'text'],
      ],
      rows: rows as string[][],
    });
    expect(held.provenance.checksum).toBe(sha256(bytes));
    const kept = await h.tenantDb.withTenant(h.tenant, async (trx) =>
      (await h.stores.forTenant(trx, h.tenant)).get(
        `${tenantPrefix(h.tenant)}sha256/${held.provenance.checksum}`,
      ),
    );
    expect(kept.toString('utf8')).toBe(bytes);

    // A connector answering rows that do not hash to the checksum it gave is not believed.
    const { document: other, node: otherNode } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '8' } } }),
    );
    const lying = ranOk([['8', 'Quay']]);
    h.connector.run = lying.outcome === 'ok' ? { ...lying, checksum: '0'.repeat(64) } : lying;
    const before = await datasetVersions();
    const answer = await resolve('ada', other.id, [{ node: otherNode, binding: 'b1' }]);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toMatchObject({
      results: [
        {
          node: otherNode,
          binding: 'b1',
          failure: { code: 'connector_error', attribution: 'connector' },
        },
      ],
    });
    expect(await datasetVersions()).toEqual(before);
    expect((await stateOf('ada', other.id, 'b1')).held).toBeNull();
  });

  it("DAT-015 resolves a binding pinned to a definition's version against that version, and a floating one against the latest", async () => {
    const definition = await h.definition(connection.id);
    const second = await h.nextDefinition(
      definition.id,
      definition.version,
      definitionBody(connection.id, {
        fetch: {
          kind: 'sql',
          text: 'select id, name from sample.site where id = {{site}} and true order by id',
        },
      }),
    );
    const { document, node } = await placed(
      binding('pinned', definition.id, { version: definition.version }),
      binding('floating', definition.id, { parameters: { site: { literal: '3' } } }),
    );
    h.connector.run = ranOk([['1', 'North']]);
    const asked = runs().length;
    const answer = await resolve('ada', document.id, [
      { node, binding: 'pinned' },
      { node, binding: 'floating' },
    ]);
    expect(answer.statusCode, answer.body).toBe(200);
    // The run each was sent is its version's SQL.
    const sent = runs()
      .slice(asked)
      .map((each) => each.body as { definition: { fetch: { text: string } }; values: Json })
      .map((each) => [each.values.site, each.definition.fetch.text]);
    expect(sent.sort()).toEqual([
      ['1', 'select id, name from sample.site where id = {{site}} order by id'],
      ['3', 'select id, name from sample.site where id = {{site}} and true order by id'],
    ]);
    expect((await stateOf('ada', document.id, 'pinned')).held!.provenance.queryDefinition).toEqual({
      artifact: definition.id,
      version: definition.version,
    });
    expect(
      (await stateOf('ada', document.id, 'floating')).held!.provenance.queryDefinition,
    ).toEqual({
      artifact: definition.id,
      version: second,
    });
  });

  it('DAT-084 records a different result found by a check as a waiting revision and resolves nothing to it', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('checked', definition.id, { parameters: { site: { literal: '11' } } }),
      binding('pinned', definition.id, { mode: 'pinned', parameters: { site: { literal: '12' } } }),
    );
    h.connector.run = ranOk([['11', 'North']]);
    expect(
      (
        await resolve('ada', document.id, [
          { node, binding: 'checked' },
          { node, binding: 'pinned' },
        ])
      ).statusCode,
    ).toBe(200);
    const held = (await stateOf('ada', document.id, 'checked')).held!;

    // The source has not moved: nothing waits, and nothing is recorded.
    const before = await datasetVersions();
    let answer = await check('ada', document.id);
    expect(answer.statusCode, answer.body).toBe(200);
    // A pinned binding is never checked.
    expect(answer.json()).toEqual({
      results: [{ node, binding: 'checked', outcome: 'unchanged' }],
    });
    expect(await datasetVersions()).toEqual(before);

    // It has: a version is recorded and waits, and the binding still holds what it held.
    h.connector.run = ranOk([['11', 'North Quay']]);
    answer = await check('ada', document.id);
    expect(answer.statusCode, answer.body).toBe(200);
    const [result] = answer.json<{ results: { outcome: string; version: string }[] }>().results;
    expect(result).toMatchObject({ node, binding: 'checked', outcome: 'revision' });
    const state = await stateOf('ada', document.id, 'checked');
    expect(state.held).toMatchObject({ version: held.version, act: 'resolve' });
    expect(state.waiting).toMatchObject({ version: result!.version });
    expect(state.waiting!.provenance.checksum).not.toBe(held.provenance.checksum);
    expect(
      (await rowsOf('binding_resolution')).filter((row) => row.document_id === document.id),
    ).toHaveLength(2);
  });

  it("DAT-093 moves only the accepting document's binding to the accepted version, and another document holding the same dataset keeps its own", async () => {
    const definition = await h.definition(connection.id);
    const component = await h.component(h.general, 'Shared');
    await h.place(
      component,
      binding('b1', definition.id, { parameters: { site: { literal: '21' } } }),
    );
    const first = await h.documentReferencing([component.id]);
    const second = await h.documentReferencing([component.id]);
    h.connector.run = ranOk([['21', 'Old']]);
    for (const each of [first, second]) {
      expect(
        (await resolve('ada', each.id, [{ node: each.nodes[0]!, binding: 'b1' }])).statusCode,
      ).toBe(200);
    }
    const before = (await stateOf('ada', second.id, 'b1')).held!;
    expect((await stateOf('ada', first.id, 'b1')).held!.version).toBe(before.version);

    h.connector.run = ranOk([['21', 'New']]);
    const revision = (await check('ada', first.id)).json<{ results: { version: string }[] }>()
      .results[0]!.version;
    const accepted = await h.call('ada', 'POST', `/v1/documents/${first.id}/bindings/accept`, {
      node: first.nodes[0],
      binding: 'b1',
      version: revision,
      replaces: before.version,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json<State>().held).toMatchObject({
      version: revision,
      act: 'accept',
      stale: false,
    });
    expect((await stateOf('ada', first.id, 'b1')).held!.version).toBe(revision);
    expect((await stateOf('ada', first.id, 'b1')).waiting).toBeNull();
    // The other document keeps its version, with the revision waiting there for somebody to accept.
    const kept = await stateOf('ada', second.id, 'b1');
    expect(kept.held!.version).toBe(before.version);
    expect(kept.waiting!.version).toBe(revision);
  });

  it('DAT-037 records each acceptance with what the binding held and what it holds after, who and when', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '31' } } }),
    );
    h.connector.run = ranOk([['31', 'Before']]);
    await resolve('ada', document.id, [{ node, binding: 'b1' }]);
    const held = (await stateOf('ada', document.id, 'b1')).held!;
    h.connector.run = ranOk([['31', 'After']]);
    const revision = (await check('ada', document.id)).json<{ results: { version: string }[] }>()
      .results[0]!.version;
    const started = new Date();
    await h.call('grace', 'POST', `/v1/documents/${document.id}/bindings/accept`, {
      node,
      binding: 'b1',
      version: revision,
      replaces: held.version,
    });
    const rows = (await rowsOf('binding_resolution')).filter(
      (row) => row.document_id === document.id,
    );
    expect(
      rows.map((row) => [row.act, row.replaces, row.dataset_version, row.resolved_by]),
    ).toEqual([
      ['resolve', null, held.version, h.ids.ada],
      ['accept', held.version, revision, h.ids.grace],
    ]);
    expect((rows[1]!.resolved_at as Date).getTime()).toBeGreaterThanOrEqual(
      started.getTime() - 1000,
    );
  });

  it('refuses an acceptance from what the binding no longer holds, or of a version that is not a newer result of it, answering the binding as it stands', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '41' } } }),
    );
    h.connector.run = ranOk([['41', 'One']]);
    await resolve('ada', document.id, [{ node, binding: 'b1' }]);
    const held = (await stateOf('ada', document.id, 'b1')).held!;
    h.connector.run = ranOk([['41', 'Two']]);
    const revision = (await check('ada', document.id)).json<{ results: { version: string }[] }>()
      .results[0]!.version;
    const accept = (version: string, replaces: string) =>
      h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/accept`, {
        node,
        binding: 'b1',
        version,
        replaces,
      });
    for (const [what, answer] of [
      ['replaces a version not held', await accept(revision, revision)],
      ['the version held again', await accept(held.version, held.version)],
    ] as const) {
      expect(answer.statusCode, `${what}: ${answer.body}`).toBe(409);
      expect(answer.json(), what).toMatchObject({
        code: 'resolution_precondition',
        current: { node, binding: { id: 'b1' }, held: { version: held.version } },
      });
    }
    expect((await accept(revision, held.version)).statusCode).toBe(200);
    // The same acceptance again, after the first: it names what the binding no longer holds.
    expect((await accept(revision, held.version)).statusCode).toBe(409);
    const missing = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/accept`, {
      node,
      binding: 'nothing',
      version: revision,
      replaces: held.version,
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({
      code: 'binding_missing',
      binding: 'nothing',
      document: document.id,
    });
  });

  it('accepts one of two revisions accepted at once, each replacing the version held, and refuses the other', async () => {
    // Each round a binding holding v1 with v2 and v3 waiting, and both accepted at the same moment.
    for (let round = 0; round < 10; round += 1) {
      const definition = await h.definition(connection.id);
      const site = String(2000 + round);
      const { document, node } = await placed(
        binding('b1', definition.id, { parameters: { site: { literal: site } } }),
      );
      h.connector.run = ranOk([[site, 'One']]);
      await resolve('ada', document.id, [{ node, binding: 'b1' }]);
      const held = (await stateOf('ada', document.id, 'b1')).held!;
      const revisions: string[] = [];
      for (const name of ['Two', 'Three']) {
        h.connector.run = ranOk([[site, name]]);
        revisions.push(
          (await check('ada', document.id)).json<{ results: { version: string }[] }>().results[0]!
            .version,
        );
      }
      const answers = await Promise.all(
        revisions.map((version) =>
          h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/accept`, {
            node,
            binding: 'b1',
            version,
            replaces: held.version,
          }),
        ),
      );
      const codes = answers.map((each) => each.statusCode).sort();
      expect(codes, `round ${round}`).toEqual([200, 409]);
      expect(answers.find((each) => each.statusCode === 409)!.json()).toMatchObject({
        code: 'resolution_precondition',
      });
      const rows = (await rowsOf('binding_resolution')).filter(
        (row) => row.document_id === document.id,
      );
      expect(rows.map((row) => row.act)).toEqual(['resolve', 'accept']);
    }
  });

  it('DAT-090 answers a stored result to whoever may read the document holding it, and to nobody else', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '51' } } }),
    );
    h.connector.run = ranOk([['51', 'Lighthouse']]);
    await resolve('ada', document.id, [{ node, binding: 'b1' }]);
    const held = (await stateOf('ada', document.id, 'b1')).held!;
    // Alice reads General, and may use no connection at all.
    const read = await h.call(
      'alice',
      'GET',
      `/v1/documents/${document.id}/datasets/${held.version}`,
    );
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toEqual({
      dataset: held.dataset,
      version: held.version,
      name: null,
      provenance: held.provenance,
      result: {
        columns: [
          ['id', 'integer'],
          ['name', 'text'],
        ],
        rows: [['51', 'Lighthouse']],
      },
    });
    expect((await states('alice', document.id)).map((each) => each.held?.version)).toEqual([
      held.version,
    ]);
    // Ivy may read nothing: the document, its bindings and its results are not there for her.
    for (const url of [
      `/v1/documents/${document.id}/datasets/${held.version}`,
      `/v1/documents/${document.id}/bindings`,
    ]) {
      expect((await h.call('ivy', 'GET', url)).statusCode, url).toBe(404);
    }
    // A result another document holds is not read through this one.
    const { document: other, node: otherNode } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '52' } } }),
    );
    h.connector.run = ranOk([['52', 'Elsewhere']]);
    await resolve('ada', other.id, [{ node: otherNode, binding: 'b1' }]);
    const elsewhere = (await stateOf('ada', other.id, 'b1')).held!.version;
    expect(
      (await h.call('alice', 'GET', `/v1/documents/${document.id}/datasets/${elsewhere}`))
        .statusCode,
    ).toBe(404);
  });

  it('shows the SQL that ran and the connection only to a reader of the document who may read the definition', async () => {
    // A definition in Quality, which Alice may not read, bound in General, which she may.
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    const definition = await h.definition(connection.id, {}, h.quality);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '53' } } }),
    );
    h.connector.run = ranOk([['53', 'Hidden']]);
    await resolve('ada', document.id, [{ node, binding: 'b1' }]);
    h.connector.run = ranOk([['53', 'Hidden still']]);
    expect((await check('ada', document.id)).statusCode).toBe(200);
    const asAda = await stateOf('ada', document.id, 'b1');
    expect(asAda.held!.provenance).toMatchObject({
      ran: { sql: expect.stringContaining('sample.site') },
      connection: { artifact: connection.id },
    });
    const asAlice = await stateOf('alice', document.id, 'b1');
    for (const provenance of [asAlice.held!.provenance, asAlice.waiting!.provenance]) {
      expect(provenance).toMatchObject({ ran: { sql: null }, connection: null });
      // What the rows are stays inspectable: their checksum, count and declared columns.
      expect(provenance).toMatchObject({
        checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
        rowCount: 1,
        columns: definitionBody(connection.id).columns,
      });
    }
    const read = await h.call(
      'alice',
      'GET',
      `/v1/documents/${document.id}/datasets/${asAlice.held!.version}`,
    );
    expect(read.statusCode, read.body).toBe(200);
    expect(read.body).not.toContain('sample.site');
    expect(read.body).not.toContain(connection.id);
    expect(read.json()).toMatchObject({
      provenance: { ran: { sql: null }, connection: null },
      result: { rows: [['53', 'Hidden']] },
    });
  });

  it('DAT-086 fails a resolve with a named error identifying the definition, the binding and the document, and records nothing', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '61' } } }),
    );
    const before = await datasetVersions();
    const resolutions = (await rowsOf('binding_resolution')).length;
    // A run the source refuses.
    h.connector.run = {
      outcome: 'failed',
      failure: {
        code: 'source_refused',
        attribution: 'query',
        source: { sqlstate: '42P01', message: 'relation "sample.site" does not exist' },
      },
    };
    const answer = await resolve('ada', document.id, [{ node, binding: 'b1' }]);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toEqual({
      results: [
        {
          node,
          binding: 'b1',
          failure: {
            code: 'source_refused',
            attribution: 'query',
            message: expect.stringContaining('42P01'),
            source: { sqlstate: '42P01', message: 'relation "sample.site" does not exist' },
            definition: definition.id,
            binding: 'b1',
            node,
            document: document.id,
          },
        },
      ],
    });
    // And a take the definition does not declare, refused before anything runs.
    const { document: taking, node: takingNode } = await placed(
      binding('b2', definition.id, { take: { column: 'height' } }),
    );
    const asked = runs().length;
    const refused = await resolve('ada', taking.id, [{ node: takingNode, binding: 'b2' }]);
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json()).toMatchObject({
      code: 'take_invalid',
      message: expect.stringContaining('height'),
      definition: definition.id,
      binding: 'b2',
      node: takingNode,
      document: taking.id,
    });
    expect(runs().length).toBe(asked);
    expect(await datasetVersions()).toEqual(before);
    expect((await rowsOf('binding_resolution')).length).toBe(resolutions);
  });

  it("answers the source's own message of a refused statement only to somebody who may write SQL on the connection", async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '62' } } }),
    );
    h.connector.run = {
      outcome: 'failed',
      failure: {
        code: 'source_refused',
        attribution: 'query',
        source: { sqlstate: '42501', message: 'permission denied for table payroll_secret' },
      },
    };
    // Grace may use the connection and may not write SQL on it; Ada may.
    for (const [as, sees] of [
      ['grace', false],
      ['ada', true],
    ] as const) {
      const answer = await resolve(as, document.id, [{ node, binding: 'b1' }]);
      expect(answer.statusCode, answer.body).toBe(200);
      const { failure } = answer.json<{
        results: { failure: { message: string; source: Json } }[];
      }>().results[0]!;
      expect(failure.source, as).toEqual(
        sees
          ? { sqlstate: '42501', message: 'permission denied for table payroll_secret' }
          : { sqlstate: '42501' },
      );
      expect(failure.message.includes('payroll_secret'), as).toBe(sees);
      expect(failure.message, as).toContain('42501');
    }
    // A check answers it alike.
    h.connector.run = ranOk([['62', 'Held']]);
    expect((await resolve('ada', document.id, [{ node, binding: 'b1' }])).statusCode).toBe(200);
    h.connector.run = {
      outcome: 'failed',
      failure: {
        code: 'source_refused',
        attribution: 'query',
        source: { sqlstate: '42501', message: 'permission denied for table payroll_secret' },
      },
    };
    const checked = await check('grace', document.id);
    expect(checked.statusCode, checked.body).toBe(200);
    expect(checked.body).not.toContain('payroll_secret');
    expect(checked.json()).toMatchObject({
      results: [
        { outcome: 'failed', failure: { code: 'source_refused', source: { sqlstate: '42501' } } },
      ],
    });
  });

  it('refuses a resolve before anything runs: a binding the node does not hold, a retired definition, a document parameter, and a caller who may not use the connection', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '71' } } }),
      binding('fromDocument', definition.id, { parameters: { site: { document: 'site' } } }),
      binding('wrongValue', definition.id, { parameters: { site: { literal: 'north' } } }),
    );
    const asked = runs().length;
    const missing = await resolve('ada', document.id, [{ node, binding: 'nothing' }]);
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({
      code: 'binding_missing',
      binding: 'nothing',
      node,
      document: document.id,
    });
    for (const id of ['fromDocument', 'wrongValue']) {
      const answer = await resolve('ada', document.id, [{ node, binding: id }]);
      expect(answer.statusCode, id).toBe(400);
      expect(answer.json(), id).toMatchObject({
        code: 'parameter_invalid',
        binding: id,
        definition: definition.id,
      });
    }
    // Ivy may edit the document and read what it binds; without use_connection she may not run it.
    const {
      component: theirs,
      document: hers,
      node: hersNode,
    } = await placed(binding('b1', definition.id));
    await h.allow(h.ids.ivy!, h.roles.Author!, { kind: 'artifact', id: hers.id });
    await h.allow(h.ids.ivy!, h.roles.Reader!, { kind: 'artifact', id: theirs.id });
    await h.allow(h.ids.ivy!, h.roles.Reader!, { kind: 'artifact', id: definition.id });
    const forbidden = await resolve('ivy', hers.id, [{ node: hersNode, binding: 'b1' }]);
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    // Retired: it runs nothing.
    const retired = await h.definition(connection.id);
    const latest = await h.nextDefinition(
      retired.id,
      retired.version,
      definitionBody(connection.id, { retired: true }),
    );
    expect(latest).toBeDefined();
    const { document: old, node: oldNode } = await placed(binding('b1', retired.id));
    const refused = await resolve('ada', old.id, [{ node: oldNode, binding: 'b1' }]);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'definition_retired', definition: retired.id });
    expect(runs().length).toBe(asked);
  });

  it('answers a binding naming a definition the caller may not read exactly as one naming no definition', async () => {
    const definition = await h.definition(connection.id);
    const answers = [];
    for (const query of [definition.id, '00000000-0000-4000-8000-000000000000']) {
      const { component, document, node } = await placed(binding('b1', query));
      // Ivy may edit the document and read the component, and may not read the definition.
      await h.allow(h.ids.ivy!, h.roles.Author!, { kind: 'artifact', id: document.id });
      await h.allow(h.ids.ivy!, h.roles.Reader!, { kind: 'artifact', id: component.id });
      const answer = await resolve('ivy', document.id, [{ node, binding: 'b1' }]);
      expect(answer.statusCode, answer.body).toBe(400);
      const { code, message, definition: named } = answer.json<Json>();
      expect(named).toBe(query);
      answers.push({ code, message });
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).toMatchObject({ code: 'binding_missing' });
  });

  /**
   * A binding Ivy may resolve and nothing more: on a connection and definition of its own, edit on the
   * document, read on the component and the definition, and use of the connection.
   */
  const ivyMayResolve = async (site: string) => {
    const own = await h.connection(`Ivy's ${site}`);
    const definition = await h.definition(own.id);
    const { component, document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: site } } }),
    );
    const edit = await h.allow(h.ids.ivy!, h.roles.Author!, { kind: 'artifact', id: document.id });
    await h.allow(h.ids.ivy!, h.roles.Reader!, { kind: 'artifact', id: component.id });
    await h.allow(h.ids.ivy!, h.roles.Reader!, { kind: 'artifact', id: definition.id });
    const use = await h.allow(h.ids.ivy!, h.roles['Connection user']!, {
      kind: 'artifact',
      id: own.id,
    });
    return { document, node, edit, use };
  };

  /** Starts a resolve that waits at the source until it is released. */
  const heldResolve = (as: string, document: string, node: string, id: string) => {
    let release!: () => void;
    h.connector.hold = new Promise<void>((done) => (release = done));
    const pending = resolve(as, document, [{ node, binding: id }]);
    // Long enough for the deciding transaction to commit and the run to be asked.
    const pause = () => new Promise((settle) => setTimeout(settle, 150));
    return {
      waited: pause,
      release: async () => {
        await pause();
        release();
        h.connector.hold = undefined;
        return pending;
      },
    };
  };

  it('records nothing where the edit permission is revoked while the source answers', async () => {
    const { document, node, edit } = await ivyMayResolve('81');
    const before = (await rowsOf('binding_resolution')).length;
    const versions = await datasetVersions();
    h.connector.run = ranOk([['81', 'Revoked']]);
    const run = heldResolve('ivy', document.id, node, 'b1');
    await run.waited();
    await h.tenantDb.withTenant(h.tenant, (trx) => removeGrant(trx, edit));
    const answer = await run.release();
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'access_changed' });
    expect((await rowsOf('binding_resolution')).length).toBe(before);
    expect(await datasetVersions()).toEqual(versions);
  });

  it('records nothing where use of the connection is revoked while the source answers', async () => {
    const { document, node, use } = await ivyMayResolve('82');
    const before = (await rowsOf('binding_resolution')).length;
    h.connector.run = ranOk([['82', 'Revoked']]);
    const run = heldResolve('ivy', document.id, node, 'b1');
    await run.waited();
    await h.tenantDb.withTenant(h.tenant, (trx) => removeGrant(trx, use));
    const answer = await run.release();
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'access_changed' });
    expect((await rowsOf('binding_resolution')).length).toBe(before);
  });

  it('records nothing where a component version changes the binding while the source answers', async () => {
    const definition = await h.definition(connection.id);
    const { component, document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '83' } } }),
    );
    const before = (await rowsOf('binding_resolution')).length;
    h.connector.run = ranOk([['83', 'Changed']]);
    const run = heldResolve('ada', document.id, node, 'b1');
    await run.waited();
    await h.place(
      component,
      binding('b1', definition.id, { parameters: { site: { literal: '84' } } }),
    );
    const answer = await run.release();
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({
      code: 'binding_changed',
      binding: 'b1',
      node,
      document: document.id,
    });
    expect((await rowsOf('binding_resolution')).length).toBe(before);
  });

  it('shows a resolution as stale once a component version changes its binding, and checks it no more', async () => {
    const definition = await h.definition(connection.id);
    const { component, document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '91' } } }),
    );
    h.connector.run = ranOk([['91', 'Before']]);
    await resolve('ada', document.id, [{ node, binding: 'b1' }]);
    expect((await stateOf('ada', document.id, 'b1')).held!.stale).toBe(false);
    // A checked binding turned pinned asks the same rows, and is still another binding (D3-R).
    await h.place(
      component,
      binding('b1', definition.id, { mode: 'pinned', parameters: { site: { literal: '91' } } }),
    );
    expect((await stateOf('ada', document.id, 'b1')).held!.stale).toBe(true);
    await h.place(
      component,
      binding('b1', definition.id, { parameters: { site: { literal: '92' } } }),
    );
    const asked = runs().length;
    const answer = await check('ada', document.id);
    expect(answer.json()).toEqual({
      results: [{ node, binding: 'b1', outcome: 'unchecked', reason: 'unresolved' }],
    });
    expect(runs().length).toBe(asked);
  });

  it('checks each distinct question once, two at a time, and at most fifty a check', async () => {
    const definition = await h.definition(connection.id);
    // 51 questions, each asked at two nodes placing the one component.
    const bindings = Array.from({ length: 51 }, (_, at) =>
      binding(`b${at}`, definition.id, { parameters: { site: { literal: String(1000 + at) } } }),
    );
    const component = await h.component(h.general, 'Many');
    await h.place(component, ...bindings);
    const document = await h.documentReferencing([component.id, component.id]);
    h.connector.run = ranOk([['1000', 'Same']]);
    for (const node of document.nodes) {
      for (const chunk of [bindings.slice(0, 50), bindings.slice(50)]) {
        const answer = await resolve(
          'ada',
          document.id,
          chunk.map((each) => ({ node, binding: each.id })),
        );
        expect(answer.statusCode, answer.body).toBe(200);
      }
    }
    // How many runs the fake answers at once, each taking a moment.
    h.connector.mostRunning = 0;
    h.connector.runMs = 5;
    const asked = runs().length;
    const checked = await check('ada', document.id).finally(() => {
      h.connector.runMs = undefined;
    });
    expect(checked.statusCode, checked.body).toBe(200);
    expect(runs().length - asked).toBe(50);
    expect(h.connector.mostRunning).toBe(2);
    const results = checked.json<{
      results: { node: string; binding: string; outcome: string }[];
    }>().results;
    expect(results).toHaveLength(102);
    // The question past fifty is unchecked at both its nodes; every other is unchanged at both.
    expect(results.filter((each) => each.outcome === 'unchecked')).toEqual(
      document.nodes.map((node) => ({
        node,
        binding: 'b50',
        outcome: 'unchecked',
        reason: 'limit',
      })),
    );
    expect(results.filter((each) => each.outcome === 'unchanged')).toHaveLength(100);
  });

  it('leaves a binding unchecked for somebody who may not use its connection, and runs nothing for it', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '95' } } }),
    );
    h.connector.run = ranOk([['95', 'Kept']]);
    await resolve('ada', document.id, [{ node, binding: 'b1' }]);
    const asked = runs().length;
    // Alice reads the document, and uses no connection.
    const answer = await check('alice', document.id);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toEqual({
      results: [{ node, binding: 'b1', outcome: 'unchecked', reason: 'permission' }],
    });
    expect(runs().length).toBe(asked);
  });

  it('names a dataset, the latest name its name, by whoever may edit it', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '96' } } }),
    );
    h.connector.run = ranOk([['96', 'Named']]);
    await resolve('ada', document.id, [{ node, binding: 'b1' }]);
    const { dataset } = (await stateOf('ada', document.id, 'b1')).held!;
    const name = (as: string, value: string) =>
      h.call(as, 'PUT', `/v1/datasets/${dataset}/name`, { name: value });
    const first = await name('ada', 'Site readings');
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({
      name: 'Site readings',
      namedBy: h.ids.ada,
      namedAt: expect.any(String),
    });
    expect((await name('grace', 'Harbour readings')).statusCode).toBe(200);
    expect((await stateOf('alice', document.id, 'b1')).held!.name).toBe('Harbour readings');
    const padded = await name('ada', ' padded');
    expect(padded.statusCode).toBe(400);
    expect(padded.json()).toMatchObject({ code: 'name_invalid' });
    // Alice reads General, and may not edit there; Ivy may not read the dataset at all.
    expect((await name('alice', 'Mine')).statusCode).toBe(403);
    expect((await name('ivy', 'Mine')).statusCode).toBe(404);
  });

  it('refuses a binding in a section title, by name', async () => {
    const definition = await h.definition(connection.id);
    const document = await h.documentReferencing([]);
    const answer = await h.call('ada', 'POST', `/v1/documents/${document.id}/outline`, {
      openedFrom: document.version,
      operation: {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'section', title: [binding('b1', definition.id)] },
      },
    });
    expect(answer.statusCode, answer.body).toBe(400);
    expect(answer.json()).toMatchObject({ code: 'binding_in_title' });
  });

  // Last: it ends Ivy's session.
  it('records nothing where the session ends while the source answers', async () => {
    const { document, node } = await ivyMayResolve('99');
    const before = (await rowsOf('binding_resolution')).length;
    h.connector.run = ranOk([['99', 'Signed out']]);
    const run = heldResolve('ivy', document.id, node, 'b1');
    await run.waited();
    const token = h.cookies.ivy!.slice(h.cookies.ivy!.indexOf('=') + 1);
    await h.tenantDb.withTenant(h.tenant, (trx) => endSession(trx, token));
    const answer = await run.release();
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'access_changed' });
    expect((await rowsOf('binding_resolution')).length).toBe(before);
  });
});
