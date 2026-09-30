// Phase 3, case 6: one logical result from every source, canonicalised and checksummed.
//   bash run.sh case6.mjs                              everything (MODE=full), in UTC
//   bash run.sh case6.mjs -e MODE=tz -e TZ=Pacific/Kiritimati   just the checksums, in another zone
// Prints one JSON document.
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import pg from 'pg';
import { parse as csvParse } from 'csv-parse/sync';
import { COLUMNS, EXPECTED, csvText, workbook, dataSheet, probeSheet, PROBES } from './lib/fixtures.mjs';
import { canonicalRows, checksum, jcs, document } from './lib/canon.mjs';
import { NamedFailure } from './lib/types.mjs';
import { readXlsx, serialDate, serialParts } from './lib/xlsx-own.mjs';
import { pgClient, msConnect, msQuery, msClose, PG_CONNECTOR } from './lib/db3.mjs';
const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

const MODE = process.env.MODE ?? 'full';
const out = { tz: process.env.TZ ?? 'UTC', node: process.version, expectedChecksum: checksum(COLUMNS, EXPECTED) };
const TYPE = Object.fromEntries(COLUMNS.map((c) => [c.name, c]));

// Canonicalise a source's rows and report the checksum, or the named failure, and which cells differ.
function score(label, rawRows) {
  try {
    const rows = canonicalRows(COLUMNS, typeof rawRows === 'function' ? rawRows() : rawRows, label);
    const sum = checksum(COLUMNS, rows);
    const diff = [];
    rows.forEach((r, i) => r.forEach((v, j) => { if (JSON.stringify(v) !== JSON.stringify(EXPECTED[i]?.[j])) diff.push(`${COLUMNS[j].name}[${i + 1}]: ${JSON.stringify(v)} != ${JSON.stringify(EXPECTED[i]?.[j])}`); }));
    return { checksum: sum, matches: sum === out.expectedChecksum, diff };
  } catch (e) {
    if (e instanceof NamedFailure) return { refused: e.code, message: e.message };
    throw e;
  }
}
// The same, with no canonical form: the driver's values put through JSON.stringify, as a connector
// that trusted its driver would store them.
const naive = (rows) => require('node:crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex');

// ---------------------------------------------------------------- PostgreSQL
const SELECT = 'select k, dec, big, amount, d, ldt, inst, tm, flag, note, empty, txt from typed_result order by k';
const RAW = (v) => v;
async function pgRows(textMode) {
  const types = textMode ? { getTypeParser: () => RAW } : undefined;
  const c = await pgClient(PG_CONNECTOR, types ? { types } : {});
  if (textMode) await c.query("set timezone = 'UTC'; set datestyle = 'ISO, YMD'");
  const r = await c.query({ text: SELECT, rowMode: 'array' });
  await c.end();
  return r.rows;
}
// Text mode: every value is the server's own text; the adapter only reads booleans.
const pgText = (rows) => rows.map((r) => r.map((v, j) => (COLUMNS[j].type === 'boolean' && v !== null ? v === 't' : v)));
// Driver mode: what pg hands back by default, read as carefully as its types allow.
const localParts = (d) => { const p = (n, w = 2) => String(n).padStart(w, '0'); return { date: `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}` }; };
const pgDriver = (rows) => rows.map((r) => r.map((v, j) => {
  if (v === null) return null;
  const t = COLUMNS[j].type;
  if (v instanceof Date) {
    if (t === 'date') return localParts(v).date;
    if (t === 'localdatetime') { const p = localParts(v); return `${p.date}T${p.time}`; }
    return v.toISOString();
  }
  return typeof v === 'number' ? String(v) : v;
}));

// ---------------------------------------------------------------- SQL Server
const MS_SELECT = 'select k, dec, big, amount, d, ldt, inst, tm, flag, note, empty, txt from dbo.typed_result order by k';
const MS_SELECT_TEXT = `select k, cast(dec as nvarchar(50)) as dec, cast(big as nvarchar(30)) as big, cast(amount as nvarchar(50)) as amount,
  convert(nvarchar(10), d, 23) as d, convert(nvarchar(30), ldt, 126) as ldt, convert(nvarchar(40), inst, 127) as inst,
  cast(tm as nvarchar(20)) as tm, flag, note, empty, txt from dbo.typed_result order by k`;
