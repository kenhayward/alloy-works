import type { Tenant } from '@alloy-works/db';
import { describe, expect, it } from 'vitest';
import { cachedResolver } from './tenants.js';

const acme: Tenant = { id: 'acme', schema: 't_acme', role: 't_acme' };

function fakeLookup() {
  const asked: string[] = [];
  const lookup = async (hostname: string) => {
    asked.push(hostname);
    return hostname === 'acme.alloy.test' ? acme : undefined;
  };
  return { asked, lookup };
}

describe('cachedResolver', () => {
  it('asks the lookup in lower case', async () => {
    const { asked, lookup } = fakeLookup();
    const resolver = cachedResolver(lookup, { ttlMs: 1000 });
    expect(await resolver.resolve('ACME.alloy.test')).toEqual(acme);
    expect(asked).toEqual(['acme.alloy.test']);
  });

  it('remembers a tenant it found until the time runs out', async () => {
    const { asked, lookup } = fakeLookup();
    let clock = 0;
    const resolver = cachedResolver(lookup, { ttlMs: 1000, now: () => clock });
    await resolver.resolve('acme.alloy.test');
    clock = 999;
    await resolver.resolve('acme.alloy.test');
    expect(asked).toHaveLength(1);
    clock = 1000;
    await resolver.resolve('acme.alloy.test');
    expect(asked).toHaveLength(2);
  });

  it('answers each hostname with its own tenant, never one it remembered for another host', async () => {
    const beta: Tenant = { id: 'beta', schema: 't_beta', role: 't_beta' };
    const asked: string[] = [];
    const resolver = cachedResolver(
      async (hostname) => {
        asked.push(hostname);
        if (hostname === 'acme.alloy.test') return acme;
        return hostname === 'beta.alloy.test' ? beta : undefined;
      },
      { ttlMs: 1000 },
    );
    expect(await resolver.resolve('acme.alloy.test')).toEqual(acme);
    expect(await resolver.resolve('beta.alloy.test')).toEqual(beta);
    // Both remembered now: each answers with its own, and a host that is neither is still asked.
    expect(await resolver.resolve('ACME.alloy.test')).toEqual(acme);
    expect(await resolver.resolve('beta.alloy.test')).toEqual(beta);
    expect(await resolver.resolve('gamma.alloy.test')).toBeUndefined();
    expect(asked).toEqual(['acme.alloy.test', 'beta.alloy.test', 'gamma.alloy.test']);
  });

  it('never remembers a miss, so a new hostname works at once and junk ones cost no memory', async () => {
    const { asked, lookup } = fakeLookup();
    const resolver = cachedResolver(lookup, { ttlMs: 1000 });
    expect(await resolver.resolve('nobody.alloy.test')).toBeUndefined();
    expect(await resolver.resolve('nobody.alloy.test')).toBeUndefined();
    expect(asked).toEqual(['nobody.alloy.test', 'nobody.alloy.test']);
  });
});
