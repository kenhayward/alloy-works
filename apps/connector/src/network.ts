import { readFileSync } from 'node:fs';
import {
  endianness as hostEndianness,
  networkInterfaces,
  type NetworkInterfaceInfo,
} from 'node:os';

import { canonicalIpv6 } from './guard.js';

/**
 * What the connector's own networks add to the guard (data.md, "The address guard"): each gateway its
 * route tables name, which is where the host answers on a bridge network, and each address the
 * connector itself holds. Read once at start, beside CONNECTOR_DENY and the built-in ranges, so a
 * deployment that forgot to list its host is not reached through it, whatever the network does.
 *
 * It is defence in depth behind the network, and it cannot see everything: an internal network's route
 * table names no gateway whether or not the bridge holds an address for the host, so compose's
 * `internal` networks add nothing here, and the first address of a network that names none is not
 * refused - an isolated bridge holds none, and Docker gives it to a container, the source's among
 * them. That isolation is the engine's (Docker Engine 28.0.0 or later), which the end-to-end isolation
 * test holds it to.
 */

export interface RouteTables {
  /** `/proc/net/route`: a header, then one route a line, the gateway third, in the kernel's byte order. */
  readonly ipv4?: string;
  /** `/proc/net/ipv6_route`: one route a line, the next hop fifth, in network order. */
  readonly ipv6?: string;
}

export type Interfaces = Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>>;

const HEX = /^[0-9a-f]+$/i;

/** An IPv4 address from the eight hex digits `/proc/net/route` prints, in the kernel's byte order. */
function ipv4From(hex: string, endianness: 'LE' | 'BE'): string {
  const bytes = [0, 2, 4, 6].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return (endianness === 'LE' ? bytes.reverse() : bytes).join('.');
}

/** Every gateway the route tables name, in the order they name them, once each. */
export function routeGateways(tables: RouteTables, endianness: 'LE' | 'BE'): string[] {
  const found: string[] = [];
  for (const line of (tables.ipv4 ?? '').split('\n').slice(1)) {
    const gateway = line.trim().split(/\s+/)[2] ?? '';
    if (gateway.length === 8 && HEX.test(gateway) && !/^0+$/.test(gateway)) {
      found.push(ipv4From(gateway, endianness));
    }
  }
  for (const line of (tables.ipv6 ?? '').split('\n')) {
    const next = line.trim().split(/\s+/)[4] ?? '';
    if (next.length === 32 && HEX.test(next) && !/^0+$/.test(next)) {
      found.push(canonicalIpv6((next.match(/.{4}/g) ?? []).join(':')));
    }
  }
  return [...new Set(found)];
}

/**
 * The ranges the connector's own networks add to its guard: each gateway, then each address the
 * connector holds but loopback, which the built-in ranges refuse already, each as a single address.
 */
export function networkDeny(found: {
  readonly routes: RouteTables;
  readonly interfaces: Interfaces;
  readonly endianness: 'LE' | 'BE';
}): string[] {
  const own = Object.values(found.interfaces)
    .flatMap((each) => each ?? [])
    .filter((each) => !each.internal)
    .map((each) =>
      each.family === 'IPv6' ? canonicalIpv6(each.address.split('%')[0]!) : each.address,
    );
  const addresses = [...new Set([...routeGateways(found.routes, found.endianness), ...own])];
  return addresses.map((address) => `${address}/${address.includes(':') ? 128 : 32}`);
}

/** A table's text, or none where the platform keeps no such file. */
function tableAt(read: (path: string) => string, path: string): string {
  try {
    return read(path);
  } catch {
    return '';
  }
}

/** The ranges the connector's own networks add, read from the kernel and the interfaces at start. */
export function readNetworkDeny(
  from: {
    readonly read?: (path: string) => string;
    readonly interfaces?: () => Interfaces;
    readonly endianness?: 'LE' | 'BE';
  } = {},
): string[] {
  const read = from.read ?? ((path: string) => readFileSync(path, 'utf8'));
  return networkDeny({
    routes: {
      ipv4: tableAt(read, '/proc/net/route'),
      ipv6: tableAt(read, '/proc/net/ipv6_route'),
    },
    interfaces: (from.interfaces ?? networkInterfaces)(),
    endianness: from.endianness ?? hostEndianness(),
  });
}
