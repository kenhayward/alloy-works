import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';
import { e2eTargets } from './targets.js';

/**
 * A binding over the whole system (the D3 plan, task 5): placed in a component by the API, resolved in
 * a document through the connector against the development source, checked after the source changed,
 * and the revision accepted - the rows read back through the document. The source change is made in a
 * table of the test's own in schema `sample`, by the source's superuser inside its container, and the
 * table is dropped afterwards. Ada uses connections and writes SQL in General by the development role
 * `pnpm dev:setup` gives her (D2-T).
 */
const PROJECT = e2eTargets(process.env).composeProject;
const READER = { account: 'reader', password: 'source-reader-dev-password' };

type Json = Record<string, unknown>;

/** Runs SQL at the development source as its superuser, in its own container of this project. */
function atTheSource(sql: string): void {
  const ids = execFileSync(
    'docker',
    [
      'ps',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${PROJECT}`,
      '--filter',
      'label=com.docker.compose.service=source-postgres',
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length !== 1) throw new Error(`${PROJECT} runs ${ids.length} source containers`);
  execFileSync(
    'docker',
    ['exec', '-i', ids[0]!, 'psql', '-U', 'postgres', '-d', 'readings', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', timeout: 60_000 },
  );
}

describe('a binding over the whole system', () => {
  const table = `sample.d3_sites_${Date.now()}`;
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
    atTheSource(
      `create table ${table} (id integer primary key, name text not null);
       insert into ${table} values (1, 'North weir');
       grant select on ${table} to reader;`,
    );
  }, 180_000);

  afterAll(() => {
    atTheSource(`drop table if exists ${table};`);
  });

  it('places a binding by the API, resolves it in a document, checks it after the source changed, and accepts the revision, over the whole system', async () => {
    // A connection as the read-only account, tested as its password is set.
    const connection = ok(
      await call('POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: `Readings for bindings ${Date.now()}`,
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
    expect(
      ok(
        await call('PUT', `/v1/connections/${connection}/credential`, { secret: READER.password }),
      ),
    ).toMatchObject({ test: { outcome: 'ok', findings: [] } });

    // A definition of a site's name by its id, over the test's own table.
    const definition = ok(
      await call('POST', `/v1/spaces/${general}/query-definitions`, {
        definition: {
          schemaVersion: 1,
          title: `Site name ${Date.now()}`,
          description: 'One site, by its id.',
          connection,
          parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
          fetch: {
            kind: 'sql',
            text: `select id, name from ${table} where id = {{site}} order by id`,
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

    // A component holding the binding, placed by the editing routes: no screen places one (D3-P).
    const component = ok(
      await call('POST', `/v1/spaces/${general}/components`, {
        title: 'Site status',
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
          title: 'Site status',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [
                { type: 'text', value: 'The first site is ', marks: [] },
                {
                  type: 'binding',
                  id: 'site-name',
                  query: definition,
                  parameters: { site: { literal: '1' } },
                  mode: 'checked',
                  take: { column: 'name' },
                },
              ],
            },
          ],
        },
      }),
    );
    expect(
      ok(
        await call(
          'DELETE',
          `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version.id}`,
        ),
      ),
    ).toMatchObject({ outcome: 'cut' });

    // Two documents placing it.
    const documentPlacing = async () => {
      const made = ok(
        await call('POST', `/v1/spaces/${general}/documents`, {
          title: `Site report ${Date.now()}`,
          language: 'en-GB',
          direction: 'ltr',
        }),
      ) as { id: string; version: { id: string } };
      const edited = ok(
        await call('POST', `/v1/documents/${made.id}/outline`, {
          openedFrom: made.version.id,
          operation: {
            operation: 'insert',
            parent: null,
            position: 0,
            node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
          },
        }),
      ) as { version: { id: string }; outline: { nodes: { id: string }[] } };
      return { id: made.id, version: edited.version.id, node: edited.outline.nodes[0]!.id };
    };
    const first = await documentPlacing();
    const second = await documentPlacing();

    // Resolved in each: one question, so one dataset, and the second reuses the first's version.
    const resolved = [];
    for (const document of [first, second]) {
      resolved.push(
        ok(
          await call('POST', `/v1/documents/${document.id}/bindings/resolve`, {
            bindings: [{ node: document.node, binding: 'site-name' }],
          }),
        ) as { results: { held: { dataset: string; version: string; reused: boolean } }[] },
      );
    }
    const held = resolved[0]!.results[0]!.held;
    expect(resolved[1]!.results[0]!.held).toEqual({ ...held, reused: true });
    const read = async (document: string, version: string) =>
      ok(await call('GET', `/v1/documents/${document}/datasets/${version}`)) as {
        result: { rows: unknown[] };
        provenance: Json;
      };
    const before = await read(first.id, held.version);
    expect(before.result.rows).toEqual([['1', 'North weir']]);
    expect(before.provenance).toMatchObject({
      queryDefinition: { artifact: definition },
      connection: { artifact: connection },
      parameters: { site: '1' },
      identity: { kind: 'service' },
      rowCount: 1,
    });

    // The source changes; a check finds it, and records it waiting, resolving nothing to it.
    expect(ok(await call('POST', `/v1/documents/${first.id}/bindings/check`, {}))).toMatchObject({
      results: [{ node: first.node, binding: 'site-name', outcome: 'unchanged' }],
    });
    atTheSource(`update ${table} set name = 'North weir and quay' where id = 1;`);
    const checked = ok(await call('POST', `/v1/documents/${first.id}/bindings/check`, {})) as {
      results: { outcome: string; version: string }[];
    };
    expect(checked.results[0]).toMatchObject({ outcome: 'revision' });
    const revision = checked.results[0]!.version;
    const waiting = ok(await call('GET', `/v1/documents/${first.id}/bindings`)) as {
      bindings: { held: { version: string }; waiting: { version: string } }[];
    };
    expect(waiting.bindings[0]).toMatchObject({
      held: { version: held.version },
      waiting: { version: revision },
    });

    // Accepted in the first document alone; the second keeps what it held.
    expect(
      ok(
        await call('POST', `/v1/documents/${first.id}/bindings/accept`, {
          node: first.node,
          binding: 'site-name',
          version: revision,
          replaces: held.version,
        }),
      ),
    ).toMatchObject({ held: { version: revision, act: 'accept' }, waiting: null });
    expect((await read(first.id, revision)).result.rows).toEqual([['1', 'North weir and quay']]);
    expect(ok(await call('GET', `/v1/documents/${second.id}/bindings`))['bindings']).toMatchObject([
      { held: { version: held.version }, waiting: { version: revision } },
    ]);
    expect((await read(second.id, held.version)).result.rows).toEqual([['1', 'North weir']]);

    // Nothing publishes a binding yet: refused at the door, naming it, and nothing is queued.
    const published = await call('POST', `/v1/documents/${first.id}/publications`, {
      version: first.version,
      formats: ['pdf'],
    });
    expect(published.status, JSON.stringify(published.body)).toBe(400);
    expect(published.body).toMatchObject({
      code: 'binding_unresolved',
      document: first.id,
      bindings: [{ node: first.node, binding: 'site-name' }],
    });
  }, 180_000);
});
