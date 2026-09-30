// Case 3: as the end user, per connector type (gate). Ada and Grace run the same binding - the same
// connection, the same query text - through the CONNECTOR (placement C), each on a FRESH connection
// (pool 'none': opened for the execution and closed after it; no connection is reused, so nothing is
// carried from one execution to the next). For each mechanism the report records what each user was
// shown, who the source believed was asking, and whether the authored query text could change that
// within its own execution. Writes dcp2-case3.json.
//
// Pooled connections are deliberately NOT exercised here (the owner's scope, 2026-09-30): what resets
// a pooled connection's identity is written in the findings as a claim, from each driver's and each
// database's documentation.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CALLER, CONNECTOR, SEALING_KEY_B64, seal, post } from './config.mjs';

const T = 'tenant-acme';
const pg = { kind: 'postgres', host: 'source-pg', port: 5432, database: 'sourcedb', user: 'connector_login',
  tenantId: T, sealingKey: SEALING_KEY_B64, sealedSecret: seal(T, 'source-pg-connector-fake-pw') };
const ms = { kind: 'sqlserver', host: 'sqlserver', port: 1433, database: 'sourcedb', user: 'connector_login',
  tenantId: T, sealingKey: SEALING_KEY_B64, sealedSecret: seal(T, 'Spike-Connector-Fake-Pw1') };
const httpDelegated = { kind: 'http', url: 'http://fake-api/', exchangeUrl: 'http://token-exchange', clientId: 'aw-connector-acme',
  audience: 'fake-api', connectionId: 'conn-http-eu', tenantId: T, sealingKey: SEALING_KEY_B64,
  sealedSecret: seal(T, 'fake-exchange-client-secret-for-the-spike') };
const httpService = { kind: 'http', url: 'http://fake-api/', connectionId: 'conn-http-svc', tenantId: T,
  sealingKey: SEALING_KEY_B64, sealedSecret: seal(T, 'fake-api-bearer-token-for-the-spike') };

const run = (body) => post(CONNECTOR, '/as-user/query', { pool: 'none', readOnly: true, ...body });
const ids = (r) => (r.json.rows ? r.json.rows.map((x) => x.id).sort((a, b) => a - b).join(',') : `ERR ${r.json.error?.code}: ${(r.json.error?.message || '').slice(0, 140)}`);
const report = { at: new Date().toISOString(), matrix: [], override: [], http: [], counts: {} };

function row(section, label, user, r, seen) {
  const e = { label, user, status: r.status, rows: ids(r), ms: r.json.ms ?? null, sourceSaw: seen(r) };
  report[section].push(e);
  console.log(`${section.padEnd(8)} ${label.padEnd(44)} ${String(user).padEnd(6)} -> ${e.rows.padEnd(10)} source saw: ${JSON.stringify(e.sourceSaw)}`);
  return e;
}
const pgSaw = (r) => r.json.identity ? { current_user: r.json.identity.current_user, session_user: r.json.identity.session_user, app_user: r.json.identity.app_user,
  afterCommit: r.json.afterCommit?.current_user } : null;
const msSaw = (r) => r.json.identity ? { db_user: r.json.identity.db_user, login: r.json.identity.login, app_user: r.json.identity.app_user, after: r.json.after?.db_user, revert: r.json.revert } : null;
const httpSaw = (r) => r.json.identity ?? null;

// ---------- 1. Ada and Grace, each mechanism, one binding ----------
const PG_Q = 'select id, owner from public.record order by id';
const PG_GUC_Q = 'select id, owner from public.record_guc order by id';
const MS_Q = 'SELECT id, owner FROM dbo.record ORDER BY id';
const MS_EU_Q = 'SELECT id, owner FROM dbo.record_eu ORDER BY id';

