import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import {
  modelCredentialContext,
  modelEventSchema,
  type ModelEvent,
  type ModelProtocol,
  type ModelRequest,
} from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { builtInDenied, loadConnectorConfig } from './config.js';
import { refusalFailure } from './model.js';
import { createConnectorServer } from './server.js';
import { childSpawn, createSupervisor, type Supervisor } from './supervisor.js';
import { DEV_CA, startFakeApi, type FakeApi } from './testing/http.js';
import { SEALING_KEY, TENANT, suiteChild, suiteDeny, suiteIsolation } from './testing/source.js';

/** The stand-in model's key (deploy/sources/http/stand-in-model.mjs). Invented. */
const MODEL_KEY = 'stand-in-model-dev-key';

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

const baseUrlOf = (protocol: ModelProtocol) =>
  `https://127.0.0.1:${api.port}/models/${protocol}${protocol === 'openai' ? '/v1' : ''}`;

function requestFor(
  protocol: ModelProtocol,
  text: string,
  over: {
    key?: string;
    sealedFor?: { id: string; baseUrl: string };
    deadlineMs?: number;
    baseUrl?: string;
  } = {},
): ModelRequest {
  const id = randomUUID();
  const endpoint = { id, protocol, baseUrl: over.baseUrl ?? baseUrlOf(protocol) };
  const sealedFor = over.sealedFor ?? endpoint;
  return {
    requestId: randomUUID(),
    tenant: TENANT,
    endpoint,
    sealed: sealSecret(
      SEALING_KEY,
      'model-credential',
      TENANT,
      over.key ?? MODEL_KEY,
      modelCredentialContext(sealedFor.id, { protocol, baseUrl: sealedFor.baseUrl }),
    ),
    call: {
      model: 'stand-in-1',
      system: 'Answer as the script says.',
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      parameters: { maxTokens: 256 },
    },
    deadlineMs: over.deadlineMs ?? 30_000,
  };
}

const script = (value: unknown) => `script:${JSON.stringify(value)}`;

async function called(
  request: ModelRequest,
  on: Supervisor = supervisor,
  signal?: AbortSignal,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  const call = on.model(request, (event) => events.push(event), signal);
  if (call === 'busy') throw new Error('busy');
  await call;
  return events;
}

const lastOf = (events: readonly ModelEvent[]) => events.at(-1);

