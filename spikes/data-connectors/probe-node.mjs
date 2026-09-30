// Phase 3: what this Node can do that the canonical forms lean on. Throwaway.
const out = { node: process.version, tz: process.env.TZ ?? null };
out.offsetMin = new Date('2026-03-29T12:00:00Z').getTimezoneOffset();
try {
  const seen = [];
  JSON.parse('{"a":123456789012345678.1234567891,"b":9223372036854775807}', function (k, v, ctx) {
    if (k) seen.push([k, v, ctx?.source]);
    return v;
  });
  out.jsonParseSource = seen;
} catch (e) {
  out.jsonParseSource = String(e);
}
out.rawJSON =
  typeof JSON.rawJSON === 'function'
    ? JSON.stringify({ x: JSON.rawJSON('123456789012345678.1234567891') })
    : 'absent';
out.isWellFormed = typeof ''.isWellFormed === 'function';
console.log(JSON.stringify(out));
