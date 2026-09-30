// Phase 3, case 7: DAT-050's limits - rows, bytes, time - applied as a result arrives, each ending as
// a named failure (DAT-051) and never as a shorter result (DAT-045).
import { Readable, Transform } from 'node:stream';
import { parse as csvParse } from 'csv-parse';
import { createRequire } from 'node:module';
import { NamedFailure } from './types.mjs';
const require = createRequire(import.meta.url);
const Cursor = require('pg-cursor');

export const failure = (code, message) => new NamedFailure(code, message);

// ---------------------------------------------------------------- HTTP
// Reads a body, counting the bytes as they arrive (after any content coding is undone), stopping at
// the byte limit, and bounding the whole exchange - headers and body - by one deadline.
export async function httpBounded(url, { maxBytes, timeoutMs, trustLength = true }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new NamedFailure('timeout', `The source did not finish within ${timeoutMs} ms.`)), timeoutMs);
  let bytes = 0;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const declared = Number(res.headers.get('content-length'));
    const encoded = !!res.headers.get('content-encoding');
    if (trustLength && !encoded && Number.isFinite(declared) && declared > maxBytes) {
      ctrl.abort();
      throw failure('size_limit', `The source declared ${declared} bytes; the limit is ${maxBytes}.`);
    }
    const chunks = [];
    for await (const c of res.body) {
      bytes += c.length;
      if (bytes > maxBytes) { ctrl.abort(); throw failure('size_limit', `The source sent more than ${maxBytes} bytes.`); }
      chunks.push(c);
    }
    if (!encoded && Number.isFinite(declared) && res.headers.get('content-length') !== null && bytes !== declared)
      throw failure('truncated', `The source declared ${declared} bytes and sent ${bytes}.`);
    return { bytes, body: Buffer.concat(chunks) };
  } catch (e) {
    if (e instanceof NamedFailure) throw e;
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof NamedFailure) throw ctrl.signal.reason;
    throw failure('source_failed', `The source's response failed: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
  } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------- CSV
// A stream of bytes (an object in the store) through a byte counter and csv-parse, whose own record
// limit stops one enormous line before it is buffered past the limit.
export async function csvBounded(gen, { maxBytes, maxRows, maxRecordBytes = maxBytes }) {
  let bytes = 0; let rows = 0;
  const counter = new Transform({ transform(chunk, _e, cb) {
    bytes += chunk.length;
    if (bytes > maxBytes) return cb(failure('size_limit', `The file is larger than ${maxBytes} bytes.`));
    cb(null, chunk);
  } });
  const parser = csvParse({ max_record_size: maxRecordBytes, from_line: 2 });
  const src = Readable.from(gen);
  src.pipe(counter).pipe(parser);
  counter.on('error', (e) => parser.destroy(e));
  try {
    for await (const _rec of parser) {
      rows++;
      if (rows > maxRows) { src.destroy(); throw failure('row_limit', `The file has more than ${maxRows} rows.`); }
    }
  } catch (e) {
    src.destroy();
    if (e instanceof NamedFailure) throw e;
    if (e.code === 'CSV_MAX_RECORD_SIZE') throw failure('size_limit', `A record is longer than ${maxRecordBytes} bytes.`);
    throw e;
  }
  return { rows, bytes };
}

// ---------------------------------------------------------------- PostgreSQL
// A cursor: the limit plus one row, then close. Nothing about the query's text is rewritten.
export async function pgRowLimit(client, sql, limit) {
  const cur = client.query(new Cursor(sql));
  const rows = await cur.read(limit + 1);
  await cur.close();
  if (rows.length > limit) throw Object.assign(failure('row_limit', `The query returned more than ${limit} rows.`), { fetched: rows.length });
  return rows;
}
export async function pgByteLimit(client, sql, maxBytes, batch = 500) {
  const cur = client.query(new Cursor(sql)); let bytes = 0; let rows = 0;
  try {
    for (;;) {
      const got = await cur.read(batch);
      if (!got.length) return { rows, bytes };
      for (const r of got) {
        rows++; bytes += Buffer.byteLength(JSON.stringify(Object.values(r)));
        if (bytes > maxBytes) throw Object.assign(failure('size_limit', `The result is larger than ${maxBytes} bytes.`), { rows, bytes });
      }
    }
  } finally { await cur.close().catch(() => {}); }
}

// ---------------------------------------------------------------- SQL Server
// Rows arrive as a stream; past the limit the request is cancelled (a TDS attention).
export function msBounded(conn, Request, sql, { maxRows = Infinity, maxBytes = Infinity }) {
  return new Promise((resolve, reject) => {
    let rows = 0; let bytes = 0; let fail = null; let afterCancel = 0;
    const req = new Request(sql, (err) => {
      if (fail) return reject(Object.assign(fail, { rows, bytes, rowsAfterCancel: afterCancel, driver: err?.message }));
      if (err) return reject(err);
      resolve({ rows, bytes });
    });
    req.on('row', (cols) => {
      if (fail) { afterCancel++; return; }
      rows++; bytes += Buffer.byteLength(JSON.stringify(cols.map((c) => c.value)));
      if (rows > maxRows) fail = failure('row_limit', `The query returned more than ${maxRows} rows.`);
      else if (bytes > maxBytes) fail = failure('size_limit', `The result is larger than ${maxBytes} bytes.`);
      if (fail) { fail.at = Date.now(); conn.cancel(); }
    });
    conn.execSql(req);
  });
}
