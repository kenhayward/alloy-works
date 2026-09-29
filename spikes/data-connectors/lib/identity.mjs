// Phase 2 (cases 3 and 4): running a query AS THE END USER, in the connector. Three mechanisms:
//  - asserted identity: the connection's own account tells the source who the user is -
//    Postgres `SET ROLE` / `SET LOCAL ROLE` / a setting a policy reads; SQL Server `SESSION_CONTEXT`
//    read by a security policy, or `EXECUTE AS USER` (plain, WITH COOKIE, WITH NO REVERT);
//  - a delegated token: the user's token from the tenant's provider exchanged (RFC 8693) for one the
//    source trusts, audience-restricted to it;
//  - a stored per-user credential: recorded, not built (the brief's rule).
//
// Pools are the thing that can leak an identity from one execution into the next, so each mechanism
// runs under a chosen pool discipline:
//  - 'none'        a fresh connection, closed after (nothing to leak into);
//  - 'naive'       a pool of one connection, returned as it is (pg.Pool's default, and a kept tedious
//                  connection with no reset);
//  - 'reset-role'  Postgres: RESET ROLE on release;
//  - 'discard'     Postgres: DISCARD ALL on release;
//  - 'reset'       SQL Server: tedious's reset (sp_reset_connection) before each reuse;
//  - 'mssql-pkg'   SQL Server through the `mssql` package's own pool (max 1), as it comes.
// A pool of ONE makes reuse certain, so a leak cannot hide behind the pool picking another connection.
import pg from 'pg';
import tedious from 'tedious';
import mssql from 'mssql';
import { createHash, randomUUID } from 'node:crypto';
import { openSecret } from './seal.mjs';

const { Client, Pool } = pg;
const { Connection, Request, TYPES } = tedious;

const pgPools = new Map();
const msConns = new Map();
const msPkgPools = new Map();
const inflight = new Map(); // execId -> { cancel, kind, startedAt }
const exchanged = new Map(); // key(tenant, connection, subject hash) -> { token, exp }
export const counters = { exchanges: 0, exchangeCacheHits: 0 };

const USER_RE = /^[a-z][a-z0-9_]{0,62}$/; // an asserted principal is an identifier, never text

export class NamedFailure extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function open(spec) {
  try {
    return openSecret(Buffer.from(spec.sealingKey, 'base64'), 'connection', spec.tenantId, spec.sealedSecret);
  } catch {
    throw new NamedFailure('credential_unopened', 'The connection credential could not be opened.');
  }
}

// ---------- PostgreSQL ----------
const PG_WHOAMI = "select current_user::text as current_user, session_user::text as session_user, current_setting('app.user', true) as app_user";

function pgCfg(spec, secret, timeoutMs) {
  return { host: spec.host, port: spec.port, database: spec.database, user: spec.user, password: secret,
    connectionTimeoutMillis: timeoutMs, statement_timeout: timeoutMs, query_timeout: timeoutMs + 1000 };
}

