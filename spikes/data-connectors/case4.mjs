// Case 4: the end user's identity, later and elsewhere (gate). Driven through the CALLER's /svc routes,
// which stand for the product's service (sessions, the tenant's schema) and, for option (b), the worker;
// every query still reaches the source through the CONNECTOR, each on a fresh connection (pool 'none').
// Writes dcp2-case4.json.
//
//  4.1 a publish of 400 inline + 40 block pass-through bindings under the three options:
//      (a) at the request, (b) carried to the worker, (c) pinned only - timing, and what is held;
//  4.2 sign-out partway through a publish, for (a) and (b), per connector type; and what a copy of the
//      user's token outside our custody can still do after it;
//  4.3 a provider token that expires inside a long publish: no refresh, refresh, and two jobs of one
//      session refreshing with and without the per-session lock;
//  4.4 a pin made by Ada, read by Grace (DAT-024);
//  4.5 the result cache under pass-through (DAT-026), and a result that outlives the user's permission.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CALLER, CONNECTOR, SEALING_KEY_B64, seal, post } from './config.mjs';

const T = 'tenant-acme';
const svc = async (route, body = {}) => post(CALLER, `/svc/${route}`, body);
const idp = async (path, form = {}) => (await svc('idp', { path, form })).json;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = {};
// ONLY=4.2,4.3 runs just those sections (the report then holds only them).
const want = (s) => !process.env.ONLY || process.env.ONLY.split(',').includes(s);
const log = (...a) => console.log(...a);
const docker = (args) =>
  execFileSync('docker', args, {
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    encoding: 'utf8',
    timeout: 30000,
  }).trim();
const psql = (sql) =>
  docker([
    'exec',
    'aw-data-connectors-source-pg-1',
    'psql',
    '-U',
    'postgres',
    '-d',
    'sourcedb',
    '-tAc',
    sql,
  ]);
// The fake API's owner-reassign switch, reached from inside the caller (the API publishes no port).
const reassign = (id, owner) =>
  docker([
    'exec',
    'aw-data-connectors-caller-1',
    'node',
    '-e',
    `fetch('http://fake-api/admin/reassign?id=${id}&owner=${owner}',{method:'POST'}).then(r=>r.text()).then(console.log)`,
  ]);
const counters = async () => (await fetch(`${CONNECTOR}/as-user/counters`)).json();

// ---------- connections and query definitions ----------
const pgSpec = {
  kind: 'postgres',
  host: 'source-pg',
  port: 5432,
  database: 'sourcedb',
  user: 'connector_login',
  tenantId: T,
  sealingKey: SEALING_KEY_B64,
  sealedSecret: seal(T, 'source-pg-connector-fake-pw'),
};
const msSpec = {
  kind: 'sqlserver',
  host: 'sqlserver',
  port: 1433,
  database: 'sourcedb',
  user: 'connector_login',
  tenantId: T,
  sealingKey: SEALING_KEY_B64,
  sealedSecret: seal(T, 'Spike-Connector-Fake-Pw1'),
};
const httpSpec = {
  kind: 'http',
  url: 'http://fake-api/',
  exchangeUrl: 'http://token-exchange',
  clientId: 'aw-connector-acme',
  audience: 'fake-api',
  connectionId: 'http-eu',
  tenantId: T,
  sealingKey: SEALING_KEY_B64,
  sealedSecret: seal(T, 'fake-exchange-client-secret-for-the-spike'),
};
await svc('setup');
await svc('reset');
await svc('connections', {
  list: [
    {
      id: 'pg-eu',
      version: 1,
      spec: pgSpec,
      mode: 'end-user',
      mechanism: 'pg-set-local-role',
      pool: 'none',
    },
    {
      id: 'ms-eu',
      version: 1,
      spec: msSpec,
      mode: 'end-user',
      mechanism: 'ms-session-context',
      readOnlyContext: true,
      pool: 'none',
    },
    {
      id: 'http-eu',
      version: 1,
      spec: httpSpec,
      mode: 'end-user',
      mechanism: 'http-delegated',
      pool: 'none',
    },
  ],
});
const qd = {
  'pg-eu': (ms) => ({
    id: 'qd-pg',
    version: 1,
    sql: `${ms ? `select pg_sleep(${ms / 1000}); ` : ''}select id, owner from public.record order by id`,
  }),
  'ms-eu': (ms) => ({
    id: 'qd-ms',
    version: 1,
    via: 'batch',
    sql: `${ms ? `WAITFOR DELAY '00:00:00.${String(ms).padStart(3, '0')}'; ` : ''}SELECT id, owner FROM dbo.record ORDER BY id`,
  }),
  'http-eu': () => ({ id: 'qd-http', version: 1 }),
};
const delayFor = (conn, ms) => (conn === 'http-eu' ? ms : 0); // HTTP latency is the source's; the databases sleep in the text
const signin = async (sub, extra = {}) =>
  (await svc('signin', { sub, scope: 'openid offline_access', ...extra })).json;
