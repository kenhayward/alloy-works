// Opens a sealed connection credential and runs a query, for both placements. The secret is opened
// (openSecret) only here, inside the process that dials the source, and is never returned, logged or
// put in an error by this module. Case 2 checks whether the DRIVERS keep that promise.
import pg from 'pg';
import tedious from 'tedious';
import { openSecret } from './seal.mjs';
import { guardHost } from './guard.mjs';

const { Client } = pg;
const { Connection, Request, TYPES } = tedious;

// A sink that records every byte a query attempt causes to be written, for the secret search.
export function makeSink() {
  const written = [];
  const record = (channel, value) => written.push({ channel, text: typeof value === 'string' ? value : safeStringify(value) });
  return { written, record };
}

function safeStringify(v) {
  try { return JSON.stringify(v, Object.getOwnPropertyNames(v ?? {})); } catch { return String(v); }
}

// Redact nothing here on purpose: we WANT to see what the driver produced, then search it.
function errorFacets(err) {
  return {
    message: err?.message ?? String(err),
    code: err?.code ?? null,
    stack: err?.stack ?? null,
    // Some drivers hang extra fields on the error; capture all own props.
    all: safeStringify(err),
  };
}

// Postgres via pg. Returns { ok, rows } or throws (caller records the error via errorFacets).
async function pgQuery(spec, secret, sql, params, timeoutMs) {
  // spec.connectionString embeds the secret in a URL - the classic leak vector the brief names.
  const cfg = spec.connectionString
    ? { connectionString: spec.connectionString.replace('__SECRET__', encodeURIComponent(secret)),
        connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, statement_timeout: timeoutMs }
    : { host: spec.host, port: spec.port, database: spec.database, user: spec.user,
        password: secret, ssl: spec.ssl ?? false,
        connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, statement_timeout: timeoutMs };
  const client = new Client(cfg);
  try {
    await client.connect();
    const res = await client.query(sql ?? 'select 1 as one', params ?? []);
    return { ok: true, rows: res.rows, fields: res.fields?.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })) };
  } finally {
    try { await client.end(); } catch {}
  }
}

// SQL Server via tedious.
function mssqlQuery(spec, secret, sql, timeoutMs) {
  return new Promise((resolve, reject) => {
    const conn = new Connection({
      server: spec.host,
      authentication: { type: 'default', options: { userName: spec.user, password: secret } },
      options: {
        port: spec.port, database: spec.database, encrypt: spec.encrypt ?? true,
        trustServerCertificate: spec.trustServerCertificate ?? true,
        connectTimeout: timeoutMs, requestTimeout: timeoutMs, rowCollectionOnRequestCompletion: true,
      },
    });
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; try { conn.close(); } catch {} fn(arg); };
    conn.on('connect', (err) => {
      if (err) return finish(reject, err);
      const rows = [];
      const req = new Request(sql ?? 'select 1 as one', (rErr, _count, rowset) => {
        if (rErr) return finish(reject, rErr);
        for (const r of rowset ?? []) rows.push(Object.fromEntries(r.map((c) => [c.metadata.colName, c.value])));
        finish(resolve, { ok: true, rows });
      });
      conn.execSql(req);
    });
    conn.on('error', (err) => finish(reject, err));
    conn.connect();
  });
}

// HTTP JSON source behind a bearer token (the token is the "secret").
async function httpQuery(spec, secret, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // spec.tokenInQuery puts the secret in the URL query string - a leak vector for HTTP sources.
    const url = spec.tokenInQuery ? `${spec.url}?token=${encodeURIComponent(secret)}` : spec.url;
    const res = await fetch(url, {
      headers: spec.tokenInQuery ? {} : { authorization: `Bearer ${secret}` },
      redirect: spec.followRedirects ? 'follow' : 'manual',
      signal: ctrl.signal,
    });
    const body = await res.text();
    let json = null; try { json = JSON.parse(body); } catch {}
    return { ok: res.ok, status: res.status, finalUrl: res.url, body: body.slice(0, 200), rows: json?.rows ?? json ?? null };
  } finally {
    clearTimeout(t);
  }
}

// DAT-006 connection test: returns { ok, reason } and NEVER an internal address. The guard runs
// first, then a dial. The reason is a fixed phrase; the true cause goes to the sink only.
export async function connectionTest(spec, { sink, guard = true } = {}) {
  const s = sink ?? makeSink();
  if (guard && spec.host) {
    const g = await guardHost(spec.host, { allowDeclaredPrivate: true });
    if (!g.allowed) {
      s.record('guard', { class: g.class, internalDetail: g.internalDetail });
      return { ok: false, reason: g.reason };
    }
  }
  try {
    await runQuery(spec, { sql: spec.testSql, timeoutMs: spec.timeoutMs ?? 2500, sink: s });
    return { ok: true, reason: 'The connection succeeded.' };
  } catch (err) {
    s.record('conn-test-error', errorFacets(err));
    // A single, uniform reason: refused, filtered, unknown host and TLS failure all read the same.
    return { ok: false, reason: 'The connection could not be established.' };
  }
}

// Run a query, opening the sealed secret here. On failure, records the raw driver error to the sink
// and rethrows a scrubbed error.
export async function runQuery(spec, { sql, params, timeoutMs = 5000, sink } = {}) {
  const s = sink ?? makeSink();
  let secret;
  try {
    secret = openSecret(Buffer.from(spec.sealingKey, 'base64'), 'connection', spec.tenantId, spec.sealedSecret);
  } catch (err) {
    s.record('open-secret', errorFacets(err));
    throw new Error('The connection credential could not be opened.');
  }
  try {
    if (spec.kind === 'postgres') return await pgQuery(spec, secret, sql, params, timeoutMs);
    if (spec.kind === 'sqlserver') return await mssqlQuery(spec, secret, sql, timeoutMs);
    if (spec.kind === 'http') return await httpQuery(spec, secret, timeoutMs);
    throw new Error(`Unknown source kind: ${spec.kind}`);
  } catch (err) {
    s.record('query-error', errorFacets(err));
    // Scrub: the caller sees a named failure with no secret and no internal address.
    const scrubbed = new Error(`The query failed (${spec.kind}).`);
    throw scrubbed;
  } finally {
    secret = null; // drop the plaintext reference
  }
}

export { errorFacets };
