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

  it('never remembers a miss, so a new hostname works at once and junk ones cost no memory', async () => {
    const { asked, lookup } = fakeLookup();
    const resolver = cachedResolver(lookup, { ttlMs: 1000 });
    expect(await resolver.resolve('nobody.alloy.test')).toBeUndefined();
    expect(await resolver.resolve('nobody.alloy.test')).toBeUndefined();
    expect(asked).toEqual(['nobody.alloy.test', 'nobody.alloy.test']);
  });
});