async function msRows(sql) {
  const c = await msConnect();
  const metaHolder = {};
  const res = await msQuery(c, sql, [], { onMeta: (m) => { metaHolder.m = m; } });
  msClose(c);
  return { rows: res.rows.map((r) => Object.values(r)), meta: metaHolder.m, dates: res.rows };
}
// tedious: decimals arrive as JavaScript numbers. Exact only while the unscaled integer is below 2^53;
// past it the connector cannot know the digits, so it refuses by name rather than round.
function tediousAdapter(rows, meta) {
  return rows.map((r) => r.map((v, j) => {
    if (v === null) return null;
    const m = meta[j]; const t = COLUMNS[j].type;
    if (m.type === 'Decimal' || m.type === 'Numeric' || m.type === 'DecimalN' || m.type === 'NumericN' || m.type === 'Money' || m.type === 'MoneyN') {
      const scale = m.scale ?? 4; const unscaled = Math.round(v * 10 ** scale);
      if (!Number.isSafeInteger(unscaled)) throw new NamedFailure('precision_lost', `${COLUMNS[j].name}: the driver returned a ${m.type}(${m.precision},${scale}) as a binary float whose digits it cannot carry (${v}).`);
      const s = String(Math.abs(unscaled)).padStart(scale + 1, '0');
      return (unscaled < 0 ? '-' : '') + s.slice(0, s.length - scale) + (scale ? '.' + s.slice(-scale) : '');
    }
    if (v instanceof Date) {
      const iso = v.toISOString(); // useUTC: the value's own fields, read as UTC
      const extra = Math.round((v.nanosecondsDelta ?? 0) * 1e7); // tedious keeps sub-millisecond digits here
      const frac = iso.slice(20, 23) + String(extra).padStart(4, '0');
      if (t === 'date') return iso.slice(0, 10);
      if (t === 'time') return `${iso.slice(11, 19)}.${frac}`;
      if (t === 'localdatetime') return `${iso.slice(0, 19)}.${frac}`;
      if (t === 'instant') return `${iso.slice(0, 19)}.${frac}Z`;
    }
    return typeof v === 'number' ? String(v) : v;
  }));
}
const msDriverNaive = (rows) => rows.map((r) => r.map((v) => (v instanceof Date ? v.toISOString() : v)));

// ---------------------------------------------------------------- JSON over HTTP
function startApi() {
  return new Promise((resolve) => {
    const child = fork('./fake-data-api.mjs', [], { env: { ...process.env, PORT: '18081' }, stdio: 'ignore' });
    child.on('message', (m) => m.ready && resolve(child));
  });
}
// Exact: a number is read by the digits the server sent (JSON.parse's source text), never as a double.
function jsonExact(text) {
  return JSON.parse(text, function (k, v, ctx) { return typeof v === 'number' ? ctx.source : v; }).rows;
}
const jsonNaive = (text) => JSON.parse(text).rows;

// ---------------------------------------------------------------- CSV
function csvRows(text, { honourQuoting }) {
  const recs = csvParse(text, { bom: true, from_line: 2, relax_column_count: false,
    cast: (value, ctx) => (honourQuoting ? (ctx.quoting ? value : value === '' ? null : value) : value) });
  return recs.map((r) => r.map((v, j) => (COLUMNS[j].type === 'boolean' && v !== null && v !== '' ? v === 'true' : v)));
}

// ---------------------------------------------------------------- XLSX
// A cell -> a value `canon` accepts, by the declared column type. The format is presentation; the
// declaration decides what a number means.
function xlsxCell(c, col, date1904) {
  if (c === null || c === undefined) return null;
  if (c.kind === 'error') throw new NamedFailure('cell_error', `${col.name}: the cell holds the error ${c.v}.`);
  if (c.kind === 'string') return c.v;
  if (c.kind === 'boolean') return c.v;
  const n = Number(c.v);
  switch (col.type) {
    case 'integer': if (!Number.isSafeInteger(n)) throw new NamedFailure('precision_lost', `${col.name}: ${c.v} is a number cell beyond 2^53, which a spreadsheet stores as a double.`); return String(n);
    case 'decimal': return n; // the shortest text that round-trips the double
    case 'date': if (!Number.isInteger(n)) throw new NamedFailure('type', `${col.name}: a date cell carries a time.`); return serialDate(n, date1904);
    case 'localdatetime': { const p = serialParts(c.v, date1904, col.precision ?? 6); return `${serialDate(p.days, date1904)}T${p.time}`; }
    case 'time': { if (n >= 1) throw new NamedFailure('type', `${col.name}: a time cell carries a date.`); return serialParts(c.v, date1904, col.precision ?? 6).time; }
    case 'instant': throw new NamedFailure('zone_missing', `${col.name}: a spreadsheet's date-time has no zone, so it is not an instant.`);
    case 'boolean': throw new NamedFailure('type', `${col.name}: a number is not a boolean.`);
    default: throw new NamedFailure('type', `${col.name}: a number cell in a text column.`);
  }
}
const xlsxAdapt = (rows, date1904) => rows.slice(1).map((r) => COLUMNS.map((col, j) => xlsxCell(r[j] ?? null, col, date1904)));

