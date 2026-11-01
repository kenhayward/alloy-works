import type { createApiClient } from '@alloy-works/api-client';

type Client = ReturnType<typeof createApiClient>;

/** An image as a space's library lists it (the AL plan, AL-J). */
export interface LibraryImage {
  readonly id: string;
  readonly version: { readonly id: string; readonly number: string };
  readonly name: string | null;
  readonly alternative: { readonly text: string; readonly language: string } | null;
  readonly format: 'png' | 'jpeg';
  readonly width: number;
  readonly height: number;
  readonly licence: { readonly id: string; readonly name: string } | null;
  readonly rights: { readonly kind: string };
  readonly expired: boolean;
  readonly used: boolean;
  readonly changedAt: string;
}

/** Where a version's thumbnail is read: a library is browsed by derivatives, never originals (AST-009). */
export const thumbnailPath = (version: string): string =>
  `/v1/asset-versions/${encodeURIComponent(version)}/derivatives/thumbnail`;

/** The SHA-256 of bytes in lowercase hexadecimal, as the service names an image's object. */
export async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The image in the space with these bytes, which the uploader may read, or null (AST-029; the AL plan,
 * AL-L): offered instead of a second copy. Null too when the service cannot say: the upload goes on.
 */
export async function duplicateOf(
  client: Client,
  space: string,
  bytes: Uint8Array,
): Promise<LibraryImage | null> {
  try {
    const sha256 = await sha256Of(bytes);
    const { data } = await client.GET('/v1/spaces/{space}/assets', {
      params: { path: { space }, query: { sha256, limit: '1' } },
    });
    return (data?.items[0] as LibraryImage | undefined) ?? null;
  } catch {
    return null;
  }
}
