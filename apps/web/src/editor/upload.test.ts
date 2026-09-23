import { createApiClient } from '@alloy-works/api-client';
import { describe, expect, it, vi } from 'vitest';

import { uploadImage } from './upload.js';

const SPACE = '5a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const UPLOAD = '7a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const VERSION = '00000000-0000-4000-8000-00000000a551';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const view = (state: string, extra: Record<string, unknown> = {}) => ({
  id: UPLOAD,
  space: SPACE,
  state,
  reason: null,
  assetVersion: null,
  ...extra,
});

/** The service as the upload meets it: each route's answers in turn, and what was sent to it. */
function service(answers: Record<string, (() => Response)[]>) {
  const sent: { route: string; body: unknown; type: string | null }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const route = `${request.method} ${new URL(request.url).pathname}`;
    const type = request.headers.get('content-type');
    const body =
      request.method === 'GET'
        ? undefined
        : type === 'application/octet-stream'
          ? new Uint8Array(await request.arrayBuffer())
          : (JSON.parse(await request.text()) as unknown);
    sent.push({ route, body, type });
    const next = answers[route]?.shift();
    return next ? next() : json(404, { code: 'not_found', message: 'none', traceId: 't' });
  });
  return {
    client: createApiClient({
      baseUrl: 'http://dev.acme.test',
      fetch: fetching as unknown as typeof fetch,
    }),
    sent,
  };
}

const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const noWait = async () => {};

describe('uploading an image for a figure (figures 2)', () => {
  it('makes the upload with its description, sends the bytes as bytes, and follows it until it is ready', async () => {
    const { client, sent } = service({
      [`POST /v1/spaces/${SPACE}/asset-uploads`]: [() => json(200, view('awaiting'))],
      [`PUT /v1/asset-uploads/${UPLOAD}/bytes`]: [() => json(200, view('checking'))],
      [`GET /v1/asset-uploads/${UPLOAD}`]: [
        () => json(200, view('checking')),
        () => json(200, view('ready', { assetVersion: VERSION })),
      ],
    });
    const outcome = await uploadImage(
      client,
      { space: SPACE, bytes, alternative: { text: 'A red square', language: 'en-GB' } },
      noWait,
    );
    expect(outcome).toEqual({ ok: true, assetVersion: VERSION });
    expect(sent[0]).toMatchObject({
      body: { alternative: { text: 'A red square', language: 'en-GB' } },
    });
    expect(sent[1]).toMatchObject({ type: 'application/octet-stream', body: bytes });
    expect(sent.filter((each) => each.route.startsWith('GET'))).toHaveLength(2);
  });

  it('says in words why an upload was refused at the door, and after its check', async () => {
    const refusedAtTheDoor = service({
      [`POST /v1/spaces/${SPACE}/asset-uploads`]: [() => json(200, view('awaiting'))],
      [`PUT /v1/asset-uploads/${UPLOAD}/bytes`]: [
        () => json(400, { code: 'asset_format_not_permitted', message: 'x', traceId: 't' }),
      ],
    });
    expect(
      await uploadImage(
        refusedAtTheDoor.client,
        { space: SPACE, bytes, alternative: null },
        noWait,
      ),
    ).toEqual({ ok: false, sentence: 'This is not a PNG or a JPEG image.' });

    const refusedAfter = service({
      [`POST /v1/spaces/${SPACE}/asset-uploads`]: [() => json(200, view('awaiting'))],
      [`PUT /v1/asset-uploads/${UPLOAD}/bytes`]: [() => json(200, view('checking'))],
      [`GET /v1/asset-uploads/${UPLOAD}`]: [
        () => json(200, view('refused', { reason: 'undecodable' })),
      ],
    });
    expect(
      await uploadImage(refusedAfter.client, { space: SPACE, bytes, alternative: null }, noWait),
    ).toEqual({
      ok: false,
      sentence: 'This image could not be read all the way through, so it may be damaged.',
    });
  });

  it('says so in words when the service cannot be reached, or will not let the author add an image', async () => {
    const unreachable = createApiClient({
      baseUrl: 'http://dev.acme.test',
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    expect(
      await uploadImage(unreachable, { space: SPACE, bytes, alternative: null }, noWait),
    ).toEqual({ ok: false, sentence: 'The image could not be uploaded. Try again.' });

    const forbidden = service({
      [`POST /v1/spaces/${SPACE}/asset-uploads`]: [
        () => json(403, { code: 'forbidden', message: 'x', traceId: 't' }),
      ],
    });
    expect(
      await uploadImage(forbidden.client, { space: SPACE, bytes, alternative: null }, noWait),
    ).toEqual({ ok: false, sentence: 'You may not add an image to this space.' });
  });

  it('gives up following an upload that never finishes, and says so rather than waiting for ever', async () => {
    const stuck = service({
      [`POST /v1/spaces/${SPACE}/asset-uploads`]: [() => json(200, view('awaiting'))],
      [`PUT /v1/asset-uploads/${UPLOAD}/bytes`]: [() => json(200, view('checking'))],
      [`GET /v1/asset-uploads/${UPLOAD}`]: Array.from(
        { length: 100 },
        () => () => json(200, view('checking')),
      ),
    });
    const outcome = await uploadImage(
      stuck.client,
      { space: SPACE, bytes, alternative: null },
      noWait,
    );
    expect(outcome).toEqual({
      ok: false,
      sentence: 'Checking the image is taking longer than it should. Try again in a moment.',
    });
    expect(stuck.sent.filter((each) => each.route.startsWith('GET'))).toHaveLength(60);
  });
});
