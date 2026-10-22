import type { REFERENCE_FAILURES } from '@alloy-works/domain';
import {
  REFERENCE_MOST_BYTES,
  readReferenceAnswer,
  referencePath,
  searchIdentifiers,
  type ChildReferenceRequest,
  type ReferenceAnswer,
  type ReferenceStep,
} from '@alloy-works/domain';

import { exchange, type ExchangePolicy } from './https.js';

/** How long a reference call may take, every step of it. */
export const REFERENCE_DEADLINE_MS = 15_000;
/** The deepest a source's JSON may nest, and the longest any list in it may be. */
const MOST_DEPTH = 32;
const MOST_LENGTH = 10_000;

type Reason = (typeof REFERENCE_FAILURES)[number];

class Failed extends Error {
  constructor(readonly reason: Reason) {
    super(reason);
  }
}

/** Whether JSON text nests deeper than the bound, read before it is parsed. */
function tooDeep(text: string): boolean {
  let depth = 0;
  let inString = false;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (inString) {
      if (char === '\\') at += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '[' || char === '{') {
      depth += 1;
      if (depth > MOST_DEPTH) return true;
    } else if (char === ']' || char === '}') depth -= 1;
  }
  return false;
}

/** Whether any list in a parsed value is longer than the bound. */
function tooLong(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > MOST_LENGTH || value.some(tooLong);
  if (typeof value === 'object' && value !== null) return Object.values(value).some(tooLong);
  return false;
}

/**
 * A reference source asked, in the child (the XR plan, XR-B): each step one `GET` to the host the
 * supervisor gave from domain's list, over TLS, held to the guard with the private ranges among its
 * deny list, no redirect followed, no credential, the terms only as encoded query parameters, at most
 * the operation's bytes, under one deadline. The answer mapped to CSL in domain; a failure answered as
 * the source's, by reason alone.
 */
export async function answerReference(
  input: ChildReferenceRequest,
  options: { readonly lookup?: ExchangePolicy['lookup'] } = {},
): Promise<ReferenceAnswer> {
  const { request } = input;
  const deadline = Date.now() + REFERENCE_DEADLINE_MS;
  const maxBytes = REFERENCE_MOST_BYTES[request.op];

  /** One step's JSON, or undefined where the source holds no such record. */
  const get = async (step: ReferenceStep): Promise<unknown> => {
    const fetched = await exchange(
      {
        host: input.host,
        port: input.port,
        path: referencePath(request.source, step, input.contact),
        method: 'GET',
        secure: true,
        headers: [
          ['accept', 'application/json'],
          ['user-agent', 'Alloy-Works-References/1'],
        ],
      },
      {
        deny: input.deny,
        ...(options.lookup ? { lookup: options.lookup } : {}),
        ...(input.ca === undefined ? {} : { ca: input.ca }),
        deadline,
        connectTimeoutMs: input.connectTimeoutMs,
        maxBytes,
      },
    );
    if (!fetched.ok) {
      switch (fetched.failure.code) {
        case 'source_refused':
          if (fetched.failure.status === 404 && step.step !== 'search') return undefined;
          throw new Failed('status');
        case 'connection_failed':
          throw new Failed('refused');
        case 'timeout':
          throw new Failed('timeout');
        case 'byte_limit':
          throw new Failed('too_large');
        default:
          throw new Failed('connector');
      }
    }
    const text = fetched.body.toString('utf8');
    if (tooDeep(text)) throw new Failed('unreadable');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Failed('unreadable');
    }
    if (tooLong(parsed)) throw new Failed('unreadable');
    return parsed;
  };

  const found = (answer: unknown): ReferenceAnswer => {
    const results = readReferenceAnswer(request.source, request.op, answer);
    if (results === undefined) throw new Failed('unreadable');
    return { type: 'found', results };
  };

  try {
    if (request.op === 'search') {
      const terms = request.query!;
      if (request.source === 'crossref') return found(await get({ step: 'search', terms }));
      const ids = searchIdentifiers(await get({ step: 'search', terms }));
      if (ids.length === 0) return { type: 'found', results: [] };
      return found(await get({ step: 'summary', ids }));
    }
    const answer = await get({ step: 'work', identifier: request.identifier! });
    return answer === undefined ? { type: 'found', results: [] } : found(answer);
  } catch (error) {
    return {
      type: 'failed',
      code: 'reference_unavailable',
      source: request.source,
      reason: error instanceof Failed ? error.reason : 'connector',
    };
  }
}
