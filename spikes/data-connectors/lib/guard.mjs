// Case 1's code-side guard: the check placement A must rely on, since placement A shares the
// platform's network and nothing but code stops it reaching the platform. The guard's job is to
// refuse an address that belongs to us while still allowing the tenant's own private source.
//
// It deliberately does NOT deny all RFC1918: the brief's "other direction" - most customer sources
// are on private addresses, so a blanket private denylist denies the customer too. Instead it denies
// loopback, link-local (incl. the cloud metadata address), and an explicit set of platform addresses
// the deployment declares. That is the best a code check can do; the finding compares it to what the
// network does for placement C.
import dns from 'node:dns/promises';
import net from 'node:net';

// Platform addresses this deployment declares off-limits (resolved at start from env, comma list).
const PLATFORM_DENY = (process.env.PLATFORM_DENY || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
// The metadata address, wherever the harness put it.
const METADATA_ADDR = (process.env.METADATA_ADDR || '169.254.169.254').trim();

// Normalise the many spellings of an IPv4/IPv6 literal to a canonical form, the way glibc
// getaddrinfo / inet_aton would, so the guard sees what the OS will actually dial. Returns
// { kind: 'ip'|'name', canonical } - canonical is a dotted-quad or normalised v6 for an IP.
export function normalizeHost(raw) {
  let h = String(raw).trim();
  if (h.endsWith('.')) h = h.slice(0, -1); // trailing dot
  // Bracketed IPv6
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  // Already a valid literal?
  const v = net.isIP(h);
  if (v === 4) return { kind: 'ip', canonical: h, family: 4 };
  if (v === 6) return { kind: 'ip', canonical: canonV6(h), family: 6, mapped: mappedV4(h) };
  // Try numeric IPv4 forms: decimal (2130706433), octal (0177.0.0.1), hex (0x7f.0.0.1), part-forms.
  const asNum = parseNumericV4(h);
  if (asNum) return { kind: 'ip', canonical: asNum, family: 4, spelled: h };
  return { kind: 'name', canonical: h };
}

function canonV6(h) { return h.toLowerCase(); }
function mappedV4(h) {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(h);
  if (m) return m[1];
  const hx = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (hx) {
    const a = parseInt(hx[1], 16), b = parseInt(hx[2], 16);
    return `${(a >> 8) & 255}.${a & 255}.${(b >> 8) & 255}.${b & 255}`;
  }
  return null;
}

// Parse the assorted integer spellings getaddrinfo accepts. Returns dotted-quad or null.
export function parseNumericV4(h) {
  const parts = h.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = [];
  for (const p of parts) {
    if (p === '') return null;
    let n;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^[0-9]+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  // inet_aton: last part absorbs the remaining bytes.
  let bytes;
  if (nums.length === 1) {
    const n = nums[0]; if (n > 0xffffffff) return null;
    bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  } else if (nums.length === 2) {
    if (nums[0] > 255 || nums[1] > 0xffffff) return null;
    bytes = [nums[0], (nums[1] >> 16) & 255, (nums[1] >> 8) & 255, nums[1] & 255];
  } else if (nums.length === 3) {
    if (nums[0] > 255 || nums[1] > 255 || nums[2] > 0xffff) return null;
    bytes = [nums[0], nums[1], (nums[2] >> 8) & 255, nums[2] & 255];
  } else {
    if (nums.some((n) => n > 255)) return null;
    bytes = nums;
  }
  return bytes.join('.');
}

export function classify(ip) {
  const canon = net.isIPv6(ip) ? (mappedV4(ip) || ip) : ip;
  if (net.isIPv4(canon)) {
    const [a, b] = canon.split('.').map(Number);
    if (a === 127) return 'loopback';
    if (a === 169 && b === 254) return 'link-local';
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 0) return 'this-host';
    return 'public';
  }
  const low = ip.toLowerCase();
  if (low === '::1') return 'loopback';
  if (low.startsWith('fe80')) return 'link-local';
  if (low.startsWith('fc') || low.startsWith('fd')) return 'private';
  return 'public';
}

// The guard decision for a would-be connection host. allowDeclaredPrivate lets the tenant's own
// private source through; a platform-declared address is denied regardless.
export async function guardHost(rawHost, { allowDeclaredPrivate = true } = {}) {
  const norm = normalizeHost(rawHost);
  // What will this actually dial? Resolve names; for a literal, use the canonical form.
  let dialed = [];
  if (norm.kind === 'ip') {
    dialed = [norm.mapped || norm.canonical];
  } else {
    try {
      const res = await dns.lookup(norm.canonical, { all: true });
      dialed = res.map((r) => r.address);
    } catch (err) {
      return { allowed: false, reason: 'A connection reason was withheld.', class: 'dns', internalDetail: err.code };
    }
  }
  for (const ip of dialed) {
    const cls = classify(ip);
    if (cls === 'loopback' || cls === 'link-local' || cls === 'this-host') {
      return { allowed: false, reason: 'A connection reason was withheld.', class: cls, dialed, internalDetail: ip };
    }
    if (PLATFORM_DENY.includes(ip) || ip === METADATA_ADDR) {
      return { allowed: false, reason: 'A connection reason was withheld.', class: 'platform', dialed, internalDetail: ip };
    }
    if (cls === 'private' && !allowDeclaredPrivate) {
      return { allowed: false, reason: 'A connection reason was withheld.', class: 'private', dialed, internalDetail: ip };
    }
  }
  return { allowed: true, dialed, pinnedIp: dialed[0] };
}
