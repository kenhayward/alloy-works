// Case 1 (gate): the connector is not a route into the platform.
// Runs the same hostile connections through placement A (caller, on the platform network) and
// placement C (connector, not on it), and records: raw network reachability, the code guard's
// verdict, the uniformity of the DAT-006 connection-test reason, redirect-following, DNS rebinding,
// connection options that reach the local machine, and that the tenant's private source still
// answers. Writes dcp1-case1.json.
import { CALLER, CONNECTOR, ADDR, post, pgSpec, httpSpec } from './config.mjs';

const report = { generatedAt: new Date().toISOString(), sections: {} };
const log = (...a) => console.log(...a);

// Internal targets a source connection must never reach.
const targets = [
  ['platform Postgres', ADDR.platformPg, 5432],
  ['object store (SeaweedFS)', ADDR.seaweed, 8333],
  ['cloud metadata endpoint', ADDR.metadata, 80],
  ['identity provider', ADDR.idp, 80],
  ["caller's own control port", ADDR.callerPlatform, 8080],
  ['loopback (own machine)', '127.0.0.1', 8080],
];

// A - raw network reachability, guard OFF, from each placement's own vantage.
async function reachability() {
  const out = {};
  for (const [base, role] of [[CALLER, 'A/caller'], [CONNECTOR, 'C/connector']]) {
    out[role] = {};
    for (const [name, host, port] of targets) {
      const r = await post(base, '/probe', { host, port });
      out[role][name] = { outcome: r.json.outcome, detail: r.json.detail, ms: r.json.ms };
    }
    // The tenant's own private source must still answer.
    const priv = await post(base, '/probe', { host: ADDR.sourcePg, port: 5432 });
    out[role]['tenant private source (must answer)'] = { outcome: priv.json.outcome, ms: priv.json.ms };
  }
  return out;
}

// B - the code guard's verdict for canonical internal targets and their alternate spellings.
async function guardVerdicts() {
  const hosts = [
    ['platform Postgres (canonical)', ADDR.platformPg],
    ['platform Postgres (decimal)', '2887715339'],
    ['platform Postgres (octal)', '0254.037.012.013'],
    ['platform Postgres (IPv4-mapped IPv6)', '::ffff:172.31.10.11'],
    ['platform Postgres (trailing dot)', '172.31.10.11.'],
    ['metadata endpoint', ADDR.metadata],
    ['loopback (canonical)', '127.0.0.1'],
    ['loopback (decimal)', '2130706433'],
    ['loopback (octal)', '0177.0.0.1'],
    ['loopback (IPv4-mapped IPv6)', '::ffff:127.0.0.1'],
    ['unix socket path', '/var/run/postgresql'],
    ['password/cert file path', '/etc/ssl/private/source.key'],
    ['tenant private source (must be allowed)', ADDR.sourcePg],
  ];
  const out = {};
  for (const [name, host] of hosts) {
    const r = await post(CALLER, '/guard', { host });
    out[name] = { host, allowed: r.json.allowed, class: r.json.class ?? null, dialed: r.json.dialed ?? null };
  }
  return out;
}

// C - the DAT-006 oracle: conn-test reasons for hostile connections must be uniform and name no
// internal address; and the raw probe outcome classes show what an ungated test WOULD leak.
async function oracle() {
  const cases = [
    ['refused port (platform pg wrong port)', ADDR.platformPg, 6543],
    ['open internal service (platform pg)', ADDR.platformPg, 5432],
    ['filtered/unreachable address', '172.31.99.99', 5432],
    ['unknown host', 'no-such-host.invalid', 5432],
  ];
  const out = { connTestReasons: {}, rawProbeClasses: {} };
  for (const [name, host, port] of cases) {
    const spec = { ...pgSpec(), host, port };
    const t = await post(CALLER, '/conn-test', { spec, guard: true });
    out.connTestReasons[name] = t.json.result?.reason ?? t.json;
    const p = await post(CALLER, '/probe', { host, port });
    out.rawProbeClasses[name] = p.json.outcome;
  }
  return out;
}

// D - redirect from an allowed host (fake-api) to a denied one (platform pg).
async function redirect() {
  const out = {};
  for (const follow of [false, true]) {
    const spec = { ...httpSpec(), url: 'http://fake-api/redirect', followRedirects: follow };
    const r = await post(CALLER, '/query', { spec });
    out[follow ? 'followRedirects=true' : 'followRedirects=false'] =
      { status: r.status, result: r.json.result ?? r.json.error ?? null };
  }
  return out;
}

// E - DNS rebinding, from each placement.
async function rebinding() {
  const out = {};
  for (const [base, role] of [[CALLER, 'A/caller'], [CONNECTOR, 'C/connector']]) {
    const r = await post(base, '/rebind-test', { name: 'rebind.evil.test', port: 5432 });
    out[role] = r.json;
  }
  return out;
}

const run = async () => {
  log('Case 1 - the connector is not a route into the platform (gate)\n');
  report.sections.A_reachability = await reachability();
  report.sections.B_guardVerdicts = await guardVerdicts();
  report.sections.C_oracle = await oracle();
  report.sections.D_redirect = await redirect();
  report.sections.E_rebinding = await rebinding();

  const { writeFileSync } = await import('node:fs');
  writeFileSync('dcp1-case1.json', JSON.stringify(report, null, 2));
  log(JSON.stringify(report.sections, null, 2));
  log('\nWrote dcp1-case1.json');
};
run().catch((e) => { console.error(e); process.exit(1); });