async function pgRun(o, secret) {
  const cfg = pgCfg(o.spec, secret, o.timeoutMs);
  let client; let release;
  if (o.pool === 'none') {
    client = new Client(cfg); await client.connect();
    release = async () => { await client.end().catch(() => {}); };
  } else {
    if (!pgPools.has(o.poolKey)) pgPools.set(o.poolKey, new Pool({ ...cfg, max: 1, idleTimeoutMillis: 600000 }));
    client = await pgPools.get(o.poolKey).connect();
    release = async (broken) => {
      try {
        if (!broken && o.pool === 'reset-role') await client.query('RESET ROLE');
        if (!broken && o.pool === 'discard') await client.query('DISCARD ALL');
      } catch { broken = true; }
      client.release(broken ? true : undefined);
    };
  }
  const pid = (await client.query('select pg_backend_pid() as pid')).rows[0].pid;
  const entry = { kind: 'postgres', startedAt: Date.now(), cancel: () => pgCancel(cfg, pid) };
  inflight.set(o.execId, entry);
  let local = false; let broken = false;
  try {
    const before = (await client.query(PG_WHOAMI)).rows[0];
    const ident = o.user ? client.escapeIdentifier(o.user) : null;
    switch (o.mechanism) {
      case 'pg-set-role': await client.query(`SET ROLE ${ident}`); break;
      case 'pg-set-local-role':
        await client.query(o.readOnly ? 'BEGIN READ ONLY' : 'BEGIN'); local = true;
        await client.query(`SET LOCAL ROLE ${ident}`); break;
      case 'pg-guc': await client.query("select set_config('app.user', $1, false)", [o.user]); break;
      case 'pg-guc-local':
        await client.query(o.readOnly ? 'BEGIN READ ONLY' : 'BEGIN'); local = true;
        await client.query("select set_config('app.user', $1, true)", [o.user]); break;
      case 'as-is': break; // run with whatever the connection already carries
      default: throw new NamedFailure('mechanism_unknown', `No such mechanism: ${o.mechanism}`);
    }
    // The query definition's text, as authored. With params it goes by the extended protocol (one
    // statement); without, by the simple protocol, which accepts several.
    const res = await client.query(o.sql, o.params?.length ? o.params : undefined);
    const last = Array.isArray(res) ? res.filter((r) => r.rows).at(-1) : res;
    const identity = (await client.query(PG_WHOAMI)).rows[0];
    if (local) { await client.query('COMMIT'); local = false; }
    const afterCommit = (await client.query(PG_WHOAMI)).rows[0];
    return { rows: last?.rows ?? [], identity, before, afterCommit, pid };
  } catch (err) {
    if (local) { try { await client.query('ROLLBACK'); } catch { broken = true; } }
    if (err instanceof NamedFailure) throw err;
    throw new NamedFailure(err.code === '57014' ? 'query_cancelled' : 'query_failed', `The query failed (postgres): ${err.code ?? ''} ${err.message}`);
  } finally {
    inflight.delete(o.execId);
    await release(broken);
  }
}

async function pgCancel(cfg, pid) {
  const c = new Client(cfg);
  await c.connect();
  try { return (await c.query('select pg_cancel_backend($1) as ok', [pid])).rows[0].ok; } finally { await c.end(); }
}

// ---------- SQL Server (tedious) ----------
const MS_WHOAMI = "SELECT USER_NAME() AS db_user, SUSER_SNAME() AS login, ORIGINAL_LOGIN() AS original_login, CAST(SESSION_CONTEXT(N'app_user') AS NVARCHAR(50)) AS app_user";

function msConnect(spec, secret, timeoutMs) {
  return new Promise((resolve, reject) => {
    const conn = new Connection({
      server: spec.host,
      authentication: { type: 'default', options: { userName: spec.user, password: secret } },
      options: { port: spec.port, database: spec.database, encrypt: true, trustServerCertificate: true,
        connectTimeout: timeoutMs, requestTimeout: timeoutMs },
    });
    conn.once('connect', (err) => (err ? reject(err) : resolve(conn)));
    conn.on('error', () => {});
    conn.connect();
  });
}

function msExec(conn, sql, { params = [], batch = false } = {}) {
  return new Promise((resolve, reject) => {
    const sets = []; let cur = null;
    const req = new Request(sql, (err) => (err ? reject(err) : resolve(sets)));
    req.on('columnMetadata', () => { cur = []; sets.push(cur); });
    req.on('row', (cols) => { if (!cur) { cur = []; sets.push(cur); } cur.push(Object.fromEntries(cols.map((c) => [c.metadata.colName, Buffer.isBuffer(c.value) ? c.value.toString('hex') : c.value]))); });
    for (const p of params) req.addParameter(p.name, TYPES[p.type], p.value);
    if (batch) conn.execSqlBatch(req); else conn.execSql(req);
  });
}

const msReset = (conn) => new Promise((resolve, reject) => conn.reset((err) => (err ? reject(err) : resolve())));

