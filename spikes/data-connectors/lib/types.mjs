// Phase 3: the declared types, and each one's canonical text. Shared by parameter validation (case 5)
// and result canonicalisation (case 6). Every function either returns the canonical text of a value
// or throws a NamedFailure naming what was wrong - it never rounds, truncates or guesses a zone.
//
// Canonical forms (the proposal the findings make):
//   text          the string as given (UTF-8 when hashed), no Unicode normalisation
//   integer       base-10, no leading zeros, no '+', '-0' is '0'; within the declared range (int64 by default)
//   decimal       base-10, no exponent, no leading zeros, no trailing fractional zeros, no '.' when whole,
//                 '-0' is '0'; within the declared precision and scale (a value needing more is refused)
//   date          YYYY-MM-DD, proleptic Gregorian, years 0001-9999
//   time          HH:MM:SS[.f], fraction without trailing zeros, within the declared precision
//   localdatetime YYYY-MM-DDTHH:MM:SS[.f], no zone, as above
//   instant       YYYY-MM-DDTHH:MM:SS[.f]Z, converted to UTC exactly (fraction kept as digits), as above
//   boolean       true / false (JSON)
//   null          null (JSON), distinct from the empty string ""
export class NamedFailure extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

export function canonInteger(raw, { min, max, what = 'value' } = {}) {
  let s;
  if (typeof raw === 'bigint') s = raw.toString();
  else if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) throw new NamedFailure('type', `${what} is not an integer`);
    if (!Number.isSafeInteger(raw))
      throw new NamedFailure(
        'precision_lost',
        `${what} arrived as a binary float beyond 2^53 and cannot be an exact integer`,
      );
    s = String(raw);
  } else if (typeof raw === 'string') s = raw;
  else throw new NamedFailure('type', `${what} is not an integer`);
  if (!/^[+-]?\d+$/.test(s)) throw new NamedFailure('type', `${what} is not an integer`);
  const v = BigInt(s);
  const lo = min !== undefined ? BigInt(min) : INT64_MIN;
  const hi = max !== undefined ? BigInt(max) : INT64_MAX;
  if (v < lo || v > hi) throw new NamedFailure('range', `${what} is outside ${lo}..${hi}`);
  return v.toString();
}

// Expand a decimal written with an optional exponent into plain digits, exactly (string arithmetic).
function expandDecimal(s) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  let [, sign, int, frac = '', exp] = m;
  let e = exp ? Number(exp) : 0;
  if (!Number.isFinite(e) || Math.abs(e) > 400) return null;
  let digits = int + frac;
  let point = int.length + e;
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  if (point > digits.length) {
    digits = digits + '0'.repeat(point - digits.length);
  }
  int = digits.slice(0, point);
  frac = digits.slice(point);
  return { sign, int, frac };
}

export function canonDecimal(
  raw,
  { precision, scale, what = 'value', allowExponent = false } = {},
) {
  let s;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new NamedFailure('type', `${what} is not a finite decimal`);
    s = String(raw); // the shortest text that round-trips the double - the most a double can say
    allowExponent = true;
  } else if (typeof raw === 'bigint') s = raw.toString();
  else if (typeof raw === 'string') s = raw.trim() === raw ? raw : '\u0000';
  else throw new NamedFailure('type', `${what} is not a decimal`);
  if (!allowExponent && /[eE]/.test(s))
    throw new NamedFailure('type', `${what} is not a plain decimal`);
  const x = expandDecimal(s);
  if (!x) throw new NamedFailure('type', `${what} is not a decimal`);
  let int = x.int.replace(/^0+/, '') || '0';
  let frac = x.frac.replace(/0+$/, '');
  if (scale !== undefined && frac.length > scale)
    throw new NamedFailure(
      'scale_exceeded',
      `${what} has ${frac.length} fractional digits; the declaration allows ${scale}`,
    );
  if (
    precision !== undefined &&
    scale !== undefined &&
    (int === '0' ? 0 : int.length) > precision - scale
  )
    throw new NamedFailure(
      'range',
      `${what} has more integer digits than decimal(${precision},${scale}) allows`,
    );
  const zero = int === '0' && frac === '';
  return (x.sign === '-' && !zero ? '-' : '') + int + (frac ? '.' + frac : '');
}

// Compare two canonical decimals exactly.
export function compareDecimal(a, b) {
  const [ai, af = ''] = a.split('.');
  const [bi, bf = ''] = b.split('.');
  const n = Math.max(af.length, bf.length);
  const scaled = (i, f, neg) => (neg ? -1n : 1n) * BigInt(i.replace('-', '') + f.padEnd(n, '0'));
  const A = scaled(ai, af, a.startsWith('-'));
  const B = scaled(bi, bf, b.startsWith('-'));
  return A < B ? -1 : A > B ? 1 : 0;
}