// ExcelJS's values -> the same cell shape.
async function excelJsCells(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const r = [];
    for (let j = 1; j <= COLUMNS.length; j++) r.push(row.getCell(j).value);
    rows.push(r);
  });
  return { rows, date1904: wb.properties?.date1904 ?? null, probes: wb.worksheets[1] ? [...Array(PROBES.length)].map((_, j) => describe(wb.worksheets[1].getRow(2).getCell(j + 1).value)) : null };
}
function describe(v) {
  if (v instanceof Date) return { Date: v.toISOString() };
  return v;
}
function excelJsAdapt(rows) {
  return rows.slice(1).map((r) => COLUMNS.map((col, j) => {
    let v = r[j];
    if (v === null || v === undefined) return null;
    if (typeof v === 'object' && 'formula' in v) v = v.result ?? null;
    if (typeof v === 'object' && v?.richText) v = v.richText.map((x) => x.text).join('');
    if (typeof v === 'object' && v?.error) throw new NamedFailure('cell_error', v.error);
    if (v instanceof Date) {
      const iso = v.toISOString();
      if (col.type === 'date') return iso.slice(0, 10);
      if (col.type === 'localdatetime') return iso.slice(0, 23);
      if (col.type === 'time') return iso.slice(11, 23);
      throw new NamedFailure('zone_missing', `${col.name}: a spreadsheet's date-time has no zone.`);
    }
    if (typeof v === 'number') return xlsxCell({ kind: 'number', v: String(v) }, col, false);
    return v;
  }));
}

// SheetJS 0.18.5 (the npm registry's copy), raw values: numbers stay serials, which we convert.
function sheetJsCells(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    const r = [];
    for (let C = 0; C < COLUMNS.length; C++) {
      const c = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!c) { r.push(null); continue; }
      r.push(c.t === 'n' ? { kind: 'number', v: String(c.v) } : c.t === 's' || c.t === 'str' ? { kind: 'string', v: c.v } : c.t === 'b' ? { kind: 'boolean', v: c.v } : c.t === 'e' ? { kind: 'error', v: c.w } : c.t === 'z' ? null : { kind: 'string', v: String(c.v) });
    }
    rows.push(r);
  }
  const ps = wb.Sheets[wb.SheetNames[1]];
  const probes = ps ? PROBES.map((_, j) => { const c = ps[XLSX.utils.encode_cell({ r: 1, c: j })]; return c ? { t: c.t, v: c.v, w: c.w } : null; }) : null;
  return { rows, date1904, probes, formatted: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]] ?? ws, { header: 1, raw: false })[1] };
}

