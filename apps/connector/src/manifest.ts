import {
  MANIFEST_MOST_BYTES,
  type ChildManifestRequest,
  type ManifestAnswer,
} from '@alloy-works/domain';

import { baseUrlParts, exchange, type ExchangePolicy } from './https.js';

/** How long a manifest's fetch may take. */
const MANIFEST_DEADLINE_MS = 10_000;

/**
 * An extension's manifest fetched, in the child (the EX plan, EX-B): one `GET` to the URL an
 * administrator named, held to the guard as an HTTP source's is, at most 64 KiB, no redirect followed.
 * Its text answered whole, for the service to read strictly; never a header or the network's words.
 */
export async function answerManifest(
  input: ChildManifestRequest,
  options: { readonly lookup?: ExchangePolicy['lookup'] } = {},
): Promise<ManifestAnswer> {
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
        ['accept', 'application/json'],
        ['user-agent', 'Alloy-Works-Extensions/1'],
      ],
    },
    {
      deny: input.deny,
      ...(options.lookup ? { lookup: options.lookup } : {}),
      ...(input.ca === undefined ? {} : { ca: input.ca }),
      deadline: Date.now() + MANIFEST_DEADLINE_MS,
      connectTimeoutMs: input.connectTimeoutMs,
      maxBytes: MANIFEST_MOST_BYTES,
    },
  );
  if (fetched.ok) return { type: 'fetched', body: fetched.body.toString('utf8') };
  switch (fetched.failure.code) {
    case 'timeout':
      return { type: 'failed', code: 'timeout' };
    case 'byte_limit':
      return { type: 'failed', code: 'manifest_too_large' };
    case 'source_refused':
      return { type: 'failed', code: 'manifest_refused' };
    case 'connection_failed':
      return { type: 'failed', code: 'connection_failed' };
    default:
      return { type: 'failed', code: 'connector_error' };
  }
}
