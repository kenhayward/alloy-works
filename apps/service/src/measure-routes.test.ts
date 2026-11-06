import type { CapabilityCount } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMeasuring } from './measure.js';
import { startHarness, type Harness } from './test/bindings-harness.js';

describe('each request counted by its capability for its environment (the DG plan, DG-C)', () => {
  let h: Harness;
  const written: { tenant: string; counts: CapabilityCount[] }[] = [];
  const measuring = createMeasuring((tenant, _minute, counts) => {
    written.push({ tenant: tenant.id, counts: [...counts] });
    return Promise.resolve();
  });

  beforeAll(async () => {
    h = await startHarness({ appOptions: { measuring } });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('counts a contract route under its tag, a refusal as a client error, and nothing a hostname does not resolve', async () => {
    expect((await h.call('ada', 'GET', '/v1/spaces')).statusCode).toBe(200);
    expect((await h.call('ada', 'GET', '/v1/components/not-a-uuid')).statusCode).toBe(400);
    await h.app.inject({ method: 'GET', url: '/v1/spaces', headers: { host: 'nowhere.test' } });
    await measuring.flush();
    const counted = written
      .filter((each) => each.tenant === h.tenant.id)
      .flatMap((each) => each.counts);
    const of = (capability: string) => counted.find((each) => each.capability === capability);
    expect(of('Spaces')).toMatchObject({ requests: 1, clientErrors: 0, serverErrors: 0 });
    expect(of('Components')).toMatchObject({ requests: 1, clientErrors: 1 });
    expect(written.every((each) => each.tenant === h.tenant.id)).toBe(true);
  });
});