async function waitJob(jobId, limitMs = 240000) {
  const t0 = Date.now();
  for (;;) {
    const j = (await svc('job', { id: jobId })).json;
    if (j && j.status !== 'running') return j;
    if (Date.now() - t0 > limitMs) return { ...j, timedOut: true };
    await sleep(100);
  }
}
const jobSummary = (j) => ({
  status: j.status,
  done: j.done,
  total: j.total,
  refreshes: j.refreshes,
  failure: j.failure,
  runMs: j.finished_ms ? Math.round(j.finished_ms - new Date(j.created_at).getTime()) : null,
});

if (want('4.1')) {
  // ================= 4.1 a publish, three options =================
  log('\n== 4.1 publish: 400 inline + 40 block pass-through bindings ==');
  report.publish = [];
  for (const conn of ['pg-eu', 'ms-eu', 'http-eu']) {
    for (const [latency, concurrency] of [
      [20, 8],
      [20, 1],
    ]) {
      const ada = await signin('ada');
      const c0 = await counters();
      const q = qd[conn](latency);
      // (a) at the request
      const a = await svc('publish', {
        sessionId: ada.sessionId,
        connectionId: conn,
        placement: 'request',
        qd: q,
        delayMs: delayFor(conn, latency),
        concurrency,
      });
      const c1 = await counters();
      // (b) carried to the worker
      const t0 = Date.now();
      const b = await svc('publish', {
        sessionId: ada.sessionId,
        connectionId: conn,
        placement: 'worker',
        qd: q,
        delayMs: delayFor(conn, latency),
        concurrency,
      });
      const bAccepted = Date.now() - t0;
      const heldDuring = (await svc('inspect')).json;
      const bj = await waitJob(b.json.jobId);
      const heldAfter = (await svc('inspect')).json;
      const c2 = await counters();
      // (c) pinned only
      const c = await svc('publish', {
        sessionId: ada.sessionId,
        connectionId: conn,
        placement: 'pinned-only',
        qd: q,
      });
      const e = {
        conn,
        latencyMs: latency,
        concurrency,
        request: {
          status: a.status,
          done: a.json.done,
          heldRequestMs: a.json.heldRequestMs,
          failure: a.json.failure ?? null,
          exchanges: c1.exchanges - c0.exchanges,
        },
        worker: {
          acceptedMs: bAccepted,
          ...jobSummary(bj),
          exchanges: c2.exchanges - c1.exchanges,
          jobIdentityRowsDuring: heldDuring.job_identities,
          jobIdentityRowsAfterDone: heldAfter.job_identities,
          providerTokenRows: heldAfter.provider_tokens,
        },
        pinnedOnly: { status: c.status, error: c.json.error, message: c.json.message },
      };
      report.publish.push(e);
      log(JSON.stringify(e));
      await svc('signout', { sessionId: ada.sessionId });
    }
  }
  // The Google route: a session whose provider token no source trusts.
  {
    const g = await signin('ada', { issuer: 'google', scope: 'openid' });
    const http = await svc('publish', {
      sessionId: g.sessionId,
      connectionId: 'http-eu',
      placement: 'request',
      qd: qd['http-eu'](),
      counts: { inline: 4, block: 0 },
    });
    const pg = await svc('publish', {
      sessionId: g.sessionId,
      connectionId: 'pg-eu',
      placement: 'request',
      qd: qd['pg-eu'](0),
      counts: { inline: 4, block: 0 },
    });
    const noTok = await signin('ada', { keepProviderToken: false, scope: 'openid' });
    const none = await svc('publish', {
      sessionId: noTok.sessionId,
      connectionId: 'http-eu',
      placement: 'request',
      qd: qd['http-eu'](),
      counts: { inline: 4, block: 0 },
    });
    report.googleRoute = {
      httpDelegated: http.json,
      pgAsserted: pg.json,
      sessionHoldingNoProviderToken: none.json,
    };
    log('google route', JSON.stringify(report.googleRoute));
    await svc('signout', { sessionId: g.sessionId });
    await svc('signout', { sessionId: noTok.sessionId });
  }
} // 4.1

