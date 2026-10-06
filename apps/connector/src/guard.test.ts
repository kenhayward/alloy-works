import { describe, expect, it } from 'vitest';

import { builtInDenied, loadConnectorConfig, productionDeny } from './config.js';
import { guardedAddress, normaliseHost, type Lookup } from './guard.js';

/** The spike's platform network, as case 1 declared it: denied by configuration. */
const PLATFORM = '172.31.10.0/24';
const SOURCE = '172.31.20.21';

/** A lookup answering from a table, counting the questions it was asked. */
function lookupFrom(answers: Record<string, readonly string[][]>): Lookup & { asked: string[] } {
  const asked: string[] = [];
  const turns = new Map<string, number>();
  const lookup = async (name: string) => {
    asked.push(name);
    const turn = turns.get(name) ?? 0;
    turns.set(name, turn + 1);
    const answer = answers[name]?.[Math.min(turn, (answers[name]?.length ?? 1) - 1)];
    if (!answer)
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
    return answer.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return Object.assign(lookup, { asked });
}

describe('the address guard', () => {
  const policy = { deny: [...builtInDenied, PLATFORM] };

  it('refuses every spelling of a platform, loopback or link-local address case 1 reached, and allows the declared private source', async () => {
    const lookup = lookupFrom({
      'loopback.example.test': [['127.0.0.1']],
      'source.example.test': [[SOURCE]],
    });
    for (const host of [
      '172.31.10.11',
      '2887715339',
      '0254.037.012.013',
      '::ffff:172.31.10.11',
      '172.31.10.11.',
      '127.0.0.1',
      '2130706433',
      '0177.0.0.1',
      '0x7f.0.0.1',
      '127.1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '[::1]',
      '169.254.169.254',
      'fe80::1',
      'fe80::1%eth0',
      '0.0.0.0',
      '/var/run/postgresql',
      '/etc/ssl/private/source.key',
      'loopback.example.test',
    ]) {
      expect(await guardedAddress(host, { ...policy, lookup }), host).toBe('refused');
    }
    expect(await guardedAddress(SOURCE, { ...policy, lookup })).toEqual({
      address: SOURCE,
      family: 4,
    });
    expect(await guardedAddress('source.example.test', { ...policy, lookup })).toEqual({
      address: SOURCE,
      family: 4,
    });
    // A name nothing answers for is refused too, and says no more than any refusal does.
    expect(await guardedAddress('nowhere.example.test', { ...policy, lookup })).toBe('refused');
  });

  it('refuses a platform or loopback address spelled IPv4-compatible or through NAT64, and a name resolving to one', async () => {
    const lookup = lookupFrom({
      'compatible.example.test': [['::7f00:1']],
      'translated.example.test': [['64:ff9b::a9fe:a9fe']],
    });
    for (const host of [
      '::7f00:1',
      '::127.0.0.1',
      '[::7f00:1]',
      '::ac1f:a0b',
      '::172.31.10.11',
      '64:ff9b::7f00:1',
      '64:ff9b::127.0.0.1',
      '64:ff9b::ac1f:a0b',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b::0.0.0.0',
      'compatible.example.test',
      'translated.example.test',
    ]) {
      expect(await guardedAddress(host, { ...policy, lookup }), host).toBe('refused');
    }
    // The source, spelled either way, passes, and is dialled as given: on an IPv6-only network a
    // NAT64 address is the only way to it, and the address it carries is not reachable at all.
    for (const host of ['::ac1f:1415', '64:ff9b::ac1f:1415']) {
      expect(await guardedAddress(host, policy), host).toEqual({ address: host, family: 6 });
    }
    expect(await guardedAddress('64:ff9b::172.31.20.21', policy)).toEqual({
      address: '64:ff9b::ac1f:1415',
      family: 6,
    });
    // And the unspecified address and loopback stay IPv6's own, refused as ever.
    expect(await guardedAddress('::', policy)).toBe('refused');
    expect(await guardedAddress('::1', policy)).toBe('refused');
  });

  it("refuses a platform or loopback address through RFC 8215's local-use NAT64 prefix, wherever in it the address is carried, and dials a permitted one as given", async () => {
    for (const host of [
      // 127.0.0.1 at /96, /64, /56 and /48 of 64:ff9b:1::/48, as RFC 6052 lays each out.
      '64:ff9b:1::7f00:1',
      '64:ff9b:1:0:7f:0:100:0',
      '64:ff9b:1:7f:0:1::',
      '64:ff9b:1:7f00:0:100::',
      // 169.254.169.254 at /48, and the platform at /64.
      '64:ff9b:1:a9fe:a9:fe00::',
      '64:ff9b:1:0:ac:1f0a:b00:0',
    ]) {
      expect(await guardedAddress(host, policy), host).toBe('refused');
    }
    expect(await guardedAddress('64:ff9b:1::ac1f:1415', policy)).toEqual({
      address: '64:ff9b:1::ac1f:1415',
      family: 6,
    });
  });

  it('refuses a platform or loopback address carried by 6to4 or Teredo, and dials a permitted one as given', async () => {
    for (const host of [
      // 6to4 (2002::/16): the IPv4 address in bits 16 to 47.
      '2002:7f00:1::',
      '2002:7f00:1:ffff::1',
      '2002:a9fe:a9fe::1',
      '2002:ac1f:a0b::',
      // Teredo (2001::/32): the server in bits 32 to 63, the client in the last 32, inverted.
      '2001:0:4136:e378:8000:63bf:80ff:fffe',
      '2001:0:7f00:1:8000:63bf:3fff:fdd2',
      '2001:0:4136:e378:8000:63bf:5601:5601',
    ]) {
      expect(await guardedAddress(host, policy), host).toBe('refused');
    }
    expect(await guardedAddress('2002:ac1f:1415::', policy)).toEqual({
      address: '2002:ac1f:1415::',
      family: 6,
    });
  });

  it('normalises a host to what the operating system would dial', () => {
    expect(normaliseHost('2887715339')).toEqual({
      kind: 'address',
      address: '172.31.10.11',
      family: 4,
    });
    expect(normaliseHost('0254.037.012.013')).toEqual({
      kind: 'address',
      address: '172.31.10.11',
      family: 4,
    });
    expect(normaliseHost('0x7f.0.0.1')).toEqual({
      kind: 'address',
      address: '127.0.0.1',
      family: 4,
    });
    expect(normaliseHost('127.1')).toEqual({ kind: 'address', address: '127.0.0.1', family: 4 });
    expect(normaliseHost('10.1.258')).toEqual({ kind: 'address', address: '10.1.1.2', family: 4 });
    expect(normaliseHost('::ffff:7f00:1')).toEqual({
      kind: 'address',
      address: '127.0.0.1',
      family: 4,
    });
    expect(normaliseHost('[::1]')).toEqual({ kind: 'address', address: '::1', family: 6 });
    expect(normaliseHost('Source.Example.Test.')).toEqual({
      kind: 'name',
      name: 'source.example.test',
    });
    for (const host of [
      'fe80::1%eth0',
      '/var/run/postgresql',
      'C:\\x',
      '',
      'a b',
      '4294967296',
      'host:5432',
    ]) {
      expect(normaliseHost(host), host).toEqual({ kind: 'refused' });
    }
  });

  it('resolves a name once and dials the address it checked', async () => {
    // A rebinding name: the source on the first answer, the platform on every one after.
    const lookup = lookupFrom({ 'rebind.example.test': [[SOURCE], ['172.31.10.11']] });
    expect(await guardedAddress('rebind.example.test', { ...policy, lookup })).toEqual({
      address: SOURCE,
      family: 4,
    });
    expect(lookup.asked).toEqual(['rebind.example.test']);
    // And a name answering the source and the platform at once is refused whole.
    const both = lookupFrom({ 'both.example.test': [[SOURCE, '172.31.10.11']] });
    expect(await guardedAddress('both.example.test', { ...policy, lookup: both })).toBe('refused');
  });

  it('holds the production policy to refusing loopback whatever CONNECTOR_DENY says', async () => {
    const lookup = lookupFrom({});
    for (const deny of ['none', '10.0.0.0/8', '172.31.10.0/24,192.168.0.0/16']) {
      const config = loadConnectorConfig({
        CONNECTOR_KEY: Buffer.alloc(32, 1).toString('base64'),
        CONNECTOR_SEALING_KEY: Buffer.alloc(32, 2).toString('base64'),
        CONNECTOR_DENY: deny,
      });
      const denied = productionDeny(config);
      for (const range of builtInDenied) expect(denied, deny).toContain(range);
      for (const host of ['127.0.0.1', '::1', '169.254.169.254', '0.0.0.0']) {
        expect(await guardedAddress(host, { deny: denied, lookup }), `${deny} ${host}`).toBe(
          'refused',
        );
      }
    }
    expect(builtInDenied).toEqual([
      '127.0.0.0/8',
      '::1/128',
      '169.254.0.0/16',
      'fe80::/10',
      '0.0.0.0/8',
      '::/128',
      '224.0.0.0/4',
      'ff00::/8',
      '255.255.255.255/32',
    ]);
  });
});
