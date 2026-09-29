// Phase 2, case 4: the CALLER standing for the product's service (placement A for sign-in, sessions and
// the tenant's schema) and, in a background path that takes nothing from a request but a job id, for
// the worker (placement B). Every query still goes to the source through the CONNECTOR (placement C),
// over aw-dc-connector-rpc, because case 1 settled that.
//
// The tenant's schema lives in platform-pg as `tenant_acme`: sessions, the provider tokens a session
// would now have to hold (the new class of secret), publish jobs and the identity a job carries, pins
// with their provenance, and the result cache. Signing out deletes the session row, and the rows that
// hang off it go with it by foreign key.
import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sealSecret, openSecret } from './seal.mjs';

const PLATFORM = process.env.PLATFORM_PG_URL || 'postgres://postgres:platform-pg-fake-pw@172.31.10.11:5432/platform';
const IDP = process.env.IDP_URL || 'http://172.31.10.14';
const CONNECTOR = process.env.CONNECTOR_URL || 'http://172.31.30.31:8080';
const TENANT = 'tenant-acme';
const KEY = Buffer.from(process.env.TENANT_SEALING_KEY || 'dlBCBJkzSuecCoSn76qngagHLR5Qjg5YHBMawT+ReJ0=', 'base64');

const db = new pg.Pool({ connectionString: PLATFORM, max: 10 });
const connections = new Map(); // id -> { id, version, spec, mode, mechanism, pool }
const sessionExecs = new Map(); // sessionId -> Set(execId) of connector executions in flight
const seal = (purpose, v) => sealSecret(KEY, purpose, TENANT, v);
const unseal = (purpose, v) => openSecret(KEY, purpose, TENANT, v);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : JSON.stringify(v));
const jwtClaims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));

export async function setup() {
  await db.query(`
    create schema if not exists tenant_acme;
    create table if not exists tenant_acme.session (
      id text primary key, principal text not null, route text not null,
      created_at timestamptz not null default now(), expires_at timestamptz not null);
    create table if not exists tenant_acme.session_provider_token (
      session_id text not null references tenant_acme.session(id) on delete cascade,
      kind text not null check (kind in ('access','refresh')), sealed text not null, expires_at timestamptz,
      primary key (session_id, kind));
    create table if not exists tenant_acme.publish_job (
      id text primary key, principal text not null, session_id text, placement text not null,
      status text not null, total int not null, done int not null default 0, refreshes int not null default 0,
      failure text, created_at timestamptz not null default now(), finished_at timestamptz,
      last_binding_started_at timestamptz);
    create table if not exists tenant_acme.job_identity (
      job_id text primary key references tenant_acme.publish_job(id) on delete cascade,
      session_id text not null references tenant_acme.session(id) on delete cascade,
      sealed_subject text not null, expires_at timestamptz not null);
    create table if not exists tenant_acme.pin (
      id serial primary key, binding text not null, value jsonb not null, provenance jsonb not null,
      pinned_at timestamptz not null default now());
    create table if not exists tenant_acme.result_cache (
      key text primary key, connection_id text not null, qdv text not null, params_canonical text not null,
      execution_identity text not null,
      session_id text references tenant_acme.session(id) on delete cascade,
      result jsonb not null, checksum text not null,
      created_at timestamptz not null default now(), expires_at timestamptz not null);
  `);
  return { ok: true };
}

