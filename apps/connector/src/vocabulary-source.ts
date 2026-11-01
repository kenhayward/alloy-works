import {
  VOCABULARY_SOURCE_MOST_BYTES,
  type ChildVocabularySourceRequest,
  type VocabularySourceAnswer,
} from '@alloy-works/domain';

import { baseUrlParts, exchange, type ExchangePolicy } from './https.js';

/** How long a vocabulary source's fetch may take (VO-J). */
export const VOCABULARY_SOURCE_DEADLINE_MS = 20_000;

/** The media type alone, lower-cased, without its parameters; nothing where none or too long. */
function mediaType(header: string | undefined): string | undefined {
  const type = header?.split(';')[0]?.trim().toLowerCase();
  return type === undefined || type === '' || type.length > 200 ? undefined : type;
}

/**
 * A vocabulary's SKOS address fetched, in the child (the VO plan, VO-J): one `GET` to the URL an
 * administrator named, held to the guard as a manifest's is, at most 5 MB in 20 s, no redirect
 * followed. Its text and media type answered, for the service to read; never the network's words.
 */
export async function answerVocabularySource(
  input: ChildVocabularySourceRequest,
  options: { readonly lookup?: ExchangePolicy['lookup'] } = {},
): Promise<VocabularySourceAnswer> {
  const url = new URL(input.request.url);
  const parts = baseUrlParts(`${url.protocol}//${url.host}`);
  const fetched = await exchange(
    {
      host: parts.host,
      port: parts.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      secure: true,
      headers: [
        ['accept', 'text/turtle, application/ld+json;q=0.9, application/json;q=0.5'],
        ['user-agent', 'Alloy-Works-Vocabularies/1'],
      ],
    },
    {
      deny: input.deny,
      ...(options.lookup ? { lookup: options.lookup } : {}),
      ...(input.ca === undefined ? {} : { ca: input.ca }),
      deadline: Date.now() + VOCABULARY_SOURCE_DEADLINE_MS,
      connectTimeoutMs: input.connectTimeoutMs,
      maxBytes: VOCABULARY_SOURCE_MOST_BYTES,
    },
  );
  if (fetched.ok) {
    const contentType = mediaType(fetched.headers['content-type']);
    return {
      type: 'fetched',
      body: fetched.body.toString('utf8'),
      ...(contentType === undefined ? {} : { contentType }),
    };
  }
  switch (fetched.failure.code) {
    case 'timeout':
      return { type: 'failed', code: 'timeout' };
    case 'byte_limit':
      return { type: 'failed', code: 'source_too_large' };
    case 'source_refused':
      return { type: 'failed', code: 'source_refused' };
    case 'connection_failed':
      return { type: 'failed', code: 'connection_failed' };
    default:
      return { type: 'failed', code: 'connector_error' };
  }
}
