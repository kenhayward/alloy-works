// Phase 3: case 6's one logical result, and the files that carry it - a CSV and two workbooks written
// by hand (1900 and 1904 date systems), so every cell is exactly what the case needs. Invented data.
import { zipSync, strToU8 } from 'fflate';

// The declared columns (DAT-011), and the result every source must reproduce, in canonical form.
export const COLUMNS = [
  { name: 'k', type: 'integer' },
  { name: 'dec', type: 'decimal', precision: 28, scale: 10 },
  { name: 'big', type: 'integer' },
  { name: 'amount', type: 'decimal', precision: 19, scale: 4 }, // a currency amount; its currency is declared, GBP
  { name: 'd', type: 'date' },
  { name: 'ldt', type: 'localdatetime', precision: 6 },
  { name: 'inst', type: 'instant', precision: 6 },
  { name: 'tm', type: 'time', precision: 6 },
  { name: 'flag', type: 'boolean' },
  { name: 'note', type: 'text' },
  { name: 'empty', type: 'text' },
  { name: 'txt', type: 'text' },
];
export const EXPECTED = [
  ['1', '123456789012345678.1234567891', '9223372036854775807', '1234.56', '2026-03-29', '2026-03-29T01:30:00.123456', '2026-03-29T00:30:00.123456Z', '23:59:59.999999', true, null, '', 'Αθήνα 東京 𠮷'],
  ['2', '-0.0000000001', '-9223372036854775808', '922337203685477.5807', '1900-03-01', '1900-03-01T00:00:00', '1969-12-31T23:59:59.999999Z', '00:00:00', false, 'x', '', 'café'],
  ['3', '0', '9007199254740993', '0.1', '2000-02-29', '2026-10-25T01:30:00', '2026-10-25T00:30:00Z', '12:00:00.5', null, '', null, 'café'],
];

// ---------------------------------------------------------------- CSV
// RFC 4180 has no null. The convention the harness declares: an unquoted empty field is null, a
// quoted empty field ("") is the empty string. Instants carry their offset as the source wrote it.
export function csvText() {
  const q = (s) => '"' + s.replace(/"/g, '""') + '"';
  const cells = (r) => r.map((v, i) => (v === null ? '' : v === true ? 'true' : v === false ? 'false' : (i === 6 && r[0] === '1') ? q('2026-03-29T01:30:00.123456+01:00') : q(v)));
  return '﻿' + COLUMNS.map((c) => c.name).join(',') + '\r\n' + EXPECTED.map((r) => cells(r).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- XLSX
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAY = 86400000;
export function serialOf(isoDate, date1904) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return date1904 ? (ms - Date.UTC(1904, 0, 1)) / DAY : (ms - Date.UTC(1899, 11, 30)) / DAY; // valid from 1900-03-01
}
function secondsOf(hms) { const [h, mi, s] = hms.split(':'); return Number(h) * 3600 + Number(mi) * 60 + Number(s); }

// Styles: 0 General, 1 date, 2 date-time, 3 currency, 4 percentage, 5 time, 6 grouped number.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="5"><numFmt numFmtId="164" formatCode="&quot;£&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd hh:mm:ss.000"/><numFmt numFmtId="167" formatCode="#,##0.00"/><numFmt numFmtId="168" formatCode="hh:mm:ss.000"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;

const letters = (i) => String.fromCharCode(65 + i);
// A cell: { n: number text, s: style } | { str: shared string } | { inline: text } | { fstr: formula string result }
//       | { b: bool } | { e: error } | { f: formula, n: cached } | null
function cellXml(ref, c, sst) {
  if (c === null) return '';
  if (c.b !== undefined) return `<c r="${ref}" t="b"><v>${c.b ? 1 : 0}</v></c>`;
  if (c.e !== undefined) return `<c r="${ref}" t="e"><v>${esc(c.e)}</v></c>`;
  if (c.str !== undefined) { let i = sst.indexOf(c.str); if (i < 0 || c.phonetic) { sst.push(c.phonetic ? { t: c.str, ph: c.phonetic } : c.str); i = sst.length - 1; } return `<c r="${ref}" t="s"><v>${i}</v></c>`; }
  if (c.inline !== undefined) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(c.inline)}</t></is></c>`;
  if (c.fstr !== undefined) return `<c r="${ref}" t="str"><f>${esc(c.f ?? '""')}</f><v>${esc(c.fstr)}</v></c>`;
  const s = c.s ? ` s="${c.s}"` : '';
  if (c.f !== undefined) return `<c r="${ref}"${s}><f>${esc(c.f)}</f><v>${c.n}</v></c>`;
  return `<c r="${ref}"${s}><v>${c.n}</v></c>`;
}
function sheetXml(rows, sst) {
  const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => cellXml(letters(j) + (i + 1), c, sst)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}
function sstXml(sst) {
  const si = sst.map((x) => typeof x === 'string'
    ? `<si><t xml:space="preserve">${esc(x)}</t></si>`
    : `<si><t xml:space="preserve">${esc(x.t)}</t><rPh sb="0" eb="1"><t>${esc(x.ph)}</t></rPh></si>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${si}</sst>`;
}
export function workbook(sheets, { date1904 = false, extra = {} } = {}) {
  const sst = [];
  const sheetFiles = Object.fromEntries(sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, strToU8(sheetXml(s.rows, sst))]));
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${date1904 ? ' date1904="1"' : ''}/><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`),
    ...sheetFiles,
    'xl/styles.xml': strToU8(STYLES),
    'xl/sharedStrings.xml': strToU8(sstXml(sst)),
    ...extra,
  };
  return zipSync(files, { level: 6 });
}

