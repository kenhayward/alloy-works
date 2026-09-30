// Phase 3, case 6: a typed result's canonical form and its checksum (DAT-011, DAT-040).
//
//   { "columns": [[name, type], ...], "rows": [[cell, ...], ...] }
//
// serialised as RFC 8785 canonical JSON and hashed with SHA-256. Every cell is a JSON string (integers,
// decimals, dates and times in their canonical text - see types.mjs), a JSON boolean, or null; there
// are no JSON numbers in the document at all, so RFC 8785's number rules never apply and no reader's
// float can reach the hash. Columns are in the declared order; rows in the query's stated order, or,
// where the definition states no total order, sorted by their own canonical text (a multiset).
import { createHash } from 'node:crypto';
import { canon, NamedFailure } from './types.mjs';

// RFC 8785 for the values this document can hold: objects with sorted keys, arrays, strings (ES
// JSON.stringify's string escaping is RFC 8785's), booleans and null.
export function jcs(v) {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort((a, b) => {
      // RFC 8785 sorts by UTF-16 code units, which is JavaScript's default string order.
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
  }
  throw new NamedFailure('not_canonical', `A ${typeof v} cannot appear in a canonical result.`);
}

// raw rows are arrays of values already converted by a source adapter into what `canon` accepts.
export function canonicalRows(columns, rawRows, source) {
  return rawRows.map((r, i) => columns.map((c, j) => {
    const x = r[j];
    if (x === null || x === undefined) return null;
    try { return canon(c, x, `${c.name} in row ${i + 1}`); }
    catch (e) { e.source = source; throw e; }
  }));
}

export function document(columns, rows, { order = 'stated' } = {}) {
  let rs = rows;
  if (order === 'multiset') rs = [...rows].map((r) => [jcs(r), r]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((x) => x[1]);
  return { columns: columns.map((c) => [c.name, c.type]), rows: rs };
}

export function checksum(columns, rows, opts) {
  return createHash('sha256').update(jcs(document(columns, rows, opts)), 'utf8').digest('hex');
}

export const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
