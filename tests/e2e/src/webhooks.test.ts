import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';

type Json = Record<string, unknown>;

/**
 * A webhook delivered over the whole system (the WB plan): the act's event queued in its
 * transaction, the worker's loop, the connector's `/v1/deliver` signing it, and the fake API's
 * `/hooks` answering, read back from the deliveries. The stack runs with `CONNECTOR_WEBHOOK_PRIVATE`
 * `allow`, since `source-http` is on a private network.
 */
describe('a webhook over the whole system', () => {
  let cookie = '';
  let general = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVICE}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Json };
  };
  const ok = (answer: { status: number; body: Json }) => {
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body;
  };

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn('ada');
    const spaces = await call('GET', '/v1/spaces');
    general = (spaces.body['items'] as { id: string; name: string }[]).find(
      (space) => space.name === 'General',
    )!.id;
  }, 180_000);

  it('posts a version cut to a service identity’s endpoint, signed, and records it delivered', async () => {
    const identity = ok(
      await call('POST', '/v1/service-identities', { name: `Receiver ${Date.now()}` }),
    )['id'] as string;
    const roles = ok(await call('GET', '/v1/roles?level=tenant'))['items'] as {
      id: string;
      name: string;
    }[];
    ok(
      await call('POST', '/v1/grants', {
        role: roles.find((role) => role.name === 'Reader')!.id,
        subject: { principal: identity },
        level: `space:${general}`,
        effect: 'allow',
      }),
    );
    const made = ok(
      await call('POST', '/v1/webhooks', {
        serviceIdentity: identity,
        url: 'https://source-http/hooks',
        eventTypes: ['content.version_cut'],
      }),
    );
    expect(made['secret']).toMatch(/^whsec_/);
    const webhook = (made['webhook'] as { id: string }).id;
    ok(
      await call('POST', `/v1/spaces/${general}/components`, {
        title: 'Delivered',
        language: 'en-GB',
        direction: 'ltr',
      }),
    );
    const delivered = await vi.waitFor(
      async () => {
        const listed = ok(await call('GET', `/v1/webhooks/${webhook}/deliveries`));
        const [first] = listed['items'] as { id: string; state: string }[];
        expect(first?.state).toBe('delivered');
        return first!;
      },
      { timeout: 60_000, interval: 1000 },
    );
    const read = ok(await call('GET', `/v1/webhooks/${webhook}/deliveries/${delivered.id}`));
    expect(read['tried']).toEqual([
      expect.objectContaining({
        status: 200,
        failure: null,
        reply: expect.stringMatching(/^received/),
      }),
    ]);
    expect(read['payload']).toMatchObject({ type: 'content.version_cut', id: delivered.id });
  }, 120_000);
});
