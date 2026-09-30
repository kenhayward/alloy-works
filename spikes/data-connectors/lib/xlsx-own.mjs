// Phase 3: an XLSX reader of our own, over fflate (streaming unzip, already in the workspace for Word
// output) and saxes (a streaming XML parser, ISC). Cases 6 and 7.
//
// It reads cells as the file stores them - a number as the text of its <v>, a shared or inline string,
// a boolean, an error, or nothing - and leaves conversion to the declared column type (case 6). It
// counts every byte it inflates, across every part, and stops at the byte limit, which bounds memory
// by the limit rather than by the file (case 7); rows are emitted one at a time and stopped at the row
// limit plus one.
import { Unzip, UnzipInflate } from 'fflate';
import { SaxesParser } from 'saxes';
import { NamedFailure } from './types.mjs';

const CHUNK = 64 * 1024;

// Inflate the named parts (a predicate), passing each chunk to `sink(name, chunk, final)`. Every
// inflated byte counts against `budget.left`; crossing it terminates the inflate and throws.
function inflateParts(bytes, want, sink, budget) {
  let failure = null;
  const uz = new Unzip((file) => {
    if (failure || !want(file.name)) return; // not started: skipped without inflating
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) { failure = new NamedFailure('xlsx_unreadable', `The workbook could not be inflated: ${err.message}`); return; }
      budget.left -= chunk.length; budget.inflated += chunk.length;
      if (budget.left < 0) {
        failure = new NamedFailure('size_limit', `The workbook expands past its byte limit of ${budget.limit} bytes (at ${file.name}).`);
        try { file.terminate(); } catch {}
        return;
      }
      try { sink(file.name, chunk, final); } catch (e) { failure = e; try { file.terminate(); } catch {} }
    };
    file.start();
  });
  uz.register(UnzipInflate);
  for (let i = 0; i < bytes.length && !failure; i += CHUNK) uz.push(bytes.subarray(i, Math.min(i + CHUNK, bytes.length)), i + CHUNK >= bytes.length);
  if (failure) throw failure;
}

function collect(bytes, names, budget) {
  const bufs = {};
  inflateParts(bytes, (n) => names.includes(n), (n, c) => { (bufs[n] ??= []).push(c); }, budget);
  const dec = new TextDecoder();
  return Object.fromEntries(Object.entries(bufs).map(([n, cs]) => [n, dec.decode(Buffer.concat(cs))]));
}

function parseXml(text, handlers) {
  const p = new SaxesParser();
  p.on('opentag', (t) => handlers.open?.(t.name, t.attributes));
  p.on('closetag', (t) => handlers.close?.(t.name));
  p.on('text', (s) => handlers.text?.(s));
  p.on('error', (e) => { throw new NamedFailure('xlsx_unreadable', `The workbook's XML is malformed: ${e.message}`); });
  p.write(text).close();
}