async function post(url, body, form = false) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body) : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// ---- sessions ----
export async function signin({ sub, scope = 'openid', issuer = 'tenant', keepProviderToken = true, sessionTtl = 3600 }) {
  const r = await post(`${IDP}/token`, { grant_type: 'urn:spike:signin', sub, scope, issuer }, true);
  if (r.status !== 200) return { error: r.json };
  // The service checks the ID token here in the product (ADR-0009); the spike trusts its own idp.
  const id = randomBytes(16).toString('hex');
  await db.query('insert into tenant_acme.session (id, principal, route, expires_at) values ($1,$2,$3, now() + make_interval(secs => $4))',
    [id, sub, issuer, sessionTtl]);
  let held = 0;
  if (keepProviderToken) {
    const at = r.json.access_token;
    await db.query('insert into tenant_acme.session_provider_token values ($1,$2,$3, to_timestamp($4))', [id, 'access', seal('provider-token', at), jwtClaims(at).exp]);
    held++;
    if (r.json.refresh_token) {
      await db.query('insert into tenant_acme.session_provider_token values ($1,$2,$3, now() + make_interval(secs => $4))',
        [id, 'refresh', seal('provider-token', r.json.refresh_token), r.json.refresh_expires_in]);
      held++;
    }
  }
  return { sessionId: id, principal: sub, route: issuer, providerTokensHeld: held,
    accessTokenBytes: r.json.access_token.length, refreshTokenBytes: r.json.refresh_token?.length ?? 0,
    accessExpiresIn: r.json.expires_in };
}

export async function signout({ sessionId, cancelInflight = true }) {
  const t0 = Date.now();
  const refresh = await db.query("select sealed from tenant_acme.session_provider_token where session_id=$1 and kind='refresh'", [sessionId]);
  const counts = await db.query(`select
      (select count(*) from tenant_acme.session_provider_token where session_id=$1)::int as provider_tokens,
      (select count(*) from tenant_acme.job_identity where session_id=$1)::int as job_identities,
      (select count(*) from tenant_acme.result_cache where session_id=$1)::int as cache_rows`, [sessionId]);
  const del = await db.query('delete from tenant_acme.session where id=$1', [sessionId]);
  let cancelled = [];
  if (cancelInflight) {
    for (const execId of sessionExecs.get(sessionId) ?? []) {
      cancelled.push((await post(`${CONNECTOR}/as-user/cancel`, { execId })).json);
    }
  }
  // Revoke the refresh token at the provider too (RFC 7009), so custody ends there and not only here.
  let revokedAtProvider = 0;
  if (refresh.rows[0]) revokedAtProvider = (await post(`${IDP}/revoke`, { token: unseal('provider-token', refresh.rows[0].sealed) }, true)).json.revoked;
  return { signedOutAt: t0, deleted: del.rowCount, removedWithIt: counts.rows[0], cancelled, revokedAtProvider, ms: Date.now() - t0 };
}

async function sessionAlive(id) {
  const r = await db.query('select principal, route from tenant_acme.session where id=$1 and expires_at > now()', [id]);
  return r.rows[0] ?? null;
}

async function providerAccessToken(sessionId) {
  const r = await db.query("select sealed, expires_at from tenant_acme.session_provider_token where session_id=$1 and kind='access'", [sessionId]);
  return r.rows[0] ? { token: unseal('provider-token', r.rows[0].sealed), exp: r.rows[0].expires_at } : null;
}

export function registerConnections(list) {
  for (const c of list) connections.set(c.id, c);
  return { registered: [...connections.keys()] };
}

// Build the identity the connection declares (DAT-008, DAT-022), from the SESSION - never the request.
async function identityFor(conn, session, sessionId, subjectOverride) {
  if (conn.mode === 'service') return { user: null, subjectToken: null, declared: 'service account' };
  if (conn.mechanism.startsWith('http')) {
    const t = subjectOverride ? { token: subjectOverride } : await providerAccessToken(sessionId);
    if (!t) throw Object.assign(new Error('The session holds no token from the provider to act as the user.'), { code: 'identity_absent' });
    return { user: null, subjectToken: t.token, declared: `end user ${session.principal} (delegated token)` };
  }
  return { user: session.principal, subjectToken: null, declared: `end user ${session.principal} (asserted)` };
}

