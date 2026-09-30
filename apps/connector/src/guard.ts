import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIPv4, isIPv6 } from 'node:net';

/**
 * The address guard (data.md, "The address guard"): defence in depth behind the network. It allows
 * the connection's declared host, private or not, and refuses loopback, link-local and the platform's
 * ranges. It runs in the child, which resolves and dials, so the process that meets a hostile answer
 * holds no key (D1-H).
 */

export type NormalisedHost =
  | { readonly kind: 'address'; readonly address: string; readonly family: 4 | 6 }
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

/**
 * An IPv6 address that carries an IPv4 address in its last 32 bits, as that IPv4 address - so the
 * guard checks the address it reaches - or undefined for any other: IPv4-mapped (`::ffff:0:0/96`),
 * IPv4-compatible (`::/96`, deprecated, but still a second spelling of `::7f00:1` for 127.0.0.1), and
 * the well-known NAT64 prefix (`64:ff9b::/96`, RFC 6052), through which a translator reaches the
 * IPv4 address it names. `::` and `::1` are IPv6's own, and the ranges deny them as such.
 */
function embedded(address: string): string | undefined {
  const all = groups(address);
  if (!all) return undefined;
  const last = dotted(((all[6]! << 16) | all[7]!) >>> 0);
  const zeros = (upTo: number) => all.slice(0, upTo).every((each) => each === 0);
  if (zeros(5) && all[5] === 0xffff) return last;
  if (zeros(6) && (all[6] !== 0 || all[7]! > 1)) return last;
  if (all[0] === 0x64 && all[1] === 0xff9b && all.slice(2, 6).every((each) => each === 0)) {
    return last;
  }
  return undefined;
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
    return four
      ? { kind: 'address', address: four, family: 4 }
      : { kind: 'address', address: host.toLowerCase(), family: 6 };
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
  let candidates: { address: string; family: 4 | 6 }[];
  if (normalised.kind === 'address') {
    candidates = [{ address: normalised.address, family: normalised.family }];
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
      candidates.push({ address: again.address, family: again.family });
    }
  }
  if (candidates.length === 0) return 'refused';
  const denied = blockListOf(policy.deny);
  for (const candidate of candidates) {
    if (denied.check(candidate.address, candidate.family === 6 ? 'ipv6' : 'ipv4')) return 'refused';
  }
  return candidates[0]!;
}
