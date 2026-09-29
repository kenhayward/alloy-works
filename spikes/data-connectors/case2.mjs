// Case 2: the secret opens in one place and never comes back out (DAT-005). Each driver is made to
// fail every way it can; every byte the attempt causes to be written is searched for the secret,
// raw, URL-encoded and base64. Paths searched: the caller-facing reason/error, the DAT-006 test
// result, the RAW driver error (the sink - what a log or a job row would hold if unscrubbed), and
// the container's stdout. Writes dcp1-case2.json.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { CALLER, ADDR, post, pgSpec, mssqlSpec, httpSpec, seal, SEALING_KEY_B64 } from './config.mjs';

// The real plaintext secrets (fake dev values) we must never find leaking.
const SECRETS = {
  postgres: 'source-pg-connector-fake-pw',
  sqlserver: 'Spike-SqlServer-Fake-Pw1',
  http: 'fake-api-bearer-token-for-the-spike',
};

// Every encoding the search must cover.
function encodings(secret) {
  return {
    raw: secret,
    urlEncoded: encodeURIComponent(secret),
    base64: Buffer.from(secret).toString('base64'),
  };
}
function findLeak(text, secret) {
  if (text == null) return [];
  const hay = typeof text === 'string' ? text : JSON.stringify(text);
  const hits = [];
  for (const [enc, needle] of Object.entries(encodings(secret))) {
    if (needle && hay.includes(needle)) hits.push(enc);
  }
  return hits;
}

// The failure modes per kind. Each returns a spec that fails on connect/auth.
function failureModes(kind) {
  const modes = [];
  if (kind === 'postgres') {
    const base = pgSpec();
    modes.push(['wrong-password', { ...base, sealedSecret: seal(base.tenantId, 'definitely-wrong') }]);
    modes.push(['unknown-host', { ...base, host: 'no-such-source.invalid', timeoutMs: 3000 }]);
    modes.push(['tls-required-but-absent', { ...base, ssl: { rejectUnauthorized: true } }]);
    modes.push(['timeout (dark address)', { ...base, host: '172.31.20.201', timeoutMs: 2500 }]);
    modes.push(['malformed connection string', {
      kind: 'postgres', tenantId: base.tenantId, sealingKey: SEALING_KEY_B64,
      sealedSecret: base.sealedSecret,
      connectionString: 'postgres://connector_login:__SECRET__@source-pg:5432/nosuchdb', timeoutMs: 3000,
    }]);
  } else if (kind === 'sqlserver') {
    const base = mssqlSpec();
    modes.push(['wrong-password', { ...base, sealedSecret: seal(base.tenantId, 'Definitely-Wrong-1') }]);
    modes.push(['unknown-host', { ...base, host: 'no-such-source.invalid', timeoutMs: 4000 }]);
    modes.push(['tls-failure (no trust)', { ...base, trustServerCertificate: false, timeoutMs: 6000 }]);
    modes.push(['timeout (dark address)', { ...base, host: '172.31.20.201', timeoutMs: 3000 }]);
  } else {
    const base = httpSpec();
    modes.push(['wrong-bearer (401)', { ...base, sealedSecret: seal(base.tenantId, 'wrong-token') }]);
    modes.push(['unknown-host', { ...base, url: 'http://no-such-api.invalid/', timeoutMs: 3000 }]);
    modes.push(['tls-failure (https to http)', { ...base, url: 'https://fake-api/', timeoutMs: 3000 }]);
    modes.push(['token-in-query-string', { ...base, tokenInQuery: true }]);
  }
  return modes;
}

const CONTAINERS = ['caller', 'connector', 'source-pg', 'sqlserver', 'fake-api'];

const run = async () => {
  const report = { generatedAt: new Date().toISOString(), attempts: [], containerLogs: {}, summary: {} };
  let anyLeak = false;

  for (const kind of ['postgres', 'sqlserver', 'http']) {
    const secret = SECRETS[kind];
    for (const [mode, spec] of failureModes(kind)) {
      // The query path (exposes the sink = raw driver error, what a log/job row/crash would hold).
      const q = await post(CALLER, '/query', { spec, sql: spec.kind === 'postgres' ? 'select 1' : undefined, exposeSink: true });
      // The DAT-006 connection-test path.
      const t = await post(CALLER, '/conn-test', { spec, guard: true, exposeSink: true });

      const callerFacing = { queryError: q.json.error ?? null, queryResult: q.json.result ?? null, testReason: t.json.result?.reason ?? null };
      const sinkText = JSON.stringify(q.json.sink ?? []) + JSON.stringify(t.json.sink ?? []);

      const leak = {
        callerFacing: findLeak(JSON.stringify(callerFacing), secret),
        rawDriverError_sink: findLeak(sinkText, secret),
      };
      if (leak.callerFacing.length || leak.rawDriverError_sink.length) anyLeak = true;
      report.attempts.push({ kind, mode, callerFacing, leak,
        sinkChannels: (q.json.sink ?? []).map((s) => s.channel) });
    }
  }

  // Container stdout since the run started - stands in for the platform's own logs.
  for (const c of CONTAINERS) {
    let logs = '';
    try { logs = execSync(`docker logs aw-data-connectors-${c}-1 2>&1`, { maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) { logs = String(e); }
    const perSecret = {};
    for (const [kind, secret] of Object.entries(SECRETS)) {
      const hits = findLeak(logs, secret);
      if (hits.length) { perSecret[kind] = hits; anyLeak = true; }
    }
    report.containerLogs[c] = { bytes: logs.length, leaks: perSecret };
  }

  report.summary = {
    attempts: report.attempts.length,
    callerFacingLeaks: report.attempts.filter((a) => a.leak.callerFacing.length).length,
    rawDriverErrorLeaks: report.attempts.filter((a) => a.leak.rawDriverError_sink.length).length,
    containerLogLeaks: Object.entries(report.containerLogs).filter(([, v]) => Object.keys(v.leaks).length).map(([k]) => k),
    verdict: anyLeak ? 'LEAK FOUND' : 'no secret found on any searched path',
  };

  writeFileSync('dcp1-case2.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('\nAttempts with a raw-driver-error leak (what a log/job row/crash would hold if unscrubbed):');
  for (const a of report.attempts) {
    console.log(`  ${a.kind}/${a.mode}: callerFacing=${JSON.stringify(a.leak.callerFacing)} rawDriverError=${JSON.stringify(a.leak.rawDriverError_sink)}`);
  }
  console.log('\nWrote dcp1-case2.json');
};
run().catch((e) => { console.error(e); process.exit(1); });