// ---------------------------------------------------------------- run
const book1900 = workbook([dataSheet(false), probeSheet()]);
const book1904 = workbook([dataSheet(true)], { date1904: true });
const sources = {};
async function allSources() {
  const pgT = await pgRows(true); const pgD = await pgRows(false);
  sources['pg (server text)'] = score('pg', pgText(pgT));
  sources['pg (driver defaults)'] = score('pg-driver', pgDriver(pgD));
  sources['pg (driver defaults, naive JSON)'] = { naiveChecksum: naive(pgD) };
  const ms = await msRows(MS_SELECT);
  sources['mssql (tedious types)'] = score('mssql', () => tediousAdapter(ms.rows, ms.meta));
  sources['mssql (tedious types), cell by cell'] = ms.rows.flatMap((r, i) => r.map((v, j) => { try { tediousAdapter([[...Array(j).fill(null), v]], ms.meta); return null; } catch (e) { return `${COLUMNS[j].name}[${i + 1}] ${e.code}`; } })).filter(Boolean);
  sources['mssql (tedious types, naive JSON)'] = { naiveChecksum: naive(msDriverNaive(ms.rows)) };
  const mst = await msRows(MS_SELECT_TEXT);
  sources['mssql (text cast in the query)'] = score('mssql-text', mst.rows);
  const api = await startApi();
  for (const path of ['typed-strings', 'typed-numbers']) {
    const text = await (await fetch(`http://127.0.0.1:18081/${path}`)).text();
    sources[`http ${path} (exact reader)`] = score('http', jsonExact(text));
    sources[`http ${path} (JSON.parse)`] = score('http', jsonNaive(text));
    if (path === 'typed-numbers') sources['http typed-numbers (JSON.parse), decimal columns alone'] = jsonNaive(text).map((r, i) => { const got = canonicalRows([TYPE.dec, TYPE.amount], [[r[1], r[3]]])[0]; return { row: i + 1, got, expected: [EXPECTED[i][1], EXPECTED[i][3]], silent: JSON.stringify(got) !== JSON.stringify([EXPECTED[i][1], EXPECTED[i][3]]) }; });
  }
  api.kill();
  sources['csv (quoting read)'] = score('csv', csvRows(csvText(), { honourQuoting: true }));
  sources['csv (quoting ignored)'] = score('csv', csvRows(csvText(), { honourQuoting: false }));
  const own1900 = readXlsx(book1900); const own1904 = readXlsx(book1904);
  sources['xlsx 1900 (own reader)'] = score('xlsx', () => xlsxAdapt(own1900.rows, own1900.date1904));
  sources['xlsx 1904 (own reader)'] = score('xlsx', () => xlsxAdapt(own1904.rows, own1904.date1904));
  sources['xlsx 1904 read as 1900'] = score('xlsx', () => xlsxAdapt(own1904.rows, false));
  for (const [name, buf] of [['1900', book1900], ['1904', book1904]]) {
    try { const e = await excelJsCells(Buffer.from(buf)); sources[`xlsx ${name} (ExcelJS)`] = { date1904: e.date1904, ...score('exceljs', () => excelJsAdapt(e.rows)) }; }
    catch (err) { sources[`xlsx ${name} (ExcelJS)`] = { error: err.message }; }
    try { const s = sheetJsCells(Buffer.from(buf)); sources[`xlsx ${name} (SheetJS 0.18.5)`] = { date1904: s.date1904, ...score('sheetjs', () => xlsxAdapt(s.rows, s.date1904)) }; }
    catch (err) { sources[`xlsx ${name} (SheetJS 0.18.5)`] = { error: err.message }; }
  }
  return { own1900 };
}

const { own1900 } = await allSources();
out.sources = sources;

