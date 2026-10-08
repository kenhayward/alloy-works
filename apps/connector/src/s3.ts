import { createHash, createHmac, timingSafeEqual, type Hash, type Hmac } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { crc32 } from 'node:zlib';

import {
  bindObjectKey,
  bucketHost,
  dataFailure,
  fileFilter,
  ObjectKeyRefused,
  parseKeyPair,
  sortRows,
  type DataFailure,
  type DescribeSqlAnswer,
  type DescribeSqlRequest,
  type FileFetch,
  type ParameterValues,
  type RunAnswer,
  type RunRequest,
  type S3KeyPair,
  type S3Settings,
  type TestAnswer,
} from '@alloy-works/domain';
import { SignatureV4 } from '@smithy/signature-v4';

import { bodyLimit, proposeColumns, readRows } from './formats/rows.js';
import type { HttpPolicy } from './http-source.js';
import { exchange, type Exchanged } from './https.js';
import { finishResult } from './result.js';

/**
 * The S3 source (data.md; the D6 plan, D6-C, D6-K and D6-L): a `GET` or `HEAD` signed by SigV4 from
 * a static access key pair, path-style or virtual-hosted as the connection says, sent through the one
 * guarded client - so the endpoint's host, or a virtual-hosted bucket's, is guarded, resolved once and
 * pinned like any other, no redirect is followed and the deadline covers the whole exchange. An
 * object is checked against its `Content-Length` and any full-object checksum the store answers to
 * checksum mode; never its ETag, which SSE-KMS and multipart make no digest. What a run reports it
 * read is the bucket, the key and the object's version: never a URL or a signature.
 */

/** SHA-256 of nothing: the payload hash of every request the source sends, none having a body. */
const EMPTY_PAYLOAD = createHash('sha256').update('').digest('hex');

/** The signer's hash, by `node:crypto`: SHA-256, or its HMAC where a key is given. */
class Sha256 {
  private hash: Hash | Hmac;
  constructor(private readonly secret?: string | ArrayBuffer | ArrayBufferView) {
    this.hash = Sha256.make(secret);
  }
  private static make(secret?: string | ArrayBuffer | ArrayBufferView): Hash | Hmac {
    if (secret === undefined) return createHash('sha256');
    const key =
      typeof secret === 'string'
        ? secret
        : ArrayBuffer.isView(secret)
          ? Buffer.from(secret.buffer, secret.byteOffset, secret.byteLength)
          : Buffer.from(secret);
    return createHmac('sha256', key);
  }
  update(data: string | ArrayBuffer | ArrayBufferView): void {
    this.hash.update(
      typeof data === 'string'
        ? data
        : ArrayBuffer.isView(data)
          ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
          : Buffer.from(data),
    );
  }
  digest(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(this.hash.digest()));
  }
  reset(): void {
    this.hash = Sha256.make(this.secret);
  }
}

/** The CRC-32C table (Castagnoli, reflected 0x82F63B78). */
const CRC32C = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-64/NVME table (reflected 0x9A6C9329AC4BC9B5), each entry in two 32-bit halves. */
const CRC64 = (() => {
  const high = new Uint32Array(256);
  const low = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let hi = 0;
    let lo = n;
    for (let k = 0; k < 8; k += 1) {
      const carry = lo & 1;
      lo = ((lo >>> 1) | ((hi & 1) << 31)) >>> 0;
      hi = hi >>> 1;
      if (carry) {
        hi = (hi ^ 0x9a6c9329) >>> 0;
        lo = (lo ^ 0xac4bc9b5) >>> 0;
      }
    }
    high[n] = hi;
    low[n] = lo;
  }
  return { high, low };
})();

/** A running checksum S3 may state, fed the body as it arrives and read once at its end. */
interface Running {
  update(chunk: Buffer): void;
  digest(): Buffer;
}

/** CRC-32C over chunks. */
export function crc32c(): Running {
  let c = 0xffffffff;
  return {
    update(chunk) {
      for (const byte of chunk) c = CRC32C[(c ^ byte) & 0xff]! ^ (c >>> 8);
    },
    digest() {
      const out = Buffer.alloc(4);
      out.writeUInt32BE((c ^ 0xffffffff) >>> 0);
      return out;
    },
  };
}

/** CRC-64/NVME over chunks. */
export function crc64nvme(): Running {
  let hi = 0xffffffff;
  let lo = 0xffffffff;
  return {
    update(chunk) {
      for (const byte of chunk) {
        const at = (lo ^ byte) & 0xff;
        lo = (((lo >>> 8) | ((hi & 0xff) << 24)) ^ CRC64.low[at]!) >>> 0;
        hi = ((hi >>> 8) ^ CRC64.high[at]!) >>> 0;
      }
    },
    digest() {
      const out = Buffer.alloc(8);
      out.writeUInt32BE((hi ^ 0xffffffff) >>> 0, 0);
      out.writeUInt32BE((lo ^ 0xffffffff) >>> 0, 4);
      return out;
    },
  };
}

