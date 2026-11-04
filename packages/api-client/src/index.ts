import createOpenApiClient, { type Client } from 'openapi-fetch';
import type { paths } from './generated/schema.js';

export type { paths } from './generated/schema.js';
export { followStream } from './stream.js';
export type { FollowOptions, StreamSample, StreamSnapshot } from './stream.js';
export { streamPost } from './stream-post.js';
export { sendLanguage } from './language.js';
import { saidLanguage } from './language.js';
export type { StreamPostOptions, StreamPostOutcome } from './stream-post.js';

/** What the service answers with, named from the document rather than written out again. */
export type Me = paths['/v1/me']['get']['responses']['200']['content']['application/json'];
export type Sample =
  paths['/v1/samples/{sampleId}']['get']['responses']['200']['content']['application/json'];
export type ComponentList =
  paths['/v1/components']['get']['responses']['200']['content']['application/json'];
export type ComponentView =
  paths['/v1/components/{id}']['get']['responses']['200']['content']['application/json'];
/** One field of a component as its view carries it (definitions.md, "A component's"). */
export type FieldView = ComponentView['fields'][number];
export type PublicationList =
  paths['/v1/publications']['get']['responses']['200']['content']['application/json'];
export type TemplateList =
  paths['/v1/templates']['get']['responses']['200']['content']['application/json'];
/** A cohort: its rows and their outcomes (the R7 plan, R7-G). */
export type CohortView =
  paths['/v1/cohorts/{id}']['get']['responses']['200']['content']['application/json'];
/** What waits on the caller (home.md, Needs your attention). */
export type AttentionView =
  paths['/v1/me/attention']['get']['responses']['200']['content']['application/json'];
/** The theme and layout a page's text is set in (themes.md, "The theme in the editor"). */
export type PresentationView =
  paths['/v1/presentation']['get']['responses']['200']['content']['application/json'];

type EnvironmentRefusal = 'environment_suspended' | 'environment_closing';

const refusalListeners = new Set<(code: EnvironmentRefusal) => void>();

/**
 * Told when any call finds its environment suspended or closing (ADM-028, ADM-030), so a page already
 * open can say so however many places asked. Answers how to stop listening.
 */
export function onEnvironmentRefused(listener: (code: EnvironmentRefusal) => void): () => void {
  refusalListeners.add(listener);
  return () => refusalListeners.delete(listener);
}

const noticeRefusal = async (response: Response): Promise<void> => {
  if (response.status !== 503) return;
  const body = (await response
    .clone()
    .json()
    .catch(() => undefined)) as { code?: unknown } | undefined;
  if (body?.code !== 'environment_suspended' && body?.code !== 'environment_closing') return;
  for (const listener of refusalListeners) listener(body.code);
};

/**
 * The one way a client calls the service (API-001): generated from the committed document, so a
 * route that changed without the document changing is a compile error rather than a surprise.
 * The session is a cookie, so every call carries credentials.
 */
export function createApiClient(
  options: { readonly baseUrl?: string; readonly fetch?: typeof fetch } = {},
): Client<paths> {
  // The interface's language said on the request itself, in the same tick, as middleware would not be.
  const given = options.fetch;
  const saying: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const said = saidLanguage();
    if (said !== undefined) request.headers.set('accept-language', said);
    const response = await (given ?? globalThis.fetch)(request);
    void noticeRefusal(response);
    return response;
  };
  return createOpenApiClient<paths>({
    baseUrl: options.baseUrl ?? '',
    credentials: 'include',
    fetch: saying,
  });
}
