import { describe, expect, it } from 'vitest';
import { documentedOperations } from './documentation.js';
import { buildOpenApi } from './openapi.js';
import { allRoutes, API_VERSION } from './routes.js';

describe('the OpenAPI document', () => {
  const document = buildOpenApi(allRoutes);

  it('API-062 publishes a complete navigable description of every operation', () => {
    const described = document as typeof document & {
      tags?: { name: string; description: string }[];
      'x-tagGroups'?: { name: string; tags: string[] }[];
      servers?: { url: string }[];
    };
    expect(described.servers).toEqual([{ url: '/' }]);
    const tags = new Set((described.tags ?? []).map((tag) => tag.name));
    expect(tags.size).toBeGreaterThan(0);
    expect(described['x-tagGroups']?.length).toBeGreaterThan(1);
    for (const route of allRoutes) {
      const operation = document.paths[route.path]?.[route.method.toLowerCase()] as {
        description?: string;
        tags?: string[];
        'x-alloy-token-enabled'?: boolean;
        'x-alloy-permission'?: string;
      };
      expect(operation.description?.trim(), route.operationId).toBeTruthy();
      expect(operation.tags, route.operationId).toHaveLength(1);
      expect(tags.has(operation.tags?.[0] ?? ''), route.operationId).toBe(true);
      expect(operation['x-alloy-token-enabled'], route.operationId).toBe(
        route.access.check !== 'none' && route.access.credential !== 'session',
      );
      if (route.access.check === 'permission') {
        expect(operation['x-alloy-permission'], route.operationId).toBe(route.access.permission);
      }
    }
  });

  it('API-062 documents no operation the contract does not declare, and each in one place', () => {
    // A route renamed or removed takes its description and tag with it; neither outlives it.
    const declared = new Set(allRoutes.map((route) => route.operationId));
    const { tagged, described } = documentedOperations();
    expect(tagged.filter((operation) => !declared.has(operation))).toEqual([]);
    expect(described.filter((operation) => !declared.has(operation))).toEqual([]);
    expect(new Set(tagged).size).toBe(tagged.length);
  });

  it('API-062 keeps JSON examples valid against the schemas they describe', () => {
    for (const route of allRoutes) {
      const operation = document.paths[route.path]?.[route.method.toLowerCase()] as {
        requestBody?: { content?: { 'application/json'?: { example?: unknown } } };
        responses: Record<string, { content?: { 'application/json'?: { example?: unknown } } }>;
      };
      if (route.body) {
        const example = operation.requestBody?.content?.['application/json']?.example;
        expect(example, `${route.operationId} request example`).toBeDefined();
        expect(route.body.safeParse(example).success, `${route.operationId} request example`).toBe(
          true,
        );
      }
      for (const [status, response] of Object.entries(route.responses)) {
        if (!response.schema || Number(status) >= 300) continue;
        const example = operation.responses[status]?.content?.['application/json']?.example;
        expect(example, `${route.operationId} ${status} response example`).toBeDefined();
        expect(
          response.schema.safeParse(example).success,
          `${route.operationId} ${status} response example`,
        ).toBe(true);
      }
    }
  });

  it('API-062 describes the shared request and response headers', () => {
    const get = document.paths['/v1/me']?.get as {
      parameters: { name: string; in: string }[];
      responses: Record<string, { headers: Record<string, unknown> }>;
    };
    expect(get.parameters).toContainEqual(
      expect.objectContaining({ name: 'X-Request-Id', in: 'header' }),
    );
    expect(get.responses['200']?.headers).toHaveProperty('X-Request-Id');
    const post = document.paths['/v1/spaces/{space}/components']?.post as {
      parameters: { name: string; in: string }[];
      responses: Record<string, { headers: Record<string, unknown> }>;
    };
    expect(post.parameters).toContainEqual(
      expect.objectContaining({ name: 'Idempotency-Key', in: 'header' }),
    );
    expect(post.responses['200']?.headers).toHaveProperty('Idempotent-Replayed');
  });

  it('DAT-003 takes a credential through a route that answers none of it, and no route in the API document answers a secret', () => {
    // The credential goes in, to one route.
    const put = document.paths['/v1/connections/{id}/credential']?.put as {
      requestBody: { content: { 'application/json': { schema: unknown } } };
      responses: Record<string, unknown>;
    };
    expect(JSON.stringify(put.requestBody)).toContain('"secret"');
    // And nothing comes out: no response schema anywhere, of any route, holds a member named for a
    // secret, and a member named `credential` is only ever whether one is set, by whom and when.
    const names = new Set(['secret', 'sealed', 'password', 'credential']);
    const found: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) return node.forEach((each, index) => walk(each, `${at}[${index}]`));
      if (typeof node !== 'object' || node === null) return;
      const properties = (node as { properties?: Record<string, unknown> }).properties;
      for (const [name, value] of Object.entries(properties ?? {})) {
        if (!names.has(name.toLowerCase())) continue;
        // Whether one is set, by whom and when, and nothing else.
        const shape = JSON.stringify(value);
        if (
          name === 'credential' &&
          shape.includes('"setBy"') &&
          !/secret|sealed|password/i.test(shape)
        ) {
          continue;
        }
        found.push(`${at}.${name}`);
      }
      for (const [key, value] of Object.entries(node)) walk(value, `${at}.${key}`);
    };
    for (const [path, byMethod] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(byMethod as Record<string, unknown>)) {
        // The one secret the API answers: a personal token's own, once, to the person who made it
        // (service-foundations.md, TK-A), which is no connection's.
        if ((operation as { operationId?: string }).operationId === 'createToken') continue;
        walk((operation as { responses?: unknown }).responses, `${method} ${path}`);
      }
    }
    // Every schema a response refers to by name, as well.
    const components = (document as { components?: { schemas?: Record<string, unknown> } })
      .components?.schemas;
    for (const [name, schema] of Object.entries(components ?? {})) {
      if (/Body$/.test(name)) continue;
      walk(schema, name);
    }
    expect(found).toEqual([]);
  });

  it('offers no idempotency key on a route that takes none: the credential, a test and a describe', () => {
    for (const [path, method] of [
      ['/v1/connections/{id}/credential', 'put'],
      ['/v1/connections/{id}/test', 'post'],
      ['/v1/connections/{id}/describe', 'post'],
    ] as const) {
      const operation = document.paths[path]?.[method] as {
        parameters: { name: string }[];
        responses: Record<string, { headers?: Record<string, unknown> }>;
      };
      expect(
        operation.parameters.map((parameter) => parameter.name),
        path,
      ).not.toContain('Idempotency-Key');
      expect(operation.responses['200']?.headers, path).not.toHaveProperty('Idempotent-Replayed');
    }
    // A connection's other writes take one, as every mutating route does.
    const versions = document.paths['/v1/connections/{id}/versions']?.post as {
      parameters: { name: string }[];
    };
    expect(versions.parameters.map((parameter) => parameter.name)).toContain('Idempotency-Key');
  });

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
    for (const route of allRoutes) {
      const operation = document.paths[route.path]?.[route.method.toLowerCase()] as {
        responses: Record<string, { content: Record<string, { schema: Record<string, unknown> }> }>;
      };
      const schema = operation.responses.default?.content['application/json']?.schema;
      expect(schema, route.operationId).toMatchObject({
        type: 'object',
        required: ['code', 'message', 'traceId'],
        properties: { code: { type: 'string' }, rule: { type: 'string' } },
      });
    }
  });

  it('API-012 tells callers to ignore fields they do not know, and publishes every response open', () => {
    // Said where a caller reads first, as the contract of the whole API version: adding a field
    // breaks nobody who ignores what they do not know, and nothing a caller relies on is removed.
    expect(document.info.description).toMatch(/must ignore any field it does not know/);
    expect(document.info.description).toMatch(
      /Within an API version no field is removed and none changes its meaning/,
    );
    // And every response published open, so a caller's own validator never refuses a new field.
    // Scoped to responses: a request body is published closed on purpose (an unknown member is
    // refused, not silently dropped), and openapi.ts's own requestBody() test covers that.
    for (const byMethod of Object.values(document.paths)) {
      for (const operation of Object.values(byMethod) as { responses?: unknown }[]) {
        expect(JSON.stringify(operation.responses)).not.toContain('"additionalProperties":false');
      }
    }
  });

  it('resolves every reference inside the document, a recursive schema included', () => {
    // A recursive schema - a template's starting sections nest - is written with a reference to a
    // definition of its own; wherever it is embedded, the reference has to name a place in this
    // document, or no client can be generated from it.
    const refs = [...JSON.stringify(document).matchAll(/"\$ref":"([^"]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref, ref).toMatch(/^#\//);
      const target = ref
        .slice(2)
        .split('/')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part.replace(/~1/g, '/')],
          document,
        );
      expect(target, ref).toBeDefined();
    }
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

  it('says which operations need a session or a token, and how each is presented', () => {
    expect(document.components.securitySchemes).toEqual({
      session: { type: 'apiKey', in: 'cookie', name: '__Host-aw_session' },
      token: {
        type: 'http',
        scheme: 'bearer',
        description: expect.stringContaining('awt_'),
      },
    });
    expect(operation('/v1/me', 'get').security).toEqual([{ session: [] }, { token: [] }]);
    expect(operation('/v1/sign-out', 'post').security).toEqual([{ session: [] }]);
    expect(operation('/v1/tenant', 'get').security).toEqual([]);
  });

  it('describes a redirect by where it goes, with no body', () => {
    const redirect = operation('/v1/sign-in/organisation', 'get').responses['302'];
    expect(redirect?.headers).toHaveProperty('Location');
    expect(redirect?.content).toBeUndefined();
  });

  it('lists query parameters, required only when the schema requires them', () => {
    expect(
      operation('/v1/sign-in/organisation/callback', 'get').parameters?.filter(
        (parameter) => parameter.in === 'query',
      ),
    ).toEqual([
      { name: 'code', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'state', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'error', in: 'query', required: false, schema: { type: 'string' } },
    ]);
  });

  it('describes a response with no body by its status alone', () => {
    const signedOut = operation('/v1/sign-out', 'post').responses['204'];
    expect(signedOut).toMatchObject({
      description: 'Signed out, everywhere this session was in use',
    });
    expect(signedOut?.content).toBeUndefined();
  });

  it('marks a query parameter required when the schema requires it', () => {
    expect(
      operation('/v1/sign-in/google/complete', 'get').parameters?.filter(
        (parameter) => parameter.in === 'query',
      ),
    ).toEqual([{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }]);
  });

  it('lists a path parameter, always required', () => {
    const parameters = operation('/v1/samples/{sampleId}', 'get').parameters;
    expect(parameters?.filter((parameter) => parameter.in === 'path')).toHaveLength(1);
    expect(parameters?.[0]).toMatchObject({ name: 'sampleId', in: 'path', required: true });
  });

  it('describes a stream by the type it sends, not by a body', () => {
    const streamed = operation('/v1/stream', 'get').responses['200'] as {
      content: Record<string, unknown>;
    };
    expect(Object.keys(streamed.content)).toEqual(['text/event-stream']);
  });
});
