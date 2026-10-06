import { randomBytes, randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

import { strFromU8, unzipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';
import { followSignedLink } from './signed-link.js';
import { atTheSource } from './source.js';

/**
 * Bound images over the whole system (the B6 plan, task 5): the seed's `sample.site_photo` placed in a
 * line and as a figure by the API, resolved through the connector and the worker's `ingest`, drawn
 * through the asset version route to a reader of the document, and published - each read back from
 * the PDF's structure and the docx as an image described by its row's caption. Then a photograph whose
 * caption is null in a table of the test's own, which the publish refuses by name. Uncited, as B1's
 * whole-system tests are: the suites below them demonstrate the requirements.
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

/** Every figure a PDF's structure tree holds, by its alternative text, as pdf.js reads it. */
async function figuresIn(bytes: Buffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const found: string[] = [];
    const walk = (node: unknown) => {
      if (typeof node !== 'object' || node === null) return;
      const { role, alt, children } = node as { role?: string; alt?: string; children?: unknown[] };
      if (role === 'Figure') found.push(alt ?? '');
      for (const child of children ?? []) walk(child);
    };
    for (let number = 1; number <= pdf.numPages; number += 1) {
      walk(await (await pdf.getPage(number)).getStructTree());
    }
    return found;
  } finally {
    await task.destroy();
  }
}

describe('bound images over the whole system', () => {
  const table = `sample.b6_photos_${Date.now()}`;
  let cookie = '';
  let general = '';
  let connection = '';

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

  /** A definition of a site's photograph and its caption, which describes it. */
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

  const bound = (id: string, query: string) => ({
    type: 'binding',
    id,
    query,
    parameters: { site: { literal: '1' } },
    mode: 'checked',
    take: { column: 'photo' },
  });

  /** A component holding `content`, placed in a new document: the document, its version and node. */
  const placed = async (content: unknown[]) => {
    const component = ok(
      await call('POST', `/v1/spaces/${general}/components`, {
        title: 'Site photographs',
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
          title: 'Site photographs',
          language: 'en-GB',
          direction: 'ltr',
          content,
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
    const outlined = ok(
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
    return { document: made.id, version: outlined.version.id, node: outlined.outline.nodes[0]!.id };
  };

  /** Resolves the bindings named: held at once, or pending and followed until done. */
  const resolve = async (document: string, node: string, bindings: string[]) => {
    const answer = await call('POST', `/v1/documents/${document}/bindings/resolve`, {
      bindings: bindings.map((binding) => ({ node, binding })),
    });
    expect([200, 202], JSON.stringify(answer.body)).toContain(answer.status);
    for (const result of answer.body['results'] as ({ pending?: string } & Json)[]) {
      if (result.pending === undefined) continue;
      await vi.waitFor(
        async () => {
          const followed = ok(await call('GET', `/v1/datasets/pending/${result.pending}`));
          expect(followed['state']).toBe('done');
        },
        { timeout: 60_000, interval: 250 },
      );
    }
  };

  /** Publishes the document's version as the PDF and Word, and answers the request as it ended. */
  const publish = async (document: string, version: string) => {
    const asked = ok(
      await call('POST', `/v1/documents/${document}/publications`, {
        version,
        formats: ['pdf', 'docx'],
      }),
    ) as { id: string };
    let ended: Json = {};
    await vi.waitFor(
      async () => {
        ended = ok(await call('GET', `/v1/publication-requests/${asked.id}`));
        expect(['done', 'failed']).toContain(ended['state']);
      },
      { timeout: 90_000, interval: 250 },
    );
    return ended;
  };

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn('ada');
    const spaces = await call('GET', '/v1/spaces');
    general = (spaces.body['items'] as { id: string; name: string }[]).find(
      (space) => space.name === 'General',
    )!.id;
    atTheSource(
      `create table ${table} (id integer primary key, caption text, photo bytea not null);
       insert into ${table} values (1, null, '\\x${freshPng().toString('hex')}');
       grant select on ${table} to reader;`,
    );
    connection = ok(
      await call('POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: `Readings for bound photographs ${Date.now()}`,
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
  }, 180_000);

  afterAll(() => {
    atTheSource(`drop table if exists ${table};`);
  });

  it('places a site photograph in a line and as a figure, draws it for a reader of the document, and publishes each as an image described by its caption', async () => {
    const byId = await define(
      'Site photograph',
      'select id, caption, photo from sample.site_photo where id = {{site}} order by id',
    );
    const { document, version, node } = await placed([
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [{ type: 'text', value: 'The weir: ', marks: [] }, bound('in-line', byId)],
      },
      {
        type: 'figure',
        id: 'f1',
        binding: bound('as-figure', byId),
        imageStyle: 'figure',
        caption: [{ type: 'text', value: 'The weir', marks: [] }],
        alternative: { kind: 'inherited' },
      },
    ]);
    await resolve(document, node, ['in-line', 'as-figure']);

    // The view answers each image with its asset version and description (B6-G).
    const view = ok(await call('GET', `/v1/documents/${document}/bindings`)) as {
      bindings: { binding: { id: string }; held: { taken: Json } }[];
    };
    const taken = Object.fromEntries(
      view.bindings.map((each) => [each.binding.id, each.held.taken]),
    );
    const description = 'The weir from the north bank';
    expect(taken['in-line']).toMatchObject({ description, assetVersion: expect.any(String) });
    expect(taken['as-figure']).toMatchObject({ description });
    // Its bytes, through the route the page draws it from, to a reader of the document (D8-I).
    const content = await fetch(
      `${SERVICE}/v1/asset-versions/${taken['as-figure']!['assetVersion'] as string}/content`,
      { headers: { cookie } },
    );
    expect(content.status).toBe(200);
    expect(content.headers.get('content-type')).toBe('image/png');

    const ended = await publish(document, version);
    expect(ended).toMatchObject({ state: 'done', failures: [] });
    const kept = ok(await call('GET', `/v1/publications/${ended['publication'] as string}`)) as {
      outputs: { format: string; download: string }[];
    };
    const bytesOf = async (format: string) =>
      (
        await followSignedLink(
          new URL(kept.outputs.find((each) => each.format === format)!.download),
        )
      ).body;
    // In the PDF, two figures - the image in its line and the figure's - each tagged with the caption.
    expect(await figuresIn(await bytesOf('pdf'))).toEqual([description, description]);
    // In Word, two drawings described the same, and the image among the package's media.
    const word = unzipSync(new Uint8Array(await bytesOf('docx')));
    const xml = strFromU8(word['word/document.xml']!);
    expect([...xml.matchAll(/descr="([^"]*)"/g)].map((match) => match[1])).toEqual([
      description,
      description,
    ]);
    expect(Object.keys(word).some((name) => name.startsWith('word/media/'))).toBe(true);
  }, 240_000);

  it('refuses to publish a bound figure whose row has no caption to describe it, by name', async () => {
    const uncaptioned = await define(
      'Uncaptioned photograph',
      `select id, caption, photo from ${table} where id = {{site}} order by id`,
    );
    const { document, version, node } = await placed([
      {
        type: 'figure',
        id: 'f1',
        binding: bound('unnamed', uncaptioned),
        imageStyle: 'figure',
        caption: [{ type: 'text', value: 'A photograph', marks: [] }],
        alternative: { kind: 'inherited' },
      },
    ]);
    await resolve(document, node, ['unnamed']);
    const ended = await publish(document, version);
    expect(ended['state']).toBe('failed');
    expect(ended['failures']).toEqual([
      expect.objectContaining({ code: 'image_description_missing', block: 'f1' }),
    ]);
  }, 240_000);
});
