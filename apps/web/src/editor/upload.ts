import type { createApiClient } from '@alloy-works/api-client';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** What an upload came to: the asset version it made, or why not, in words an author can act on. */
export type UploadOutcome =
  | { readonly ok: true; readonly assetVersion: string }
  | { readonly ok: false; readonly sentence: string };

const TOO_LARGE =
  'This image is larger than 25 MB or has more than 50 million pixels, which is more than an image may have.';

/**
 * Each refusal said once, whether it came at the door as a wire code or after the check as the
 * upload's reason: the author needs what the file was, never where it was caught.
 */
const SAID: Readonly<Record<string, string>> = {
  get asset_format_not_permitted() {
    return words('editor.this-is-not-a-png');
  },
  get not_permitted() {
    return words('editor.this-is-not-a-png');
  },
  asset_too_large: TOO_LARGE,
  too_large: TOO_LARGE,
  too_many_pixels: TOO_LARGE,
  get asset_unreadable() {
    return words('editor.this-is-not-a-complete');
  },
  get malformed() {
    return words('editor.this-is-not-a-complete');
  },
  get undecodable() {
    return words('editor.this-image-could-not-be');
  },
  get unchecked() {
    return words('editor.the-image-could-not-be-2');
  },
  // Editing a component does not by itself let its author add to the space it is in.
  get forbidden() {
    return words('editor.you-may-not-add-an');
  },
};

const FAILED = 'The image could not be uploaded. Try again.';
const TOO_SLOW = 'Checking the image is taking longer than it should. Try again in a moment.';

/** How often the upload is followed, and for how long: every half second for thirty (ruling R4). */
const FOLLOW_EVERY_MS = 500;
const FOLLOW_TIMES = 60;

const refusal = (code: string | undefined): UploadOutcome => ({
  ok: false,
  sentence: (code !== undefined ? SAID[code] : undefined) ?? FAILED,
});

/**
 * An image uploaded into a space for a figure (figures 2, ruling R4): the upload made with the
 * description its author gave - which never travels in a header or a query string - then filled with
 * the bytes as bytes, then followed until the worker's check has finished. `wait` is the pause between
 * asks, which a test replaces.
 */
export async function uploadImage(
  client: Client,
  input: {
    readonly space: string;
    readonly bytes: Uint8Array;
    readonly alternative: { readonly text: string; readonly language: string } | null;
  },
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<UploadOutcome> {
  // A request that never reaches the service rejects rather than answering; it is said as any other
  // failure is, so the dialog waiting on this always hears back (figures 2, final review).
  try {
    return await attempt(client, input, wait);
  } catch {
    return refusal(undefined);
  }
}

async function attempt(
  client: Client,
  input: Parameters<typeof uploadImage>[1],
  wait: (ms: number) => Promise<void>,
): Promise<UploadOutcome> {
  const made = await client.POST('/v1/spaces/{space}/asset-uploads', {
    params: { path: { space: input.space } },
    body: { alternative: input.alternative },
  });
  if (!made.data) return refusal((made.error as { code?: string } | undefined)?.code);
  const id = made.data.id;

  const filled = await client.PUT('/v1/asset-uploads/{id}/bytes', {
    params: { path: { id } },
    // The contract describes the body as a string of its media type; what is sent is the bytes as
    // they are, never serialised as JSON.
    body: input.bytes as unknown as string,
    bodySerializer: (body: unknown) => body as BodyInit,
    headers: { 'content-type': 'application/octet-stream' },
  });
  if (!filled.data) return refusal((filled.error as { code?: string } | undefined)?.code);

  for (let asked = 0; asked < FOLLOW_TIMES; asked += 1) {
    const followed = await client.GET('/v1/asset-uploads/{id}', { params: { path: { id } } });
    const upload = followed.data;
    if (!upload) return refusal(undefined);
    if (upload.state === 'ready' && upload.assetVersion !== null) {
      return { ok: true, assetVersion: upload.assetVersion };
    }
    if (upload.state === 'refused') return refusal(upload.reason ?? undefined);
    await wait(FOLLOW_EVERY_MS);
  }
  return { ok: false, sentence: TOO_SLOW };
}
