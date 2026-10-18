import { canonicalResultBytes, type RunAnswer } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binding, sha256, startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/** Sites by region, as a source answers them: what is stored, and then queried as a source. */
const SITES = [
  ['1', 'Harbour', 'North'],
  ['2', 'Quay', 'North'],
  ['3', 'Downs', 'South'],
];
const sitesAnswer = (): RunAnswer => {
  const result = {
    columns: [
      ['id', 'integer'],
      ['name', 'text'],
      ['region', 'text'],
    ] as [string, 'integer' | 'text'][],
    rows: SITES,
  };
  return {
    outcome: 'ok',
    result,
    checksum: sha256(canonicalResultBytes(result)),
    rowCount: SITES.length,
    ran: { sql: 'select id, name, region from sample.site order by id' },
    durationMs: 12,
  };
};

/** A query over a stored result: how many sites in each region, or the name of one. */
const overDataset = (dataset: string, over: Json = {}) => ({
  schemaVersion: 1,
  parameters: [],
  fetch: {
    kind: 'dataset',
    format: 1,
    dataset,
    query: {
      sources: [{ alias: 'd', table: { schema: 'dataset', name: 'rows' } }],
      joins: [],
      select: [
        { name: 'region', of: { source: 'd', column: 'region' } },
        { name: 'sites', of: { aggregate: 'count' } },
      ],
      groupBy: [{ source: 'd', column: 'region' }],
    },
  },
  columns: [
    { name: 'region', from: { column: 'region' }, type: { base: 'text' } },
    { name: 'sites', from: { column: 'sites' }, type: { base: 'integer' } },
  ],
  key: ['region'],
  order: [{ column: 'region', direction: 'ascending' }],
  empty: 'valid',
  limits: { rows: 1000, bytes: 1_048_576, seconds: 30 },
  ...over,
});

describe('a stored result queried as a source of its own (data.md; the R21 plan, R21-A)', () => {
  let h: Harness;
  let dataset = '';

  beforeAll(async () => {
    h = await startHarness();
    // A stored result, as resolving a binding keeps one: every site and its region.
    const connection = await h.connection('Sites');
    const sites = await h.definition(connection.id, {
      title: 'Every site',
      parameters: [],
      fetch: { kind: 'sql', text: 'select id, name, region from sample.site order by id' },
      columns: [
        { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
        { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
        { name: 'region', from: { column: 'region' }, type: { base: 'text' } },
      ],
    });
    const component = await h.component(h.general, 'Sites');
    await h.place(
      component,
      binding('b1', sites.id, { parameters: {}, take: { key: { id: '1' }, column: 'name' } }),
    );
    const document = await h.documentReferencing([component.id]);
    h.connector.mode = 'answer';
    h.connector.run = sitesAnswer();
    const resolved = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [{ node: document.nodes[0], binding: 'b1' }],
    });
    if (resolved.statusCode !== 200) throw new Error(`${resolved.statusCode} ${resolved.body}`);
    dataset = resolved.json<{ results: { held: { dataset: string } }[] }>().results[0]!.held
      .dataset;
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const runsAsked = () => h.connector.asked.filter((each) => each.path === '/v1/run').length;

  it('DAT-094 lists the stored results its reader may read, with the columns a query over each may select', async () => {
    const listed = await h.call('ada', 'GET', '/v1/datasets');
    expect(listed.statusCode, listed.body).toBe(200);
    const mine = listed
      .json<{ items: { id: string; name: string; columns: { name: string }[] }[] }>()
      .items.find((each) => each.id === dataset)!;
    expect(mine).toMatchObject({ name: 'Every site' });
    expect(mine.columns.map((each) => each.name)).toEqual(['id', 'name', 'region']);
    // Ivy reads nothing, and so is shown none.
    const hers = await h.call('ivy', 'GET', '/v1/datasets');
    expect(hers.json<{ items: unknown[] }>().items).toEqual([]);
  });

  it('DAT-094 runs the query builder over a stored result, without asking the source it came from', async () => {
    const before = runsAsked();
    const sampled = await h.call('ada', 'POST', `/v1/datasets/${dataset}/sample`, {
      definition: overDataset(dataset),
      values: {},
    });
    expect(sampled.statusCode, sampled.body).toBe(200);
    expect(sampled.json()).toMatchObject({
      outcome: 'ok',
      columns: [
        ['region', 'text'],
        ['sites', 'integer'],
      ],
      rows: [
        ['North', '2'],
        ['South', '1'],
      ],
      rowCount: 2,
      ran: { dataset: { artifact: dataset } },
    });
    expect(runsAsked()).toBe(before);
    // A column the stored result does not have is refused by name, before anything runs.
    const wrong = await h.call('ada', 'POST', `/v1/datasets/${dataset}/sample`, {
      definition: overDataset(dataset, {
        fetch: {
          ...overDataset(dataset).fetch,
          query: {
            ...overDataset(dataset).fetch.query,
            where: { column: { source: 'd', column: 'county' }, is: 'isNull' },
          },
        },
      }),
      values: {},
    });
    expect(wrong.statusCode).toBe(400);
    expect(JSON.stringify(wrong.json())).toContain('The stored result has no column county');
  });

  it('DAT-094 governs who may query a stored result by read on it, and saves a query over one with no connection', async () => {
    // Ivy may not read it: it is not there for her.
    expect(
      (
        await h.call('ivy', 'POST', `/v1/datasets/${dataset}/sample`, {
          definition: overDataset(dataset),
          values: {},
        })
      ).statusCode,
    ).toBe(404);
    const made = await h.call('ada', 'POST', `/v1/spaces/${h.general}/query-definitions`, {
      definition: {
        ...overDataset(dataset),
        title: 'Sites by region',
        description: '',
        retired: false,
      },
    });
    expect(made.statusCode, made.body).toBe(200);
    expect(made.json()).toMatchObject({ connection: null, mayRun: true });

    // Bound in a document and resolved: its result kept as any is, read from the stored one alone.
    const definition = made.json<{ id: string }>().id;
    const component = await h.component(h.general, 'Regions');
    await h.place(
      component,
      binding('r1', definition, {
        parameters: {},
        take: { key: { region: 'North' }, column: 'sites' },
      }),
    );
    const document = await h.documentReferencing([component.id]);
    const before = runsAsked();
    const resolved = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [{ node: document.nodes[0], binding: 'r1' }],
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(runsAsked()).toBe(before);
    const states = (await h.call('ada', 'GET', `/v1/documents/${document.id}/bindings`)).json<{
      bindings: { held: { provenance: Json } | null }[];
    }>().bindings;
    expect(states[0]!.held!.provenance).toMatchObject({
      queryDefinition: { artifact: definition },
      ran: { dataset: { artifact: dataset } },
      rowCount: 2,
    });
    expect(states[0]!.held!.provenance).not.toHaveProperty('connection');
  });

  it('DAT-094 names a stored result by its query definition only to whoever may read the definition too', async () => {
    // Ivy is let read the stored result alone, not the definition that made it.
    await h.allow(h.ids.ivy!, h.roles.Reader!, { kind: 'artifact', id: dataset });
    const hers = (await h.call('ivy', 'GET', '/v1/datasets'))
      .json<{ items: Json[] }>()
      .items.find((each) => each.id === dataset)!;
    expect(hers).toMatchObject({ name: 'A stored result', definition: null });
    expect(JSON.stringify(hers)).not.toContain('Every site');
    expect(hers.columns).toEqual([
      { name: 'id', type: { base: 'integer' } },
      { name: 'name', type: { base: 'text' } },
      { name: 'region', type: { base: 'text' } },
    ]);
  });
});