async function viaConnector(conn, ident, qd, sessionId, extra = {}) {
  const execId = randomUUID();
  if (!sessionExecs.has(sessionId)) sessionExecs.set(sessionId, new Set());
  sessionExecs.get(sessionId).add(execId);
  try {
    return await post(`${CONNECTOR}/as-user/query`, {
      spec: conn.spec, mechanism: conn.mode === 'service' ? conn.serviceMechanism : conn.mechanism,
      user: ident.user, subjectToken: ident.subjectToken, sql: qd.sql, params: qd.params, via: qd.via,
      pool: conn.pool, poolKey: conn.id, readOnly: true, execId, delayMs: extra.delayMs, readOnlyContext: conn.readOnlyContext,
    });
  } finally { sessionExecs.get(sessionId)?.delete(execId); }
}

export async function query({ sessionId, connectionId, qd }) {
  const session = await sessionAlive(sessionId);
  if (!session) return { status: 401, json: { error: 'session_ended' } };
  const conn = connections.get(connectionId);
  const ident = await identityFor(conn, session, sessionId).catch((e) => ({ error: e }));
  if (ident.error) return { status: 422, json: { error: ident.error.code, message: ident.error.message } };
  const r = await viaConnector(conn, ident, qd, sessionId);
  return { status: r.status, json: { declared: ident.declared, ...r.json } };
}

// ---- publish: 400 inline + 40 block pass-through bindings ----
function bindings(n, inline, block, qd) {
  const out = [];
  for (let i = 0; i < n.inline; i++) out.push({ id: `inline-${i}`, qd: inline ?? qd });
  for (let i = 0; i < n.block; i++) out.push({ id: `block-${i}`, qd: block ?? qd });
  return out;
}

