import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { readPdf, spoken } from './pdf.js';
import { SERVICE, signIn, untilReady } from './session.js';
import { followSignedLink } from './signed-link.js';

/**
 * A document's parameter feeding a binding over the whole system (the TP2 plan, task 3): a document
 * made from development's Report with its `period`, a value placed in it whose definition takes a date
 * from the document, resolved through the connector against the development source; `period` changed,
 * which marks that value changed, naming the parameter, and the publish refuses it until it is resolved
 * again; then published, printing the new period's row.
 */
const READER = { account: 'reader', password: 'source-reader-dev-password' };

type Json = Record<string, unknown>;

describe("a document's parameter feeding a binding over the whole system", () => {
  let cookie = '';
  let general = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVICE}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Json };
  };
  const ok = (answer: { status: number; body: Json }) => {
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body;
  };

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn('ada');
    const spaces = await call('GET', '/v1/spaces');
    general = (spaces.body['items'] as { id: string; name: string }[]).find(
      (space) => space.name === 'General',
    )!.id;
  }, 180_000);

  it('TPL-066 seeds the Period field from period and supplies it to a binding, marks the binding changed when period changes, and publishes once it is resolved again, over the whole system', async () => {
    const connection = ok(
      await call('POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: `Readings for parameters ${Date.now()}`,
          description: 'The development source.',
          type: 'postgres',
          source: {
            host: 'source-postgres',
            port: 5432,
            database: 'readings',
            account: READER.account,
            tls: 'require',
          },
          identity: { kind: 'service' },
          retired: false,
        },
      }),
    )['id'] as string;
    ok(await call('PUT', `/v1/connections/${connection}/credential`, { secret: READER.password }));

    // The site opened on a date, which the document's period gives it.
    const definition = ok(
      await call('POST', `/v1/spaces/${general}/query-definitions`, {
        definition: {
          schemaVersion: 1,
          title: `Site opened on ${Date.now()}`,
          description: 'The site opened on a date.',
          connection,
          parameters: [{ name: 'on', type: { base: 'date' }, required: true, list: false }],
          fetch: {
            kind: 'sql',
            text: 'select id, name from sample.site where opened = {{on}} order by id',
          },
          columns: [
            { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
            { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
          ],
          key: ['id'],
          order: [{ column: 'id', direction: 'ascending' }],
          empty: 'valid',
          limits: { rows: 100, bytes: 65_536, seconds: 10 },
          retired: false,
        },
      }),
    )['id'] as string;

    // A component whose value takes its date from the document's `period`.
    const component = ok(
      await call('POST', `/v1/spaces/${general}/components`, {
        title: 'Site opened',
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const session = randomUUID();
    ok(await call('POST', `/v1/components/${component.id}/lock`, { session }));
    ok(
      await call('PUT', `/v1/components/${component.id}/iterations/${session}/1`, {
        openedFrom: component.version.id,
        content: {
          schemaVersion: 1,
          title: 'Site opened',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [
                { type: 'text', value: 'The site opened in the period is ', marks: [] },
                {
                  type: 'binding',
                  id: 'opened',
                  query: definition,
                  parameters: { on: { document: 'period' } },
                  mode: 'checked',
                  take: { column: 'name' },
                },
              ],
            },
          ],
        },
      }),
    );
    ok(
      await call(
        'DELETE',
        `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version.id}`,
      ),
    );

    // A document made from Report with its period, the Period field seeded from it.
    const templates = ok(await call('GET', '/v1/templates?limit=100'));
    const report = (templates['items'] as { id: string; name: string }[]).find(
      (each) => each.name === 'Report',
    )!;
    const reportDefinition = ok(await call('GET', `/v1/templates/${report.id}`))['definition'] as {
      parameters: { name: string; feeds: { field?: string } }[];
    };
    const periodField = reportDefinition.parameters.find((each) => each.name === 'period')!.feeds
      .field!;
    const made = ok(
      await call('POST', `/v1/spaces/${general}/documents`, {
        title: `Opened in the period ${Date.now()}`,
        language: 'en-GB',
        direction: 'ltr',
        template: report.id,
        parameters: { period: '2024-03-01' },
      }),
    ) as {
      id: string;
      version: { id: string };
      values: Json;
      outline: { nodes: { id: string }[] };
    };
    expect(made.values[periodField]).toBe('2024-03-01');
    const edited = ok(
      await call('POST', `/v1/documents/${made.id}/outline`, {
        openedFrom: made.version.id,
        operation: {
          operation: 'insert',
          parent: made.outline.nodes[0]?.id ?? null,
          position: 0,
          node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
        },
      }),
    ) as {
      version: { id: string };
      outline: { nodes: { id: string; children?: { id: string }[] }[] };
    };
    const first = edited.outline.nodes[0]!;
    const node = made.outline.nodes.length > 0 ? first.children![0]!.id : first.id;

    // Resolved with the document's period.
    const resolve = async () =>
      (
        ok(
          await call('POST', `/v1/documents/${made.id}/bindings/resolve`, {
            bindings: [{ node, binding: 'opened' }],
          }),
        ) as { results: { held: { version: string } }[] }
      ).results[0]!.held.version;
    const rowsOf = async (version: string) =>
      (
        ok(await call('GET', `/v1/documents/${made.id}/datasets/${version}`)) as {
          result: { rows: unknown[] };
          provenance: Json;
        }
      ).result.rows;
    expect(await rowsOf(await resolve())).toEqual([['1', 'North weir']]);
    const stateOf = async () =>
      (
        ok(await call('GET', `/v1/documents/${made.id}/bindings`)) as {
          bindings: { held: { stale: boolean; parameters?: string[] } }[];
        }
      ).bindings[0]!.held;
    expect(await stateOf()).toMatchObject({ stale: false });

    // The period changed: the value is changed, by its parameter, and the publish refuses it.
    const changed = ok(
      await call('PUT', `/v1/documents/${made.id}/parameters`, {
        openedFrom: edited.version.id,
        parameters: { period: '2024-05-17' },
      }),
    ) as { version: { id: string } };
    expect(await stateOf()).toMatchObject({ stale: true, parameters: ['period'] });
    const refused = await call('POST', `/v1/documents/${made.id}/publications`, {
      version: changed.version.id,
      formats: ['pdf'],
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body).toMatchObject({
      code: 'binding_unresolved',
      bindings: [{ node, binding: 'opened', reason: 'changed' }],
    });

    // Resolved again, it takes the new period, and the document publishes it.
    expect(await rowsOf(await resolve())).toEqual([['2', 'South bank']]);
    expect(await stateOf()).toMatchObject({ stale: false });
    const asked = ok(
      await call('POST', `/v1/documents/${made.id}/publications`, {
        version: changed.version.id,
        formats: ['pdf'],
      }),
    ) as { id: string };
    let publication = '';
    await vi.waitFor(
      async () => {
        const request = ok(await call('GET', `/v1/publication-requests/${asked.id}`));
        expect(request).toMatchObject({ state: 'done', failures: [] });
        publication = request['publication'] as string;
      },
      { timeout: 60_000, interval: 250 },
    );
    const kept = ok(await call('GET', `/v1/publications/${publication}`)) as {
      outputs: { format: string; download: string }[];
    };
    const pdf = (
      await followSignedLink(new URL(kept.outputs.find((each) => each.format === 'pdf')!.download))
    ).body;
    expect(spoken((await readPdf(pdf)).taggedText.flat())).toContain(
      'The site opened in the period is South bank',
    );
  }, 180_000);
});
