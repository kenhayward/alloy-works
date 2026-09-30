// Phase 3, case 7: limits that fail rather than truncate.
//   bash run.sh case7.mjs --memory 3g         everything; readers each run in a child process so each
//                                            one's peak memory is its own (children: --max-old-space-size=1024)
//   (internally: node case7.mjs child <scenario>)
// Nothing expanded is written to disk: every large input is generated in memory from a generator.
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import tedious from 'tedious';
import { NamedFailure } from './lib/types.mjs';
import { httpBounded, csvBounded, pgRowLimit, pgByteLimit, msBounded } from './lib/limits.mjs';
import { readXlsx } from './lib/xlsx-own.mjs';
import { xlsxOfRows, xlsxSharedStringBomb, csvRowsGen, csvOneLineGen } from './lib/bombs.mjs';
import {
  pgClient,
  msConnect,
  msQuery,
  msClose,
  PG_CONNECTOR,
  PG_OBSERVER,
  MS_OBSERVER,
} from './lib/db3.mjs';
const require = createRequire(import.meta.url);
const { Request } = tedious;

const MB = 1024 * 1024;
const L = 10 * MB; // the byte limit every reader is held to
const ROWS = 100000; // the row limit for files
const API = 'http://127.0.0.1:18082';

// ================================================================ child: one reader, one input
async function child(name) {
  const t0 = Date.now();
  let result;
  try {
    result = { outcome: 'ok', ...(await SCENARIOS[name]()) };
  } catch (e) {
    result = {
      outcome: e instanceof NamedFailure ? `failed:${e.code}` : `error:${e.code ?? e.name}`,
      message: String(e.message).slice(0, 160),
    };
  }
  result.ms = Date.now() - t0;
  result.maxRSSMB = Math.round(process.resourceUsage().maxRSS / 1024);
  process.send(result);
}
const SCENARIOS = {
  // CSV
  'csv own, at the limit': () => csvBounded(csvRowsGen(L - 1000), { maxBytes: L, maxRows: 1e9 }),
  'csv own, 10x the limit': () => csvBounded(csvRowsGen(10 * L), { maxBytes: L, maxRows: 1e9 }),
  'csv own, one 100 MB line': () =>
    csvBounded(csvOneLineGen(10 * L), { maxBytes: 100 * L, maxRecordBytes: L, maxRows: 1e9 }),
  'csv own, 10x, row limit 100000': () =>
    csvBounded(csvRowsGen(10 * L), { maxBytes: 100 * L, maxRows: ROWS }),
  'csv whole-file read, 10x': async () => {
    const chunks = [];
    for (const c of csvRowsGen(10 * L)) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8');
    const rows = require('csv-parse/sync').parse(text, { from_line: 2 });
    if (text.length > L)
      throw new NamedFailure('size_limit', 'checked after reading the whole file');
    return { rows: rows.length };
  },
  // XLSX, our reader
  'xlsx own, at the limit': async () => {
    const b = await xlsxOfRows(L - 20000);
    let n = 0;
    const r = readXlsx(b, { maxBytes: L, maxRows: 1e9, onRow: () => n++ });
    return { rows: n, fileBytes: b.length, inflated: r.inflated };
  },
  'xlsx own, 10x the limit': async () => {
    const b = await xlsxOfRows(10 * L);
    let n = 0;
    const r = readXlsx(b, { maxBytes: L, maxRows: 1e9, onRow: () => n++ });
    return { rows: n, fileBytes: b.length };
  },
  'xlsx own, 1 GB sheet bomb': async () => {
    const b = await xlsxOfRows(1000 * MB);
    let n = 0;
    readXlsx(b, { maxBytes: L, maxRows: 1e9, onRow: () => n++ });
    return { rows: n, fileBytes: b.length };
  },
  'xlsx own, 600 MB shared string': async () => {
    const b = await xlsxSharedStringBomb(600 * MB);
    readXlsx(b, { maxBytes: L });
    return { fileBytes: b.length };
  },
  'xlsx own, 10x, row limit 100000': async () => {
    const b = await xlsxOfRows(10 * L);
    let n = 0;
    readXlsx(b, { maxBytes: 1e12, maxRows: ROWS, onRow: () => n++ });
    return { rows: n };
  },
  'xlsx own, 1 GB sheet, row limit only': async () => {
    const b = await xlsxOfRows(1000 * MB);
    let n = 0;
    readXlsx(b, { maxBytes: 1e12, maxRows: ROWS, onRow: () => n++ });
    return { rows: n };
  },
  // XLSX, ExcelJS (whole workbook, then streaming)
  'xlsx ExcelJS load, at the limit': async () => {
    const b = await xlsxOfRows(L - 20000);
    const E = require('exceljs');
    const wb = new E.Workbook();
    await wb.xlsx.load(b);
    return { rows: wb.worksheets[0].rowCount, fileBytes: b.length };
  },
  'xlsx ExcelJS load, 10x the limit': async () => {
    const b = await xlsxOfRows(10 * L);
    const E = require('exceljs');
    const wb = new E.Workbook();
    await wb.xlsx.load(b);
    return { rows: wb.worksheets[0].rowCount };
  },
  'xlsx ExcelJS load, 1 GB sheet bomb': async () => {
    const b = await xlsxOfRows(1000 * MB);
    const E = require('exceljs');
    const wb = new E.Workbook();
    await wb.xlsx.load(b);
    return { rows: wb.worksheets[0].rowCount };
  },
  'xlsx ExcelJS stream, 1 GB sheet bomb, row limit': async () =>
    excelStream(await xlsxOfRows(1000 * MB)),
  'xlsx ExcelJS stream, 600 MB shared string': async () =>
    excelStream(await xlsxSharedStringBomb(600 * MB)),
  // XLSX, SheetJS 0.18.5
  'xlsx SheetJS read, at the limit': async () => {
    const b = await xlsxOfRows(L - 20000);
    const X = require('xlsx');
    const wb = X.read(b, { type: 'buffer', dense: true });
    return { sheets: wb.SheetNames.length };
  },
  'xlsx SheetJS read, 10x the limit': async () => {
    const b = await xlsxOfRows(10 * L);
    const X = require('xlsx');
    return sheetJsSummary(X.read(b, { type: 'buffer', dense: true }));
  },
  'xlsx SheetJS read, 1 GB sheet bomb': async () => {
    const b = await xlsxOfRows(1000 * MB);
    const X = require('xlsx');
    const wb = X.read(b, { type: 'buffer', dense: true });
    return sheetJsSummary(wb);
  },
  'xlsx SheetJS read, 600 MB shared string': async () => {
    const b = await xlsxSharedStringBomb(600 * MB);
    const X = require('xlsx');
    const wb = X.read(b, { type: 'buffer', dense: true });
    return sheetJsSummary(wb);
  },
  // HTTP (the fake source runs in the parent)
  'http gzip, 1 GB expanded, counted': () =>
    httpBounded(`${API}/gzip?bytes=${1000 * MB}`, { maxBytes: L, timeoutMs: 60000 }).then((r) => ({
      bytes: r.bytes,
    })),
  'http gzip, 1 GB expanded, res.text()': async () => {
    const r = await fetch(`${API}/gzip?bytes=${1000 * MB}`);
    const t = await r.text();
    if (t.length > L) throw new NamedFailure('size_limit', 'checked after reading the whole body');
    return {};
  },
  'http 100 MB, counted, length not trusted': () =>
    httpBounded(`${API}/big?bytes=${10 * L}`, {
      maxBytes: L,
      timeoutMs: 60000,
      trustLength: false,
    }).then((r) => ({ bytes: r.bytes })),
  // Databases: one value larger than the whole byte limit
  'pg one 100 MB value, byte limit 10 MB': async () => {
    const c = await pgClient();
    try {
      return await pgByteLimit(c, "select repeat('x', 104857600) as v", L);
    } finally {
      await c.end();
    }
  },
  'mssql one 100 MB value, byte limit 10 MB': async () => {
    const c = await msConnect();
    try {
      return await msBounded(
        c,
        Request,
        "select replicate(cast('x' as varchar(max)), 104857600) as v",
        { maxBytes: L },
      );
    } finally {
      msClose(c);
    }
  },
};
// What SheetJS handed back: which sheets, how many rows it holds, and the first cell.
function sheetJsSummary(wb) {
  const ws = wb.Sheets?.[wb.SheetNames?.[0]];
  if (!ws) return { sheetNames: wb.SheetNames, sheetsHeld: Object.keys(wb.Sheets ?? {}) };
  const data = Array.isArray(ws) ? ws : ws['!data'];
  const first = data ? data[0]?.[0] : ws.A1;
  return {
    sheetNames: wb.SheetNames,
    ref: ws['!ref'],
    rowsHeld: data ? data.length : null,
    firstCell: first ? { t: first.t, length: String(first.v).length } : null,
  };
}
async function excelStream(buf) {
  const E = require('exceljs');
  const reader = new E.stream.xlsx.WorkbookReader(Readable.from([buf]), {
    sharedStrings: 'cache',
    worksheets: 'emit',
    hyperlinks: 'ignore',
    styles: 'ignore',
  });
  let n = 0;
  for await (const ws of reader) {
    for await (const _row of ws) {
      if (++n > ROWS) throw new NamedFailure('row_limit', `more than ${ROWS} rows`);
    }
  }
  return { rows: n };
}