const plan = [
  ['postgres SET ROLE (session)', pg, 'pg-set-role', PG_Q, {}, pgSaw],
  ['postgres SET LOCAL ROLE (transaction)', pg, 'pg-set-local-role', PG_Q, {}, pgSaw],
  ['postgres setting read by policy (session)', pg, 'pg-guc', PG_GUC_Q, {}, pgSaw],
  ['postgres setting read by policy (SET LOCAL)', pg, 'pg-guc-local', PG_GUC_Q, {}, pgSaw],
  ['sqlserver SESSION_CONTEXT', ms, 'ms-session-context', MS_Q, { via: 'batch' }, msSaw],
  ['sqlserver SESSION_CONTEXT read_only', ms, 'ms-session-context', MS_Q, { via: 'batch', readOnlyContext: true }, msSaw],
  ['sqlserver EXECUTE AS USER', ms, 'ms-execute-as', MS_EU_Q, { via: 'batch' }, msSaw],
  ['sqlserver EXECUTE AS USER WITH COOKIE', ms, 'ms-execute-as-cookie', MS_EU_Q, { via: 'batch' }, msSaw],
  ['sqlserver EXECUTE AS USER WITH NO REVERT', ms, 'ms-execute-as-norevert', MS_EU_Q, { via: 'batch' }, msSaw],
];
for (const [label, spec, mechanism, sql, extra, seen] of plan) {
  for (const user of ['ada', 'grace']) row('matrix', label, user, await run({ spec, mechanism, user, sql, ...extra }), seen);
}
// Nobody asserted: the connection's own account, on a fresh connection.
row('matrix', 'postgres nobody asserted, record (SET ROLE table)', '-', await run({ spec: pg, mechanism: 'as-is', sql: PG_Q }), pgSaw);
row('matrix', 'postgres nobody asserted, record_guc', '-', await run({ spec: pg, mechanism: 'as-is', sql: PG_GUC_Q }), pgSaw);
row('matrix', 'sqlserver nobody asserted, record (SESSION_CONTEXT)', '-', await run({ spec: ms, mechanism: 'as-is', sql: MS_Q, via: 'batch' }), msSaw);
row('matrix', 'sqlserver nobody asserted, record_eu (EXECUTE AS)', '-', await run({ spec: ms, mechanism: 'as-is', sql: MS_EU_Q, via: 'batch' }), msSaw);
// An identity that is not an identifier is refused before anything reaches the source.
row('matrix', 'sqlserver asserted identity not an identifier', "a'--", await run({ spec: ms, mechanism: 'ms-execute-as', user: "ada'; --", sql: MS_EU_Q, via: 'batch' }), msSaw);

// ---------- 2. Can the authored query text change the identity within its own execution? ----------
// Run for Ada, whose rows are 1 and 3. Grace's row is 2: a result naming row 2 means the text moved the
// identity. Each on a fresh connection; nothing here outlives the execution.
const overrides = [
  ['postgres SET ROLE; text: RESET ROLE; SET ROLE grace', pg, 'pg-set-role', 'reset role; set role grace; select id, owner from public.record order by id', {}, pgSaw],
  ['postgres SET LOCAL ROLE; text: SET LOCAL ROLE grace', pg, 'pg-set-local-role', 'set local role grace; select id, owner from public.record order by id', {}, pgSaw],
  ['postgres setting; text: set_config app.user grace', pg, 'pg-guc-local', "select set_config('app.user','grace',true); select id, owner from public.record_guc order by id", {}, pgSaw],
  ['postgres SET LOCAL ROLE, one bound statement only', pg, 'pg-set-local-role', 'set local role grace; select id, owner from public.record where $1::int > 0 order by id', { params: [1] }, pgSaw],
  ['sqlserver SESSION_CONTEXT; text: set app_user grace', ms, 'ms-session-context', "EXEC sp_set_session_context N'app_user', N'grace'; SELECT id, owner FROM dbo.record ORDER BY id", { via: 'batch' }, msSaw],
  ['sqlserver SESSION_CONTEXT read_only; text: set grace', ms, 'ms-session-context', "EXEC sp_set_session_context N'app_user', N'grace'; SELECT id, owner FROM dbo.record ORDER BY id", { via: 'batch', readOnlyContext: true }, msSaw],
  ['sqlserver EXECUTE AS; text: REVERT; EXECUTE AS grace', ms, 'ms-execute-as', "REVERT; EXECUTE AS USER = N'grace'; SELECT id, owner FROM dbo.record_eu ORDER BY id", { via: 'batch' }, msSaw],
  ['sqlserver EXECUTE AS; text: EXECUTE AS grace (nested)', ms, 'ms-execute-as', "EXECUTE AS USER = N'grace'; SELECT id, owner FROM dbo.record_eu ORDER BY id", { via: 'batch' }, msSaw],
  ['sqlserver WITH COOKIE; text: REVERT; EXECUTE AS grace', ms, 'ms-execute-as-cookie', "REVERT; EXECUTE AS USER = N'grace'; SELECT id, owner FROM dbo.record_eu ORDER BY id", { via: 'batch' }, msSaw],
  ['sqlserver WITH NO REVERT; text: REVERT; EXECUTE AS grace', ms, 'ms-execute-as-norevert', "REVERT; EXECUTE AS USER = N'grace'; SELECT id, owner FROM dbo.record_eu ORDER BY id", { via: 'batch' }, msSaw],
];
for (const [label, spec, mechanism, sql, extra, seen] of overrides) row('override', label, 'ada', await run({ spec, mechanism, user: 'ada', sql, ...extra }), seen);

