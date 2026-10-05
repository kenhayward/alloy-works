import { randomBytes, randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';
import { atTheSource } from './source.js';

/**
 * Image columns over the whole system (the D8 plan, D8.3): a definition over a `bytea` column resolved
 * through the connector, the service and the worker's `ingest` to assets, the page's checking back
 * done here by the API; then the same image resolved again for another question, reusing its asset.
 * A photograph no earlier run has admitted is made for each run, in a table of the test's own,
 * dropped afterwards; the seed's `sample.site_photo` is read twice, so the second read reuses
 * whatever the first, or an earlier run, admitted.
 */
const READER = { account: 'reader', password: 'source-reader-dev-password' };

type Json = Record<string, unknown>;

const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** An invented PNG of one random shade, 5 by 4 pixels: an image no earlier run has admitted. */
const freshPng = () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(5, 0);
  header.writeUInt32BE(4, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const shade = randomBytes(3);
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: 5 }, () => shade)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([row, row, row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

describe('image columns over the whole system', () => {
  const table = `sample.d8_photos_${Date.now()}`;
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
      `create table ${table} (id integer primary key, caption text not null, photo bytea not null);
       insert into ${table} values (1, 'A new photograph', '\\x${freshPng().toString('hex')}');
       grant select on ${table} to reader;`,
    );
  }, 180_000);

  afterAll(() => {
    atTheSource(`drop table if exists ${table};`);
  });

  it('resolves a binary image column through ingest to assets, and resolves the same image again reusing its asset', async () => {
    const connection = ok(
      await call('POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: `Readings for photographs ${Date.now()}`,
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

    // The source proposes a bytea column as an image held as binary (D8-A).
    const described = ok(
      await call('POST', `/v1/connections/${connection}/describe`, {
        sql: { text: 'select id, caption, photo from sample.site_photo', parameters: [] },
      }),
    );
    expect(described['columns']).toMatchObject([
      { name: 'id' },
      { name: 'caption', proposed: { base: 'text' } },
      { name: 'photo', sourceType: 'bytea', proposed: { base: 'image', encoding: 'binary' } },
    ]);

    // Three definitions of a photograph and its caption: over the test's own table, and over the
    // seed's by a site's id and by its site.
    const define = async (title: string, text: string) =>
      ok(
        await call('POST', `/v1/spaces/${general}/query-definitions`, {
          definition: {
            schemaVersion: 1,
            title: `${title} ${Date.now()}`,
            description: 'A photograph and its caption.',
            connection,
            parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
            fetch: { kind: 'sql', text },
            columns: [
              { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
              { name: 'caption', from: { column: 'caption' }, type: { base: 'text' } },
              {
                name: 'photo',
                from: { column: 'photo' },
                type: { base: 'image', encoding: 'binary', description: { column: 'caption' } },
              },
            ],
            key: ['id'],
            order: [{ column: 'id', direction: 'ascending' }],
            empty: 'valid',
            limits: { rows: 100, bytes: 65_536, seconds: 10 },
            retired: false,
          },
        }),
      )['id'] as string;
    const fresh = await define(
      'New photograph',
      `select id, caption, photo from ${table} where id = {{site}} order by id`,
    );
    const byId = await define(
      'Site photograph',
      'select id, caption, photo from sample.site_photo where id = {{site}} order by id',
    );
    const bySite = await define(
      'Photograph of a site',
      'select id, caption, photo from sample.site_photo where site = {{site}} order by id',
    );

    // A component taking each caption, placed in a document. An image is placed by B6, not here.
    const component = ok(
      await call('POST', `/v1/spaces/${general}/components`, {
        title: 'Site photographs',
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const session = randomUUID();
    const bound = (id: string, query: string) => ({
      type: 'binding',
      id,
      query,
      parameters: { site: { literal: '1' } },
      mode: 'checked',
      take: { column: 'caption' },
    });
    ok(await call('POST', `/v1/components/${component.id}/lock`, { session }));
    ok(
      await call('PUT', `/v1/components/${component.id}/iterations/${session}/1`, {
        openedFrom: component.version.id,
        content: {
          schemaVersion: 1,
          title: 'Site photographs',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [
                { type: 'text', value: 'Captions: ', marks: [] },
                bound('fresh', fresh),
                { type: 'text', value: ', ', marks: [] },
                bound('by-id', byId),
                { type: 'text', value: ' and ', marks: [] },
                bound('by-site', bySite),
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
        title: `Photograph report ${Date.now()}`,
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const document = made.id;
    const node = (
      ok(
        await call('POST', `/v1/documents/${document}/outline`, {
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

    type Held = { dataset: string; version: string; reused: boolean };
    /** Resolves one binding: held at once, or pending and followed until every image is admitted. */
    const resolve = async (binding: string): Promise<{ status: number; held: Held }> => {
      const answer = await call('POST', `/v1/documents/${document}/bindings/resolve`, {
        bindings: [{ node, binding }],
      });
      expect([200, 202], JSON.stringify(answer.body)).toContain(answer.status);
      const [result] = answer.body['results'] as ({ held?: Held; pending?: string } & Json)[];
      if (result!.held !== undefined) return { status: answer.status, held: result!.held };
      expect(result!.pending, JSON.stringify(result)).toEqual(expect.any(String));
      let held: Held | undefined;
      await vi.waitFor(
        async () => {
          const followed = ok(await call('GET', `/v1/datasets/pending/${result!.pending}`)) as {
            state: string;
            result: { held?: Held } | null;
          };
          expect(followed.state).toBe('done');
          expect(followed.result, JSON.stringify(followed.result)).toHaveProperty('held');
          held = followed.result!.held;
        },
        { timeout: 60_000, interval: 250 },
      );
      return { status: answer.status, held: held! };
    };
    const imagesOf = async (version: string) => {
      const read = ok(await call('GET', `/v1/documents/${document}/datasets/${version}`)) as {
        result: { rows: (string | null)[][] };
        provenance: { images: Record<string, string> };
      };
      return { rows: read.result.rows, images: read.provenance.images };
    };

    // An image no asset holds: answered pending, and recorded once ingest has admitted it.
    const first = await resolve('fresh');
    expect(first.status).toBe(202);
    const admitted = await imagesOf(first.held.version);
    const [hash] = admitted.rows[0]!.slice(2) as string[];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(admitted.images)).toEqual([hash]);
    // The asset is read through the document holding it (D8-I).
    expect(ok(await call('GET', `/v1/asset-versions/${admitted.images[hash!]}`))).toMatchObject({
      format: 'png',
      width: 5,
      height: 4,
    });

    // The seed's photograph, by its id: admitted now, or by an earlier run against this stack.
    const seeded = await imagesOf((await resolve('by-id')).held.version);
    expect(seeded.rows).toEqual([['1', 'The weir from the north bank', expect.any(String)]]);
    const seedHash = seeded.rows[0]![2]!;
    const seedAsset = seeded.images[seedHash];
    expect(ok(await call('GET', `/v1/asset-versions/${seedAsset}`))).toMatchObject({
      format: 'png',
      width: 4,
      height: 3,
    });

    // The same photograph for another question: recorded at once, reusing the asset.
    const again = await resolve('by-site');
    expect(again.status).toBe(200);
    expect(again.held.dataset).not.toBe(first.held.dataset);
    expect((await imagesOf(again.held.version)).images).toEqual({ [seedHash]: seedAsset });
  }, 180_000);
});
