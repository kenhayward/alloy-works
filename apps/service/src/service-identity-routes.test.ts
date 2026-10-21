import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

interface Identity {
  id: string;
  name: string;
  description: string;
  createdBy: string | null;
  disabledAt: string | null;
  tokens: number;
}

const inAMonth = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

describe('service identities through the API (the G8 plan, G8-G and G8-H)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const make = async (name: string) => {
    const made = await h.call('ada', 'POST', '/v1/service-identities', {
      name,
      description: 'Invented for the test',
    });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<Identity>();
  };

  const issue = async (id: string, scopes: string[] = []) => {
    const issued = await h.call('ada', 'POST', `/v1/service-identities/${id}/tokens`, {
      name: 'Agent',
      scopes,
      expiresAt: inAMonth(),
    });
    expect(issued.statusCode, issued.body).toBe(200);
    expect(issued.headers['cache-control']).toBe('no-store');
    return issued.json<{ id: string; secret: string }>();
  };

  it('IAM-033 lets only an administrator with a session make a service identity, never a token', async () => {
    const made = await make('Nightly importer');
    expect(made).toMatchObject({
      name: 'Nightly importer',
      createdBy: h.ids.ada,
      disabledAt: null,
      tokens: 0,
    });
    const listed = (await h.call('ada', 'GET', '/v1/service-identities')).json<{
      items: Identity[];
    }>();
    expect(listed.items.map((each) => each.id)).toContain(made.id);
    expect(
      (await h.call('grace', 'POST', '/v1/service-identities', { name: 'Hers' })).statusCode,
    ).toBe(403);
    const own = await h.call('ada', 'POST', '/v1/tokens', {
      name: 'Administering',
      scopes: ['administer'],
      expiresAt: inAMonth(),
    });
    const secret = own.json<{ secret: string }>().secret;
    const byToken = await h.bearer(secret, 'POST', '/v1/service-identities', { name: 'Minted' });
    expect(byToken.statusCode).toBe(403);
    expect(byToken.json<{ code: string }>().code).toBe('token_not_allowed');
    const minting = await h.bearer(secret, 'POST', `/v1/service-identities/${made.id}/tokens`, {
      name: 'Minted',
      scopes: [],
      expiresAt: inAMonth(),
    });
    expect(minting.statusCode).toBe(403);
  });

  it("IAM-033 issues a service identity a token that acts as the service, with the service's own grants", async () => {
    const made = await make('Reader agent');
    const { secret } = await issue(made.id);
    const component = (await h.component(h.general, 'For the agent')).id;
    // No roles yet: the service reads nothing.
    expect((await h.bearer(secret, 'GET', `/v1/components/${component}`)).statusCode).toBe(404);
    await h.allow(made.id, h.roles.Reader!, { kind: 'space', id: h.general });
    const read = await h.bearer(secret, 'GET', `/v1/components/${component}`);
    expect(read.statusCode, read.body).toBe(200);
    const me = (await h.bearer(secret, 'GET', '/v1/me')).json<{ id: string }>();
    expect(me.id).toBe(made.id);
  });

  it('renames a service identity', async () => {
    const made = await make('Exporter');
    const renamed = await h.call('ada', 'PATCH', `/v1/service-identities/${made.id}`, {
      name: 'Weekly exporter',
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json<Identity>()).toMatchObject({ name: 'Weekly exporter' });
    expect(
      (
        await h.call(
          'ada',
          'PATCH',
          '/v1/service-identities/00000000-0000-4000-8000-000000000001',
          {
            name: 'Nobody',
          },
        )
      ).statusCode,
    ).toBe(404);
  });

  it('IAM-035 refuses a disabled service identity its tokens at their next request, and issues it no more', async () => {
    const made = await make('Publisher');
    const { secret } = await issue(made.id);
    expect((await h.bearer(secret, 'GET', '/v1/me')).statusCode).toBe(200);
    const disabled = await h.call('ada', 'POST', `/v1/service-identities/${made.id}/disablement`);
    expect(disabled.statusCode, disabled.body).toBe(200);
    expect(disabled.json<Identity>()).toMatchObject({ tokens: 0, disabledAt: expect.any(String) });
    expect((await h.bearer(secret, 'GET', '/v1/me')).statusCode).toBe(401);
    const more = await h.call('ada', 'POST', `/v1/service-identities/${made.id}/tokens`, {
      name: 'Again',
      scopes: [],
      expiresAt: inAMonth(),
    });
    expect(more.statusCode).toBe(409);
    expect(more.json<{ code: string }>().code).toBe('service_identity_disabled');
  });
});
