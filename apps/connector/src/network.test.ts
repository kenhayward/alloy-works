import type { NetworkInterfaceInfo } from 'node:os';

import { describe, expect, it } from 'vitest';

import { loadConnectorConfig, productionDeny } from './config.js';
import { guardedAddress } from './guard.js';
import { networkDeny, readNetworkDeny, routeGateways } from './network.js';

/**
 * A container's IPv4 route table as the kernel prints it: a default route through the host's bridge
 * address on eth0 (172.20.0.1, whose bytes the kernel writes in its own order, little-endian here),
 * that network's link route, and a second network's link route with no gateway, as an internal one has.
 */
const IPV4_ROUTES = [
  'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
  'eth0\t00000000\t010014AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
  'eth0\t000014AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
  'eth1\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
  '',
].join('\n');

/** The same table on a big-endian kernel: the gateway's bytes in network order. */
const IPV4_ROUTES_BIG_ENDIAN = IPV4_ROUTES.replace('010014AC', 'AC140001');

/** An IPv6 route table: a default route through fd00::1, a link route, and loopback's. */
const IPV6_ROUTES = [
  '00000000000000000000000000000000 00 00000000000000000000000000000000 00 fd000000000000000000000000000001 00000400 00000001 00000000 00000003     eth0',
  'fd000000000000000000000000000000 40 00000000000000000000000000000000 00 00000000000000000000000000000000 00000100 00000001 00000000 00000001     eth0',
  '00000000000000000000000000000001 80 00000000000000000000000000000000 00 00000000000000000000000000000000 00000000 00000002 00000000 80200001       lo',
  '',
].join('\n');

const iface = (address: string, internal = false): NetworkInterfaceInfo =>
  (address.includes(':')
    ? {
        address,
        netmask: 'ffff:ffff:ffff:ffff::',
        family: 'IPv6',
        mac: '02:42:ac:14:00:02',
        internal,
        cidr: `${address}/64`,
        scopeid: 0,
      }
    : {
        address,
        netmask: '255.255.0.0',
        family: 'IPv4',
        mac: '02:42:ac:14:00:02',
        internal,
        cidr: `${address}/16`,
      }) as NetworkInterfaceInfo;

/** The connector's own interfaces: loopback, and one address on each of two networks. */
const INTERFACES = {
  lo: [iface('127.0.0.1', true), iface('::1', true)],
  eth0: [iface('172.20.0.2'), iface('fd00::2')],
  eth1: [iface('172.18.0.3')],
};

const config = loadConnectorConfig({
  CONNECTOR_KEY: Buffer.alloc(32, 1).toString('base64'),
  CONNECTOR_SEALING_KEY: Buffer.alloc(32, 2).toString('base64'),
  CONNECTOR_DENY: 'none',
});

describe("the connector's own networks", () => {
  it('reads every gateway from the route tables, in the kernel byte order, and none where a network has none', () => {
    expect(routeGateways({ ipv4: IPV4_ROUTES, ipv6: IPV6_ROUTES }, 'LE')).toEqual([
      '172.20.0.1',
      'fd00::1',
    ]);
    expect(routeGateways({ ipv4: IPV4_ROUTES_BIG_ENDIAN }, 'BE')).toEqual(['172.20.0.1']);
    // Two internal networks, as compose gives the connector: link routes alone, so no gateway.
    const internal = IPV4_ROUTES.split('\n')
      .filter((line) => !line.startsWith('eth0\t00000000'))
      .join('\n');
    expect(routeGateways({ ipv4: internal, ipv6: '' }, 'LE')).toEqual([]);
    expect(routeGateways({}, 'LE')).toEqual([]);
  });

  it("refuses each gateway of its networks, where the host answers, and the connector's own addresses, beside the ranges it refuses already", async () => {
    const discovered = networkDeny({
      routes: { ipv4: IPV4_ROUTES, ipv6: IPV6_ROUTES },
      interfaces: INTERFACES,
      endianness: 'LE',
    });
    expect(discovered).toEqual([
      '172.20.0.1/32',
      'fd00::1/128',
      '172.20.0.2/32',
      'fd00::2/128',
      '172.18.0.3/32',
    ]);
    const deny = productionDeny(config, discovered);
    for (const host of ['172.20.0.1', 'fd00::1', '::ffff:172.20.0.1', '172.20.0.2', '172.18.0.3']) {
      expect(await guardedAddress(host, { deny }), host).toBe('refused');
    }
    // A source beside it on the same network is not the host, and is dialled.
    expect(await guardedAddress('172.20.0.9', { deny })).toEqual({
      address: '172.20.0.9',
      family: 4,
    });
  });

  it("dials the first address of a network that names no gateway: an isolated bridge holds none, and Docker gives it to a container, the source's among them", async () => {
    const isolated = [
      'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
      'eth1\t000014AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
      '',
    ].join('\n');
    const deny = productionDeny(
      config,
      networkDeny({
        routes: { ipv4: isolated },
        interfaces: { eth1: [iface('172.20.0.2')] },
        endianness: 'LE',
      }),
    );
    expect(await guardedAddress('172.20.0.1', { deny })).toEqual({
      address: '172.20.0.1',
      family: 4,
    });
  });

  it('reads the tables where the kernel keeps them, and starts without them where there are none', () => {
    const asked: string[] = [];
    const read = (path: string) => {
      asked.push(path);
      if (path === '/proc/net/route') return IPV4_ROUTES;
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    };
    expect(readNetworkDeny({ read, interfaces: () => INTERFACES, endianness: 'LE' })).toEqual([
      '172.20.0.1/32',
      '172.20.0.2/32',
      'fd00::2/128',
      '172.18.0.3/32',
    ]);
    expect(asked).toEqual(['/proc/net/route', '/proc/net/ipv6_route']);
    const none = () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    expect(readNetworkDeny({ read: none, interfaces: () => ({}), endianness: 'LE' })).toEqual([]);
  });
});