async function runPool(items, concurrency, fn) {
  let next = 0; let stop = null;
  const worker = async () => {
    while (!stop && next < items.length) {
      const it = items[next++];
      try { await fn(it); } catch (e) { stop = stop ?? e; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  if (stop) throw stop;
}

export async function publish(o) {
  const { sessionId, connectionId, placement, counts = { inline: 400, block: 40 }, qd, inlineQd, blockQd,
    concurrency = 8, delayMs = 0, checkEvery = 1 } = o;
  const session = await sessionAlive(sessionId);
  if (!session) return { status: 401, json: { error: 'session_ended' } };
  const conn = connections.get(connectionId);
  const items = bindings(counts, inlineQd, blockQd, qd);
  if (placement === 'pinned-only') {
    // Option (c): a pass-through binding cannot be live in a publish; it must be pinned first.
    if (conn.mode === 'end-user') return { status: 409, json: { error: 'pass_through_binding_live', message: `${items.length} bindings run as the end user and are not pinned; pin them before publishing.` } };
  }
  const ident = await identityFor(conn, session, sessionId).catch((e) => ({ error: e }));
  if (ident.error) return { status: 422, json: { error: ident.error.code, message: ident.error.message } };

  const jobId = randomUUID();
  await db.query('insert into tenant_acme.publish_job (id, principal, session_id, placement, status, total) values ($1,$2,$3,$4,$5,$6)',
    [jobId, session.principal, sessionId, placement, 'running', items.length]);

  if (placement === 'request') {
    // Option (a): resolved at the request, in the service, with the principal at hand. The session is
    // re-checked every `checkEvery` bindings, which is what makes a sign-out stop it.
    const t0 = performance.now();
    let done = 0;
    try {
      await runPool(items, concurrency, async (it) => {
        if (done % checkEvery === 0 && !(await sessionAlive(sessionId))) throw Object.assign(new Error('The publisher signed out.'), { code: 'session_ended' });
        await db.query('update tenant_acme.publish_job set last_binding_started_at = clock_timestamp() where id=$1', [jobId]);
        const r = await viaConnector(conn, ident, it.qd, sessionId, { delayMs });
        if (r.status !== 200) throw Object.assign(new Error(r.json.error?.message ?? r.json.error), { code: r.json.error?.code ?? 'query_failed' });
        done++;
      });
      await db.query("update tenant_acme.publish_job set status='done', done=$2, finished_at=clock_timestamp() where id=$1", [jobId, done]);
      return { status: 200, json: { jobId, placement, done, total: items.length, heldRequestMs: +(performance.now() - t0).toFixed(0) } };
    } catch (e) {
      await db.query("update tenant_acme.publish_job set status='failed', done=$2, failure=$3, finished_at=clock_timestamp() where id=$1", [jobId, done, `${e.code}: ${e.message}`]);
      return { status: 409, json: { jobId, placement, done, total: items.length, failure: `${e.code}: ${e.message}`, heldRequestMs: +(performance.now() - t0).toFixed(0) } };
    }
  }

  if (placement === 'worker') {
    // Option (b): carried to the worker. Asserted identity needs only the principal's name; a delegated
    // token needs the token itself, sealed into the tenant's schema beside the job.
    if (ident.subjectToken) {
      await db.query('insert into tenant_acme.job_identity values ($1,$2,$3, to_timestamp($4))',
        [jobId, sessionId, seal('job-identity', ident.subjectToken), jwtClaims(ident.subjectToken).exp]);
    }
    setImmediate(() => workerRun(jobId, { connectionId, items, concurrency, delayMs, refresh: !!o.refresh, refreshLock: o.refreshLock !== false }).catch(() => {}));
    return { status: 202, json: { jobId, placement } };
  }
  return { status: 400, json: { error: 'placement_unknown' } };
}

// The worker path: given a job id and nothing of the requester's, it reads the job and the identity
// the job carries from the tenant's schema, and checks the session before every binding.
async function workerRun(jobId, { connectionId, items, concurrency, delayMs, refresh, refreshLock }) {
  const job = (await db.query('select * from tenant_acme.publish_job where id=$1', [jobId])).rows[0];
  const conn = connections.get(connectionId);
  let done = 0; let refreshes = 0;
  const identity = async () => {
    const s = await sessionAlive(job.session_id);
    if (!s) throw Object.assign(new Error('The publisher signed out.'), { code: 'session_ended' });
    if (conn.mode !== 'end-user' || !conn.mechanism.startsWith('http')) return { user: s.principal, subjectToken: null };
    const row = (await db.query('select sealed_subject, expires_at from tenant_acme.job_identity where job_id=$1', [jobId])).rows[0];
    if (!row) throw Object.assign(new Error('The job carries no identity.'), { code: 'identity_absent' });
    let token = unseal('job-identity', row.sealed_subject);
    if (jwtClaims(token).exp * 1000 - Date.now() < 3000) {
      if (!refresh) return { user: null, subjectToken: token }; // let it fail by name at the exchange
      token = await refreshFor(job.session_id, refreshLock);
      refreshes++;
      await db.query('update tenant_acme.job_identity set sealed_subject=$2, expires_at=to_timestamp($3) where job_id=$1', [jobId, seal('job-identity', token), jwtClaims(token).exp]);
    }
    return { user: null, subjectToken: token };
  };
  try {
    await runPool(items, concurrency, async (it) => {
      const ident = await identity();
      await db.query('update tenant_acme.publish_job set last_binding_started_at = clock_timestamp() where id=$1', [jobId]);
      const r = await viaConnector(conn, ident, it.qd, job.session_id, { delayMs });
      if (r.status !== 200) throw Object.assign(new Error(r.json.error?.message ?? r.json.error), { code: r.json.error?.code ?? 'query_failed' });
      done++;
      if (done % 20 === 0) await db.query('update tenant_acme.publish_job set done=$2, refreshes=$3 where id=$1', [jobId, done, refreshes]);
    });
    await db.query("update tenant_acme.publish_job set status='done', done=$2, refreshes=$3, finished_at=clock_timestamp() where id=$1", [jobId, done, refreshes]);
  } catch (e) {
    await db.query("update tenant_acme.publish_job set status='failed', done=$2, refreshes=$3, failure=$4, finished_at=clock_timestamp() where id=$1", [jobId, done, refreshes, `${e.code}: ${e.message}`]);
  }
}

// Refresh the session's provider token. With the lock, concurrent jobs of one session serialise on the
// session's refresh row; without it, two jobs can present one refresh token twice.
async function refreshFor(sessionId, lock) {
  const c = await db.connect();
  try {
    await c.query('begin');
    const r = (await c.query(`select sealed from tenant_acme.session_provider_token where session_id=$1 and kind='refresh' ${lock ? 'for update' : ''}`, [sessionId])).rows[0];
    if (!r) throw Object.assign(new Error('The session holds no refresh token.'), { code: 'token_expired' });
    // Another job may have refreshed while this one waited: use its access token if it is fresh.
    const a = (await c.query("select sealed from tenant_acme.session_provider_token where session_id=$1 and kind='access'", [sessionId])).rows[0];
    if (lock && a) { const t = unseal('provider-token', a.sealed); if (jwtClaims(t).exp * 1000 - Date.now() > 3000) { await c.query('commit'); return t; } }
    const res = await post(`${IDP}/token`, { grant_type: 'refresh_token', refresh_token: unseal('provider-token', r.sealed) }, true);
    if (res.status !== 200) throw Object.assign(new Error(`The provider refused the refresh: ${res.json.error_description}`), { code: 'refresh_refused' });
    await c.query("update tenant_acme.session_provider_token set sealed=$2, expires_at=to_timestamp($3) where session_id=$1 and kind='access'", [sessionId, seal('provider-token', res.json.access_token), jwtClaims(res.json.access_token).exp]);
    await c.query("update tenant_acme.session_provider_token set sealed=$2 where session_id=$1 and kind='refresh'", [sessionId, seal('provider-token', res.json.refresh_token)]);
    await c.query('commit');
    return res.json.access_token;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}

export async function job(id) {
  return (await db.query(`select *, extract(epoch from finished_at)*1000 as finished_ms,
    extract(epoch from last_binding_started_at)*1000 as last_started_ms from tenant_acme.publish_job where id=$1`, [id])).rows[0] ?? null;
}

// Use a job's sealed identity directly, WITHOUT the session check - what a worker that forgot to check
// could still do after the publisher signed out, if the row were still there.
export async function rawJobToken(jobId) {
  const r = (await db.query('select sealed_subject from tenant_acme.job_identity where job_id=$1', [jobId])).rows[0];
  return r ? unseal('job-identity', r.sealed_subject) : null;
}

// ---- pins (DAT-024, DAT-035, DAT-040) ----
export async function pin({ sessionId, connectionId, qd, binding }) {
  const session = await sessionAlive(sessionId);
  const conn = connections.get(connectionId);
  const ident = await identityFor(conn, session, sessionId);
  const r = await viaConnector(conn, ident, qd, sessionId);
  if (r.status !== 200) return r;
  const rows = r.json.rows;
  const provenance = {
    connection: { id: conn.id, version: conn.version, declares: conn.mode === 'end-user' ? 'end user' : 'service account' },
    queryDefinition: { id: qd.id, version: qd.version }, params: canon(qd.params ?? []),
    executionIdentity: { mode: conn.mode, mechanism: conn.mechanism, principal: session.principal, route: session.route,
      asTheSourceSawIt: r.json.identity?.current_user ?? r.json.identity?.app_user ?? r.json.identity?.db_user ?? r.json.identity?.as ?? null },
    at: new Date().toISOString(), rowCount: rows.length, checksum: sha(canon(rows)),
  };
  const ins = await db.query('insert into tenant_acme.pin (binding, value, provenance) values ($1,$2,$3) returning id', [binding, JSON.stringify(rows), provenance]);
  return { status: 200, json: { pinId: ins.rows[0].id, rows, provenance } };
}

export async function readPin({ sessionId, pinId }) {
  const session = await sessionAlive(sessionId);
  if (!session) return { status: 401, json: { error: 'session_ended' } };
  const p = (await db.query('select * from tenant_acme.pin where id=$1', [pinId])).rows[0];
  const ei = p.provenance.executionIdentity;
  const whose = ei.mode === 'end-user' ? `Resolved as ${ei.principal === 'ada' ? 'Ada' : ei.principal === 'grace' ? 'Grace' : ei.principal}, through ${ei.mechanism}` : 'Resolved as the connection\'s service account';
  return { status: 200, json: { reader: session.principal, value: p.value, provenance: p.provenance, shown: whose, readerIsProducer: ei.principal === session.principal } };
}

// ---- the result cache (DAT-026, DAT-052, IAM-075) ----
export async function cachedQuery({ sessionId, connectionId, qd, ttlSec = 300, keyMode = 'full', tieToSession = true }) {
  const session = await sessionAlive(sessionId);
  if (!session) return { status: 401, json: { error: 'session_ended' } };
  const conn = connections.get(connectionId);
  const ident = await identityFor(conn, session, sessionId);
  // The execution identity AS THE SOURCE SEES IT. Asserted: the principal we assert. Delegated: the
  // subject the exchanged token will carry - the provider's `sub`, read from the user's token.
  const execIdentity = conn.mode === 'service' ? `service:${conn.id}`
    : ident.subjectToken ? `delegated:${jwtClaims(ident.subjectToken).iss}|${jwtClaims(ident.subjectToken).sub}` : `asserted:${ident.user}`;
  const keyParts = { tenant: TENANT, connection: `${conn.id}@${conn.version}`, qdv: `${qd.id}@${qd.version}`, params: canon(qd.params ?? []),
    ...(keyMode === 'full' ? { identity: execIdentity } : {}) };
  const key = sha(canon(keyParts));
  const hit = (await db.query('select result, execution_identity, created_at, expires_at from tenant_acme.result_cache where key=$1 and expires_at > now()', [key])).rows[0];
  if (hit) return { status: 200, json: { hit: true, key, keyParts, cachedFor: hit.execution_identity, rows: hit.result } };
  const r = await viaConnector(conn, ident, qd, sessionId);
  if (r.status !== 200) return { status: r.status, json: { hit: false, key, ...r.json } };
  // A pass-through result's lifetime is capped by what the source itself would honour: the delegated
  // token's expiry where there is one. Asserted identity has no such bound.
  let ttl = ttlSec;
  if (r.json.identity?.tokenExp) ttl = Math.min(ttl, r.json.identity.tokenExp - Math.floor(Date.now() / 1000));
  await db.query(`insert into tenant_acme.result_cache (key, connection_id, qdv, params_canonical, execution_identity, session_id, result, checksum, expires_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(secs => $9)) on conflict (key) do update set result=excluded.result, expires_at=excluded.expires_at`,
  [key, conn.id, `${qd.id}@${qd.version}`, keyParts.params, execIdentity, tieToSession ? sessionId : null, JSON.stringify(r.json.rows), sha(canon(r.json.rows)), ttl]);
  return { status: 200, json: { hit: false, key, keyParts, ttl, rows: r.json.rows, identity: r.json.identity } };
}

export async function inspect() {
  const r = await db.query(`select
    (select count(*) from tenant_acme.session)::int as sessions,
    (select count(*) from tenant_acme.session_provider_token)::int as provider_tokens,
    (select count(*) from tenant_acme.job_identity)::int as job_identities,
    (select count(*) from tenant_acme.result_cache)::int as cache_rows,
    (select count(*) from tenant_acme.pin)::int as pins`);
  return r.rows[0];
}

export async function reset() {
  await db.query('truncate tenant_acme.pin, tenant_acme.result_cache, tenant_acme.job_identity, tenant_acme.publish_job, tenant_acme.session_provider_token, tenant_acme.session cascade');
  return { ok: true };
}

export { post as svcPost };
