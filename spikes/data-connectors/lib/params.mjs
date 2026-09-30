// Phase 3, case 5: one parameter declaration (DAT-010), validated before anything runs (DAT-020), and
// bound three ways - as the driver's parameters in SQL (DAT-017), into an HTTP request by a builder,
// and as filters a file source applies to its own rows. A variation (DAT-019) is a key choosing among
// fixed fragments the query definition declares; the key never reaches the source.
import { NamedFailure, canon, canonText, compareDecimal } from './types.mjs';
import tedious from 'tedious';
const { TYPES } = tedious;

// ---------------------------------------------------------------- the declaration and DAT-020
// Parameter: { name, type, required, ...constraints }
//   type: text | integer | decimal | date | instant | localdatetime | time | boolean | choice | list
//   choice: values: [..] (permitted values, DAT-010);  list: of: <scalar decl>, minItems, maxItems
// Variation: { name, options: { key: fragment-per-binding } } - the fragment is the definition's text.
export function validate(decl, values = {}) {
  const out = {};
  const known = new Set([...decl.parameters.map((p) => p.name), ...(decl.variations ?? []).map((v) => v.name)]);
  for (const k of Object.keys(values)) if (!known.has(k)) throw new NamedFailure('param_unknown', `No parameter or variation is declared as '${k}'.`);
  for (const p of decl.parameters) {
    const raw = values[p.name];
    if (raw === undefined || raw === null || raw === '') {
      if (p.required) throw new NamedFailure('param_required', `The parameter '${p.name}' is required.`);
      out[p.name] = null; continue;
    }
    out[p.name] = one(p, raw, p.name);
  }
  for (const v of decl.variations ?? []) {
    const key = values[v.name] ?? v.default;
    if (typeof key !== 'string' || !Object.hasOwn(v.options, key))
      throw new NamedFailure('variation_unknown', `'${String(key).slice(0, 40)}' is not one of the declared choices for '${v.name}'.`);
    out[v.name] = key;
  }
  return out;
}

function one(p, raw, what) {
  try {
    if (p.type === 'choice') {
      if (typeof raw !== 'string' || !p.values.includes(raw)) throw new NamedFailure('not_permitted', `the value is not one of the permitted values`);
      return raw;
    }
    if (p.type === 'list') {
      if (!Array.isArray(raw)) throw new NamedFailure('type', `the value is not a list`);
      if (raw.length < (p.minItems ?? 1)) throw new NamedFailure('range', `the list has fewer than ${p.minItems ?? 1} items`);
      if (raw.length > (p.maxItems ?? 100)) throw new NamedFailure('range', `the list has more than ${p.maxItems ?? 100} items`);
      return raw.map((x, i) => one(p.of, x, `${what}[${i}]`));
    }
    return canon(p, raw, what);
  } catch (e) {
    if (e instanceof NamedFailure && !e.code.startsWith('param_')) throw new NamedFailure(`param_${e.code}`, `The parameter '${what}' ${e.message.replace(/^[^ ]+ /, '')}.`);
    throw e;
  }
}

