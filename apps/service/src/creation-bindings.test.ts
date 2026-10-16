import { DEFAULT_LAYOUT_ID, DEFAULT_THEME_ID, findRole, grant } from '@alloy-works/db';
import { TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binding, HOST, ranOk, startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/** A document made from a template whose required component holds a binding (the R9 plan, R9-E). */
describe('bindings established when a document is made', () => {
  let h: Harness;
  let template = '';

  beforeAll(async () => {
    h = await startHarness();
    // Ada designs templates in General, as a designer is granted there.
    await h.tenantDb.withTenant(h.tenant, async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Designer'))!.id,
        subject: { principal: h.ids.ada! },
        level: { kind: 'space', id: h.general },
        effect: 'allow',
        grantedBy: h.ids.ada!,
      }),
    );
    const connection = await h.connection('Site readings');
    const definition = await h.definition(connection.id);
    const component = await h.component(h.general, 'Site line');
    await h.place(
      component,
      { type: 'text', value: 'The site is ', marks: [] },
      binding('b1', definition.id),
    );
    const made = await h.call('ada', 'POST', `/v1/spaces/${h.general}/templates`, {
      definition: {
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        name: 'Site report',
        theme: DEFAULT_THEME_ID,
        layout: DEFAULT_LAYOUT_ID,
        schemas: [],
        outline: {
          sections: [
            {
              key: 'site',
              title: [{ type: 'text', value: 'Site', marks: [] }],
              required: false,
              numbered: true,
              matter: 'body',
              pageBreak: 'none',
              children: [],
            },
          ],
        },
        changes: { add: true, remove: true, reorder: true },
        components: [
          {
            key: 'line',
            component: component.id,
            mode: { kind: 'latest' },
            place: { section: 'site', at: 'start' },
          },
        ],
      },
    });
    expect(made.statusCode, made.body).toBe(200);
    template = made.json<{ id: string }>().id;
  });

  afterAll(async () => {
    await h?.close();
  });

  const create = (title: string, headers: Record<string, string> = {}) =>
    h.app.inject({
      method: 'POST',
      url: `/v1/spaces/${h.general}/documents`,
      headers: { ...headers, cookie: h.cookies.ada!, host: HOST },
      payload: { title, language: 'en-GB', direction: 'ltr', template },
    });
  const documents = () =>
    h.tenantDb.withTenant(h.tenant, async (trx) =>
      Number(
        (
          await trx
            .selectFrom('artifact')
            .select((eb) => eb.fn.countAll().as('n'))
            .where('kind', '=', 'document')
            .executeTakeFirstOrThrow()
        ).n,
      ),
    );

  it('TPL-063 TPL-065 runs the query each required component binds when the document is made, and holds its result', async () => {
    h.connector.mode = 'answer';
    h.connector.run = ranOk([['1', 'North Quay']]);
    const runs = h.connector.asked.filter((each) => each.path === '/v1/run').length;
    const made = await h.call('ada', 'POST', `/v1/spaces/${h.general}/documents`, {
      title: 'North Quay survey',
      language: 'en-GB',
      direction: 'ltr',
      template,
    });
    expect(made.statusCode, made.body).toBe(200);
    expect(h.connector.asked.filter((each) => each.path === '/v1/run')).toHaveLength(runs + 1);
    const id = made.json<{ id: string }>().id;
    const bindings = (await h.call('ada', 'GET', `/v1/documents/${id}/bindings`)).json<{
      bindings: { binding: { id: string }; held: { act: string } | null }[];
    }>().bindings;
    expect(bindings.map((each) => [each.binding.id, each.held?.act])).toEqual([['b1', 'resolve']]);
    expect(JSON.stringify(bindings[0]!.held)).toContain('North Quay');
  });

  it('TPL-024 makes nothing where the query of a required component fails, naming the binding', async () => {
    h.connector.mode = 'answer';
    h.connector.run = {
      outcome: 'failed',
      failure: { code: 'connector_error', attribution: 'connector' },
    };
    const before = await documents();
    const refused = await h.call('ada', 'POST', `/v1/spaces/${h.general}/documents`, {
      title: 'South Quay survey',
      language: 'en-GB',
      direction: 'ltr',
      template,
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({
      code: 'creation_failed',
      failures: [expect.objectContaining({ binding: 'b1' })],
    });
    expect(await documents()).toBe(before);
  });

  it('refuses an idempotency key where the required components run queries, since their answer is made after the request is decided', async () => {
    const keyed = await create('East Quay survey', { 'idempotency-key': 'east-quay' });
    expect(keyed.statusCode, keyed.body).toBe(400);
    expect(keyed.json()).toMatchObject({ code: 'invalid_request' });
  });
});