describe('a model call through the connector', () => {
  it.each(['anthropic', 'openai'] as const)(
    'streams %s text as it arrives, ending with the model and its tokens',
    async (protocol) => {
      const events = await called(requestFor(protocol, 'Hello'));
      expect(
        events
          .filter((event) => event.type === 'text')
          .map((event) => event.text)
          .join(''),
      ).toBe('ready.');
      const last = lastOf(events);
      expect(last).toMatchObject({ type: 'ended', model: 'stand-in-1', stop: 'end' });
      expect(last?.type === 'ended' && last.usage?.in).toBeGreaterThan(0);
      expect(last?.type === 'ended' && last.usage?.out).toBeGreaterThan(0);
    },
  );

  it('GEN-027 speaks both protocols, a tool call read whole from either', async () => {
    for (const protocol of ['anthropic', 'openai'] as const) {
      const events = await called(
        requestFor(
          protocol,
          script({
            items: [
              { text: 'Reading it.' },
              { tool: { id: 'call_1', name: 'read_component', input: { id: 'c1', depth: 2 } } },
            ],
          }),
        ),
      );
      expect(
        events.find((event) => event.type === 'tool_call'),
        protocol,
      ).toEqual({
        type: 'tool_call',
        id: 'call_1',
        name: 'read_component',
        input: { id: 'c1', depth: 2 },
      });
      expect(lastOf(events), protocol).toMatchObject({ type: 'ended', stop: 'tool_use' });
      for (const event of events) expect(modelEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it("GEN-030 calls with the tenant's own key, as each protocol sends it, and no other key opens it", async () => {
    for (const protocol of ['anthropic', 'openai'] as const) {
      expect(lastOf(await called(requestFor(protocol, 'Hello')))?.type, protocol).toBe('ended');
      expect(
        lastOf(await called(requestFor(protocol, 'Hello', { key: 'another-key' }))),
        protocol,
      ).toEqual({
        type: 'failed',
        failure: { code: 'model_unavailable', reason: 'key_refused' },
      });
    }
  });

  it('GEN-029 opens a key only for the endpoint and origin it was sealed to, and repeats it nowhere', async () => {
    const elsewhere = requestFor('anthropic', 'Hello', {
      sealedFor: { id: randomUUID(), baseUrl: baseUrlOf('anthropic') },
    });
    expect(lastOf(await called(elsewhere))).toEqual({
      type: 'failed',
      failure: { code: 'model_unavailable', reason: 'key_refused' },
    });
    const moved = requestFor('anthropic', 'Hello');
    const pointed = {
      ...moved,
      endpoint: { ...moved.endpoint, baseUrl: `https://localhost:${api.port}/models/anthropic` },
    };
    expect(lastOf(await called(pointed))).toEqual({
      type: 'failed',
      failure: { code: 'model_unavailable', reason: 'key_refused' },
    });
    // The key is in no event, and the stand-in remembered no header carrying it.
    let stderr = 0;
    const counted = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 2,
      spec: childSpawn(suiteChild, suiteIsolation),
      ca: DEV_CA,
      onStderrBytes: (bytes) => {
        stderr += bytes;
      },
    });
    for (const protocol of ['anthropic', 'openai'] as const) {
      const events = await called(
        requestFor(protocol, script({ status: 401, body: 'refused at host-7' })),
        counted,
      );
      expect(JSON.stringify(events)).not.toContain(MODEL_KEY);
      expect(JSON.stringify(events)).not.toContain('host-7');
    }
    expect(stderr).toBe(0);
    expect(JSON.stringify(api.seen)).not.toContain(MODEL_KEY);
  });

  it('GEN-032 fails visibly, by code and reason alone, never trying elsewhere', async () => {
    const cases: [unknown, unknown][] = [
      [
        { status: 500, body: 'overloaded at host-7' },
        { code: 'model_unavailable', reason: 'failed' },
      ],
      [{ status: 503 }, { code: 'model_unavailable', reason: 'failed' }],
      [{ status: 429 }, { code: 'model_unavailable', reason: 'rate_limited' }],
      [{ status: 403 }, { code: 'model_unavailable', reason: 'key_refused' }],
      [
        { items: [{ text: 'Half' }, { cut: true }] },
        { code: 'model_unavailable', reason: 'failed' },
      ],
      [
        {
          status: 400,
          body: JSON.stringify({ error: { message: 'prompt is too long: 300000 tokens' } }),
        },
        { code: 'context_too_large' },
      ],
      [{ model: 'another-model' }, { code: 'model_mismatch' }],
    ];
    for (const [given, failure] of cases) {
      for (const protocol of ['anthropic', 'openai'] as const) {
        const events = await called(requestFor(protocol, script(given)));
        expect(lastOf(events), `${protocol} ${JSON.stringify(given)}`).toEqual({
          type: 'failed',
          failure,
        });
        expect(
          events.filter((event) => event.type === 'ended' || event.type === 'failed'),
        ).toHaveLength(1);
      }
    }
    const nowhere = requestFor('openai', 'Hello', { baseUrl: 'https://127.0.0.1:1/v1' });
    expect(lastOf(await called(nowhere))).toEqual({
      type: 'failed',
      failure: { code: 'model_unavailable', reason: 'unreachable' },
    });
  });

  it('refuses a model endpoint at an address the platform keeps, as the guard refuses a source', async () => {
    const guarded = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: builtInDenied,
      maxChildren: 1,
      spec: childSpawn(suiteChild, suiteIsolation),
      ca: DEV_CA,
    });
    expect(lastOf(await called(requestFor('anthropic', 'Hello'), guarded))).toEqual({
      type: 'failed',
      failure: { code: 'model_unavailable', reason: 'unreachable' },
    });
    expect(api.seen.filter((seen) => seen.rawPath?.startsWith('/models/')).length).toBeGreaterThan(
      0,
    );
  });

  it('ends a call past its deadline, and one whose caller has gone', async () => {
    const slow = requestFor('anthropic', script({ items: [{ pause: 5000 }, { text: 'late' }] }), {
      deadlineMs: 1000,
    });
    expect(lastOf(await called(slow))).toEqual({ type: 'failed', failure: { code: 'timeout' } });
    const gone = new AbortController();
    const started = Date.now();
    const events: ModelEvent[] = [];
    const call = supervisor.model(
      requestFor(
        'openai',
        script({ items: [{ text: 'First' }, { pause: 20_000 }, { text: 'never' }] }),
      ),
      (event) => {
        events.push(event);
        if (event.type === 'text') gone.abort();
      },
      gone.signal,
    );
    if (call === 'busy') throw new Error('busy');
    await call;
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(events.some((event) => event.type === 'text' && event.text === 'never')).toBe(false);
  });

  it('answers busy past its cap of model calls, leaving the other slots to connections', async () => {
    const capped = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 4,
      maxModels: 1,
      spec: childSpawn(suiteChild, suiteIsolation),
      ca: DEV_CA,
    });
    const first = capped.model(
      requestFor('anthropic', script({ items: [{ pause: 500 }, { text: 'ok' }] })),
      () => {},
    );
    expect(first).not.toBe('busy');
    expect(capped.model(requestFor('anthropic', 'Hello'), () => {})).toBe('busy');
    await first;
  });

  it('records no tokens where the provider reports none, rather than guessing', async () => {
    const events = await called(
      requestFor('openai', script({ items: [{ text: 'Hi' }], usage: false })),
    );
    expect(lastOf(events)).toMatchObject({ type: 'ended', usage: null });
  });

  it("classifies a refusal by its status, reading a 400's body only to tell a context too long", () => {
    expect(refusalFailure(400, '{"error":{"code":"context_length_exceeded"}}')).toEqual({
      code: 'context_too_large',
    });
    expect(refusalFailure(400, '{"error":"bad request"}')).toEqual({
      code: 'model_unavailable',
      reason: 'failed',
    });
    expect(refusalFailure(413, '')).toEqual({ code: 'context_too_large' });
  });
});

