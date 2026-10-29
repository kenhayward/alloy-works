import { BridgeErrorSchema } from '@kenhayward/bridge-contract';
import { describe, expect, it } from 'vitest';
import { refuse, toBridgeAnswer } from './errors.js';

describe("the bridge's answers to failure", () => {
  it('a database out of reach is sink_unavailable, and every retryable class 503', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', '08006', '57P01']) {
      const answer = toBridgeAnswer(Object.assign(new Error('connect failed'), { code }));
      expect(answer.status).toBe(503);
      expect(answer.body).toEqual({
        class: 'retryable',
        code: 'sink_unavailable',
        message: expect.any(String),
      });
    }
    const unexpected = toBridgeAnswer(new Error('something else'));
    expect(unexpected.status).toBe(503);
    expect(BridgeErrorSchema.parse(unexpected.body)).toMatchObject({ code: 'internal' });
    expect(unexpected.body.message).not.toContain('something else');
    expect(toBridgeAnswer(refuse('timeout', 'Too slow.')).status).toBe(503);
    expect(toBridgeAnswer(refuse('not_found', 'Gone.')).status).toBe(422);
  });

  it('a body Fastify would not read is too_large or invalid_request', () => {
    expect(toBridgeAnswer({ statusCode: 413 }).body.details).toEqual({ reason: 'too_large' });
    expect(toBridgeAnswer({ statusCode: 400 }).body.details).toEqual({
      reason: 'invalid_request',
    });
  });
});
