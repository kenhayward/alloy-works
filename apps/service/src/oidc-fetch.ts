import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';

/**
 * Where a provider may be reached (identity.md, IN-A): an issuer is an administrator's to name, and what
 * it publishes names more addresses again, so the service never dials one of its own network's. Refused
 * as an address of no public provider: loopback, private, link-local and the metadata address among it,
 * and the IPv6 spellings that carry an IPv4 address to a translator.
 */
const REFUSED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  REFUSED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2001::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  REFUSED.addSubnet(network, prefix, 'ipv6');
}

/** Whether an address is one the service never dials for a provider. */
export function refusedProviderAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  // BlockList checks an IPv4-mapped IPv6 address against the IPv4 rules itself.
  return REFUSED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export type Lookup = (
  name: string,
) => Promise<readonly { readonly address: string; readonly family: number }[]>;

const lookupAll: Lookup = (name) => dnsLookup(name, { all: true });

/** Refused before anything is sent: nothing of the address is said to whoever configured it. */
export class ProviderAddressRefused extends Error {}

/**
 * Every address a host has, or a refusal where any is refused: a name with one public address and one
 * private is refused, since either may be the one dialled.
 */
export async function guardedProviderAddress(
  host: string,
  lookup: Lookup = lookupAll,
  refuses: (address: string) => boolean = refusedProviderAddress,
): Promise<{ readonly address: string; readonly family: number }> {
  const bare = host.replace(/^\[|\]$/g, '');
  const addresses = isIP(bare) === 0 ? await lookup(bare) : [{ address: bare, family: isIP(bare) }];
  if (addresses.length === 0 || addresses.some((each) => refuses(each.address))) {
    throw new ProviderAddressRefused('The identity provider is not at an address it may be at.');
  }
  return addresses[0]!;
}

/** What openid-client hands a custom fetch (its `CustomFetchOptions`), the optional left optional. */
interface ProviderRequest {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/** The guard's seams, for a test of the exchange itself: nothing but a test passes these. */
export interface GuardSeams {
  readonly lookup?: Lookup;
  readonly refuses?: (address: string) => boolean;
  /** A certificate authority beside the system's, for a server of a test's own. */
  readonly ca?: string | Buffer;
}

/**
 * A `fetch` for openid-client that reaches only what the guard allows: over HTTPS, to the one address
 * checked, so a name answering differently the second time reaches nothing new, and following no
 * redirect, which a provider's OpenID Connect endpoints have no need of.
 */
export function guardedProviderFetch(seams: GuardSeams = {}) {
  const lookup = seams.lookup ?? lookupAll;
  return async (input: string | URL, init?: ProviderRequest): Promise<Response> => {
    const url = new URL(String(input));
    if (url.protocol !== 'https:') {
      throw new ProviderAddressRefused('The identity provider must be reached over HTTPS.');
    }
    const { address, family } = await guardedProviderAddress(url.hostname, lookup, seams.refuses);
    const body = init?.body === undefined || init.body === null ? undefined : String(init.body);
    return new Promise<Response>((resolve, reject) => {
      const sent = httpsRequest(
        url,
        {
          method: init?.method ?? 'GET',
          headers: init?.headers ?? {},
          ...(init?.signal ? { signal: init.signal } : {}),
          ...(seams.ca === undefined ? {} : { ca: seams.ca }),
          // Only the address checked, whatever the name answers now.
          lookup: (_name, options, callback) => {
            if ((options as { all?: boolean }).all) {
              (callback as unknown as (e: null, all: object[]) => void)(null, [
                { address, family },
              ]);
            } else callback(null, address, family);
          },
        },
        (answer) => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(answer.headers)) {
            if (value !== undefined) headers.set(name, String(value));
          }
          const status = answer.statusCode ?? 502;
          const empty = status === 204 || status === 304;
          resolve(
            new Response(empty ? null : (Readable.toWeb(answer) as ReadableStream), {
              status,
              headers,
            }),
          );
        },
      );
      sent.on('error', reject);
      sent.end(body);
    });
  };
}
