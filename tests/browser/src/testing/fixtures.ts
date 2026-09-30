import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { crc32, deflateSync } from 'node:zlib';
import { DEFAULT_LAYOUT_ID } from '@alloy-works/db';
import { vi } from 'vitest';
import { API, STORE_AT } from './addresses.js';
import { edit, nodesOf, words, type Client, type DocumentView } from './api.js';

/**
 * Fixtures made through the API for the measured style (the W13 plan's W13.4): an image, a component
 * holding a token at the head of every block and run the theme styles, a template binding a theme, a
 * document made from it, and the PDF the worker publishes of it.
 */

async function general(client: Client): Promise<string> {
  const { data: spaces } = await client.GET('/v1/spaces');
  const found = spaces?.items.find((space) => space.name === 'General');
  if (!found) throw new Error('The development environment has no General space');
  return found.id;
}

/** A PNG of `width` by `height` pixels, one colour, made here rather than kept as a file. */
export function png(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.from([0, ...Array.from({ length: width }, () => [...rgb]).flat()]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Uploads an image into General and waits for the worker to prove it, answering its asset version. */
export async function uploadImage(client: Client, session: string, bytes: Buffer): Promise<string> {
  const { data: upload } = await client.POST('/v1/spaces/{space}/asset-uploads', {
    params: { path: { space: await general(client) } },
    body: { alternative: { text: 'A block of colour', language: 'en-GB' } },
  });
  if (!upload) throw new Error('An upload could not be started');
  const filled = await fetch(`${API}/v1/asset-uploads/${upload.id}/bytes`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', cookie: session },
    body: new Uint8Array(bytes),
  });
  if (!filled.ok) throw new Error(`Its bytes answered ${filled.status}`);
  let version: string | null = null;
  await vi.waitFor(
    async () => {
      const { data } = await client.GET('/v1/asset-uploads/{id}', {
        params: { path: { id: upload.id } },
      });
      if (data?.reason) throw new Error(`The image was refused: ${data.reason}`);
      if (data?.state !== 'ready') throw new Error(`The image is ${data?.state}`);
      version = data.assetVersion;
    },
    { timeout: 60_000, interval: 250 },
  );
  return version!;
}

/**
 * A component in General at a second version holding `content`, saved as the renderer saves one: the
 * lock claimed, one iteration, a version cut and the lock let go.
 */
export async function makeComponent(
  client: Client,
  title: string,
  content: readonly unknown[],
): Promise<string> {
  const { data: made, response } = await client.POST('/v1/spaces/{space}/components', {
    params: { path: { space: await general(client) } },
    body: { title, language: 'en-GB', direction: 'ltr' },
  });
  if (!made) throw new Error(`making a component answered ${response.status}`);
  const path = { id: made.id };
  const session = randomUUID();
  const claimed = await client.POST('/v1/components/{id}/lock', {
    params: { path },
    body: { session },
  });
  if (!claimed.data) throw new Error(`claiming it answered ${claimed.response.status}`);
  const saved = await client.PUT('/v1/components/{id}/iterations/{session}/{sequence}', {
    params: { path: { ...path, session, sequence: '1' } },
    body: {
      openedFrom: made.version.id,
      content: { schemaVersion: 1, title, language: 'en-GB', direction: 'ltr', content },
    },
  });
  if (!saved.data) {
    throw new Error(`saving it answered ${saved.response.status}: ${JSON.stringify(saved.error)}`);
  }
  const cut = await client.POST('/v1/components/{id}/versions', {
    params: { path },
    body: { session, openedFrom: made.version.id },
  });
  if (cut.data?.outcome !== 'cut') throw new Error(`cutting it answered ${cut.response.status}`);
  await client.DELETE('/v1/components/{id}/lock', {
    params: { path, query: { session, openedFrom: cut.data.version.id } },
  });
  return made.id;
}

/** A template in General over `theme` and the environment's layout, with no starting outline. */
export async function makeTemplate(client: Client, name: string, theme: string): Promise<string> {
  const { data, error, response } = await client.POST('/v1/spaces/{space}/templates', {
    params: { path: { space: await general(client) } },
    body: {
      definition: {
        schemaVersion: 1,
        name,
        theme,
        layout: DEFAULT_LAYOUT_ID,
        schemas: [],
        outline: { sections: [] },
        changes: { add: true, remove: true, reorder: true },
      },
    },
  });
  if (!data)
    throw new Error(`making a template answered ${response.status}: ${JSON.stringify(error)}`);
  return data.id;
}

/**
 * A document from `template`: a section at each depth from the first to `depth`, each holding the
 * next, their titles `titles`, and the component referenced in the deepest, where its own heading is
 * one deeper still.
 */
export async function makeDocument(
  client: Client,
  title: string,
  template: string,
  titles: readonly string[],
  component: string,
): Promise<DocumentView> {
  const {
    data: made,
    error,
    response,
  } = await client.POST('/v1/spaces/{space}/documents', {
    params: { path: { space: await general(client) } },
    body: { title, language: 'en-GB', direction: 'ltr', template },
  });
  if (!made)
    throw new Error(`making a document answered ${response.status}: ${JSON.stringify(error)}`);
  let document = made;
  let parent: string | null = null;
  for (const each of titles) {
    document = await edit(client, document, {
      operation: 'insert',
      parent,
      position: 0,
      node: { type: 'section', title: words(each) },
    });
    let nodes = nodesOf(document);
    let found = nodes[0]!;
    while (found.children.length > 0) {
      nodes = found.children;
      found = nodes[0]!;
    }
    parent = found.id;
  }
  return edit(client, document, {
    operation: 'insert',
    parent,
    position: 0,
    node: { type: 'reference', component, mode: { kind: 'latest' } },
  });
}

/** Follows a link the object store signed, its name kept in `Host` and the socket sent to `STORE_AT`. */
function followSignedLink(link: URL): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const asked = httpRequest(
      {
        host: STORE_AT,
        port: link.port,
        path: `${link.pathname}${link.search}`,
        headers: { host: link.host },
      },
      (answer) => {
        const chunks: Buffer[] = [];
        answer.on('data', (chunk: Buffer) => chunks.push(chunk));
        answer.on('error', reject);
        answer.on('end', () => {
          if (answer.statusCode !== 200)
            reject(new Error(`The store answered ${answer.statusCode}`));
          else resolve(Buffer.concat(chunks));
        });
      },
    );
    asked.on('error', reject);
    asked.end();
  });
}

