import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { inject, vi } from 'vitest';
import { API } from './addresses.js';
import type { Client } from './api.js';

/** The development environment's General space, where every fixture is made. */
export async function generalSpace(client: Client): Promise<string> {
  const { data: spaces } = await client.GET('/v1/spaces');
  const general = spaces?.items.find((space) => space.name === 'General');
  if (!general) throw new Error('The development environment has no General space');
  return general.id;
}

/** CRC-32, as PNG's chunks carry it. */
function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** A six by four PNG of one colour, made here rather than kept as a file. */
export function squarePng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(6, 0);
  header.writeUInt32BE(4, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.from([0, ...Array.from({ length: 6 }, () => [37, 99, 235]).flat()]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([row, row, row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * An image uploaded into the General space through the API, as the Figure dialog uploads one, and
 * waited for until the worker has proved it and recorded its asset version, which is answered.
 */
export async function uploadImage(client: Client, description: string): Promise<string> {
  const space = await generalSpace(client);
  const { data: upload, response } = await client.POST('/v1/spaces/{space}/asset-uploads', {
    params: { path: { space } },
    body: { alternative: { text: description, language: 'en-GB' } },
  });
  if (!upload) throw new Error(`starting an upload answered ${response.status}`);
  const filled = await fetch(`${API}/v1/asset-uploads/${upload.id}/bytes`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', cookie: inject('session') },
    body: new Uint8Array(squarePng()),
  });
  if (!filled.ok) throw new Error(`sending the image answered ${filled.status}`);
  let version: string | null = null;
  await vi.waitFor(
    async () => {
      const { data } = await client.GET('/v1/asset-uploads/{id}', {
        params: { path: { id: upload.id } },
      });
      if (data?.state !== 'ready' || !data.assetVersion) throw new Error('not ready yet');
      version = data.assetVersion;
    },
    { timeout: 60_000, interval: 250 },
  );
  return version!;
}

/**
 * A component in the General space holding `content`, made through the API as the editor makes one:
 * created, its lock claimed, the content saved as an iteration, and Done editing cutting the version
 * the page then opens. Its title carries `name` and the moment it was made, as a document's does.
 * `type` names a component type the space offers; absent, the environment's default.
 */
export async function makeComponent(
  client: Client,
  name: string,
  content: readonly unknown[],
  { type }: { readonly type?: string } = {},
): Promise<{ readonly id: string; readonly title: string }> {
  const space = await generalSpace(client);
  let componentType: string | undefined;
  if (type !== undefined) {
    const { data: types } = await client.GET('/v1/spaces/{space}/component-types', {
      params: { path: { space } },
    });
    componentType = types?.items.find((each) => each.name === type)?.id;
    if (!componentType) throw new Error(`The General space offers no component type ${type}`);
  }
  const title = `${name} ${new Date().toISOString()}`;
  const { data: made, response } = await client.POST('/v1/spaces/{space}/components', {
    params: { path: { space } },
    body: {
      title,
      language: 'en-GB',
      direction: 'ltr',
      ...(componentType === undefined ? {} : { componentType }),
    },
  });
  if (!made) throw new Error(`making a component answered ${response.status}`);
  const id = made.id;
  const openedFrom = made.version.id;
  const session = randomUUID();
  const claimed = await client.POST('/v1/components/{id}/lock', {
    params: { path: { id } },
    body: { session },
  });
  if (!claimed.data) throw new Error(`claiming answered ${claimed.response.status}`);
  const saved = await client.PUT('/v1/components/{id}/iterations/{session}/{sequence}', {
    params: { path: { id, session, sequence: '1' } },
    body: {
      openedFrom,
      content: { schemaVersion: 1, title, language: 'en-GB', direction: 'ltr', content },
    },
  });
  if (!saved.data) {
    throw new Error(
      `saving answered ${saved.response.status}: ${JSON.stringify(saved.error ?? null)}`,
    );
  }
  const done = await client.DELETE('/v1/components/{id}/lock', {
    params: { path: { id }, query: { session, openedFrom } },
  });
  if (!done.response.ok) throw new Error(`Done editing answered ${done.response.status}`);
  return { id, title };
}