// ================================================================ parent
function runChild(name) {
  return new Promise((resolve) => {
    const c = fork(new URL(import.meta.url).pathname, ['child', name], {
      execArgv: ['--max-old-space-size=1024'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let msg = null;
    let err = '';
    c.stderr.on('data', (d) => {
      err += d;
      if (err.length > 4000) err = err.slice(-4000);
    });
    c.on('message', (m) => {
      msg = m;
    });
    const kill = setTimeout(() => c.kill('SIGKILL'), 180000);
    c.on('exit', (code, signal) => {
      clearTimeout(kill);
      resolve(
        msg ?? {
          outcome: `crashed (exit ${code}${signal ? ', ' + signal : ''})`,
          stderr: err
            .split('\n')
            .filter((l) => /FATAL|Error|RangeError|heap/.test(l))
            .slice(0, 3)
            .join(' | ')
            .slice(0, 300),
        },
      );
    });
  });
}
function startApi() {
  return new Promise((resolve) => {
    const child = fork('./fake-data-api.mjs', [], {
      env: { ...process.env, PORT: '18082' },
      stdio: 'ignore',
    });
    child.on('message', (m) => m.ready && resolve(child));
  });
}
async function tryIt(fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { outcome: 'ok', ms: Date.now() - t0, ...r };
  } catch (e) {
    return {
      outcome: e instanceof NamedFailure ? `failed:${e.code}` : `error:${e.code ?? e.name}`,
      message: String(e.message).slice(0, 140),
      ms: Date.now() - t0,
      ...(e.fetched ? { fetched: e.fetched } : {}),
      ...(e.rows !== undefined
        ? { rows: e.rows, rowsAfterCancel: e.rowsAfterCancel, driver: e.driver }
        : {}),
    };
  }
}

// Poll a server's own list of running statements for one session until it leaves (or give up).
async function pgWatch(obs, pid, fromMs, giveUpMs) {
  const t0 = Date.now();
  for (;;) {
    const r = await obs.query(
      "select state, left(query, 40) as q from pg_stat_activity where pid = $1 and state = 'active'",
      [pid],
    );
    if (!r.rows.length) return { goneAfterMs: Date.now() - fromMs };
    if (Date.now() - t0 > giveUpMs)
      return { stillRunningAfterMs: Date.now() - fromMs, query: r.rows[0].q };
    await new Promise((s) => setTimeout(s, 20));
  }
}
async function msWatch(obs, spid, fromMs, giveUpMs) {
  const t0 = Date.now();
  for (;;) {
    const r = await msQuery(
      obs,
      `select status, command from sys.dm_exec_requests where session_id = ${spid}`,
    );
    if (!r.rows.length) return { goneAfterMs: Date.now() - fromMs };
    if (Date.now() - t0 > giveUpMs)
      return {
        stillRunningAfterMs: Date.now() - fromMs,
        command: r.rows[0].command,
        status: r.rows[0].status,
      };
    await new Promise((s) => setTimeout(s, 20));
  }
}

async function pgTimeouts() {
  const out = {};
  const obs = await pgClient(PG_OBSERVER);
  const SLEEP = 'select pg_sleep(20)';
  const CPU = 'select sum(i) from (select generate_series(1, 20000000000::bigint) as i) s'; // value-per-call: nothing spills to disk
  const cases = {
    "pg's own query_timeout (client side) only": { cfg: { query_timeout: 1000 }, sql: SLEEP },
    'statement_timeout (server side)': { pre: 'set statement_timeout = 1000', sql: SLEEP },
    'statement_timeout, CPU-bound query': { pre: 'set statement_timeout = 1000', sql: CPU },
    'our timer, then pg_cancel_backend from a second connection': { own: 'cancel', sql: SLEEP },
    'our timer, then the socket destroyed': { own: 'destroy', sql: SLEEP },
    'our timer, socket destroyed, CPU-bound': { own: 'destroy', sql: CPU },
    'our timer, socket destroyed, client_connection_check_interval 250ms': {
      own: 'destroy',
      pre: 'set client_connection_check_interval = 250',
      sql: SLEEP,
    },
    'our timer, socket destroyed, CPU-bound, check interval 250ms': {
      own: 'destroy',
      pre: 'set client_connection_check_interval = 250',
      sql: CPU,
    },
  };
  for (const [name, k] of Object.entries(cases)) {
    const c = await pgClient(PG_CONNECTOR, k.cfg ?? {});
    c.on('error', () => {});
    const pid = (await c.query('select pg_backend_pid() as p')).rows[0].p;
    if (k.pre) await c.query(k.pre);
    const t0 = Date.now();
    let limitAt = null;
    let err = null;
    const q = c.query(k.sql).then(
      () => 'completed',
      (e) => {
        err = e;
        limitAt ??= Date.now();
        return `error: ${e.code ?? ''} ${e.message.slice(0, 60)}`;
      },
    );
    let timer;
    if (k.own)
      timer = setTimeout(async () => {
        limitAt = Date.now();
        if (k.own === 'cancel') {
          const c2 = await pgClient();
          await c2.query('select pg_cancel_backend($1)', [pid]);
          await c2.end();
        } else c.connection.stream.destroy();
      }, 1000);
    const clientSaw = await Promise.race([
      q,
      new Promise((r) => setTimeout(() => r('still waiting at 3 s'), 3000)),
    ]);
    const watch = await pgWatch(obs, pid, limitAt ?? t0 + 1000, 4000);
    out[name] = { clientSaw, clientMs: (limitAt ?? Date.now()) - t0, ...watch };
    clearTimeout(timer);
    await obs.query('select pg_terminate_backend($1)', [pid]); // clean up whatever is left
    await c.end().catch(() => {});
  }
  await obs.end();
  return out;
}

async function msTimeouts() {
  const out = {};
  const obs = await msConnect(MS_OBSERVER);
  const SLEEP = "waitfor delay '00:00:20'";
  const CPU = 'declare @i bigint = 0; while @i < 10000000000 set @i += 1;'; // a batch that only burns CPU
  const cases = {
    "tedious's requestTimeout 1 s": { cfg: { requestTimeout: 1000 }, sql: SLEEP },
    "tedious's requestTimeout 1 s, CPU-bound": { cfg: { requestTimeout: 1000 }, sql: CPU },
    'our timer, then connection.cancel()': { own: 'cancel', sql: SLEEP },
    'our timer, then the socket destroyed': { own: 'destroy', sql: SLEEP },
    'our timer, socket destroyed, CPU-bound': { own: 'destroy', sql: CPU },
  };
  for (const [name, k] of Object.entries(cases)) {
    const c = await msConnect(undefined, { requestTimeout: 60000, ...(k.cfg ?? {}) });
    const spid = (await msQuery(c, 'select @@spid as s')).rows[0].s;
    const t0 = Date.now();
    let limitAt = null;
    const q = msQuery(c, k.sql).then(
      () => 'completed',
      (e) => {
        limitAt ??= Date.now();
        return `error: ${e.code ?? ''} ${e.message.slice(0, 60)}`;
      },
    );
    let timer;
    if (k.own)
      timer = setTimeout(() => {
        limitAt = Date.now();
        if (k.own === 'cancel') c.cancel();
        else c.socket?.destroy();
      }, 1000);
    const clientSaw = await Promise.race([
      q,
      new Promise((r) => setTimeout(() => r('still waiting at 3 s'), 3000)),
    ]);
    const watch = await msWatch(obs, spid, limitAt ?? t0 + 1000, 4000);
    out[name] = { clientSaw, clientMs: (limitAt ?? Date.now()) - t0, ...watch };
    clearTimeout(timer);
    try {
      await msQuery(obs, `kill ${spid}`);
    } catch {}
    msClose(c);
  }
  msClose(obs);
  return out;
}

async function parent() {
  const out = { byteLimitMB: L / MB, fileRowLimit: ROWS };
  if (process.env.ONLY) {
    const api = await startApi();
    out.readers = {};
    for (const name of Object.keys(SCENARIOS).filter((n) => n.includes(process.env.ONLY)))
      out.readers[name] = await runChild(name);
    api.kill();
    console.log(JSON.stringify(out, null, 1));
    return;
  }
  // Databases: row and byte limits.
  const pgc = await pgClient();
  out.pgRowLimit = await tryIt(() =>
    pgRowLimit(pgc, 'select id, payload from many order by id', 1000).then((r) => ({
      rows: r.length,
    })),
  );
  out.pgRowLimitExact = await tryIt(() =>
    pgRowLimit(pgc, 'select id, payload from many where id <= 1000 order by id', 1000).then(
      (r) => ({ rows: r.length }),
    ),
  );
  out.pgByteLimit = await tryIt(() =>
    pgByteLimit(pgc, 'select id, payload from many order by id', 1 * MB),
  );
  await pgc.end();
  for (const [k, opts] of [
    ['mssqlRowLimit', { maxRows: 1000 }],
    ['mssqlByteLimit', { maxBytes: 1 * MB }],
  ]) {
    const c = await msConnect();
    const spid = (await msQuery(c, 'select @@spid as s')).rows[0].s;
    const obs = await msConnect(MS_OBSERVER);
    out[k] = await tryIt(() =>
      msBounded(c, Request, 'select id, payload from dbo.many order by id', opts),
    );
    out[k].afterwards = await msWatch(obs, spid, Date.now(), 2000);
    msClose(obs);
    msClose(c);
  }
  // Timeouts, and whether the source stops.
  out.pgTimeouts = await pgTimeouts();
  out.msTimeouts = await msTimeouts();
  // HTTP, in this process.
  const api = await startApi();
  out.http = {
    'declared length over the limit': await tryIt(() =>
      httpBounded(`${API}/big?bytes=${10 * L}`, { maxBytes: L, timeoutMs: 10000 }),
    ),
    'within the limit': await tryIt(() =>
      httpBounded(`${API}/big?bytes=${L - 100}`, { maxBytes: L, timeoutMs: 10000 }).then((r) => ({
        bytes: r.bytes,
      })),
    ),
    'length claims 10, body is 1000': await tryIt(() =>
      httpBounded(`http://127.0.0.1:18083/?claim=10&bytes=1000`, {
        maxBytes: L,
        timeoutMs: 5000,
      }).then((r) => ({ bytes: r.bytes })),
    ),
    'length claims 1000, body is 10': await tryIt(() =>
      httpBounded(`http://127.0.0.1:18083/?claim=1000&bytes=10`, {
        maxBytes: L,
        timeoutMs: 5000,
      }).then((r) => ({ bytes: r.bytes })),
    ),
    'a byte every 100 ms for 10 s, deadline 2 s': await tryIt(() =>
      httpBounded(`${API}/drip?bytes=100&everyMs=100`, { maxBytes: L, timeoutMs: 2000 }).then(
        (r) => ({ bytes: r.bytes }),
      ),
    ),
    'the same with fetch defaults and no deadline': await tryIt(async () => {
      const r = await fetch(`${API}/drip?bytes=100&everyMs=100`);
      const t = await r.text();
      return { bytes: t.length };
    }),
    'headers after 5 s, deadline 2 s': await tryIt(() =>
      httpBounded(`${API}/slow?ms=5000`, { maxBytes: L, timeoutMs: 2000 }),
    ),
  };
  // Readers, each in its own process, for memory.
  out.readers = {};
  for (const name of Object.keys(SCENARIOS)) out.readers[name] = await runChild(name);
  api.kill();
  console.log(JSON.stringify(out, null, 1));
}

if (process.argv[2] === 'child') {
  // HTTP scenarios need the fake source; the parent keeps one running for them.
  await child(process.argv[3]);
  process.exit(0);
} else {
  await parent();
  process.exit(0);
}
