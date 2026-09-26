import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from './errors.js';
import { createHttp } from './http.js';
import type { ZodTypeProvider } from './type-provider.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, stream };
}

function testApp() {
  const logs = capture();
  const app = createHttp({
    logLevel: 'info',
    logStream: logs.stream,
  }).withTypeProvider<ZodTypeProvider>();
  const Named = z.object({ name: z.string() });
  app.get('/named', { schema: { response: { 200: Named } } }, async () => {
    // Held in a variable: a literal with an undeclared field would not compile, and the point is
    // what happens when one arrives at runtime anyway.
    const person = { name: 'Ada', password: 'should never leave' };
    return person;
  });
  app.get(
    '/malformed',
    { schema: { response: { 200: Named } } },
    async () => ({ name: 42 }) as unknown as { name: string },
  );
  app.get(
    '/items/:id',
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: Named } } },
    async (request) => ({ name: request.params.id }),
  );
  app.post('/named', { schema: { body: Named, response: { 200: Named } } }, async (request) => ({
    name: request.body.name,
  }));
  // The rule identifier is invented: ZZZ is the area reserved for fixtures, and the traceability
  // scan ignores it. A real one here would read as a citation - this test verifies the shape of a
  // refusal, not whatever requirement the identifier names.
  app.get('/refused', async () => {
    throw new AppError(403, 'forbidden', 'You may not do that here.', 'ZZZ-001');
  });
  app.get('/broken', async () => {
    throw new Error('connection to postgres://aw_service:hunter2@db failed');
  });
  app.get('/held', async () => {
    throw new AppError(409, 'held', 'Somebody else has this.', undefined, {
      holder: { id: 'p1', name: 'Grace' },
      code: 'not-this-one',
      traceId: 'not-this-either',
    });
  });
  return { app, logs };
}

const TRACE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('the HTTP layer', () => {
  it('sends only the fields a response declares', async () => {
    const { app } = testApp();
    const response = await app.inject('/named');
    expect(response.json()).toEqual({ name: 'Ada' });
  });

  it('answers a request that fails its schema with invalid_request, naming the part and field', async () => {
    const { app } = testApp();
    const response = await app.inject('/items/not-an-id');
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({ code: 'invalid_request' });
    expect(body.message).toMatch(/params/);
    expect(body.message).toMatch(/id/);
    expect(body.message).not.toContain('not-an-id');
    expect(body.traceId).toMatch(TRACE);
  });

  it('passes on the code, message and rule of a refusal', async () => {
    const { app } = testApp();
    const response = await app.inject('/refused');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'forbidden',
      message: 'You may not do that here.',
      rule: 'ZZZ-001',
    });
  });

  it("sends a refusal's members beside its code, message and trace id, never in place of them", async () => {
    const { app } = testApp();
    const response = await app.inject('/held');
    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body).toMatchObject({
      code: 'held',
      message: 'Somebody else has this.',
      holder: { id: 'p1', name: 'Grace' },
    });
    expect(body.traceId).toMatch(TRACE);
  });

  it('turns an unexpected failure into a generic 500 and logs the detail instead', async () => {
    const { app, logs } = testApp();
    const response = await app.inject('/broken');
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.code).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(logs.lines.join('')).toContain(body.traceId);
  });

  it('treats a response that breaks its own schema as the service failing, not the caller', async () => {
    const { app } = testApp();
    const response = await app.inject('/malformed');
    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe('internal');
    expect(response.body).not.toContain('invalid_type');
  });

  it('answers an unknown route with not_found in the same shape', async () => {
    const { app } = testApp();
    const response = await app.inject('/nowhere');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'not_found' });
    expect(response.json().traceId).toMatch(TRACE);
  });

  it('labels every log line of a request with its trace id', async () => {
    const { app, logs } = testApp();
    await app.inject('/named');
    const lines = logs.lines.map((line) => JSON.parse(line) as { traceId?: string });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.traceId).toMatch(TRACE);
  });
});

describe('the shape of every failure', () => {
  const failures = [
    {
      said: 'a request that fails its schema',
      url: '/items/not-an-id',
      status: 400,
      code: 'invalid_request',
    },
    { said: 'a refusal', url: '/refused', status: 403, code: 'forbidden' },
    { said: 'an unexpected failure', url: '/broken', status: 500, code: 'internal' },
    {
      said: 'a response that breaks its own schema',
      url: '/malformed',
      status: 500,
      code: 'internal',
    },
    { said: 'an unknown route', url: '/nowhere', status: 404, code: 'not_found' },
    {
      said: 'a body that is not JSON',
      url: '/named',
      body: '{"name": ',
      status: 400,
      code: 'invalid_request',
    },
  ] as const;

  it('API-005 answers every kind of failure with a stable code beside a message, and a trace id', async () => {
    for (const failure of failures) {
      const { app } = testApp();
      const response = await app.inject(
        'body' in failure
          ? {
              method: 'POST',
              url: failure.url,
              headers: { 'content-type': 'application/json' },
              payload: failure.body,
            }
          : { url: failure.url },
      );
      expect(response.statusCode, failure.said).toBe(failure.status);
      const body = response.json<Record<string, unknown>>();
      // The code is the machine's, the same on every answer of this kind; the message is a person's.
      expect(body.code, failure.said).toBe(failure.code);
      expect(typeof body.message, failure.said).toBe('string');
      expect(body.message, failure.said).not.toBe('');
      expect(body.message, failure.said).not.toBe(body.code);
      expect(body.traceId, failure.said).toMatch(TRACE);
    }
  });
});