// ---------------------------------------------------------------- SQL: the driver's parameters
// The author's text marks a parameter as {{name}} and a variation as {{#name}}. The binder replaces a
// parameter marker with the driver's placeholder and a variation marker with the fragment the
// definition declares for the chosen key. A value never becomes text.
export function bindPg(text, decl, v, variationFragments = {}) {
  const params = []; const index = new Map();
  const sql = text.replace(/\{\{(#?)([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_, hash, name) => {
    if (hash) return fragment(decl, v, name, 'pg');
    if (!index.has(name)) { params.push(pgValue(decl, name, v[name])); index.set(name, params.length); }
    return `$${index.get(name)}`;
  });
  return { sql, params };
}
function pgValue(decl, name, value) {
  const p = decl.parameters.find((x) => x.name === name);
  if (!p) throw new NamedFailure('definition_invalid', `The text names an undeclared parameter '${name}'.`);
  return value; // canonical text, boolean, or an array (a list binds as one array parameter)
}
function fragment(decl, v, name, site) {
  const d = (decl.variations ?? []).find((x) => x.name === name);
  if (!d) throw new NamedFailure('definition_invalid', `The text names an undeclared variation '${name}'.`);
  const f = d.options[v[name]][site];
  if (typeof f !== 'string') throw new NamedFailure('definition_invalid', `The variation '${name}' has no ${site} fragment.`);
  return f;
}

// SQL Server has no array parameter. `listMode` chooses how a list binds:
//   'expand'  one parameter per item (@ids_0, @ids_1, ...) - the text's shape varies only in count
//   'json'    one NVARCHAR parameter holding a JSON array, read by OPENJSON in the text
//   'tvp'     one table-valued parameter of a type the source declares (dbo.IntList)
//   'split'   one NVARCHAR parameter of comma-joined items, read by STRING_SPLIT (shown to be unsafe for text)
// `decimalMode`: 'native' binds tedious's Decimal type (which goes through a JavaScript number);
// 'text' binds NVARCHAR and the text CASTs it. Instants likewise ('native' DateTimeOffset or 'text').
export function bindMssql(text, decl, v, { listMode = 'json', decimalMode = 'text', instantMode = 'text' } = {}) {
  const params = [];
  const sql = text.replace(/\{\{(#?)([A-Za-z_][A-Za-z0-9_]*)(?::([a-z]+))?\}\}/g, (_, hash, name, how) => {
    if (hash) return fragment(decl, v, name, 'mssql');
    const p = decl.parameters.find((x) => x.name === name);
    if (!p) throw new NamedFailure('definition_invalid', `The text names an undeclared parameter '${name}'.`);
    const val = v[name];
    if (p.type === 'list') {
      const mode = how ?? listMode;
      if (mode === 'expand') {
        return val.map((x, i) => { params.push(msParam(`${name}_${i}`, p.of, x, decimalMode, instantMode)); return `@${name}_${i}`; }).join(', ');
      }
      if (mode === 'json') {
        params.push({ name, type: TYPES.NVarChar, value: JSON.stringify(val) });
        const t = p.of.type === 'integer' ? 'BIGINT' : 'NVARCHAR(4000)';
        return `SELECT j.v FROM OPENJSON(@${name}) WITH (v ${t} '$') AS j`;
      }
      if (mode === 'tvp') {
        params.push({ name, type: TYPES.TVP, value: { name: 'IntList', schema: 'dbo', columns: [{ name: 'v', type: TYPES.Int }], rows: val.map((x) => [Number(x)]) } });
        return `SELECT v FROM @${name}`;
      }
      if (mode === 'split') {
        params.push({ name, type: TYPES.NVarChar, value: val.join(',') });
        return `SELECT value FROM STRING_SPLIT(@${name}, N',')`;
      }
    }
    params.push(msParam(name, p, val, decimalMode, instantMode));
    if (p.type === 'decimal' && decimalMode === 'text') return `CAST(@${name} AS DECIMAL(${p.precision ?? 38},${p.scale ?? 10}))`;
    if (p.type === 'instant' && instantMode === 'text') return `CAST(@${name} AS DATETIMEOFFSET(7))`;
    return `@${name}`;
  });
  return { sql, params };
}
function msParam(name, p, val, decimalMode, instantMode) {
  switch (p.type) {
    case 'text': case 'choice': return { name, type: TYPES.NVarChar, value: val };
    case 'integer': return { name, type: TYPES.BigInt, value: val };
    case 'decimal': return decimalMode === 'text'
      ? { name, type: TYPES.NVarChar, value: val }
      : { name, type: TYPES.Decimal, value: val, options: { precision: p.precision ?? 38, scale: p.scale ?? 10 } };
    case 'date': return { name, type: TYPES.Date, value: val };
    case 'instant': return instantMode === 'text'
      ? { name, type: TYPES.NVarChar, value: val }
      : { name, type: TYPES.DateTimeOffset, value: new Date(val), options: { scale: 7 } };
    case 'boolean': return { name, type: TYPES.Bit, value: val };
    default: throw new NamedFailure('definition_invalid', `No SQL Server binding for ${p.type}.`);
  }
}

// ---------------------------------------------------------------- HTTP: a request builder
// A request template: { method, path: [literal | {param}], query: [{name, param}], headers: [{name, param}],
// body: JSON with {param} / {variation} leaves }. Every value is encoded for its position by the builder;
// none is spliced into a string the builder then parses.
const HEADER_OK = /^[\x20-\x7e]*$/;
export function encodeScalar(p, val) {
  if (val === null) return null;
  if (p.type === 'boolean') return val ? 'true' : 'false';
  return String(val); // every other canonical value is already text
}
export function buildHttp(tpl, decl, v, { naivePath = false } = {}) {
  const P = (name) => {
    const p = decl.parameters.find((x) => x.name === name);
    if (!p) throw new NamedFailure('definition_invalid', `The template names an undeclared parameter '${name}'.`);
    return p;
  };
  const segs = tpl.path.map((s) => {
    if (typeof s === 'string') return s;
    if (s.variation) return fragment(decl, v, s.variation, 'http');
    const p = P(s.param);
    if (p.type === 'list') throw new NamedFailure('param_not_placeable', `A list cannot be placed in a path segment.`);
    const text = encodeScalar(p, v[s.param]);
    if (text === null) throw new NamedFailure('param_required', `The path needs '${s.param}'.`);
    if (!naivePath) {
      if (text === '' || text === '.' || text === '..') throw new NamedFailure('param_not_placeable', `'${s.param}' cannot be a whole path segment of '.', '..' or nothing.`);
      if (/[/\\\u0000-\u001f\u007f]/.test(text)) throw new NamedFailure('param_not_placeable', `'${s.param}' contains a character a path segment may not carry.`);
    }
    return encodeURIComponent(text);
  });
  const url = new URL(tpl.base);
  url.pathname = '/' + segs.join('/');
  const qs = new URLSearchParams();
  for (const q of tpl.query ?? []) {
    if (q.variation) { qs.append(q.name, fragment(decl, v, q.variation, 'http')); continue; }
    const p = P(q.param); const val = v[q.param];
    if (val === null) continue;
    if (p.type === 'list') for (const x of val) qs.append(q.name, encodeScalar(p.of, x));
    else qs.append(q.name, encodeScalar(p, val));
  }
  url.search = qs.toString();
  const headers = { 'content-type': 'application/json' };
  for (const h of tpl.headers ?? []) {
    const p = P(h.param); const val = v[h.param];
    if (val === null) continue;
    if (p.type === 'list') throw new NamedFailure('param_not_placeable', `A list cannot be placed in a header.`);
    const text = encodeScalar(p, val);
    if (!HEADER_OK.test(text)) throw new NamedFailure('param_not_placeable', `'${h.param}' contains a character a header value may not carry.`);
    headers[h.name] = text;
  }
  const body = tpl.body === undefined ? undefined : JSON.stringify(fill(tpl.body, decl, v, P));
  return { method: tpl.method ?? 'GET', url: url.toString(), headers, body };
}
function fill(node, decl, v, P) {
  if (Array.isArray(node)) return node.map((x) => fill(x, decl, v, P));
  if (node && typeof node === 'object') {
    if (typeof node.param === 'string') {
      const p = P(node.param); const val = v[node.param];
      if (val === null) return null;
      if (p.type === 'list') return val.map((x) => jsonLeaf(p.of, x));
      return jsonLeaf(p, val);
    }
    if (typeof node.variation === 'string') return fragment(decl, v, node.variation, 'http');
    return Object.fromEntries(Object.entries(node).map(([k, x]) => [k, fill(x, decl, v, P)]));
  }
  return node;
}
// JSON leaves: integers and decimals as exact JSON numbers (JSON.rawJSON writes the digits as given);
// everything else as a string or a boolean.
function jsonLeaf(p, val) {
  if (p.type === 'boolean') return val;
  if (p.type === 'integer' || p.type === 'decimal') return JSON.rawJSON(val);
  return String(val);
}

// ---------------------------------------------------------------- a file: filters over its own rows
// A filter: { column, op: eq | contains | prefix | gte | lte | in, param }. Rows are already canonical
// (case 6), so a comparison is by the column's declared type - never by pattern, never by float.
export function filterRows(rows, columns, filters, decl, v) {
  const col = Object.fromEntries(columns.map((c, i) => [c.name, { ...c, i }]));
  return rows.filter((r) => filters.every((f) => {
    const c = col[f.column]; const val = v[f.param];
    if (val === null) return true; // an absent optional parameter applies no filter
    const x = r[c.i];
    if (x === null) return false;
    // A canonical time strips trailing zeros, so text order is not time order ('00.5Z' < '00Z'): pad
    // the fraction to nine digits before comparing.
    const timeKey = (s) => String(s).replace(/(\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z?)$/, (_, hms, f = '', z) => `${hms}.${f.padEnd(9, '0')}${z}`);
    const cmp = (a, b) => {
      if (c.type === 'decimal' || c.type === 'integer') return compareDecimal(String(a), String(b));
      if (c.type === 'instant' || c.type === 'localdatetime' || c.type === 'time') { a = timeKey(a); b = timeKey(b); }
      return a < b ? -1 : a > b ? 1 : 0;
    };
    switch (f.op) {
      case 'eq': return cmp(x, val) === 0;
      case 'contains': return String(x).includes(val);
      case 'prefix': return String(x).startsWith(val);
      case 'gte': return cmp(x, val) >= 0;
      case 'lte': return cmp(x, val) <= 0;
      case 'in': return val.some((y) => cmp(x, y) === 0);
      default: throw new NamedFailure('definition_invalid', `Unknown filter ${f.op}`);
    }
  }));
}
export { canonText };
