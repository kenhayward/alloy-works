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
  app.get('/refused', async () => {
    throw new AppError(403, 'forbidden', 'You may not do that here.', 'IAM-018');
  });
  app.get('/broken', async () => {
    throw new Error('connection to postgres://aw_service:hunter2@db failed');
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
      rule: 'IAM-018',
    });
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