// The Data sheet: what a person would type into a spreadsheet for EXPECTED. Where a spreadsheet
// cannot hold the value as a number - over 15 significant digits, an int64, an instant's zone, a date
// before the 1904 system's epoch - the cell is text, as it would have to be.
export function dataSheet(date1904) {
  const num = (n, s) => ({ n: String(n), s });
  const dt = (iso, s = 1) => {
    const [d, t] = iso.split('T');
    if (date1904 && d < '1904-01-01') return { str: iso }; // the 1904 system has no serial for it
    const days = serialOf(d, date1904);
    return t === undefined ? num(days, s) : num(days + secondsOf(t) / 86400, s);
  };
  const time = (hms) => num(secondsOf(hms) / 86400, 5);
  const header = COLUMNS.map((c) => ({ str: c.name }));
  const r1 = [num(1), { inline: '123456789012345678.1234567891' }, { inline: '9223372036854775807' }, num(1234.56, 3), dt('2026-03-29'), dt('2026-03-29T01:30:00.123456', 2),
    { inline: '2026-03-29T01:30:00.123456+01:00' }, time('23:59:59.999999'), { b: true }, null, { str: '' }, { str: EXPECTED[0][11] }];
  const r2 = [num(2), num('-1E-10'), { inline: '-9223372036854775808' }, { inline: '922337203685477.5807' }, dt('1900-03-01'), dt('1900-03-01T00:00:00', 2),
    { inline: '1969-12-31T23:59:59.999999Z' }, time('00:00:00'), { b: false }, { str: 'x' }, { inline: '' }, { str: EXPECTED[1][11] }];
  const r3 = [{ f: 'A3+1', n: '3' }, num(0), { inline: '9007199254740993' }, num(0.1, 3), dt('2000-02-29'), dt('2026-10-25T01:30:00', 2),
    { inline: '2026-10-25T00:30:00Z' }, time('12:00:00.5'), null, { fstr: '', f: '""' }, null, { str: EXPECTED[2][11] }];
  return { name: 'Data', rows: [header, r1, r2, r3] };
}

// The Probes sheet: one cell per thing the brief names that the Data sheet does not.
export const PROBES = ['percentage 0.125 as 0.0%', 'grouped number 1234567.891 as #,##0.00', 'int64 written as a number', '28-digit decimal written as a number', 'serial 60 as a date', 'an error cell', 'a shared string with a phonetic run', 'a formula with a cached number'];
export function probeSheet() {
  return { name: 'Probes', rows: [PROBES.map((p) => ({ str: p })), [
    { n: '0.125', s: 4 }, { n: '1234567.891', s: 6 }, { n: '9007199254740993' }, { n: '123456789012345678.1234567891' },
    { n: '60', s: 1 }, { e: '#DIV/0!' }, { str: '東京', phonetic: 'とうきょう' }, { f: 'A2*2', n: '0.25' },
  ]] };
}
