import {
  createTemplate,
  DEFAULT_LAYOUT_ID,
  DEFAULT_THEME_ID,
  recordPublication,
} from '@alloy-works/db';
import { queryAs } from '@alloy-works/db/testing';
import { defaultNumberingScheme, TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  binding,
  definitionBody,
  ranOk,
  sha256,
  startHarness,
  type Harness,
} from './test/bindings-harness.js';

/**
 * A binding's `{ document }` arguments fed by the document's parameters (the TP2 plan, Task 1;
 * templates.md, "Feeding the bindings"): substituted at resolve and check, a binding's digest taken
 * with them substituted, so a changed parameter marks exactly the bindings reading it changed.
 */

type Json = Record<string, unknown>;

interface Held {
  version: string;
  stale: boolean;
  keepable: boolean;
  parameters?: string[];
  provenance: Json & { parameters: Json };
}
interface State {
  node: string;
  binding: Json & { id: string };
  held: Held | null;
}

// Development's Period field, which Report's `period` seeds (dev-content.ts; TP2-G).
const PERIOD_FIELD = '0d5e7a11-0000-4000-8000-00000000f1e4';

describe("a binding's document arguments, through the service", () => {
  let h: Harness;
  let connection: { id: string; version: string };
  /** Sites: `site`, an integer, and `sites`, a list of them, both feeding arguments. */
  let sites: string;
  /** Development's Report: `reviewer`, feeding a field alone; `issued` and `period`, dates. */
  let report: string;

  beforeAll(async () => {
    h = await startHarness({ development: true });
    connection = await h.connection('Readings');
    // Ada publishes and designs in General by development's own grants.
    const parameter = (name: string, list: boolean) => ({
      name,
      type: { base: 'integer' },
      required: false,
      list,
      changeable: true,
      feeds: { arguments: true },
    });
    sites = await h.tenantDb.withTenant(h.tenant, async (trx) => {
      const made = await createTemplate(trx, {
        spaceId: h.general,
        author: h.ids.ada!,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Sites',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
          parameters: [parameter('site', false), parameter('sites', true)],
        },
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.template.id;
    });
    const templates = await h.call('ada', 'GET', '/v1/templates');
    report = templates
      .json<{ items: { id: string; name: string }[] }>()
      .items.find((each) => each.name === 'Report')!.id;
  });

  afterAll(async () => {
    await h?.close();
  });

  /** A component holding these bindings, and a document made from a template placing it once. */
  const placed = async (
    from: { template: string; parameters?: Json } | undefined,
    ...inlines: unknown[]
  ) => {
    const component = await h.component(h.general, 'Readings');
    await h.place(component, { type: 'text', value: 'The site is ', marks: [] }, ...inlines);
    const document = await h.documentReferencing([component.id], h.general, from);
    return { component, document, node: document.nodes[0]! };
  };
  const resolve = (document: string, node: string, ...ids: string[]) =>
    h.call('ada', 'POST', `/v1/documents/${document}/bindings/resolve`, {
      bindings: ids.map((binding) => ({ node, binding })),
    });
  const stateOf = async (document: string, id: string) => {
    const answer = await h.call('ada', 'GET', `/v1/documents/${document}/bindings`);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ bindings: State[] }>().bindings.find((each) => each.binding.id === id)!;
  };
  const latest = async (document: string) =>
    (await h.call('ada', 'GET', `/v1/documents/${document}`)).json<{
      version: { id: string };
      values: Json;
      parameters: Json;
    }>();
  /** Writes the document's parameters whole, as the Parameters panel does. */
  const change = async (document: string, parameters: Json) => {
    const answer = await h.call('ada', 'PUT', `/v1/documents/${document}/parameters`, {
      openedFrom: (await latest(document)).version.id,
      parameters,
    });
    expect(answer.statusCode, answer.body).toBe(200);
  };
  const publish = async (document: string) =>
    h.call('ada', 'POST', `/v1/documents/${document}/publications`, {
      version: (await latest(document)).version.id,
      formats: ['pdf'],
    });
  const fromDocument = (id: string, query: string, name = 'site', over: Json = {}) =>
    binding(id, query, { parameters: { site: { document: name } }, ...over });

  it('DAT-030 resolves a binding whose argument is the document parameter to that parameter value through the API', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      { template: sites, parameters: { site: '7' } },
      fromDocument('b1', definition.id),
    );
    h.connector.run = ranOk([['7', 'Harbour']]);
    const asked = h.connector.asked.length;
    const answer = await resolve(document.id, node, 'b1');
    expect(answer.statusCode, answer.body).toBe(200);
    // The run was sent the document's value, and the result records it as what ran.
    const run = h.connector.asked.slice(asked).find((each) => each.path === '/v1/run')!;
    expect((run.body as { values: Json }).values).toEqual({ site: '7' });
    const state = await stateOf(document.id, 'b1');
    expect(state.held).toMatchObject({ stale: false, provenance: { parameters: { site: '7' } } });
    // The binding is answered as the component holds it, its document argument as written.
    expect(state.binding.parameters).toEqual({ site: { document: 'site' } });
  });

  it('TPL-066 seeds the Period field from the period parameter when the document is made and supplies it as the argument of a binding placed in it, and a changed period marks that binding changed', async () => {
    const definition = await h.definition(
      connection.id,
      definitionBody(connection.id, {
        parameters: [{ name: 'on', type: { base: 'date' }, required: true, list: false }],
        fetch: {
          kind: 'sql',
          text: 'select id, name from sample.site where opened = {{on}} order by id',
        },
      }),
    );
    const { document, node } = await placed(
      { template: report, parameters: { period: '2026-09-30' } },
      binding('b1', definition.id, { parameters: { on: { document: 'period' } } }),
    );
    expect((await latest(document.id)).values[PERIOD_FIELD]).toBe('2026-09-30');
    h.connector.run = ranOk([['1', 'North']]);
    expect((await resolve(document.id, node, 'b1')).statusCode).toBe(200);
    expect((await stateOf(document.id, 'b1')).held).toMatchObject({
      stale: false,
      provenance: { parameters: { on: '2026-09-30' } },
    });
    await change(document.id, { period: '2026-10-31' });
    const changed = (await stateOf(document.id, 'b1')).held!;
    expect(changed.stale).toBe(true);
    expect(changed.parameters).toEqual(['period']);
    // Seeded once: the field is the author's from then on.
    expect((await latest(document.id)).values[PERIOD_FIELD]).toBe('2026-09-30');
  });

  it('keeps the digest of a binding with no document argument, as a stored resolution holds it', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      { template: sites, parameters: { site: '7' } },
      binding('b1', definition.id),
    );
    h.connector.run = ranOk([['1', 'North']]);
    expect((await resolve(document.id, node, 'b1')).statusCode).toBe(200);
    const stored = await queryAs(
      h.db.adminUrl,
      `select binding_digest from ${h.tenant.schema}.binding_resolution where document_id = $1`,
      [document.id],
    );
    // The canonical form before TP2, spelled out: a parameter of the document's name changes nothing.
    expect(stored.rows).toEqual([
      {
        binding_digest: sha256(
          `{"id":"b1","mode":"checked","parameters":{"site":{"literal":"1"}},"query":"${definition.id}","take":{"column":"name"},"type":"binding"}`,
        ),
      },
    ]);
  });

  it('holds a binding rewritten from the document argument to the same literal, and one whose parameter changes and changes back', async () => {
    const definition = await h.definition(connection.id);
    const { component, document, node } = await placed(
      { template: sites, parameters: { site: '7' } },
      fromDocument('b1', definition.id),
    );
    h.connector.run = ranOk([['7', 'Harbour']]);
    expect((await resolve(document.id, node, 'b1')).statusCode).toBe(200);
    await change(document.id, { site: '8' });
    expect((await stateOf(document.id, 'b1')).held!.stale).toBe(true);
    await change(document.id, { site: '7' });
    expect((await stateOf(document.id, 'b1')).held).toMatchObject({ stale: false });
    await h.place(
      component,
      { type: 'text', value: 'The site is ', marks: [] },
      binding('b1', definition.id, { parameters: { site: { literal: '7' } } }),
    );
    expect((await stateOf(document.id, 'b1')).held).toMatchObject({ stale: false });
  });

  it('refuses an argument the document has no value for, or an empty list, as required', async () => {
    const definition = await h.definition(connection.id);
    const list = await h.definition(
      connection.id,
      definitionBody(connection.id, {
        parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: true }],
      }),
    );
    const { document, node } = await placed(
      { template: sites, parameters: { sites: [] } },
      fromDocument('none', definition.id),
      fromDocument('empty', list.id, 'sites'),
    );
    for (const id of ['none', 'empty']) {
      const answer = await resolve(document.id, node, id);
      expect(answer.statusCode, id).toBe(400);
      expect(answer.json(), id).toMatchObject({
        code: 'parameter_invalid',
        binding: id,
        problems: [{ parameter: 'site', rule: 'required', value: '' }],
      });
    }
  });

  it('refuses a document parameter not feeding arguments, or of another type or list, naming nothing of its declaration', async () => {
    const text = await h.definition(
      connection.id,
      definitionBody(connection.id, {
        parameters: [{ name: 'who', type: { base: 'text' }, required: true, list: false }],
        fetch: { kind: 'sql', text: 'select id, name from sample.site where name = {{who}}' },
      }),
    );
    const integer = await h.definition(connection.id);
    const { document, node } = await placed(
      { template: report, parameters: { reviewer: 'Grace', issued: '2026-09-01' } },
      binding('feeds', text.id, { parameters: { who: { document: 'reviewer' } } }),
      binding('type', integer.id, { parameters: { site: { document: 'issued' } } }),
    );
    const listed = await placed(
      { template: sites, parameters: { sites: ['1', '2'] } },
      fromDocument('list', integer.id, 'sites'),
    );
    for (const [at, id, parameter, rule] of [
      [document.id, 'feeds', 'reviewer', 'feeds'],
      [document.id, 'type', 'issued', 'type'],
      [listed.document.id, 'list', 'sites', 'type'],
    ] as const) {
      const answer = await resolve(at, at === document.id ? node : listed.node, id);
      expect(answer.statusCode, id).toBe(400);
      const body = answer.json<Json & { problems: unknown[] }>();
      expect(body, id).toMatchObject({ code: 'parameter_invalid', binding: id });
      expect(body.problems, id).toEqual([{ parameter, rule, value: '' }]);
      expect(answer.body, id).not.toMatch(/changeable|"feeds":|"arguments"|"base"/);
    }
  });

  it("checks the document's value against the definition's own narrower permitted values", async () => {
    const definition = await h.definition(
      connection.id,
      definitionBody(connection.id, {
        parameters: [
          {
            name: 'site',
            type: { base: 'integer' },
            required: true,
            list: false,
            permitted: { values: ['1', '2'] },
          },
        ],
      }),
    );
    const { document, node } = await placed(
      { template: sites, parameters: { site: '7' } },
      fromDocument('b1', definition.id),
    );
    const answer = await resolve(document.id, node, 'b1');
    expect(answer.statusCode).toBe(400);
    expect(answer.json()).toMatchObject({
      code: 'parameter_invalid',
      problems: [{ parameter: 'site', rule: 'permitted', value: '7' }],
    });
  });

  it('marks exactly the bindings reading a changed parameter changed, and the publish refuses them until resolved', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      { template: sites, parameters: { site: '7' } },
      fromDocument('reads', definition.id),
      binding('literal', definition.id),
    );
    h.connector.run = ranOk([['7', 'Harbour']]);
    expect((await resolve(document.id, node, 'reads', 'literal')).statusCode).toBe(200);
    expect((await publish(document.id)).statusCode).toBe(200);
    await change(document.id, { site: '9' });
    expect((await stateOf(document.id, 'reads')).held).toMatchObject({
      stale: true,
      parameters: ['site'],
    });
    const literal = (await stateOf(document.id, 'literal')).held!;
    expect(literal.stale).toBe(false);
    expect(literal.parameters).toBeUndefined();
    const refused = await publish(document.id);
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json()).toMatchObject({
      code: 'binding_unresolved',
      bindings: [{ node, binding: 'reads', reason: 'changed' }],
    });
    h.connector.run = ranOk([['9', 'Quay']]);
    expect((await resolve(document.id, node, 'reads')).statusCode).toBe(200);
    expect((await stateOf(document.id, 'reads')).held).toMatchObject({
      stale: false,
      provenance: { parameters: { site: '9' } },
    });
    expect((await publish(document.id)).statusCode).toBe(200);
  });

  it('still publishes a request queued before a parameter changed, with what it held', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      { template: sites, parameters: { site: '7' } },
      fromDocument('b1', definition.id),
    );
    h.connector.run = ranOk([['7', 'Harbour']]);
    expect((await resolve(document.id, node, 'b1')).statusCode).toBe(200);
    const asked = await publish(document.id);
    expect(asked.statusCode, asked.body).toBe(200);
    await change(document.id, { site: '8' });
    // Recorded as the worker records it, from the request's own digests.
    const publication = await h.tenantDb.withTenant(h.tenant, (trx) =>
      recordPublication(trx, {
        requestId: asked.json<{ id: string }>().id,
        pipelineVersion: '16',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf',
            engineVersion: '0.15.1',
            templateVersion: 15,
            key: `${h.tenant.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1000,
          },
          {
            format: 'provenance',
            pipelineVersion: '16',
            key: `${h.tenant.role}/sha256/${'e'.repeat(64)}`,
            sha256: 'e'.repeat(64),
            bytes: 200,
          },
        ],
      }),
    );
    const read = await h.call('ada', 'GET', `/v1/publications/${publication}/bindings`);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({
      bindings: [{ node, binding: 'b1', result: { parameters: { site: '7' } } }],
    });
  });

  it('keeps a held result across a change leaving the substituted question the same, and refuses one across a changed parameter', async () => {
    const definition = await h.definition(connection.id);
    const { component, document, node } = await placed(
      { template: sites, parameters: { site: '7' } },
      fromDocument('b1', definition.id),
    );
    h.connector.run = ranOk([['7', 'Harbour']]);
    expect((await resolve(document.id, node, 'b1')).statusCode).toBe(200);
    // Taking another column asks the same question.
    await h.place(
      component,
      { type: 'text', value: 'The site is ', marks: [] },
      fromDocument('b1', definition.id, 'site', { take: { column: 'id' } }),
    );
    const moved = (await stateOf(document.id, 'b1')).held!;
    expect(moved).toMatchObject({ stale: true, keepable: true });
    const confirm = (replaces: string) =>
      h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/confirm`, {
        node,
        binding: 'b1',
        replaces,
      });
    const kept = await confirm(moved.version);
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json<State>().held).toMatchObject({ stale: false, act: 'confirm' });
    // Another value of the parameter asks another question.
    await h.place(
      component,
      { type: 'text', value: 'The site is ', marks: [] },
      fromDocument('b1', definition.id),
    );
    await change(document.id, { site: '8' });
    const changed = (await stateOf(document.id, 'b1')).held!;
    expect(changed).toMatchObject({ stale: true, keepable: false });
    const refused = await confirm(changed.version);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'confirm_not_possible' });
  });

  it('records nothing where a parameter changes while the source answers, and a resolve again takes the new value', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      { template: sites, parameters: { site: '7' } },
      fromDocument('b1', definition.id),
    );
    h.connector.run = ranOk([['7', 'Harbour']]);
    let release!: () => void;
    h.connector.hold = new Promise<void>((done) => (release = done));
    const asked = h.connector.asked.length;
    const pending = resolve(document.id, node, 'b1');
    // The resolve has reached the source, which holds its answer.
    await vi.waitFor(() =>
      expect(h.connector.asked.slice(asked).some((each) => each.path === '/v1/run')).toBe(true),
    );
    await change(document.id, { site: '8' });
    release();
    h.connector.hold = undefined;
    const answer = await pending;
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'binding_changed', binding: 'b1', node });
    expect((await stateOf(document.id, 'b1')).held).toBeNull();
    h.connector.run = ranOk([['8', 'Quay']]);
    expect((await resolve(document.id, node, 'b1')).statusCode).toBe(200);
    expect((await stateOf(document.id, 'b1')).held).toMatchObject({
      stale: false,
      provenance: { parameters: { site: '8' } },
    });
  });
  it('runs without a document argument the document has no value for where its parameter is not required, and marks it changed once the value is set (the TP2 final review)', async () => {
    const optional = await h.definition(
      connection.id,
      definitionBody(connection.id, {
        parameters: [{ name: 'site', type: { base: 'integer' }, required: false, list: false }],
      }),
    );
    const { document, node } = await placed({ template: sites }, fromDocument('b1', optional.id));
    h.connector.run = ranOk([['1', 'North']]);
    const asked = h.connector.asked.length;
    const answer = await resolve(document.id, node, 'b1');
    expect(answer.statusCode, answer.body).toBe(200);
    const run = h.connector.asked.slice(asked).find((each) => each.path === '/v1/run')!;
    expect((run.body as { values: Json }).values).toEqual({});
    expect((await stateOf(document.id, 'b1')).held).toMatchObject({ stale: false });
    await change(document.id, { site: '7' });
    expect((await stateOf(document.id, 'b1')).held).toMatchObject({
      stale: true,
      parameters: ['site'],
    });
  });

  it('reads a binding repointed to a parameter not fed to arguments as changed, though it holds the same value, and the publish refuses it (the TP2 final review)', async () => {
    const text = await h.definition(
      connection.id,
      definitionBody(connection.id, {
        parameters: [{ name: 'who', type: { base: 'text' }, required: true, list: false }],
        fetch: { kind: 'sql', text: 'select id, name from sample.site where name = {{who}}' },
      }),
    );
    // Report's own definition, with `who` fed to arguments beside `reviewer`, which seeds a field alone.
    const read = await h.call('ada', 'GET', `/v1/templates/${report}`);
    const definition = read.json<{ definition: Json & { parameters: Json[] } }>().definition;
    const made = await h.call('ada', 'POST', `/v1/spaces/${h.general}/templates`, {
      definition: {
        ...definition,
        name: `Reviewed ${Date.now()}`,
        parameters: [
          ...definition.parameters.filter((each) => each['name'] === 'reviewer'),
          {
            name: 'who',
            type: { base: 'text' },
            required: false,
            list: false,
            changeable: true,
            feeds: { arguments: true },
          },
        ],
      },
    });
    expect(made.statusCode, made.body).toBe(200);
    const { component, document, node } = await placed(
      { template: made.json<{ id: string }>().id, parameters: { who: 'Grace', reviewer: 'Grace' } },
      binding('b1', text.id, { parameters: { who: { document: 'who' } } }),
    );
    h.connector.run = ranOk([['1', 'Grace']]);
    expect((await resolve(document.id, node, 'b1')).statusCode).toBe(200);
    expect((await publish(document.id)).statusCode).toBe(200);
    await h.place(
      component,
      { type: 'text', value: 'The site is ', marks: [] },
      binding('b1', text.id, { parameters: { who: { document: 'reviewer' } } }),
    );
    expect((await stateOf(document.id, 'b1')).held).toMatchObject({ stale: true });
    const refused = await publish(document.id);
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json()).toMatchObject({
      code: 'binding_unresolved',
      bindings: [{ node, binding: 'b1', reason: 'changed' }],
    });
    const answer = await resolve(document.id, node, 'b1');
    expect(answer.statusCode).toBe(400);
    expect(answer.json<{ problems: unknown[] }>().problems).toEqual([
      { parameter: 'reviewer', rule: 'feeds', value: '' },
    ]);
  });

  it('names a changed parameter only where its value alone moved, not where the component changed too or the document has none (the TP2 final review)', async () => {
    const definition = await h.definition(connection.id);
    const { component, document, node } = await placed(
      { template: sites, parameters: { site: '7' } },
      fromDocument('b1', definition.id),
    );
    h.connector.run = ranOk([['7', 'Harbour']]);
    expect((await resolve(document.id, node, 'b1')).statusCode).toBe(200);
    // Its take changed as well as the value: the component changed it too.
    await h.place(
      component,
      { type: 'text', value: 'The site is ', marks: [] },
      fromDocument('b1', definition.id, 'site', { take: { column: 'id' } }),
    );
    await change(document.id, { site: '8' });
    const both = (await stateOf(document.id, 'b1')).held!;
    expect(both.stale).toBe(true);
    expect(both.parameters).toBeUndefined();
    // Repointed to a parameter the document has no value for.
    await h.place(
      component,
      { type: 'text', value: 'The site is ', marks: [] },
      fromDocument('b1', definition.id, 'lot'),
    );
    const none = (await stateOf(document.id, 'b1')).held!;
    expect(none.stale).toBe(true);
    expect(none.parameters).toBeUndefined();
  });
});