/** CRC-32 over chunks, by `node:zlib`. */
function crc32Running(): Running {
  let c = 0;
  return {
    update(chunk) {
      c = crc32(chunk, c);
    },
    digest() {
      const out = Buffer.alloc(4);
      out.writeUInt32BE(c >>> 0);
      return out;
    },
  };
}

/** A hash of `node:crypto`'s over chunks. */
function hashRunning(algorithm: 'sha1' | 'sha256'): Running {
  const hash = createHash(algorithm);
  return { update: (chunk) => hash.update(chunk), digest: () => hash.digest() };
}

/** The checksums an S3 store states of an object, by the header it states each in. */
const CHECKSUMS: Readonly<Record<string, () => Running>> = {
  'x-amz-checksum-crc32': crc32Running,
  'x-amz-checksum-crc32c': crc32c,
  'x-amz-checksum-crc64nvme': crc64nvme,
  'x-amz-checksum-sha1': () => hashRunning('sha1'),
  'x-amz-checksum-sha256': () => hashRunning('sha256'),
};

/**
 * Whether a body matches every full-object checksum its headers state (DAT-108, D6-K): a composite
 * checksum - a multipart object's checksum of its parts' checksums, marked `COMPOSITE` or with a
 * part count - states nothing of the whole that can be checked, so it is passed over, as an ETag
 * always is.
 */
export class ChecksumCheck {
  private readonly running = new Map<string, Running>(
    Object.entries(CHECKSUMS).map(([header, make]) => [header, make()]),
  );
  update(chunk: Buffer): void {
    for (const each of this.running.values()) each.update(chunk);
  }
  holds(headers: IncomingHttpHeaders): boolean {
    if (String(headers['x-amz-checksum-type'] ?? '').toUpperCase() === 'COMPOSITE') return true;
    for (const [header, running] of this.running) {
      const stated = headers[header];
      if (stated === undefined) continue;
      if (typeof stated !== 'string') return false;
      if (/-[0-9]+$/.test(stated)) continue;
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(stated)) return false;
      const expected = Buffer.from(stated, 'base64');
      const actual = running.digest();
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    }
    return true;
  }
}

/** A failure the S3 source answers with, inside it. */
class Refused extends Error {
  constructor(readonly failure: DataFailure) {
    super(failure.code);
  }
}

/** The connection's key pair, opened from its sealed text, or a connector error where it is not one. */
function keyPair(secret: string): S3KeyPair {
  const pair = parseKeyPair(secret);
  if (pair === undefined) throw new Refused(dataFailure('connector_error'));
  return pair;
}

/**
 * One signed request to the bucket: a `HEAD` of the bucket, or a `GET` of an object's encoded path.
 * Signed for the host it is sent to, with the payload's hash and, for a `GET`, checksum mode on, so a
 * store that keeps a checksum states it (D6-K). The signed headers are sent as signed, and the
 * secret never leaves this function but as the signature.
 */
async function signedExchange(
  settings: S3Settings,
  pair: S3KeyPair,
  method: 'GET' | 'HEAD',
  objectPath: string,
  policy: HttpPolicy,
  deadline: number,
  maxBytes: number,
  observe?: (chunk: Buffer) => void,
): Promise<Exchanged> {
  const { source } = settings;
  const { host, port, secure } = bucketHost(source);
  const usual = secure ? 443 : 80;
  const path = source.pathStyle ? `/${source.bucket}${objectPath}` : objectPath || '/';
  const named = host.includes(':') ? `[${host}]` : host;
  const signer = new SignatureV4({
    service: 's3',
    region: source.region,
    credentials: { accessKeyId: pair.accessKeyId, secretAccessKey: pair.secretAccessKey },
    sha256: Sha256,
    // S3 signs the path as it is sent, each segment already encoded once by the key's binder.
    uriEscapePath: false,
    applyChecksum: false,
  });
  const signed = await signer.sign({
    method,
    protocol: secure ? 'https:' : 'http:',
    hostname: host,
    ...(port === usual ? {} : { port }),
    path,
    query: {},
    headers: {
      host: port === usual ? named : `${named}:${port}`,
      'x-amz-content-sha256': EMPTY_PAYLOAD,
      ...(method === 'GET' ? { 'x-amz-checksum-mode': 'ENABLED' } : {}),
    },
  });
  return exchange(
    {
      host,
      port,
      secure,
      path,
      method,
      headers: Object.entries(signed.headers).map(([name, value]) => [name.toLowerCase(), value]),
    },
    {
      deny: policy.deny,
      ...(policy.lookup ? { lookup: policy.lookup } : {}),
      ...(policy.ca === undefined ? {} : { ca: policy.ca }),
      deadline,
      connectTimeoutMs: policy.connectTimeoutMs,
      maxBytes,
      ...(observe ? { observe } : {}),
    },
  );
}