function checkCalendar(y, mo, d) {
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(2000, mo, 0)).getUTCDate(); // days in month in a leap year
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= (mo === 2 ? (leap ? 29 : 28) : dim);
}
const pad = (n, w = 2) => String(n).padStart(w, '0');

export function canonDate(raw, { what = 'value' } = {}) {
  if (typeof raw !== 'string') throw new NamedFailure('type', `${what} is not a date (YYYY-MM-DD)`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m || !checkCalendar(+m[1], +m[2], +m[3]))
    throw new NamedFailure('type', `${what} is not a date (YYYY-MM-DD)`);
  return raw;
}

function canonFraction(f, precision, what) {
  const frac = (f ?? '').replace(/0+$/, '');
  if (precision !== undefined && frac.length > precision)
    throw new NamedFailure(
      'precision_exceeded',
      `${what} has ${frac.length} fractional-second digits; the declaration allows ${precision}`,
    );
  return frac ? '.' + frac : '';
}

export function canonTime(raw, { precision = 9, what = 'value' } = {}) {
  if (typeof raw !== 'string') throw new NamedFailure('type', `${what} is not a time`);
  const m = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(raw);
  if (!m || +m[1] > 23 || +m[2] > 59 || +m[3] > 59)
    throw new NamedFailure('type', `${what} is not a time (HH:MM:SS[.f])`);
  return `${m[1]}:${m[2]}:${m[3]}${canonFraction(m[4], precision, what)}`;
}

export function canonLocalDateTime(raw, { precision = 9, what = 'value' } = {}) {
  if (typeof raw !== 'string') throw new NamedFailure('type', `${what} is not a local date-time`);
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(raw);
  if (!m || !checkCalendar(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || +m[6] > 59)
    throw new NamedFailure('type', `${what} is not a local date-time (no zone)`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${canonFraction(m[7], precision, what)}`;
}

export function canonInstant(raw, { precision = 9, what = 'value' } = {}) {
  if (typeof raw !== 'string') throw new NamedFailure('type', `${what} is not an instant`);
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(
      raw,
    );
  if (!m) {
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw))
      throw new NamedFailure(
        'zone_missing',
        `${what} has no zone or offset, so it is not an instant`,
      );
    throw new NamedFailure('type', `${what} is not an instant (ISO 8601 with a zone)`);
  }
  if (!checkCalendar(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || +m[6] > 59)
    throw new NamedFailure('type', `${what} is not a valid instant`);
  let off = 0;
  if (m[8] !== 'Z') {
    const o = /^([+-])(\d{2}):?(\d{2})?$/.exec(m[8]);
    off = (o[1] === '-' ? -1 : 1) * (+o[2] * 60 + +(o[3] ?? 0));
  }
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - off * 60000;
  const t = new Date(ms);
  if (t.getUTCFullYear() < 1 || t.getUTCFullYear() > 9999)
    throw new NamedFailure('range', `${what} is outside years 0001-9999`);
  const base = `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
  return `${base}${canonFraction(m[7], precision, what)}Z`;
}

export function canonBoolean(raw, { what = 'value' } = {}) {
  if (raw === true || raw === false) return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new NamedFailure('type', `${what} is not a boolean (true or false)`);
}

export function canonText(raw, { maxLength, what = 'value' } = {}) {
  if (typeof raw !== 'string') throw new NamedFailure('type', `${what} is not text`);
  if (!raw.isWellFormed())
    throw new NamedFailure('type', `${what} is not well-formed Unicode (a lone surrogate)`);
  if (maxLength !== undefined && [...raw].length > maxLength)
    throw new NamedFailure('range', `${what} is longer than ${maxLength} characters`);
  return raw;
}

// One declared column or parameter type -> its canonical value.
export function canon(decl, raw, what) {
  const o = { ...decl, what };
  switch (decl.type) {
    case 'text':
      return canonText(raw, o);
    case 'integer':
      return canonInteger(raw, o);
    case 'decimal':
      return canonDecimal(raw, o);
    case 'date':
      return canonDate(raw, o);
    case 'time':
      return canonTime(raw, o);
    case 'localdatetime':
      return canonLocalDateTime(raw, o);
    case 'instant':
      return canonInstant(raw, o);
    case 'boolean':
      return canonBoolean(raw, o);
    default:
      throw new NamedFailure('declaration', `unknown type ${decl.type}`);
  }
}