describe("the connector's model paths", () => {
  const KEY = Buffer.alloc(32, 3).toString('base64');
  const config = loadConnectorConfig({
    CONNECTOR_KEY: KEY,
    CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
    CONNECTOR_DENY: 'none',
    CONNECTOR_HOST: '127.0.0.1',
  });
  let server: Server;
  let url: string;
  const lines: string[] = [];
  beforeAll(async () => {
    server = createConnectorServer({
      config: { ...config, ca: DEV_CA },
      deny: suiteDeny,
      spec: childSpawn(suiteChild, suiteIsolation),
      log: (line) => lines.push(line),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (path: string, body: unknown, key = KEY) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('GEN-029 seals a model key for its endpoint, which then opens for that endpoint alone', async () => {
    const request = requestFor('anthropic', 'Hello');
    const sealing = await post('/v1/model/seal', {
      tenant: TENANT,
      endpoint: request.endpoint,
      secret: MODEL_KEY,
    });
    expect(sealing.status).toBe(200);
    const { sealed } = (await sealing.json()) as { sealed: string };
    expect(sealed).not.toContain(MODEL_KEY);
    const events = await called({ ...request, sealed });
    expect(lastOf(events)?.type).toBe('ended');
    expect(
      (
        await post(
          '/v1/model/seal',
          { tenant: TENANT, endpoint: request.endpoint, secret: MODEL_KEY },
          'wrong',
        )
      ).status,
    ).toBe(401);
  });

  it('streams a call as lines of JSON, one an event, and logs neither the call nor its answer', async () => {
    const response = await post('/v1/model', requestFor('openai', 'Hello'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    const events = (await response.text())
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => modelEventSchema.parse(JSON.parse(line)));
    expect(lastOf(events)?.type).toBe('ended');
    const logged = lines.join('\n');
    expect(logged).toContain('/v1/model');
    expect(logged).not.toContain('ready.');
    expect(logged).not.toContain('Hello');
    expect((await post('/v1/model', { tenant: TENANT })).status).toBe(400);
  });
});