if (MODE === 'full') {
  // What each reader hands back for the probes.
  const ownProbes = readXlsx(book1900, { sheet: 'Probes' }).rows[1];
  const probes = {};
  const sj = sheetJsCells(Buffer.from(book1900)); const ej = await excelJsCells(Buffer.from(book1900));
  PROBES.forEach((p, j) => { probes[p] = { own: ownProbes[j], sheetjs: sj.probes[j], sheetjsFormatted: sj.formatted?.[j], exceljs: ej.probes[j] }; });
  out.probes = probes;

  // What the drivers hand back before we touch them (row 1 and row 2, the edges).
  const pgD = await pgRows(false); const ms = await msRows(MS_SELECT);
  const show = (v) => (v instanceof Date ? { Date: v.toISOString(), nanosecondsDelta: v.nanosecondsDelta } : typeof v === 'number' ? { number: v } : v);
  out.driverValues = { pg: pgD.slice(0, 2).map((r) => r.map(show)), tedious: ms.rows.slice(0, 2).map((r) => r.map(show)), tediousMeta: ms.meta };
  out.jsonNumbersParsed = JSON.parse(await (async () => { const a = await startApi(); const t = await (await fetch('http://127.0.0.1:18081/typed-numbers')).text(); a.kill(); return JSON.stringify(JSON.parse(t).rows[0].slice(0, 4)); })());

  // Currency types: each database's own money type.
  const c = await pgClient();
  const money = {};
  for (const lc of ['C', 'en_US.utf8', 'en_GB.utf8']) {
    try { await c.query(`set lc_monetary = '${lc}'`); money[`pg money under lc_monetary ${lc}`] = (await c.query("select '1234.56'::money::text as m, '-92233720368547758.08'::money::text as mn")).rows[0]; }
    catch (e) { money[`pg money under lc_monetary ${lc}`] = `error: ${e.message.slice(0, 80)}`; }
  }
  await c.end();
  const mc = await msConnect();
  money['mssql money via tedious'] = (await msQuery(mc, "select cast(1234.56 as money) as a, cast(922337203685477.5807 as money) as b, cast(-922337203685477.5808 as money) as c")).rows[0];
  msClose(mc);
  out.money = money;

  // 100 runs of each database's canonical checksum, in this process.
  const seen = { pg: new Set(), mssql: new Set(), mssqlText: new Set() };
  for (let i = 0; i < 100; i++) {
    seen.pg.add(checksum(COLUMNS, canonicalRows(COLUMNS, pgText(await pgRows(true)))));
    const m = await msRows(MS_SELECT_TEXT); seen.mssqlText.add(checksum(COLUMNS, canonicalRows(COLUMNS, m.rows)));
  }
  out.hundredRuns = { pgDistinct: seen.pg.size, mssqlTextDistinct: seen.mssqlText.size };

  // A result with no stated order.
  out.unordered = await unordered();
  out.canonicalDocumentSample = jcs(document(COLUMNS, EXPECTED)).slice(0, 400);
}
console.log(JSON.stringify(out, null, 1));

async function unordered() {
  const cols = [{ name: 'id', type: 'integer' }, { name: 'category', type: 'text' }, { name: 'v', type: 'integer' }];
  const res = {};
  const forms = {
    'no order': 'select id, category, v from unordered',
    'order by category (ties)': 'select id, category, v from unordered order by category',
    'order by category, id (total)': 'select id, category, v from unordered order by category, id',
  };
  // Postgres: between refreshes, rewrite some rows with their own values (the data does not change).
  const c = await pgClient();
  for (const [name, sql] of Object.entries(forms)) {
    for (const mode of ['stated', 'multiset']) {
      const sums = [];
      for (let i = 0; i < 20; i++) {
        const rows = (await c.query({ text: sql, rowMode: 'array' })).rows.map((r) => r.map(String));
        sums.push(checksum(cols, rows, { order: mode }));
        await c.query('update unordered set v = v where id = $1', [1 + ((i * 7) % 30)]);
      }
      let moved = 0; for (let i = 1; i < sums.length; i++) if (sums[i] !== sums[i - 1]) moved++;
      res[`pg: ${name}, rows ${mode === 'stated' ? 'as returned' : 'sorted (multiset)'}`] = { refreshes: 19, flaggedMoved: moved, distinct: new Set(sums).size };
    }
  }
  await c.end();
  // SQL Server: a heap (the key is nonclustered); between refreshes delete and re-insert a row as it was.
  const m = await msConnect();
  const msForms = { 'no order': 'select id, category, v from dbo.unordered', 'order by category (ties)': 'select id, category, v from dbo.unordered order by category', 'order by category, id (total)': 'select id, category, v from dbo.unordered order by category, id' };
  for (const [name, sql] of Object.entries(msForms)) {
    for (const mode of ['stated', 'multiset']) {
      const sums = [];
      for (let i = 0; i < 20; i++) {
        const rows = (await msQuery(m, sql)).rows.map((r) => Object.values(r).map(String));
        sums.push(checksum(cols, rows, { order: mode }));
        const id = 1 + ((i * 7) % 30);
        await msQuery(m, `declare @c nvarchar(5), @v int; select @c = category, @v = v from dbo.unordered where id = ${id}; delete from dbo.unordered where id = ${id}; insert into dbo.unordered values (${id}, @c, @v); update dbo.unordered set category = category + N'' where id = ${31 - id};`);
      }
      let moved = 0; for (let i = 1; i < sums.length; i++) if (sums[i] !== sums[i - 1]) moved++;
      res[`mssql: ${name}, rows ${mode === 'stated' ? 'as returned' : 'sorted (multiset)'}`] = { refreshes: 19, flaggedMoved: moved, distinct: new Set(sums).size };
    }
  }
  msClose(m);
  return res;
}
