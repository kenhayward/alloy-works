import { createHmac, randomUUID } from 'node:crypto';

import {
  deliverAnswerSchema,
  webhookSecretContext,
  type DeliverRequest,
} from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConnectorConfig, PRIVATE_RANGES } from './config.js';
import { createConnectorServer } from './server.js';
import { childSpawn, createSupervisor } from './supervisor.js';
import { DEV_CA, startFakeApi, type FakeApi } from './testing/http.js';
import { SEALING_KEY, TENANT, suiteChild, suiteDeny, suiteIsolation } from './testing/source.js';

/** Invented secrets, as Standard Webhooks writes them. */
const SECRET = `whsec_${Buffer.alloc(32, 3).toString('base64')}`;
const OLDER = `whsec_${Buffer.alloc(32, 4).toString('base64')}`;

let api: FakeApi;
beforeAll(async () => {
  api = await startFakeApi();
});
afterAll(async () => {
  await api.close();
});

const supervisor = createSupervisor({
  sealingKey: SEALING_KEY,
  deny: suiteDeny,
  maxChildren: 8,
  spec: childSpawn(suiteChild, suiteIsolation),
  ca: DEV_CA,
});

function deliveryTo(path: string, secrets: readonly string[] = [SECRET]): DeliverRequest {
  const subscription = randomUUID();
  const url = `https://127.0.0.1:${api.port}${path}`;
  return {
    requestId: randomUUID(),
    tenant: TENANT,
    subscription,
    url,
    sealed: secrets.map((secret) =>
      sealSecret(
        SEALING_KEY,
        'webhook-signing',
        TENANT,
        secret,
        webhookSecretContext(subscription, url),
      ),
    ),
    id: randomUUID(),
    body: JSON.stringify({ type: 'content.version_cut', sequence: 'audit:1' }),
  };
}

const sign = (secret: string, content: string) =>
  createHmac('sha256', Buffer.from(secret.slice('whsec_'.length), 'base64'))
    .update(content)
    .digest('base64');

describe('a webhook delivery through the connector (the WB plan, WB-F and WB-G)', () => {
  it('signs the body as Standard Webhooks specifies, with every secret it holds, and answers the status', async () => {
    const request = deliveryTo('/hooks', [SECRET, OLDER]);
    const answer = await supervisor.deliver(request);
    expect(answer).toMatchObject({ type: 'answered', status: 200 });
    const seen = api.seen.find((each) => each.headers['webhook-id'] === request.id)!;
    expect(seen.body).toBe(request.body);
    const timestamp = String(seen.headers['webhook-timestamp']);
    const content = `${request.id}.${timestamp}.${request.body}`;
    expect(seen.headers['webhook-signature']).toBe(
      `v1,${sign(SECRET, content)} v1,${sign(OLDER, content)}`,
    );
  });

  it("API-029 keeps the receiver's own status and at most 2 KiB of its reply, and follows no redirect", async () => {
    const refused = await supervisor.deliver(deliveryTo('/hooks/503'));
    expect(refused).toMatchObject({ type: 'answered', status: 503 });
    expect(deliverAnswerSchema.parse(refused)).toMatchObject({
      reply: expect.stringMatching(/^received/),
    });
    expect((refused as { reply: string }).reply.length).toBeLessThanOrEqual(2048);
    const before = api.seen.length;
    const moved = await supervisor.deliver(deliveryTo('/hooks/302'));
    expect(moved).toMatchObject({ type: 'answered', status: 302 });
    expect(api.seen.length).toBe(before + 1);
  });

  it('keeps no control character of a reply, NUL among them', async () => {
    const answer = await supervisor.deliver(deliveryTo('/hooks/nul'));
    expect(answer).toMatchObject({ type: 'answered', status: 200 });
    expect((answer as { reply: string }).reply.includes(String.fromCharCode(0))).toBe(false);
    expect((answer as { reply: string }).reply).toMatch(/^ab/);
  });

  it('refuses a secret sealed to another subscription or URL, and sends nothing', async () => {
    const request = deliveryTo('/hooks');
    const moved = { ...request, url: `https://127.0.0.1:${api.port}/hooks/201` };
    expect(await supervisor.deliver(moved)).toMatchObject({
      type: 'failed',
      code: 'secret_refused',
    });
    expect(api.seen.some((each) => each.headers['webhook-id'] === request.id)).toBe(false);
  });

  it('refuses a private receiver where the deployment does not allow one', async () => {
    const strict = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      webhookDeny: [...PRIVATE_RANGES, '127.0.0.0/8'],
      maxChildren: 2,
      spec: childSpawn(suiteChild, suiteIsolation),
      ca: DEV_CA,
    });
    expect(await strict.deliver(deliveryTo('/hooks'))).toMatchObject({
      type: 'failed',
      code: 'host_refused',
    });
  });
});

