import { describe, expect, it } from 'vitest';

import {
  canonicalCall,
  costMicros,
  modelCredentialContext,
  modelEndpointSchema,
  modelEventSchema,
  modelRequestSchema,
  replyModelMatches,
  type ModelCall,
} from './index.js';

const endpoint = {
  name: 'Drafting',
  protocol: 'anthropic',
  baseUrl: 'https://models.example.test',
  model: 'claude-test',
  contextWindow: 200_000,
  priceIn: 3,
  priceOut: 15,
  currency: 'USD',
  boundary: 'outside',
} as const;

describe('a model endpoint', () => {
  it('GEN-027 takes either protocol, a self-hosted one at a plain address among them', () => {
    expect(modelEndpointSchema.safeParse(endpoint).success).toBe(true);
    const selfHosted = {
      ...endpoint,
      protocol: 'openai',
      baseUrl: 'http://10.0.4.7:11434/v1',
      boundary: 'inside',
    };
    expect(modelEndpointSchema.safeParse(selfHosted).success).toBe(true);
    expect(modelEndpointSchema.safeParse({ ...endpoint, protocol: 'gemini' }).success).toBe(false);
  });

  it('GEN-031 refuses an endpoint that does not state whether it is outside the boundary', () => {
    const stated: Record<string, unknown> = { ...endpoint };
    delete stated.boundary;
    expect(modelEndpointSchema.safeParse(stated).success).toBe(false);
    expect(modelEndpointSchema.safeParse({ ...endpoint, boundary: 'unknown' }).success).toBe(false);
  });

  it('refuses a base URL with a user, a query or a trailing slash, and a price past six places', () => {
    for (const baseUrl of [
      'https://ada@models.example.test',
      'https://models.example.test/v1?x=1',
      'https://models.example.test/',
      'ftp://models.example.test',
    ]) {
      expect(modelEndpointSchema.safeParse({ ...endpoint, baseUrl }).success, baseUrl).toBe(false);
    }
    expect(modelEndpointSchema.safeParse({ ...endpoint, priceIn: 0.0000001 }).success).toBe(false);
    expect(modelEndpointSchema.safeParse({ ...endpoint, priceIn: 0.000001 }).success).toBe(true);
  });

  it('seals a key to its endpoint and the origin it signs in at, not to a path', () => {
    const id = '0d6f3c1e-6a5b-4c1d-9e2f-3a4b5c6d7e8f';
    expect(modelCredentialContext(id, endpoint)).toBe(
      JSON.stringify([id, 'anthropic', 'https://models.example.test']),
    );
    expect(
      modelCredentialContext(id, { ...endpoint, baseUrl: 'https://models.example.test/v2' }),
    ).toBe(modelCredentialContext(id, endpoint));
    expect(
      modelCredentialContext(id, { ...endpoint, baseUrl: 'https://other.example.test' }),
    ).not.toBe(modelCredentialContext(id, endpoint));
  });

  it('costs tokens at prices per million, in millionths, rounded half up', () => {
    expect(costMicros({ in: 1_000_000, out: 0 }, endpoint)).toBe(3_000_000n);
    expect(costMicros({ in: 1, out: 1 }, endpoint)).toBe(18n);
    expect(costMicros({ in: 1, out: 0 }, { priceIn: 0.5, priceOut: 0 })).toBe(1n);
    expect(costMicros({ in: 1, out: 0 }, { priceIn: 0.4, priceOut: 0 })).toBe(0n);
  });
});

const call: ModelCall = {
  model: 'claude-test',
  system: 'Draft as asked.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
  parameters: { maxTokens: 64 },
};

describe("the connector's model call", () => {
  it('is canonical whatever order its members were written in', () => {
    const reordered = {
      parameters: { maxTokens: 64 },
      messages: [{ content: [{ text: 'Hello', type: 'text' }], role: 'user' }],
      system: 'Draft as asked.',
      model: 'claude-test',
    } as unknown as ModelCall;
    expect(canonicalCall(reordered)).toBe(canonicalCall(call));
    expect(canonicalCall(call)).toBe(
      '{"messages":[{"content":[{"text":"Hello","type":"text"}],"role":"user"}],"model":"claude-test","parameters":{"maxTokens":64},"system":"Draft as asked."}',
    );
  });

  it('holds a deadline of 1 to 240 seconds, and no key of its own', () => {
    const request = {
      requestId: '7b0c1f6e-2d3a-4b5c-8d9e-0f1a2b3c4d5e',
      tenant: 'acme',
      endpoint: {
        id: '0d6f3c1e-6a5b-4c1d-9e2f-3a4b5c6d7e8f',
        protocol: 'anthropic',
        baseUrl: endpoint.baseUrl,
      },
      sealed: `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(30)}`,
      call,
      deadlineMs: 240_000,
    };
    expect(modelRequestSchema.safeParse(request).success).toBe(true);
    expect(modelRequestSchema.safeParse({ ...request, deadlineMs: 240_001 }).success).toBe(false);
    expect(modelRequestSchema.safeParse({ ...request, key: 'secret' }).success).toBe(false);
  });

  it('answers events, a failure carrying a code and a reason and nothing the provider said', () => {
    expect(
      modelEventSchema.safeParse({
        type: 'failed',
        failure: { code: 'model_unavailable', reason: 'key_refused' },
      }).success,
    ).toBe(true);
    expect(
      modelEventSchema.safeParse({
        type: 'failed',
        failure: { code: 'model_unavailable', message: 'invalid x-api-key' },
      }).success,
    ).toBe(false);
  });

  it('takes a reply naming a dated release of the model, and refuses another model', () => {
    expect(replyModelMatches('claude-test', 'claude-test')).toBe(true);
    expect(replyModelMatches('claude-test', 'claude-test-20260101')).toBe(true);
    expect(replyModelMatches('claude-test', 'claude-testing')).toBe(false);
    expect(replyModelMatches('claude-test', 'gpt-test')).toBe(false);
  });
});
