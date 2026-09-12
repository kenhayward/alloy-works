import createOpenApiClient, { type Client } from 'openapi-fetch';
import type { paths } from './generated/schema.js';

export type { paths } from './generated/schema.js';
export { followStream } from './stream.js';
export type { FollowOptions, StreamSample, StreamSnapshot } from './stream.js';

/** What the service answers with, named from the document rather than written out again. */
export type Me = paths['/v1/me']['get']['responses']['200']['content']['application/json'];
export type Sample =
  paths['/v1/samples/{sampleId}']['get']['responses']['200']['content']['application/json'];

/**
 * The one way a client calls the service (API-001): generated from the committed document, so a
 * route that changed without the document changing is a compile error rather than a surprise.
 * The session is a cookie, so every call carries credentials.
 */
export function createApiClient(
  options: { readonly baseUrl?: string; readonly fetch?: typeof fetch } = {},
): Client<paths> {
  return createOpenApiClient<paths>({
    baseUrl: options.baseUrl ?? '',
    credentials: 'include',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