describe('a private receiver, as production is configured (the WB plan, WB-F)', () => {
  let url = '';
  let close = () => Promise.resolve();
  const DELIVER_KEY = Buffer.alloc(32, 9).toString('base64');

  beforeAll(async () => {
    // No CONNECTOR_WEBHOOK_PRIVATE: production's default, `deny`.
    const server = createConnectorServer({
      config: {
        ...loadConnectorConfig({
          CONNECTOR_KEY: Buffer.alloc(32, 1).toString('base64'),
          CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
          CONNECTOR_DELIVER_KEY: DELIVER_KEY,
          CONNECTOR_DENY: 'none',
          LOG_LEVEL: 'silent',
        }),
        ca: DEV_CA,
      },
      deny: suiteDeny,
      spec: childSpawn(suiteChild, suiteIsolation),
      log: () => {},
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterAll(() => close());

  it('refuses a receiver at a private, CGNAT or unique-local address, however it is written', async () => {
    for (const host of [
      '10.0.0.5',
      '172.20.1.1',
      '192.168.4.4',
      '100.64.0.9',
      '[fd00::1]',
      '[::ffff:10.0.0.5]',
    ]) {
      const request = { ...deliveryTo('/hooks') };
      const target = `https://${host}/hooks`;
      const answer = await fetch(`${url}/v1/deliver`, {
        method: 'POST',
        headers: { authorization: `Bearer ${DELIVER_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          ...request,
          url: target,
          sealed: [
            sealSecret(
              SEALING_KEY,
              'webhook-signing',
              TENANT,
              SECRET,
              webhookSecretContext(request.subscription, target),
            ),
          ],
        }),
      });
      expect(await answer.json(), host).toMatchObject({ type: 'failed', code: 'host_refused' });
    }
  });
});

describe("the connector's deliver key (the WB plan, WB-F)", () => {
  const SERVICE_KEY = Buffer.alloc(32, 1).toString('base64');
  const EMBED_KEY = Buffer.alloc(32, 2).toString('base64');
  const DELIVER_KEY = Buffer.alloc(32, 5).toString('base64');
  let url = '';
  let close = () => Promise.resolve();

  beforeAll(async () => {
    const server = createConnectorServer({
      config: loadConnectorConfig({
        CONNECTOR_KEY: SERVICE_KEY,
        CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
        CONNECTOR_EMBED_KEY: EMBED_KEY,
        CONNECTOR_DELIVER_KEY: DELIVER_KEY,
        CONNECTOR_DENY: 'none',
        LOG_LEVEL: 'silent',
      }),
      supervisor,
      log: () => {},
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    url = `http://127.0.0.1:${address.port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterAll(() => close());

  const post = (path: string, body: unknown, key: string) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('opens delivery alone to the deliver key, and delivery to no other key the worker holds', async () => {
    expect((await post('/v1/deliver', deliveryTo('/hooks'), DELIVER_KEY)).status).toBe(200);
    expect((await post('/v1/deliver', deliveryTo('/hooks'), EMBED_KEY)).status).toBe(401);
    for (const path of ['/v1/embed', '/v1/model', '/v1/seal', '/v1/webhook/seal', '/v1/run']) {
      expect((await post(path, { tenant: TENANT }, DELIVER_KEY)).status, path).toBe(401);
    }
  });

  it('refuses a deliver key that is one of the others', () => {
    expect(() =>
      loadConnectorConfig({
        CONNECTOR_KEY: SERVICE_KEY,
        CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
        CONNECTOR_DELIVER_KEY: SERVICE_KEY,
        CONNECTOR_DENY: 'none',
      }),
    ).toThrow(/CONNECTOR_DELIVER_KEY/);
  });
});