async function msRun(o, secret) {
  let conn; let closeAfter = false;
  if (o.pool === 'none') { conn = await msConnect(o.spec, secret, o.timeoutMs); closeAfter = true; }
  else {
    conn = msConns.get(o.poolKey);
    if (!conn || conn.closed) { conn = await msConnect(o.spec, secret, o.timeoutMs); msConns.set(o.poolKey, conn); }
    else if (o.pool === 'reset') await msReset(conn);
  }
  inflight.set(o.execId, { kind: 'sqlserver', startedAt: Date.now(), cancel: async () => conn.cancel() });
  let cookie = null;
  try {
    const before = (await msExec(conn, MS_WHOAMI, { batch: true }))[0]?.[0];
    if (o.user && !USER_RE.test(o.user)) throw new NamedFailure('identity_invalid', 'The asserted identity is not an identifier.');
    switch (o.mechanism) {
      case 'ms-session-context':
        await msExec(conn, "EXEC sp_set_session_context @key = N'app_user', @value = @u, @read_only = @ro",
          { params: [{ name: 'u', type: 'NVarChar', value: o.user }, { name: 'ro', type: 'Bit', value: !!o.readOnlyContext }] });
        break;
      case 'ms-execute-as': await msExec(conn, `EXECUTE AS USER = N'${o.user}'`, { batch: true }); break;
      case 'ms-execute-as-cookie': {
        const sets = await msExec(conn, `DECLARE @c VARBINARY(8000); EXECUTE AS USER = N'${o.user}' WITH COOKIE INTO @c; SELECT @c AS cookie;`, { batch: true });
        cookie = sets[0]?.[0]?.cookie ?? null; break;
      }
      case 'ms-execute-as-norevert': await msExec(conn, `EXECUTE AS USER = N'${o.user}' WITH NO REVERT`, { batch: true }); break;
      case 'as-is': break;
      default: throw new NamedFailure('mechanism_unknown', `No such mechanism: ${o.mechanism}`);
    }
    // Query text as authored: as a batch (execSqlBatch), or through sp_executesql (execSql), which is
    // how a parameterised query reaches SQL Server and which opens a scope of its own.
    const sets = await msExec(conn, o.sql, { batch: o.via === 'batch', params: (o.params || []).map((v, i) => ({ name: `p${i + 1}`, type: 'NVarChar', value: String(v) })) });
    const identity = (await msExec(conn, MS_WHOAMI, { batch: true }))[0]?.[0];
    let revert = null;
    if (cookie) {
      try { await msExec(conn, `DECLARE @c VARBINARY(8000) = 0x${cookie}; REVERT WITH COOKIE = @c;`, { batch: true }); revert = 'reverted'; }
      catch (e) { revert = `revert failed: ${e.message}`; }
    }
    const after = (await msExec(conn, MS_WHOAMI, { batch: true }))[0]?.[0];
    const rows = sets.filter((s) => s.length && !('cookie' in s[0])).at(-1) ?? [];
    return { rows, identity, before, after, revert, resultSets: sets.length };
  } catch (err) {
    if (err instanceof NamedFailure) throw err;
    throw new NamedFailure('query_failed', `The query failed (sqlserver): ${err.number ?? ''} ${err.message}`);
  } finally {
    inflight.delete(o.execId);
    if (closeAfter) conn.close();
  }
}

// SQL Server through the `mssql` package's own pool, as it comes: does it reset a connection?
async function msPkgRun(o, secret) {
  if (!msPkgPools.has(o.poolKey)) {
    const pool = new mssql.ConnectionPool({ server: o.spec.host, port: o.spec.port, database: o.spec.database,
      user: o.spec.user, password: secret, pool: { max: 1, min: 0 },
      options: { encrypt: true, trustServerCertificate: true } });
    msPkgPools.set(o.poolKey, pool.connect());
  }
  const pool = await msPkgPools.get(o.poolKey);
  const before = (await pool.request().query(MS_WHOAMI)).recordset[0];
  if (o.mechanism === 'ms-session-context') {
    await pool.request().input('u', mssql.NVarChar, o.user).input('ro', mssql.Bit, !!o.readOnlyContext)
      .query("EXEC sp_set_session_context @key = N'app_user', @value = @u, @read_only = @ro");
  } else if (o.mechanism === 'ms-execute-as') {
    if (!USER_RE.test(o.user)) throw new NamedFailure('identity_invalid', 'bad identity');
    await pool.request().batch(`EXECUTE AS USER = N'${o.user}'`);
  } else if (o.mechanism !== 'as-is') throw new NamedFailure('mechanism_unknown', o.mechanism);
  const r = o.via === 'batch' ? await pool.request().batch(o.sql) : await pool.request().query(o.sql);
  const identity = (await pool.request().query(MS_WHOAMI)).recordset[0];
  return { rows: r.recordset ?? [], identity, before };
}