/**
 * A test (data.md, "The connection test"): `HeadBucket` with the key pair. A refusal to sign in, a
 * redirect to another region and a guarded host are `connection_failed` alike (DAT-075); a bucket
 * that is not there is the source's refusal with its status.
 */
export async function testS3(
  settings: S3Settings,
  secret: string,
  policy: HttpPolicy,
  deadline: number,
): Promise<TestAnswer> {
  try {
    const exchanged = await signedExchange(
      settings,
      keyPair(secret),
      'HEAD',
      '',
      policy,
      deadline,
      0,
    );
    return exchanged.ok
      ? { outcome: 'ok', findings: [] }
      : { outcome: 'failed', failure: exchanged.failure };
  } catch (error) {
    if (error instanceof Refused) return { outcome: 'failed', failure: error.failure };
    throw error;
  }
}

/** An object read whole under the limits and checked against what its store states of it. */
async function readObject(
  settings: S3Settings,
  secret: string,
  key: FileFetch['key'],
  values: ParameterValues,
  policy: HttpPolicy,
  deadline: number,
  maxBytes: number,
): Promise<{ readonly body: Buffer; readonly key: string; readonly versionId?: string }> {
  let bound;
  try {
    bound = bindObjectKey(key, values);
  } catch (error) {
    // A value a key's segment cannot carry is the caller's, and nothing is sent.
    if (error instanceof ObjectKeyRefused) throw new Refused(dataFailure('parameter_invalid'));
    throw error;
  }
  const check = new ChecksumCheck();
  const exchanged = await signedExchange(
    settings,
    keyPair(secret),
    'GET',
    bound.path,
    policy,
    deadline,
    maxBytes,
    (chunk) => check.update(chunk),
  );
  if (!exchanged.ok) throw new Refused(exchanged.failure);
  if (!check.holds(exchanged.headers)) throw new Refused(dataFailure('result_incomplete'));
  const version = exchanged.headers['x-amz-version-id'];
  const versionId =
    typeof version === 'string' && version !== 'null' && /^[\x21-\x7e]{1,1024}$/.test(version)
      ? version
      : undefined;
  return {
    body: exchanged.body,
    key: bound.key,
    ...(versionId === undefined ? {} : { versionId }),
  };
}

/**
 * A run of a file (the D6 plan, task 2 and D6-J): the object read by its bound key, its rows read by
 * the format, kept by the typed filter as they are read, put in the declared order - a file has no
 * query to order them - and finished as every source's are.
 */
export async function runS3(
  request: RunRequest,
  secret: string,
  policy: HttpPolicy,
  deadline: number,
): Promise<RunAnswer> {
  const started = Date.now();
  const { definition, limits } = request;
  const fetch = definition.fetch as FileFetch;
  const values = request.values as ParameterValues;
  const settings = request.settings as S3Settings;
  try {
    const object = await readObject(
      settings,
      secret,
      fetch.key,
      values,
      policy,
      deadline,
      bodyLimit(fetch.format, limits.bytes),
    );
    const keep =
      fetch.where === undefined
        ? undefined
        : fileFilter(fetch.where, definition.columns, definition.parameters, values);
    let body: Buffer | undefined = object.body;
    const read = readRows(body, fetch.format, definition.columns, limits, keep);
    body = undefined;
    if ('failure' in read) return { outcome: 'failed', failure: read.failure };
    const finished = finishResult(
      sortRows(read.rows, definition),
      definition,
      limits,
      read.imageBytes,
    );
    if ('failure' in finished) return { outcome: 'failed', failure: finished.failure };
    return {
      outcome: 'ok',
      result: finished.result as Extract<RunAnswer, { outcome: 'ok' }>['result'],
      checksum: finished.checksum,
      rowCount: finished.rowCount,
      ran: {
        object: {
          bucket: settings.source.bucket,
          key: object.key,
          ...(object.versionId === undefined ? {} : { versionId: object.versionId }),
        },
      },
      durationMs: Date.now() - started,
      images: Object.fromEntries(
        [...read.images].map(([hash, bytes]) => [hash, bytes.toString('base64')]),
      ),
    };
  } catch (error) {
    if (error instanceof Refused) return { outcome: 'failed', failure: error.failure };
    throw error;
  }
}

/** A sample of an object for its columns (DAT-105): read by its key, its first rows proposed. */
export async function describeS3(
  request: Extract<DescribeSqlRequest, { file: unknown }>,
  secret: string,
  policy: HttpPolicy,
  deadline: number,
  maxBytes: number,
): Promise<DescribeSqlAnswer> {
  try {
    const object = await readObject(
      request.settings as S3Settings,
      secret,
      request.file.key,
      request.file.values as ParameterValues,
      policy,
      deadline,
      bodyLimit(request.file.format, maxBytes),
    );
    return proposeColumns(object.body, request.file.format);
  } catch (error) {
    if (error instanceof Refused) return { failure: error.failure };
    throw error;
  }
}