// ---------- 3. HTTP: delegated token by RFC 8693 exchange ----------
async function providerToken(sub, issuer = 'tenant') {
  const r = await post(CALLER, '/svc/idp', { path: '/token', form: { grant_type: 'urn:spike:signin', sub, scope: 'openid', issuer } });
  return r.json.access_token;
}
const ada = await providerToken('ada');
const grace = await providerToken('grace');
const adaGoogle = await providerToken('ada', 'google');
for (const [user, tok] of [['ada', ada], ['grace', grace]]) {
  row('http', 'http delegated (exchanged, audience fake-api)', user, await run({ spec: httpDelegated, mechanism: 'http-delegated', subjectToken: tok }), httpSaw);
}
row('http', 'http service account (the connection\'s own bearer)', '-', await run({ spec: httpService, mechanism: 'http-service' }), httpSaw);
row('http', 'http provider token straight to the source', 'ada', await run({ spec: httpDelegated, mechanism: 'http-raw-subject', subjectToken: ada }), httpSaw);
row('http', 'http delegated, Google-route token', 'ada', await run({ spec: httpDelegated, mechanism: 'http-delegated', subjectToken: adaGoogle }), httpSaw);
row('http', 'http delegated, no token presented', 'ada', await run({ spec: httpDelegated, mechanism: 'http-delegated' }), httpSaw);
row('http', 'http delegated, wrong client secret', 'ada', await run({ spec: { ...httpDelegated, connectionId: 'conn-http-bad', sealedSecret: seal(T, 'not-the-client-secret') }, mechanism: 'http-delegated', subjectToken: ada, cacheExchange: false }), httpSaw);

// The exchanged token as the source received it: decode the one the exchange issues for Ada.
const ex = await fetch('http://127.0.0.1:15707/as-user/counters').then((r) => r.json());
report.counts.connector = ex;

// ---------- 4. Postgres: the connection account's own authority, with and without INHERIT ----------
// By default (PostgreSQL 16+) `grant ada to connector_login` is WITH INHERIT TRUE, so connector_login
// holds ada's and grace's SELECT itself, and a query nobody asserted for is not refused - the policy just
// matches no row. Granting membership WITH INHERIT FALSE, SET TRUE keeps SET ROLE and removes the
// standing privilege. Measured both ways, then put back as the init script has it.
const psql = (sql) => execFileSync('docker', ['exec', 'aw-data-connectors-source-pg-1', 'psql', '-U', 'postgres', '-d', 'sourcedb', '-tAc', sql],
  { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8', timeout: 20000 }).trim();
report.inherit = { default: psql("select has_table_privilege('connector_login','public.record','select')") };
psql('revoke ada, grace from connector_login; grant ada, grace to connector_login with inherit false, set true');
report.inherit.inheritFalse = psql("select has_table_privilege('connector_login','public.record','select')");
row('matrix', 'postgres INHERIT FALSE: nobody asserted, record', '-', await run({ spec: pg, mechanism: 'as-is', sql: PG_Q }), pgSaw);
for (const user of ['ada', 'grace']) row('matrix', 'postgres INHERIT FALSE: SET LOCAL ROLE', user, await run({ spec: pg, mechanism: 'pg-set-local-role', user, sql: PG_Q }), pgSaw);
psql('revoke ada, grace from connector_login; grant ada, grace to connector_login');
report.inherit.restored = psql("select has_table_privilege('connector_login','public.record','select')");
console.log('inherit', JSON.stringify(report.inherit));

// Who the source trusts, for each database: the connection account's standing authority.
report.counts.note = 'connector_login is a member of role ada and role grace (Postgres); holds IMPERSONATE on users ada and grace (SQL Server)';
writeFileSync('dcp2-case3.json', JSON.stringify(report, null, 2));
console.log('\nconnector counters', JSON.stringify(ex));