// ---------- HTTP, delegated token ----------
async function exchange(spec, clientSecret, subjectToken, useCache) {
  const key = createHash('sha256').update(`${spec.tenantId}|${spec.connectionId}|${subjectToken}`).digest('hex');
  const hit = exchanged.get(key);
  if (useCache && hit && hit.exp * 1000 > Date.now() + 2000) { counters.exchangeCacheHits++; return hit; }
  const res = await fetch(`${spec.exchangeUrl}/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${spec.clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken, subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', audience: spec.audience }),
  });
  const body = await res.json();
  counters.exchanges++;
  if (!res.ok) throw new NamedFailure('exchange_refused', `The source's authorisation server refused the user's token: ${body.error_description ?? body.error}`);
  const out = { token: body.access_token, exp: Math.floor(Date.now() / 1000) + body.expires_in };
  if (useCache) exchanged.set(key, out);
  return out;
}

async function httpRun(o, secret) {
  const ctrl = new AbortController();
  inflight.set(o.execId, { kind: 'http', startedAt: Date.now(), cancel: async () => ctrl.abort() });
  try {
    let bearer; let tokenExp = null;
    if (o.mechanism === 'http-delegated') {
      if (!o.subjectToken) throw new NamedFailure('identity_absent', 'No token for the end user was presented.');
      const ex = await exchange(o.spec, secret, o.subjectToken, o.cacheExchange !== false);
      bearer = ex.token; tokenExp = ex.exp;
    } else if (o.mechanism === 'http-raw-subject') {
      bearer = o.subjectToken; // the user's own provider token, presented straight to the source
    } else if (o.mechanism === 'http-service') bearer = secret;
    else throw new NamedFailure('mechanism_unknown', o.mechanism);
    const url = `${o.spec.url}records${o.delayMs ? `?delayMs=${o.delayMs}` : ''}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${bearer}` }, signal: ctrl.signal });
    const body = await res.json();
    if (!res.ok) throw new NamedFailure('source_refused', `The source refused the request: ${body.error_description ?? body.error}`);
    return { rows: body.rows, identity: { as: body.as, actor: body.actor ?? null, tokenExp } };
  } catch (err) {
    if (err instanceof NamedFailure) throw err;
    if (err.name === 'AbortError') throw new NamedFailure('query_cancelled', 'The request was cancelled.');
    throw new NamedFailure('query_failed', `The query failed (http): ${err.message}`);
  } finally {
    inflight.delete(o.execId);
  }
}

// ---------- entry points ----------
export async function runAsUser(input) {
  const o = { pool: 'none', poolKey: 'default', timeoutMs: 8000, execId: randomUUID(), ...input };
  const secret = open(o.spec);
  const t0 = performance.now();
  let out;
  if (o.spec.kind === 'postgres') out = await pgRun(o, secret);
  else if (o.spec.kind === 'sqlserver') out = o.pool === 'mssql-pkg' ? await msPkgRun(o, secret) : await msRun(o, secret);
  else if (o.spec.kind === 'http') out = await httpRun(o, secret);
  else throw new NamedFailure('kind_unknown', o.spec.kind);
  return { execId: o.execId, ms: +(performance.now() - t0).toFixed(2), ...out };
}

export async function cancel(execId) {
  const e = inflight.get(execId);
  if (!e) return { found: false };
  const r = await e.cancel();
  return { found: true, kind: e.kind, runningForMs: Date.now() - e.startedAt, result: r ?? null };
}

export function inflightIds() { return [...inflight.keys()]; }

export async function closePools() {
  for (const p of pgPools.values()) await p.end().catch(() => {});
  for (const c of msConns.values()) c.close();
  for (const p of msPkgPools.values()) (await p).close().catch(() => {});
  pgPools.clear(); msConns.clear(); msPkgPools.clear(); exchanged.clear();
  return { closed: true };
}
