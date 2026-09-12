import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi.js';
import { allRoutes, API_VERSION } from './routes.js';

describe('the OpenAPI document', () => {
  const document = buildOpenApi(allRoutes);

  it('is OpenAPI 3.1, at the API version rather than the product release', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(API_VERSION);
  });

  it('publishes every route under its path and method, with its operation id', () => {
    for (const route of allRoutes) {
      const operation = document.paths[route.path]?.[route.method.toLowerCase()] as
        { operationId: string } | undefined;
      expect(operation?.operationId, `${route.method} ${route.path}`).toBe(route.operationId);
    }
  });

  it('gives every operation the one error shape as its default response', () => {
    const operation = document.paths['/v1/tenant']?.get as {
      responses: Record<string, { content: Record<string, { schema: Record<string, unknown> }> }>;
    };
    const schema = operation.responses.default?.content['application/json']?.schema;
    expect(schema).toMatchObject({
      type: 'object',
      required: ['code', 'message', 'traceId'],
      properties: { code: { type: 'string' }, rule: { type: 'string' } },
    });
  });

  it('publishes response objects open, so a field added later never breaks a client', () => {
    expect(JSON.stringify(document)).not.toContain('"additionalProperties":false');
  });

  it('carries no JSON Schema dialect markers inside the document', () => {
    expect(JSON.stringify(document)).not.toContain('$schema');
  });

  type Operation = {
    security: Record<string, string[]>[];
    parameters?: { name: string; in: string; required: boolean }[];
    responses: Record<string, { headers?: Record<string, unknown>; content?: unknown }>;
  };
  const operation = (path: string, method: string) => document.paths[path]?.[method] as Operation;

  it('says which operations need a session, and how one is presented', () => {
    expect(document.components.securitySchemes).toEqual({
      session: { type: 'apiKey', in: 'cookie', name: '__Host-aw_session' },
    });
    expect(operation('/v1/me', 'get').security).toEqual([{ session: [] }]);
    expect(operation('/v1/tenant', 'get').security).toEqual([]);
  });

  it('describes a redirect by where it goes, with no body', () => {
    const redirect = operation('/v1/sign-in/organisation', 'get').responses['302'];
    expect(redirect?.headers).toHaveProperty('Location');
    expect(redirect?.content).toBeUndefined();
  });

  it('lists query parameters, required only when the schema requires them', () => {
    expect(operation('/v1/sign-in/organisation/callback', 'get').parameters).toEqual([
      { name: 'code', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'state', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'error', in: 'query', required: false, schema: { type: 'string' } },
    ]);
  });

  it('describes a response with no body by its status alone', () => {
    const signedOut = operation('/v1/sign-out', 'post').responses['204'];
    expect(signedOut).toEqual({ description: 'Signed out, everywhere this session was in use' });
  });

  it('marks a query parameter required when the schema requires it', () => {
    expect(operation('/v1/sign-in/google/complete', 'get').parameters).toEqual([
      { name: 'code', in: 'query', required: true, schema: { type: 'string' } },
    ]);
  });

  it('lists a path parameter, always required', () => {
    const parameters = operation('/v1/samples/{sampleId}', 'get').parameters;
    expect(parameters).toHaveLength(1);
    expect(parameters?.[0]).toMatchObject({ name: 'sampleId', in: 'path', required: true });
  });

  it('describes a stream by the type it sends, not by a body', () => {
    const streamed = operation('/v1/stream', 'get').responses['200'] as {
      content: Record<string, unknown>;
    };
    expect(Object.keys(streamed.content)).toEqual(['text/event-stream']);
  });
});