/** Publishes the document's latest version to a PDF through the stack and downloads it. */
export async function publishPdf(client: Client, document: DocumentView): Promise<Buffer> {
  const { data: asked, error } = await client.POST('/v1/documents/{id}/publications', {
    params: { path: { id: document.id } },
    body: { version: document.version.id, formats: ['pdf'] },
  });
  if (!asked) throw new Error(`asking for a publication answered ${JSON.stringify(error)}`);
  let publication: string | null = null;
  let failures: unknown[] = [];
  await vi.waitFor(
    async () => {
      const { data } = await client.GET('/v1/publication-requests/{id}', {
        params: { path: { id: asked.id } },
      });
      // A failure is final: said at once rather than waited out.
      failures = data?.failures ?? [];
      if (failures.length > 0) return;
      if (data?.state !== 'done') throw new Error(`The request is ${data?.state}`);
      publication = data.publication;
    },
    { timeout: 120_000, interval: 250 },
  );
  if (failures.length > 0) throw new Error(`The publish failed: ${JSON.stringify(failures)}`);
  const { data: kept } = await client.GET('/v1/publications/{id}', {
    params: { path: { id: publication! } },
  });
  const pdf = kept?.outputs.find((each) => each.format === 'pdf');
  if (!pdf) throw new Error('The publication holds no PDF');
  return followSignedLink(new URL(pdf.download));
}
