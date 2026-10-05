import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { readPdf, spoken } from './pdf.js';
import { SERVICE, signIn, untilReady } from './session.js';
import { followSignedLink } from './signed-link.js';
import { atTheSource } from './source.js';
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
       insert into ${table} values (1, 'North weir'), (2, 'South quay');
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

    // Published to the PDF and Word with the table gone from the source: the worker reads the stored
    // result, and never the source. Renamed away rather than the source stopped, which the suite's
    // other files, running beside this one, still reach.
    const away = `${table.split('.')[1]}_away`;
    atTheSource(`alter table ${table} rename to ${away};`);
    let publication = '';
    try {
      const asked = ok(
        await call('POST', `/v1/documents/${first.id}/publications`, {
          version: first.version,
          formats: ['pdf', 'docx'],
        }),
      ) as { id: string };
      await vi.waitFor(
        async () => {
          const request = ok(await call('GET', `/v1/publication-requests/${asked.id}`));
          expect(request).toMatchObject({ state: 'done', failures: [] });
          publication = request['publication'] as string;
        },
        { timeout: 60_000, interval: 250 },
      );
    } finally {
      atTheSource(`alter table sample.${away} rename to ${table.split('.')[1]};`);
    }
    const kept = ok(await call('GET', `/v1/publications/${publication}`)) as {
      outputs: { format: string; download: string }[];
    };
    expect(kept.outputs.map((each) => each.format)).toEqual(['pdf', 'docx', 'provenance']);
    const bytesOf = async (format: string) =>
      (
        await followSignedLink(
          new URL(kept.outputs.find((each) => each.format === format)!.download),
        )
      ).body;
    const printed = 'The first site is North weir and quay';
    expect(spoken((await readPdf(await bytesOf('pdf'))).taggedText.flat())).toContain(printed);
    const word = strFromU8(unzipSync(new Uint8Array(await bytesOf('docx')))['word/document.xml']!);
    expect(
      [...word.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join(''),
    ).toContain(printed);
    // provenance.json, as Grace downloads it: what was printed, and no SQL, connection or source column.
    cookie = await signIn('grace');
    const regraced = ok(await call('GET', `/v1/publications/${publication}`)) as typeof kept;
    const provenance = (
      await followSignedLink(
        new URL(regraced.outputs.find((each) => each.format === 'provenance')!.download),
      )
    ).body.toString('utf8');
    expect(JSON.parse(provenance)).toMatchObject({
      values: [{ node: first.node, binding: 'site-name', printed: 'North weir and quay' }],
    });
    for (const secret of [table, 'select', connection, '"from"']) {
      expect(provenance).not.toContain(secret);
    }
    cookie = await signIn('ada');
  }, 180_000);

  it('resolves a binding from an editing session, keeps it across a changed take, and names its holders, over the whole system', async () => {
    const connection = ok(
      await call('POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: `Readings for placing ${Date.now()}`,
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
    const definition = ok(
      await call('POST', `/v1/spaces/${general}/query-definitions`, {
        definition: {
          schemaVersion: 1,
          title: `Site placed ${Date.now()}`,
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
    const component = ok(
      await call('POST', `/v1/spaces/${general}/components`, {
        title: 'Placed site',
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const made = ok(
      await call('POST', `/v1/spaces/${general}/documents`, {
        title: `Placed report ${Date.now()}`,
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const node = (
      ok(
        await call('POST', `/v1/documents/${made.id}/outline`, {
          openedFrom: made.version.id,
          operation: {
            operation: 'insert',
            parent: null,
            position: 0,
            node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
          },
        }),
      ) as { outline: { nodes: { id: string }[] } }
    ).outline.nodes[0]!.id;

    // Placed in an editing session, never cut: resolved from the session.
    const session = randomUUID();
    ok(await call('POST', `/v1/components/${component.id}/lock`, { session }));
    const save = (sequence: number, take: Json) =>
      call('PUT', `/v1/components/${component.id}/iterations/${session}/${sequence}`, {
        openedFrom: component.version.id,
        content: {
          schemaVersion: 1,
          title: 'Placed site',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [
                { type: 'text', value: 'The second site is ', marks: [] },
                {
                  type: 'binding',
                  id: 'placed',
                  query: definition,
                  parameters: { site: { literal: '2' } },
                  mode: 'checked',
                  take,
                },
              ],
            },
          ],
        },
      });
    ok(await save(1, { column: 'name' }));
    ok(
      await call('POST', `/v1/documents/${made.id}/bindings/resolve`, {
        bindings: [{ node, binding: 'placed', from: 'session' }],
        session,
      }),
    );
    const stateOf = async (query = '') =>
      (
        ok(await call('GET', `/v1/documents/${made.id}/bindings${query}`)) as {
          bindings: { held: { version: string; keepable: boolean; act: string; taken: Json } }[];
        }
      ).bindings[0]!;
    const held = (await stateOf(`?session=${session}`)).held;
    expect(held.taken).toMatchObject({ value: 'South quay' });

    // The take changed: kept, querying nothing.
    ok(await save(2, { column: 'id' }));
    expect((await stateOf(`?session=${session}`)).held).toMatchObject({ keepable: true });
    expect(
      ok(
        await call('POST', `/v1/documents/${made.id}/bindings/confirm`, {
          node,
          binding: 'placed',
          replaces: held.version,
          from: 'session',
          session,
        }),
      ),
    ).toMatchObject({ held: { version: held.version, act: 'confirm', taken: { value: '2' } } });

    // Its holders, and once cut, the version holds it kept.
    expect(
      ok(await call('GET', `/v1/components/${component.id}/bindings/placed/holders`)),
    ).toMatchObject({ documents: { readable: [{ id: made.id }], others: 0 } });
    ok(
      await call(
        'DELETE',
        `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version.id}`,
      ),
    );
    expect((await stateOf()).held).toMatchObject({ act: 'confirm', taken: { value: '2' } });
  });

  it('answers the value each binding takes through the bindings view, its provenance redacted to a reader as the definition and the connection allow, over the whole system', async () => {
    const graceCookie = await signIn('grace');
    const asGrace = async (path: string) => {
      const response = await fetch(`${SERVICE}${path}`, { headers: { cookie: graceCookie } });
      return { status: response.status, body: (await response.json()) as Json };
    };
    const grace = ok(await asGrace('/v1/me'))['id'] as string;

    const connectionName = `Readings for values ${Date.now()}`;
    const connection = ok(
      await call('POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: connectionName,
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
    const definitionTitled = async (title: string) =>
      ok(
        await call('POST', `/v1/spaces/${general}/query-definitions`, {
          definition: {
            schemaVersion: 1,
            title,
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
    const shown = await definitionTitled(`Sites shown ${Date.now()}`);
    const hidden = await definitionTitled(`Sites hidden ${Date.now()}`);

    // Grace reads General, so each of these, but is denied reading the connection and one definition.
    const roles = ok(await call('GET', `/v1/roles?level=space:${general}`))['items'] as {
      id: string;
      name: string;
    }[];
    const reader = roles.find((role) => role.name === 'Reader')!.id;
    for (const artifact of [connection, hidden]) {
      ok(
        await call('POST', '/v1/grants', {
          role: reader,
          subject: { principal: grace },
          level: `artifact:${artifact}`,
          effect: 'deny',
        }),
      );
    }

    // A component taking the site's name by both definitions, and its id by the first.
    const binding = (id: string, query: string, column: string) => ({
      type: 'binding',
      id,
      query,
      parameters: { site: { literal: '2' } },
      mode: 'checked',
      take: { column },
    });
    const component = ok(
      await call('POST', `/v1/spaces/${general}/components`, {
        title: 'Site values',
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
          title: 'Site values',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [
                { type: 'text', value: 'The site is ', marks: [] },
                binding('by-shown', shown, 'name'),
                binding('by-hidden', hidden, 'name'),
                binding('its-id', shown, 'id'),
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
    const made = ok(
      await call('POST', `/v1/spaces/${general}/documents`, {
        title: `Values report ${Date.now()}`,
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
    ) as { outline: { nodes: { id: string }[] } };
    const node = edited.outline.nodes[0]!.id;
    ok(
      await call('POST', `/v1/documents/${made.id}/bindings/resolve`, {
        bindings: ['by-shown', 'by-hidden', 'its-id'].map((each) => ({ node, binding: each })),
      }),
    );

    type Shown = {
      binding: { id: string };
      held: { version: string; taken: unknown; provenance: { ran: { sql: string | null } } };
      definition: { title: string } | null;
      connection: { name: string } | null;
    };
    const viewOf = async (body: Json) =>
      new Map((body['bindings'] as Shown[]).map((each) => [each.binding.id, each]));
    const asAda = await viewOf(ok(await call('GET', `/v1/documents/${made.id}/bindings`)));
    const asGraceView = await viewOf(ok(await asGrace(`/v1/documents/${made.id}/bindings`)));
    const name = { value: 'South quay', column: { name: 'name', type: { base: 'text' } } };
    for (const view of [asAda, asGraceView]) {
      expect(view.get('by-shown')!.held.taken).toEqual(name);
      expect(view.get('by-hidden')!.held.taken).toEqual(name);
      expect(view.get('its-id')!.held.taken).toEqual({
        value: '2',
        column: { name: 'id', type: { base: 'integer' } },
      });
    }
    expect(asAda.get('by-shown')).toMatchObject({
      definition: { title: expect.stringMatching(/^Sites shown/) },
      connection: { name: connectionName },
    });
    // Grace reads the definition and not its connection: its title, and no connection's name.
    expect(asGraceView.get('by-shown')).toMatchObject({
      definition: { title: expect.stringMatching(/^Sites shown/) },
      connection: null,
    });
    // Nor the other definition: nothing of it, and no SQL.
    expect(asGraceView.get('by-hidden')).toMatchObject({
      definition: null,
      connection: null,
      held: { provenance: { ran: { sql: null } } },
    });
    expect(JSON.stringify(asGraceView.get('by-hidden'))).not.toContain('Sites hidden');

    // One derived row for each version and take: two takes of the first's version, one of the other's.
    const versions = [
      asAda.get('by-shown')!.held.version,
      asAda.get('by-hidden')!.held.version,
    ] as const;
    expect(versions[0]).not.toBe(versions[1]);
    const counted = takesAtTheService(versions);
    expect(counted).toEqual({ [versions[0]]: 2, [versions[1]]: 1 });
  }, 180_000);

  it('offers a binding pinned to a definition version no result of a later one, and a floating one none of an earlier, over the whole system (#396)', async () => {
    atTheSource(`insert into ${table} values (3, 'West pier');`);
    const connection = ok(
      await call('POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: `Readings for versions ${Date.now()}`,
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
    const body = (description: string) => ({
      schemaVersion: 1,
      title: `Site by version ${Date.now()}`,
      description,
      connection,
      parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
      fetch: { kind: 'sql', text: `select id, name from ${table} where id = {{site}} order by id` },
      columns: [
        { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
        { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
      ],
      key: ['id'],
      order: [{ column: 'id', direction: 'ascending' }],
      empty: 'valid',
      limits: { rows: 100, bytes: 65_536, seconds: 10 },
      retired: false,
    });
    const definition = ok(
      await call('POST', `/v1/spaces/${general}/query-definitions`, { definition: body('One.') }),
    ) as { id: string; version: { id: string } };

    /** A document placing a component holding this binding of site 3, cut by the editing routes. */
    const documentHolding = async (binding: Json) => {
      const component = ok(
        await call('POST', `/v1/spaces/${general}/components`, {
          title: 'Pier',
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
            title: 'Pier',
            language: 'en-GB',
            direction: 'ltr',
            content: [{ type: 'paragraph', id: 'p1', style: 'body', content: [binding] }],
          },
        }),
      );
      ok(
        await call(
          'DELETE',
          `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version.id}`,
        ),
      );
      const made = ok(
        await call('POST', `/v1/spaces/${general}/documents`, {
          title: `Pier report ${Date.now()}`,
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
      ) as { outline: { nodes: { id: string }[] } };
      const node = edited.outline.nodes[0]!.id;
      ok(
        await call('POST', `/v1/documents/${made.id}/bindings/resolve`, {
          bindings: [{ node, binding: 'pier' }],
        }),
      );
      return { id: made.id, node };
    };
    const asked = { type: 'binding', id: 'pier', query: definition.id, mode: 'checked' };
    const site = { site: { literal: '3' } };
    const pinned = await documentHolding({
      ...asked,
      version: definition.version.id,
      parameters: site,
      take: { column: 'name' },
    });
    // The definition moves on, and a floating binding resolves the same question with it.
    ok(
      await call('POST', `/v1/query-definitions/${definition.id}/versions`, {
        openedFrom: definition.version.id,
        definition: body('Two.'),
      }),
    );
    const floating = await documentHolding({
      ...asked,
      parameters: site,
      take: { column: 'name' },
    });
    type View = { bindings: { held: { dataset: string; version: string }; waiting: unknown }[] };
    const viewOf = async (document: string) =>
      (ok(await call('GET', `/v1/documents/${document}/bindings`)) as View).bindings[0]!;
    const [pinnedHeld, floatingHeld] = [await viewOf(pinned.id), await viewOf(floating.id)];
    expect(floatingHeld.held.dataset).toBe(pinnedHeld.held.dataset);
    expect(pinnedHeld.waiting).toBeNull();
    const refused = await call('POST', `/v1/documents/${pinned.id}/bindings/accept`, {
      node: pinned.node,
      binding: 'pier',
      version: floatingHeld.held.version,
      replaces: pinnedHeld.held.version,
    });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'resolution_precondition' });

    // The source changes: the pinned binding's check is offered to it alone.
    atTheSource(`update ${table} set name = 'West pier head' where id = 3;`);
    const checked = ok(await call('POST', `/v1/documents/${pinned.id}/bindings/check`, {})) as {
      results: { outcome: string; version: string }[];
    };
    expect(checked.results[0]).toMatchObject({ outcome: 'revision' });
    expect(await viewOf(pinned.id)).toMatchObject({
      waiting: { version: checked.results[0]!.version },
    });
    expect((await viewOf(floating.id)).waiting).toBeNull();
  }, 180_000);
});

/**
 * How many `dataset_take` rows each version has, read in the project's own database as its owner: one
 * row for each version and take, whichever tenant's schema holds them.
 */
function takesAtTheService(versions: readonly string[]): Record<string, number> {
  const ids = execFileSync(
    'docker',
    [
      'ps',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${PROJECT}`,
      '--filter',
      'label=com.docker.compose.service=postgres',
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length !== 1) throw new Error(`${PROJECT} runs ${ids.length} database containers`);
  const psql = (sql: string) =>
    execFileSync(
      'docker',
      [
        'exec',
        '-i',
        ids[0]!,
        'psql',
        '-U',
        'postgres',
        '-d',
        'alloy_dev',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { input: sql, encoding: 'utf8', timeout: 60_000 },
    );
  const schemas = psql(
    "select table_schema from information_schema.tables where table_name = 'dataset_take';",
  )
    .split(/\s+/)
    .filter(Boolean);
  const listed = versions.map((each) => `'${each}'`).join(', ');
  const rows = psql(
    schemas
      .map(
        (schema) =>
          `select dataset_version, count(*) from ${schema}.dataset_take where dataset_version in (${listed}) group by 1`,
      )
      .join(' union all ') + ';',
  )
    .split(/\s+/)
    .filter(Boolean);
  return Object.fromEntries(
    rows.map((row) => {
      const [version, count] = row.split('|');
      return [version!, Number(count)];
    }),
  );
}