if (want('4.2')) {
  // ================= 4.2 sign-out mid-publish =================
  log('\n== 4.2 sign-out partway through a publish ==');
  report.signout = [];
  const REPEAT = Number(process.env.REPEAT || 5);
  for (const conn of ['pg-eu', 'ms-eu', 'http-eu']) {
    for (const placement of ['request', 'worker'])
      for (let rep = 0; rep < REPEAT; rep++) {
        const ada = await signin('ada');
        const q = qd[conn](200);
        const pub = svc('publish', {
          sessionId: ada.sessionId,
          connectionId: conn,
          placement,
          qd: q,
          delayMs: delayFor(conn, 200),
          concurrency: 4,
        });
        let jobId = null;
        if (placement === 'worker') jobId = (await pub).json.jobId;
        await sleep(1500);
        const so = (await svc('signout', { sessionId: ada.sessionId })).json;
        let result;
        if (placement === 'request') {
          const r = await pub;
          jobId = r.json.jobId;
          result = { status: r.status, done: r.json.done, failure: r.json.failure };
        }
        const j = await waitJob(jobId);
        const e = {
          conn,
          placement,
          signoutMs: so.ms,
          removedWithSession: so.removedWithIt,
          revokedAtProvider: so.revokedAtProvider,
          cancelledInFlight: so.cancelled.filter((x) => x.found).length,
          cancelResults: so.cancelled.map((x) => x.result),
          job: jobSummary(j),
          stoppedAfterSignoutMs: Math.round(j.finished_ms - so.signedOutAt),
          bindingStartedAfterSignout: j.last_started_ms > so.signedOutAt,
          lastStartVsSignoutMs: Math.round(j.last_started_ms - so.signedOutAt),
          request: result ?? null,
        };
        report.signout.push(e);
        log(JSON.stringify(e));
      }
  }
  // Per connector and option: how many runs let a binding start after the sign-out, and how long the
  // last work went on after it.
  report.signoutSummary = {};
  for (const e of report.signout) {
    const k = `${e.conn} ${e.placement}`;
    const s = (report.signoutSummary[k] ??= {
      runs: 0,
      stoppedByName: 0,
      bindingStartedAfter: 0,
      maxStoppedAfterMs: 0,
      failures: {},
    });
    s.runs++;
    if (e.job.status === 'failed') s.stoppedByName++;
    if (e.bindingStartedAfterSignout) s.bindingStartedAfter++;
    s.maxStoppedAfterMs = Math.max(s.maxStoppedAfterMs, e.stoppedAfterSignoutMs);
    const f = (e.job.failure || '').split(':')[0];
    s.failures[f] = (s.failures[f] || 0) + 1;
  }
  log('signout summary', JSON.stringify(report.signoutSummary));

  // A copy of the user's token outside our custody, after sign-out (IAM-067). Capture the token a worker
  // job carries while it runs, sign out, then present that copy straight to the connector.
  {
    const ada = await signin('ada');
    const b = await svc('publish', {
      sessionId: ada.sessionId,
      connectionId: 'http-eu',
      placement: 'worker',
      qd: qd['http-eu'](),
      delayMs: 200,
      concurrency: 4,
      counts: { inline: 40, block: 0 },
    });
    await sleep(400);
    const copy = (await svc('raw-job-token', { jobId: b.json.jobId })).json.token;
    const so = (await svc('signout', { sessionId: ada.sessionId })).json;
    await waitJob(b.json.jobId);
    const afterRow = (await svc('raw-job-token', { jobId: b.json.jobId })).json.token;
    const direct = async (cacheExchange) => {
      const r = await post(CONNECTOR, '/as-user/query', {
        spec: httpSpec,
        mechanism: 'http-delegated',
        subjectToken: copy,
        pool: 'none',
        cacheExchange,
      });
      return r.status === 200
        ? `served as ${r.json.identity.as}, rows ${r.json.rows.map((x) => x.id).join(',')}`
        : `${r.json.error.code}: ${r.json.error.message}`;
    };
    const claims = JSON.parse(Buffer.from(copy.split('.')[1], 'base64url').toString());
    const x = {
      providerRevokedRefreshTokens: so.revokedAtProvider,
      jobIdentityRowAfterSignout: afterRow === null ? 'gone' : 'present',
      copyRemainingLifeSec: claims.exp - Math.floor(Date.now() / 1000),
      afterSignout_connectorExchangeCache: await direct(true),
      afterSignout_freshExchange: await direct(false),
    };
    await idp('/stats');
    // An administrator disables Ada at the source's authorisation server (the exchange).
    execFileSync(
      'docker',
      [
        'exec',
        'aw-data-connectors-caller-1',
        'node',
        '-e',
        "fetch('http://token-exchange/admin/config',{method:'POST',body:new URLSearchParams({disable:'ada'})}).then(r=>r.text()).then(console.log)",
      ],
      { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8', timeout: 20000 },
    );
    x.adaDisabled_freshExchange = await direct(false);
    x.adaDisabled_connectorExchangeCache = await direct(true);
    execFileSync(
      'docker',
      [
        'exec',
        'aw-data-connectors-caller-1',
        'node',
        '-e',
        "fetch('http://token-exchange/admin/config',{method:'POST',body:new URLSearchParams({enable:'ada'})}).then(r=>r.text()).then(console.log)",
      ],
      { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8', timeout: 20000 },
    );
    report.copyAfterSignout = x;
    log('copy after sign-out', JSON.stringify(x));
  }
} // 4.2

if (want('4.3')) {
  // ================= 4.3 a token that expires inside a long publish =================
  log('\n== 4.3 token expiry inside a publish ==');
  report.expiry = { ttl: await idp('/admin/ttl', { access: 6 }) };
  const statsBefore = await idp('/stats');
  const expiryRuns = [];
  {
    // Each run's own count of refresh grants the provider served, refused, and reuses it detected.
    let last = statsBefore;
    const push = async (e) => {
      const now = await idp('/stats');
      expiryRuns.push({
        ...e,
        provider: {
          refreshed: now.refreshed - last.refreshed,
          refused: now.refused - last.refused,
          reuseDetected: now.reuseDetected - last.reuseDetected,
        },
      });
      last = now;
    };
    // no refresh: request and worker
    const s1 = await signin('ada');
    const a = await svc('publish', {
      sessionId: s1.sessionId,
      connectionId: 'http-eu',
      placement: 'request',
      qd: qd['http-eu'](),
      delayMs: 100,
      concurrency: 4,
    });
    await push({
      run: 'request, no refresh',
      status: a.status,
      done: a.json.done,
      failure: a.json.failure ?? null,
      heldRequestMs: a.json.heldRequestMs,
    });
    const s2 = await signin('ada');
    const b = await svc('publish', {
      sessionId: s2.sessionId,
      connectionId: 'http-eu',
      placement: 'worker',
      qd: qd['http-eu'](),
      delayMs: 100,
      concurrency: 4,
      refresh: false,
    });
    await push({ run: 'worker, no refresh', ...jobSummary(await waitJob(b.json.jobId)) });
    // refresh with the per-session lock
    const s3 = await signin('ada');
    const c = await svc('publish', {
      sessionId: s3.sessionId,
      connectionId: 'http-eu',
      placement: 'worker',
      qd: qd['http-eu'](),
      delayMs: 100,
      concurrency: 4,
      refresh: true,
      refreshLock: true,
    });
    await push({ run: 'worker, refresh, lock', ...jobSummary(await waitJob(c.json.jobId)) });
    // two jobs of one session, refreshing at once: without the lock, then with it
    for (const lock of [false, true]) {
      const s = await signin('ada');
      const j1 = await svc('publish', {
        sessionId: s.sessionId,
        connectionId: 'http-eu',
        placement: 'worker',
        qd: qd['http-eu'](),
        delayMs: 100,
        concurrency: 4,
        refresh: true,
        refreshLock: lock,
      });
      const j2 = await svc('publish', {
        sessionId: s.sessionId,
        connectionId: 'http-eu',
        placement: 'worker',
        qd: qd['http-eu'](),
        delayMs: 100,
        concurrency: 4,
        refresh: true,
        refreshLock: lock,
      });
      const [r1, r2] = await Promise.all([waitJob(j1.json.jobId), waitJob(j2.json.jobId)]);
      await push({
        run: `two jobs one session, refresh, lock ${lock}`,
        job1: jobSummary(r1),
        job2: jobSummary(r2),
      });
    }
    for (const s of [s1, s2, s3]) await svc('signout', { sessionId: s.sessionId });
  }
  const statsAfter = await idp('/stats');
  report.expiry.runs = expiryRuns;
  report.expiry.idp = {
    refreshed: statsAfter.refreshed - statsBefore.refreshed,
    reuseDetected: statsAfter.reuseDetected - statsBefore.reuseDetected,
    refused: statsAfter.refused - statsBefore.refused,
  };
  report.expiry.custody = {
    refreshTokenLifetimeSec: statsAfter.ttl.refresh,
    accessTokenLifetimeSec: statsAfter.ttl.access,
  };
  for (const r of expiryRuns) log(JSON.stringify(r));
  log('idp', JSON.stringify(report.expiry.idp));
  await idp('/admin/ttl', { access: 300 });
} // 4.3

if (want('4.4')) {
  // ================= 4.4 a pin made by Ada, read by Grace =================
  log('\n== 4.4 a pin by Ada read by Grace ==');
  report.pin = [];
  {
    const ada = await signin('ada');
    const grace = await signin('grace');
    for (const conn of ['pg-eu', 'ms-eu', 'http-eu']) {
      const p = await svc('pin', {
        sessionId: ada.sessionId,
        connectionId: conn,
        qd: qd[conn](0),
        binding: `b-${conn}`,
      });
      const read = await svc('read-pin', { sessionId: grace.sessionId, pinId: p.json.pinId });
      const live = await svc('query', {
        sessionId: grace.sessionId,
        connectionId: conn,
        qd: qd[conn](0),
      });
      const e = {
        conn,
        pinnedRows: p.json.rows.map((r) => r.id).join(','),
        provenanceIdentity: p.json.provenance.executionIdentity,
        checksum: p.json.provenance.checksum.slice(0, 16),
        graceReads: read.json.value.map((r) => r.id).join(','),
        shownToGrace: read.json.shown,
        readerIsProducer: read.json.readerIsProducer,
        graceLive: live.json.rows.map((r) => r.id).join(','),
      };
      report.pin.push(e);
      log(JSON.stringify(e));
    }
    await svc('signout', { sessionId: ada.sessionId });
    await svc('signout', { sessionId: grace.sessionId });
  }
} // 4.4

if (want('4.5')) {
  // ================= 4.5 the cache =================
  log('\n== 4.5 the result cache ==');
  report.cache = {};
  {
    const ada = await signin('ada');
    const grace = await signin('grace');
    const ids = (r) => r.json.rows?.map((x) => x.id).join(',') ?? `ERR ${r.json.error}`;
    const cq = (s, conn, q, extra = {}) =>
      svc('cached', { sessionId: s.sessionId, connectionId: conn, qd: q, ...extra });
    const seq = [];
    for (const conn of ['pg-eu', 'ms-eu', 'http-eu']) {
      const q = { ...qd[conn](0), version: 2 };
      for (const [who, s] of [
        ['ada', ada],
        ['grace', grace],
        ['ada', ada],
        ['grace', grace],
      ]) {
        const r = await cq(s, conn, q);
        seq.push({
          conn,
          key: 'full',
          who,
          hit: r.json.hit,
          rows: ids(r),
          ttl: r.json.ttl ?? null,
          cachedFor: r.json.cachedFor ?? null,
        });
      }
      // The same, with the execution identity left out of the key.
      const q3 = { ...qd[conn](0), version: 3 };
      for (const [who, s] of [
        ['ada', ada],
        ['grace', grace],
      ]) {
        const r = await cq(s, conn, q3, { keyMode: 'no-identity' });
        seq.push({
          conn,
          key: 'without identity',
          who,
          hit: r.json.hit,
          rows: ids(r),
          cachedFor: r.json.cachedFor ?? null,
        });
      }
    }
    report.cache.sequence = seq;
    for (const x of seq) log(JSON.stringify(x));
    report.cache.keyParts = (
      await cq(ada, 'http-eu', { ...qd['http-eu'](), version: 2 })
    ).json.keyParts;
    log('key parts', JSON.stringify(report.cache.keyParts));

    // A result that outlives the user's permission at the source: row 1 moves from Ada to Grace after
    // Ada's result is cached. HTTP (delegated; lifetime capped at the token's) and Postgres (asserted).
    const stale = [];
    for (const conn of ['http-eu', 'pg-eu']) {
      const q = { ...qd[conn](0), version: 4 };
      const first = await cq(ada, conn, q, { ttlSec: 3600 });
      if (conn === 'http-eu') reassign(1, 'grace');
      else psql("update public.record set owner='grace' where id=1");
      const cached = await cq(ada, conn, q, { ttlSec: 3600 });
      const live = await svc('query', { sessionId: ada.sessionId, connectionId: conn, qd: q });
      stale.push({
        conn,
        ttlGrantedSec: first.json.ttl,
        before: ids(first),
        afterReassign_cached: `${ids(cached)} (hit ${cached.json.hit})`,
        afterReassign_live: ids(live),
      });
      if (conn === 'http-eu') reassign(1, 'ada');
      else psql("update public.record set owner='ada' where id=1");
    }
    report.cache.stale = stale;
    for (const x of stale) log(JSON.stringify(x));
    const before = (await svc('inspect')).json;
    const so = (await svc('signout', { sessionId: ada.sessionId })).json;
    report.cache.signout = {
      cacheRowsBefore: before.cache_rows,
      removedWithAdasSession: so.removedWithIt.cache_rows,
      cacheRowsAfter: (await svc('inspect')).json.cache_rows,
    };
    log('cache and sign-out', JSON.stringify(report.cache.signout));
    await svc('signout', { sessionId: grace.sessionId });
  }
} // 4.5

writeFileSync('dcp2-case4.json', JSON.stringify(report, null, 2));
log('\nwritten dcp2-case4.json');
