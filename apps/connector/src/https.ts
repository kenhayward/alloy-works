import { createHash, timingSafeEqual, type Hash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { rootCertificates } from 'node:tls';
import type { LookupFunction } from 'node:net';
import type { Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { dataFailure, type DataFailure } from '@alloy-works/domain';

import { guardedAddress, normaliseHost, type Lookup } from './guard.js';

/**
 * The one HTTPS client (the D6 plan, D6-B), for an HTTP source and S3 alike: the host guarded and
 * resolved once, the socket's lookup pinned to the address checked, so a rebinding answer is never
 * asked for; HTTPS only, by `node:https` with an agent of its own and no proxy read from anywhere; no
 * redirect followed; one deadline over the whole exchange, headers and body, the request destroyed
 * at it (DAT-109); the body counted as it arrives and again after decoding - gzip, deflate or brotli,
 * one at a time - either past the limit `byte_limit` (DAT-110); and what the response states of
 * itself apart from its framing checked: its `Content-Length` and RFC 9530's `Content-Digest`
 * (DAT-108). Never an ETag. No error, URL or header is ever answered: only a failure's code.
 */

export interface Exchange {
  /** The host as the connection stores it: a name, or an address without brackets. */
  readonly host: string;
  readonly port: number;
  /** The path and query, already encoded by the template's builder. */
  readonly path: string;
  readonly method: 'GET' | 'POST' | 'HEAD';
  readonly headers: readonly (readonly [string, string])[];
  readonly body?: string;
}

export interface ExchangePolicy {
  readonly deny: readonly string[];
  readonly lookup?: Lookup;
  /** A development or CI source's certificate authority, as PEM, beside the system's. */
  readonly ca?: string;
  /** The deadline over the whole exchange, as a `Date.now()` time. */
  readonly deadline: number;
  readonly connectTimeoutMs: number;
  /** The most bytes the body may be, as it arrives and once decoded. */
  readonly maxBytes: number;
  /** Shown each chunk of the body as it arrived, before decoding: what S3's checksums are over. */
  readonly observe?: (chunk: Buffer) => void;
}

export type Exchanged =
  | {
      readonly ok: true;
      readonly status: number;
      readonly headers: IncomingHttpHeaders;
      readonly body: Buffer;
    }
  | { readonly ok: false; readonly failure: DataFailure };

/** The statuses that read as a failure to reach or sign in, alike (DAT-075): a redirect too. */
const UNREACHED = new Set([401, 403, 407]);

/** RFC 9530's digests the client checks, by the name `Content-Digest` gives each. */
const DIGESTS: Readonly<Record<string, 'sha256' | 'sha512'>> = {
  'sha-256': 'sha256',
  'sha-512': 'sha512',
};

/**
 * The digests a `Content-Digest` header states (RFC 9530, a structured dictionary of byte
 * sequences), by algorithm; an algorithm the client does not know is passed over, and a header it
 * cannot read states nothing it checks. Undefined where it is malformed.
 */
export function statedDigests(header: string | undefined): Map<string, Buffer> | undefined {
  const stated = new Map<string, Buffer>();
  if (header === undefined) return stated;
  for (const member of header.split(',')) {
    const match = /^\s*([a-z][a-z0-9_.*-]*)\s*=\s*:([A-Za-z0-9+/]*={0,2}):\s*$/.exec(member);
    if (!match) return undefined;
    const algorithm = DIGESTS[match[1]!];
    if (algorithm !== undefined) stated.set(algorithm, Buffer.from(match[2]!, 'base64'));
  }
  return stated;
}

/** The decoder for a `Content-Encoding`, none for identity, or undefined for one not taken. */
function decoderFor(encoding: string | undefined): Transform | null | undefined {
  const name = (encoding ?? 'identity').trim().toLowerCase();
  if (name === 'identity' || name === '') return null;
  if (name === 'gzip' || name === 'x-gzip') return createGunzip();
  if (name === 'deflate') return createInflate();
  if (name === 'br') return createBrotliDecompress();
  return undefined;
}

/**
 * One request and its response, under the policy. The guard refusing the host, a refused or filtered
 * port, a TLS failure, a 401, 403 or 407 and any redirect are `connection_failed` alike, so none tells
 * an author more than another (DAT-075); any other status but a 2xx is `source_refused` with that
 * status alone, its body never read.
 */
export async function exchange(asked: Exchange, policy: ExchangePolicy): Promise<Exchanged> {
  const failed = (failure: DataFailure): Exchanged => ({ ok: false, failure });
  const guarded = await guardedAddress(asked.host, {
    deny: policy.deny,
    ...(policy.lookup ? { lookup: policy.lookup } : {}),
  });
  if (guarded === 'refused') return failed(dataFailure('connection_failed'));
  if (Date.now() >= policy.deadline) return failed(dataFailure('timeout'));
  const byName = normaliseHost(asked.host).kind === 'name';
  // The address checked is the only one the socket may reach, whatever a resolver would say now.
  const pinned: LookupFunction = (_hostname, options, callback) => {
    const all = (options as { all?: boolean } | undefined)?.all === true;
    if (all) {
      (callback as (error: null, addresses: { address: string; family: number }[]) => void)(null, [
        { address: guarded.address, family: guarded.family },
      ]);
    } else callback(null, guarded.address, guarded.family);
  };
  const headers: Record<string, string> = {};
  for (const [name, value] of asked.headers) headers[name] = value;
  headers['accept-encoding'] = 'gzip, deflate, br';
  if (asked.body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(asked.body, 'utf8'));
  }
  const options: RequestOptions = {
    host: byName ? asked.host : guarded.address,
    port: asked.port,
    path: asked.path,
    method: asked.method,
    headers,
    // An agent of its own: no socket pooled from another request, and no proxy, which Node reads
    // only through an agent configured for one.
    agent: false,
    lookup: pinned,
    family: guarded.family,

    ...(byName ? { servername: asked.host } : {}),
    ...(policy.ca === undefined ? {} : { ca: [...rootCertificates, policy.ca] }),
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
    maxHeaderSize: 16 * 1024,
  };

  return new Promise<Exchanged>((resolve) => {
    let settled = false;
    let connected = false;
    const timers: NodeJS.Timeout[] = [];
    const finish = (outcome: Exchanged) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      if (!outcome.ok) request.destroy();
      resolve(outcome);
    };
    const request = httpsRequest(options);
    timers.push(
      setTimeout(
        () => finish(failed(dataFailure('timeout'))),
        Math.max(0, policy.deadline - Date.now()),
      ),
      setTimeout(
        () => {
          if (!connected) finish(failed(dataFailure('connection_failed')));
        },
        Math.max(0, Math.min(policy.connectTimeoutMs, policy.deadline - Date.now())),
      ),
    );
    request.on('socket', (socket) => {
      socket.once('secureConnect', () => {
        connected = true;
      });
    });
    request.on('error', () => {
      // Before an answer, nothing reached the source or signed in; after, the body was cut short.
      finish(
        failed(
          dataFailure(
            Date.now() >= policy.deadline
              ? 'timeout'
              : connected
                ? 'result_incomplete'
                : 'connection_failed',
          ),
        ),
      );
    });
    request.on('response', (response) => {
      const status = response.statusCode ?? 0;
      if ((status >= 300 && status < 400) || UNREACHED.has(status)) {
        finish(failed(dataFailure('connection_failed')));
        return;
      }
      if (status < 200 || status >= 300) {
        finish(failed(dataFailure('source_refused', { status })));
        return;
      }
      // A HEAD's answer states the length of a body it does not send: it has none to check.
      if (asked.method === 'HEAD') {
        response.resume();
        response.on('end', () =>
          finish({ ok: true, status, headers: response.headers, body: Buffer.alloc(0) }),
        );
        response.on('error', () => finish(failed(dataFailure('result_incomplete'))));
        return;
      }
      const lengthHeader = response.headers['content-length'];
      const declared =
        lengthHeader !== undefined && /^[0-9]{1,15}$/.test(lengthHeader)
          ? Number(lengthHeader)
          : undefined;
      if (lengthHeader !== undefined && declared === undefined) {
        finish(failed(dataFailure('result_incomplete')));
        return;
      }
      if (declared !== undefined && declared > policy.maxBytes) {
        finish(failed(dataFailure('byte_limit')));
        return;
      }
      const digestHeader = response.headers['content-digest'];
      const stated = statedDigests(
        Array.isArray(digestHeader) ? digestHeader.join(',') : digestHeader,
      );
      const decoder = decoderFor(response.headers['content-encoding']);
      if (stated === undefined || decoder === undefined) {
        finish(failed(dataFailure('result_incomplete')));
        return;
      }
      const hashes = new Map<string, Hash>(
        [...stated.keys()].map((algorithm) => [algorithm, createHash(algorithm)]),
      );
      let chunks: Buffer[] = [];
      let raw = 0;
      let decoded = 0;
      let rawEnded = false;
      // A body whose length is stated, and not encoded, is kept in one buffer of that length as it
      // arrives, never in chunks and a copy of them, so it is held once.
      const whole =
        decoder === null && declared !== undefined ? Buffer.allocUnsafe(declared) : null;
      const keep = (chunk: Buffer) => {
        decoded += chunk.length;
        if (decoded > policy.maxBytes) {
          finish(failed(dataFailure('byte_limit')));
          decoder?.destroy();
          return;
        }
        if (whole !== null && decoded <= whole.length) chunk.copy(whole, decoded - chunk.length);
        else chunks.push(chunk);
      };
      const done = () => {
        const body = whole ?? Buffer.concat(chunks, decoded);
        chunks = [];
        finish({ ok: true, status, headers: response.headers, body });
      };
      decoder?.on('data', keep);
      decoder?.on('error', () => finish(failed(dataFailure('result_incomplete'))));
      decoder?.on('end', () => {
        if (rawEnded) done();
      });
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        raw += chunk.length;
        if (raw > policy.maxBytes) {
          finish(failed(dataFailure('byte_limit')));
          return;
        }
        for (const hash of hashes.values()) hash.update(chunk);
        policy.observe?.(chunk);
        if (decoder) decoder.write(chunk);
        else keep(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        rawEnded = true;
        if (declared !== undefined && raw !== declared) {
          finish(failed(dataFailure('result_incomplete')));
          return;
        }
        for (const [algorithm, hash] of hashes) {
          const expected = stated.get(algorithm)!;
          const actual = hash.digest();
          if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
            finish(failed(dataFailure('result_incomplete')));
            return;
          }
        }
        if (decoder) decoder.end();
        else done();
      });
      // A body cut short: the socket closed before the response ended.
      response.on('error', () => finish(failed(dataFailure('result_incomplete'))));
      response.on('close', () => {
        if (!rawEnded) finish(failed(dataFailure('result_incomplete')));
      });
    });
    request.end(asked.body);
  });
}

/** A base URL's parts: its host as stored, its port, and its path, empty or segments. */
export function baseUrlParts(baseUrl: string): {
  readonly host: string;
  readonly port: number;
  readonly path: string;
} {
  const match = /^https:\/\/(\[[^\]]+\]|[^/:]+)(?::([0-9]+))?(.*)$/.exec(baseUrl)!;
  const host = match[1]!.startsWith('[') ? match[1]!.slice(1, -1) : match[1]!;
  return { host, port: match[2] === undefined ? 443 : Number(match[2]), path: match[3] ?? '' };
}
