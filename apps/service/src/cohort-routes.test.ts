import { createTemplate, DEFAULT_LAYOUT_ID, DEFAULT_THEME_ID } from '@alloy-works/db';
import { TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binding, ranOk, startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/** Cohorts through the service (the R7 plan, R7-A, R7-B, R7-F, R7-G). */
describe('cohorts, through the service', () => {
  let h: Harness;
  let template = '';
  let connection: { id: string; version: string };

  beforeAll(async () => {
    h = await startHarness({ development: true });
    connection = await h.connection('Readings');
    const parameter = (name: string, base: string) => ({
      name,
      type: { base },
      required: true,
      list: false,
      changeable: true,
      feeds: { arguments: true },
    });
    template = await h.tenantDb.withTenant(h.tenant, async (trx) => {
      const made = await createTemplate(trx, {
        spaceId: h.general,
        author: h.ids.ada!,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Site report',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
          parameters: [parameter('id', 'integer'), parameter('name', 'text')],
        },
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.template.id;
    });
  });

  afterAll(async () => {
    await h?.close();
  });

  const submit = (body: Json) =>
    h.call('ada', 'POST', `/v1/spaces/${h.general}/cohorts`, {
      template,
      title: 'Site {id}: {name}',
      language: 'en-GB',
      direction: 'ltr',
      ...body,
    });

  it('SCH-065 TPL-040 lists the cohorts the caller may read, newest first or by title, filtered by template and by state, each with its rows counted', async () => {
    const make = async (title: string) =>
      (
        await submit({
          title,
          rows: [
            { id: '1', name: 'Harbour' },
            { id: '2', name: 'Quay' },
          ],
        })
      ).json<{
        cohort: { id: string };
      }>().cohort.id;
    const first = await make('Annual {name}');
    const second = await make('Board {name}');
    // The second's first row failed, as a run would leave it.
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .updateTable('cohort_row')
        .set({ state: 'failed', failure: JSON.stringify({ code: 'rows.invalid', message: 'No.' }) })
        .where('cohort_id', '=', second)
        .where('row_no', '=', 1)
        .execute(),
    );
    type Listed = {
      items: {
        id: string;
        title: string;
        template: { id: string; name: string };
        space: { id: string; name: string };
        rows: { made: number; failed: number; pending: number };
      }[];
      next: string | null;
    };
    const listed = async (query = '', who = 'ada') => {
      const answer = await h.call(who, 'GET', `/v1/cohorts${query}`);
      expect(answer.statusCode, answer.body).toBe(200);
      return answer.json<Listed>();
    };
    const ours = (page: Listed) => page.items.filter((each) => [first, second].includes(each.id));
    expect(ours(await listed()).map((each) => each.id)).toEqual([second, first]);
    expect(ours(await listed('?sort=title')).map((each) => each.title)).toEqual([
      'Annual {name}',
      'Board {name}',
    ]);
    expect(ours(await listed('?state=failed')).map((each) => each.id)).toEqual([second]);
    expect(ours(await listed('?state=pending')).map((each) => each.id)).toEqual([first]);
    expect(ours(await listed(`?template=${template}`)).length).toBe(2);
    const shown = ours(await listed()).find((each) => each.id === second)!;
    expect(shown).toMatchObject({
      template: { id: template, name: 'Site report' },
      space: { id: h.general, name: 'General' },
      rows: { made: 0, failed: 1, pending: 1 },
    });
    // A page at a time, by an opaque cursor.
    const page = await listed('?limit=1');
    expect(page.items).toHaveLength(1);
    expect(page.next).not.toBeNull();
    // A reader of the space is shown them; somebody who may read nothing is shown none.
    expect(ours(await listed('', 'alice'))).toHaveLength(2);
    expect((await listed('', 'ivy')).items).toEqual([]);
  });

  it('REU-034 asks for a cohort of rows given inline, every row pending, and finds it again by its id', async () => {
    const asked = await submit({
      rows: [
        { id: '1', name: 'Harbour' },
        { id: '2', name: 'Quay' },
      ],
    });
    expect(asked.statusCode, asked.body).toBe(200);
    const { cohort, job } = asked.json<{ cohort: Json & { id: string }; job: Json }>();
    expect(job).toMatchObject({ kind: 'cohort', subject: cohort.id, state: 'accepted' });
    const found = await h.call('ada', 'GET', `/v1/cohorts/${cohort.id}`);
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json()).toMatchObject({
      template: { id: template },
      title: 'Site {id}: {name}',
      source: { rows: 2 },
      rows: [
        { row: 1, parameters: { id: '1', name: 'Harbour' }, state: 'pending', document: null },
        { row: 2, parameters: { id: '2', name: 'Quay' }, state: 'pending', document: null },
      ],
    });
    // Nothing has failed, so nothing is run again.
    const again = await h.call('ada', 'POST', `/v1/cohorts/${cohort.id}/rerun`, {});
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json()).toMatchObject({ code: 'cohort_complete' });
  });

  it('REU-032 takes its rows from a query result the caller may read, a parameter for each column', async () => {
    const definition = await h.definition(connection.id);
    const component = await h.component(h.general, 'Readings');
    await h.place(
      component,
      binding('b1', definition.id, { parameters: { site: { literal: '1' } } }),
    );
    const document = await h.documentReferencing([component.id]);
    h.connector.run = ranOk([
      ['1', 'Harbour'],
      ['2', 'Quay'],
    ]);
    const resolved = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [{ node: document.nodes[0]!, binding: 'b1' }],
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    const state = (await h.call('ada', 'GET', `/v1/documents/${document.id}/bindings`)).json<{
      bindings: { binding: { id: string }; held: { version: string } | null }[];
    }>();
    const dataset = state.bindings.find((each) => each.binding.id === 'b1')!.held!.version;

    const asked = await submit({ dataset });
    expect(asked.statusCode, asked.body).toBe(200);
    expect(asked.json<{ cohort: Json }>().cohort).toMatchObject({
      source: { dataset },
      rows: [
        { row: 1, parameters: { id: '1', name: 'Harbour' } },
        { row: 2, parameters: { id: '2', name: 'Quay' } },
      ],
    });
  });

  it('refuses rows given both ways, or none, and a template the caller may not read', async () => {
    expect((await submit({})).statusCode).toBe(400);
    expect((await submit({ rows: [] })).statusCode).toBe(400);
    const language = await submit({ language: 'not a tag!', rows: [{ id: '1', name: 'Harbour' }] });
    expect(language.statusCode).toBe(400);
    expect(language.json()).toMatchObject({ code: 'content_invalid' });
    const missing = await submit({
      template: '00000000-0000-4000-8000-000000000000',
      rows: [{ id: '1', name: 'Harbour' }],
    });
    expect(missing.statusCode).toBe(404);
  });
});
