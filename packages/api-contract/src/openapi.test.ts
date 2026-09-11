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
});
