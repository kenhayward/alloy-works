import { createApiClient } from '@alloy-works/api-client';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { duplicateOf, sha256Of, thumbnailPath } from './library.js';

const GENERAL = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const image = {
  id: ASSET,
  version: { id: VERSION, number: '0.1' },
  name: 'harbour.png',
  alternative: { text: 'A harbour at dawn', language: 'en-GB' },
  format: 'png',
  width: 9,
  height: 4,
  rights: { kind: 'undeclared' },
  licence: null,
  expired: false,
  used: false,
  changedAt: '2026-11-01T09:00:00.000Z',
};

describe("a space's images, as the renderer reads them (the AL plan, AL-J, AL-L)", () => {
  it('AST-009 browses by the thumbnail, never the original', () => {
    expect(thumbnailPath(VERSION)).toBe(`/v1/asset-versions/${VERSION}/derivatives/thumbnail`);
  });

  it("hashes bytes as SHA-256, in lowercase hexadecimal, as the service names an image's object", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(await sha256Of(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it("AST-029 finds an upload's duplicate in the space by the hash of its bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const asked: string[] = [];
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        asked.push(`${url.pathname}${url.search}`);
        return json(200, { items: [image], next: null, total: 1 });
      }),
    });
    expect(await duplicateOf(client, GENERAL, bytes)).toMatchObject({ id: ASSET, name: 'harbour.png' });
    expect(asked).toEqual([`/v1/spaces/${GENERAL}/assets?sha256=${hash}&limit=1`]);
  });

  it('finds no duplicate when the space holds none, or the service cannot say', async () => {
    const answering = (response: () => Response) =>
      createApiClient({ baseUrl: 'http://localhost', fetch: vi.fn(async () => response()) });
    const bytes = new Uint8Array([4]);
    expect(
      await duplicateOf(answering(() => json(200, { items: [], next: null, total: 0 })), GENERAL, bytes),
    ).toBeNull();
    expect(await duplicateOf(answering(() => json(500, {})), GENERAL, bytes)).toBeNull();
  });
});
