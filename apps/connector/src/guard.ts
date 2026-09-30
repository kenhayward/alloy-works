import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIPv4, isIPv6 } from 'node:net';

/**
 * The address guard (data.md, "The address guard"): defence in depth behind the network. It allows
 * the connection's declared host, private or not, and refuses loopback, link-local and the platform's
 * ranges. It runs in the child, which resolves and dials, so the process that meets a hostile answer
 * holds no key (D1-H).
 */

export type NormalisedHost =
  | {
      readonly kind: 'address';
      readonly address: string;
      readonly family: 4 | 6;
      /**
       * The IPv4 addresses an IPv6 address carries, which the guard checks beside it: the address is
       * dialled as given, and a translator or the kernel reaches what it carries.
       */
      readonly carries?: readonly string[];
    }
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'refused' };

/** A resolver, as `dns.lookup` with `all: true` answers: every address a name has, in order. */
export type Lookup = (
  name: string,
) => Promise<readonly { readonly address: string; readonly family: number }[]>;

const REFUSED = { kind: 'refused' } as const;

/** An IPv4 address's text from its 32 bits. */
const dotted = (value: number) =>
  [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');

/** One part of an `inet_aton` spelling: decimal, octal with a leading zero, or hexadecimal. */
function part(text: string): number | undefined {
  if (/^0x[0-9a-f]+$/i.test(text)) return parseInt(text.slice(2), 16);
  if (/^0[0-7]*$/.test(text)) return parseInt(text, 8);
  if (/^[1-9][0-9]*$/.test(text)) return parseInt(text, 10);
  return undefined;
}

/**
 * The address `inet_aton` makes of a host, as glibc's resolver would dial it: one to four parts, the
 * last taking every byte the others leave. Undefined for anything that is not such a spelling.
 */
function inetAton(host: string): string | undefined {
  const texts = host.split('.');
  if (texts.length < 1 || texts.length > 4) return undefined;
  const parts = texts.map(part);
  if (parts.some((each) => each === undefined || !Number.isSafeInteger(each))) return undefined;
  const numbers = parts as number[];
  const leading = numbers.slice(0, -1);
  if (leading.some((each) => each > 255)) return undefined;
  const lastBytes = 4 - leading.length;
  const last = numbers[numbers.length - 1]!;
  if (last >= 2 ** (8 * lastBytes)) return undefined;
  let value = 0;
  for (const each of leading) value = value * 256 + each;
  value = value * 2 ** (8 * lastBytes) + last;
  return dotted(value >>> 0);
}

/** An IPv6 address's eight groups, an embedded dotted quad read as the last two; undefined if not one. */
function groups(address: string): number[] | undefined {
  if (!isIPv6(address)) return undefined;
  let text = address.toLowerCase();
  const quad = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (quad) {
    const [a, b, c, d] = quad[1]!.split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, -quad[1]!.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const split = (value: string) => (value === '' ? [] : value.split(':'));
  const front = split(head).map((each) => parseInt(each, 16));
  const back = tail === undefined ? [] : split(tail).map((each) => parseInt(each, 16));
  const zeros = 8 - front.length - back.length;
  return [...front, ...Array<number>(tail === undefined ? 0 : zeros).fill(0), ...back];
}

/** An address's 128 bits, as a string of ones and zeros, from its eight groups. */
const bitsOf = (all: readonly number[]) =>
  all.map((each) => each.toString(2).padStart(16, '0')).join('');

/** An IPv4 address's text from 32 bits written as ones and zeros. */
const dottedBits = (bits: string) => dotted(parseInt(bits, 2) >>> 0);

/**
 * The IPv4 addresses a NAT64 address in RFC 8215's local-use prefix, `64:ff9b:1::/48`, may carry. A
 * translator there embeds its IPv4 address after a prefix of 48, 56, 64 or 96 bits, as RFC 6052 lays
 * each out - bits 64 to 71, the u-octet, skipped and zero, and the bits after the address zero - and
 * which it uses is its own configuration. So every layout the address is well formed under is read,
 * and the /96 layout always is; the guard refuses the address if any of them is denied.
 */
function localUseCarried(all: readonly number[]): string[] {
  const bits = bitsOf(all);
  const carried = [dottedBits(bits.slice(96))];
  if (bits.slice(64, 72) !== '0'.repeat(8)) return carried;
  // The address's bits with the u-octet taken out: RFC 6052's layouts below 96 read these.
  const skipped = bits.slice(0, 64) + bits.slice(72);
  for (const prefix of [48, 56, 64]) {
    if (/^0*$/.test(skipped.slice(prefix + 32)))
      carried.push(dottedBits(skipped.slice(prefix, prefix + 32)));
  }
  return carried;
}

/**
 * How an IPv6 address that carries an IPv4 address is dialled and checked - or undefined for any
 * other. IPv4-mapped (`::ffff:0:0/96`) is the IPv4 address itself, which the kernel dials, so it is
 * normalised to it. The others are dialled as given, and the IPv4 addresses they carry are checked
 * beside them: IPv4-compatible (`::/96`, deprecated, but a second spelling of `::7f00:1` for
 * 127.0.0.1), the well-known NAT64 prefix (`64:ff9b::/96`, RFC 6052), and RFC 8215's local-use one
 * (`64:ff9b:1::/48`), through which a translator reaches the IPv4 address it names. On an IPv6-only
 * network a NAT64 address is the only way to an IPv4 source, so dialling what it carries instead
 * would reach nothing. `::` and `::1` are IPv6's own, and the ranges deny them as such.
 */
function embedded(
  address: string,
): { readonly mapped: string } | { readonly carries: readonly string[] } | undefined {
  const all = groups(address);
  if (!all) return undefined;
  const last = dotted(((all[6]! << 16) | all[7]!) >>> 0);
  const zeros = (upTo: number) => all.slice(0, upTo).every((each) => each === 0);
  if (zeros(5) && all[5] === 0xffff) return { mapped: last };
  if (zeros(6) && (all[6] !== 0 || all[7]! > 1)) return { carries: [last] };
  if (all[0] === 0x64 && all[1] === 0xff9b && all.slice(2, 6).every((each) => each === 0)) {
    return { carries: [last] };
  }
  if (all[0] === 0x64 && all[1] === 0xff9b && all[2] === 1) {
    return { carries: localUseCarried(all) };
  }
  return undefined;
}

/** An IPv6 address's text as Node spells it, lower case and shortest. */
function canonical(address: string): string {
  const all = groups(address)!;
  const hex = all.map((each) => each.toString(16));
  // The longest run of two or more zero groups, the first where two tie, becomes `::`.
  let best = { at: -1, length: 0 };
  for (let at = 0; at < 8;) {
    let length = 0;
    while (at + length < 8 && all[at + length] === 0) length += 1;
    if (length > best.length && length > 1) best = { at, length };
    at += length === 0 ? 1 : length;
  }
  if (best.at < 0) return hex.join(':');
  return `${hex.slice(0, best.at).join(':')}::${hex.slice(best.at + best.length).join(':')}`;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A host normalised to what the operating system will dial (case 1's spellings): decimal, octal,
 * hexadecimal and short IPv4 forms, an IPv6 address carrying an IPv4 one - mapped, compatible or
 * NAT64 - a trailing dot and brackets. A zone, a path, a port, a user and anything else a name cannot
 * be are refused.
 */
export function normaliseHost(raw: string): NormalisedHost {
  let host = raw;
  if (host === '' || /[\s/\\%@]/.test(host)) return REFUSED;
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
    if (!isIPv6(host)) return REFUSED;
  }
  if (isIPv6(host)) {
    const four = embedded(host);
    if (four && 'mapped' in four) return { kind: 'address', address: four.mapped, family: 4 };
    return {
      kind: 'address',
      address: four ? canonical(host) : host.toLowerCase(),
      family: 6,
      ...(four ? { carries: four.carries } : {}),
    };
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (isIPv4(host)) return { kind: 'address', address: host, family: 4 };
  const aton = inetAton(host);
  if (aton) return { kind: 'address', address: aton, family: 4 };
  const name = host.toLowerCase();
  const labels = name.split('.');
  if (name.length > 253 || !labels.every((label) => LABEL.test(label))) return REFUSED;
  // A last label of digits alone is a number no spelling above could read: never a name.
  if (
    /^[0-9]+$/.test(labels[labels.length - 1]!) ||
    /^0x[0-9a-f]*$/.test(labels[labels.length - 1]!)
  ) {
    return REFUSED;
  }
  return { kind: 'name', name };
}

function blockListOf(deny: readonly string[]): BlockList {
  const list = new BlockList();
  for (const range of deny) {
    const [address, prefix] = range.split('/') as [string, string];
    list.addSubnet(address, Number(prefix), address.includes(':') ? 'ipv6' : 'ipv4');
  }
  return list;
}

const defaultLookup: Lookup = (name) => dnsLookup(name, { all: true, verbatim: true });

/**
 * The one address to dial for a host, or `refused`. A name is resolved once, and every address it
 * answers must pass, so a rebinding answer is never asked for again and an answer holding a denied
 * address is refused whole; the address handed on is the first, which was checked.
 */
export async function guardedAddress(
  host: string,
  policy: { readonly deny: readonly string[]; readonly lookup?: Lookup },
): Promise<{ readonly address: string; readonly family: 4 | 6 } | 'refused'> {
  const normalised = normaliseHost(host);
  if (normalised.kind === 'refused') return 'refused';
  let candidates: { address: string; family: 4 | 6; carries?: readonly string[] }[];
  if (normalised.kind === 'address') {
    candidates = [normalised];
  } else {
    let answers: readonly { readonly address: string; readonly family: number }[];
    try {
      answers = await (policy.lookup ?? defaultLookup)(normalised.name);
    } catch {
      return 'refused';
    }
    candidates = [];
    for (const answer of answers) {
      const again = normaliseHost(answer.address);
      if (again.kind !== 'address') return 'refused';
      candidates.push(again);
    }
  }
  if (candidates.length === 0) return 'refused';
  const denied = blockListOf(policy.deny);
  for (const candidate of candidates) {
    if (denied.check(candidate.address, candidate.family === 6 ? 'ipv6' : 'ipv4')) return 'refused';
    // And whatever IPv4 address it carries, which a translator or the kernel would reach.
    if (candidate.carries?.some((four) => denied.check(four, 'ipv4'))) return 'refused';
  }
  const { address, family } = candidates[0]!;
  return { address, family };
}
