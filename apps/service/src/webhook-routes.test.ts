import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

interface Answer {
  webhook: { id: string; url: string; eventTypes: string[]; disabledAt: string | null };
  secret?: string;
}

const SECRET = /^whsec_[A-Za-z0-9+/]{43}=$/;

describe('webhook subscriptions through the API (the WB plan, WB-H)', () => {
  let h: Harness;
  let robot = '';

  beforeAll(async () => {
    h = await startHarness();
    robot = (await h.call('ada', 'POST', '/v1/service-identities', { name: 'Receiver' })).json<{
      id: string;
    }>().id;
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const make = async (body: Record<string, unknown> = {}) =>
    h.call('ada', 'POST', '/v1/webhooks', {
      serviceIdentity: robot,
      url: 'https://receiver.example.test/hooks',
      eventTypes: ['content.version_cut'],
      ...body,
    });

  it('makes a subscription, answering its signing secret once and never again', async () => {
    const made = await make({ description: 'Publishing feed' });
    expect(made.statusCode, made.body).toBe(200);
    expect(made.headers['cache-control']).toBe('no-store');
    const answer = made.json<Answer>();
    expect(answer.secret).toMatch(SECRET);
    const sealed = h.connector.asked.find((each) => each.path === '/v1/webhook/seal');
    expect(sealed?.body).toMatchObject({
      subscription: answer.webhook.id,
      url: answer.webhook.url,
    });
    const read = await h.call('ada', 'GET', `/v1/webhooks/${answer.webhook.id}`);
    expect(read.json<Answer>().secret).toBeUndefined();
    const listed = await h.call('ada', 'GET', '/v1/webhooks');
    expect(listed.body).not.toContain(answer.secret!);
    expect(listed.body).not.toContain('sealed');
  });

  it('refuses a URL that is not HTTPS, a type it does not know, and a service identity disabled', async () => {
    expect((await make({ url: 'http://receiver.example.test' })).statusCode).toBe(400);
    expect((await make({ eventTypes: ['content.burned'] })).statusCode).toBe(400);
    const other = (await h.call('ada', 'POST', '/v1/service-identities', { name: 'Gone' })).json<{
      id: string;
    }>().id;
    await h.call('ada', 'POST', `/v1/service-identities/${other}/disablement`);
    const refused = await make({ serviceIdentity: other });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe('service_identity_unavailable');
  });

  it('answers a new secret where the URL changes or the secret is rotated, and removes', async () => {
    const id = (await make()).json<Answer>().webhook.id;
    const kept = await h.call('ada', 'PATCH', `/v1/webhooks/${id}`, {
      eventTypes: ['content.version_cut', 'publication.produced'],
    });
    expect(kept.json<Answer>()).toMatchObject({
      webhook: { eventTypes: ['content.version_cut', 'publication.produced'] },
    });
    expect(kept.json<Answer>().secret).toBeUndefined();
    const moved = await h.call('ada', 'PATCH', `/v1/webhooks/${id}`, {
      url: 'https://elsewhere.example.test/hooks',
    });
    expect(moved.json<Answer>().secret).toMatch(SECRET);
    const rotated = await h.call('ada', 'POST', `/v1/webhooks/${id}/secret`);
    expect(rotated.statusCode, rotated.body).toBe(200);
    expect(rotated.json<Answer>().secret).toMatch(SECRET);
    expect((await h.call('ada', 'DELETE', `/v1/webhooks/${id}`)).statusCode).toBe(200);
    expect((await h.call('ada', 'GET', `/v1/webhooks/${id}`)).statusCode).toBe(404);
  });

  it('lets only an administrator with a session manage webhooks', async () => {
    expect((await h.call('grace', 'GET', '/v1/webhooks')).statusCode).toBe(403);
    const own = await h.call('ada', 'POST', '/v1/tokens', {
      name: 'Administering',
      scopes: ['administer'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const listed = await h.bearer(own.json<{ secret: string }>().secret, 'GET', '/v1/webhooks');
    expect(listed.statusCode).toBe(403);
  });
});