const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export function readXlsx(bytes, { maxBytes = 50e6, maxRows = 1e6, sheet: sheetName, onRow } = {}) {
  const budget = { limit: maxBytes, left: maxBytes, inflated: 0 };
  const meta = collect(bytes, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml'], budget);
  // The workbook: its date system and its sheets.
  let date1904 = false; const sheets = [];
  parseXml(meta['xl/workbook.xml'] ?? '', { open: (n, a) => {
    if (n === 'workbookPr') date1904 = a.date1904 === '1' || a.date1904 === 'true';
    if (n === 'sheet') sheets.push({ name: a.name, rid: a['r:id'] });
  } });
  const targets = {};
  parseXml(meta['xl/_rels/workbook.xml.rels'] ?? '', { open: (n, a) => { if (n === 'Relationship') targets[a.Id] = a.Target.replace(/^\/?(xl\/)?/, 'xl/'); } });
  // Styles: which number format each cell style carries (recorded as evidence; the declared type decides).
  const fmts = { 9: '0%', 10: '0.00%', 14: 'mm-dd-yy', 22: 'm/d/yy h:mm' }; const xfs = []; let inXfs = false;
  parseXml(meta['xl/styles.xml'] ?? '', {
    open: (n, a) => { if (n === 'numFmt') fmts[a.numFmtId] = a.formatCode; if (n === 'cellXfs') inXfs = true; if (n === 'xf' && inXfs) xfs.push(Number(a.numFmtId ?? 0)); },
    close: (n) => { if (n === 'cellXfs') inXfs = false; },
  });
  // Shared strings, each the concatenation of its runs' <t>, leaving out phonetic runs (<rPh>).
  const shared = []; let si = null; let inT = false; let inRPh = false;
  parseXml(meta['xl/sharedStrings.xml'] ?? '', {
    open: (n) => { if (n === 'si') si = ''; if (n === 'rPh') inRPh = true; if (n === 't') inT = true; },
    close: (n) => { if (n === 'si') { shared.push(si); si = null; } if (n === 'rPh') inRPh = false; if (n === 't') inT = false; },
    text: (s) => { if (si !== null && inT && !inRPh) si += s; },
  });
  const target = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
  if (!target) throw new NamedFailure('xlsx_no_sheet', `The workbook has no sheet ${sheetName ?? ''}.`);
  const path = targets[target.rid];
  // The sheet, streamed.
  const rows = []; let row = null; let cell = null; let field = null; let count = 0;
  const p = new SaxesParser();
  p.on('opentag', (t) => {
    const a = t.attributes;
    if (t.name === 'row') row = [];
    else if (t.name === 'c') cell = { i: colIndex(a.r), t: a.t ?? 'n', fmt: fmts[xfs[Number(a.s ?? 0)]] ?? null, v: null, f: null, is: null };
    else if (t.name === 'v') field = 'v';
    else if (t.name === 'f') field = 'f';
    else if (t.name === 't' && cell?.t === 'inlineStr') { field = 'is'; cell.is ??= ''; }
  });
  p.on('text', (s) => { if (cell && field) cell[field] = (cell[field] ?? '') + s; });
  p.on('closetag', (t) => {
    if (t.name === 'v' || t.name === 'f' || t.name === 't') field = null;
    else if (t.name === 'c') {
      let out;
      switch (cell.t) {
        case 's': out = { kind: 'string', v: shared[Number(cell.v)] }; break;
        case 'inlineStr': out = { kind: 'string', v: cell.is ?? '' }; break;
        case 'str': out = { kind: 'string', v: cell.v ?? '' }; break; // a formula's string result
        case 'b': out = { kind: 'boolean', v: cell.v === '1' }; break;
        case 'e': out = { kind: 'error', v: cell.v }; break;
        default: out = cell.v === null ? null : { kind: 'number', v: cell.v, fmt: cell.fmt };
      }
      if (out && cell.f !== null) out.formula = cell.f;
      while (row.length < cell.i) row.push(null);
      row[cell.i] = out; cell = null;
    } else if (t.name === 'row') {
      count++;
      if (count > maxRows) throw new NamedFailure('row_limit', `The sheet has more than ${maxRows} rows.`);
      if (onRow) onRow(row); else rows.push(row);
      row = null;
    }
  });
  p.on('error', (e) => { throw new NamedFailure('xlsx_unreadable', `The sheet's XML is malformed: ${e.message}`); });
  const dec = new TextDecoder();
  inflateParts(bytes, (n) => n === path, (_, chunk, final) => { p.write(dec.decode(chunk, { stream: !final })); if (final) p.close(); }, budget);
  return { date1904, sheets: sheets.map((s) => s.name), rows, inflated: budget.inflated };
}

// ---------------------------------------------------------------- serial numbers
const pad = (n, w = 2) => String(n).padStart(w, '0');
function ymd(ms) { const d = new Date(ms); return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }

// Days -> a calendar date, in the workbook's date system. 1900: serial 1 is 1900-01-01, and serial 60
// is 1900-02-29, a day that never existed (Lotus 1-2-3's bug, kept for compatibility).
export function serialDate(days, date1904) {
  if (date1904) return ymd(Date.UTC(1904, 0, 1) + days * 86400000);
  if (days === 60) throw new NamedFailure('nonexistent_date', 'Serial 60 is 1900-02-29, which does not exist.');
  if (days < 1) throw new NamedFailure('range', 'A 1900-system serial before 1 is not a date.');
  return ymd(Date.UTC(1899, 11, days < 60 ? 31 : 30) + days * 86400000);
}

// A serial -> date and time of day, rounded to the declared precision - refused where the double
// cannot resolve that precision at this magnitude: a writer rounds to the nearest double, so the
// intended value is recoverable while the unit in the last place is under one declared unit.
export function serialParts(serialText, date1904, precision) {
  const serial = Number(serialText);
  if (!Number.isFinite(serial) || serial < 0) throw new NamedFailure('type', 'not a serial date');
  const ulpDays = serial === 0 ? 0 : 2 ** (Math.floor(Math.log2(serial)) - 52);
  const units = 10 ** precision;
  if (ulpDays * 86400 * units >= 1)
    throw new NamedFailure('precision_not_carried', `A serial near ${serial} resolves ${(ulpDays * 86400e6).toFixed(2)} microseconds, coarser than the declared precision ${precision}.`);
  const days = Math.floor(serial);
  let t = Math.round((serial - days) * 86400 * units);
  let d = days;
  if (t >= 86400 * units) { t -= 86400 * units; d += 1; }
  const secs = Math.floor(t / units); const frac = String(t % units).padStart(precision, '0');
  const time = `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}${precision ? '.' + frac : ''}`;
  return { days: d, time };
}
