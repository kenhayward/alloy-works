import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi.js';
import { allRoutes, routes } from './routes.js';

describe('the editing routes in the published document', () => {
  const document = buildOpenApi(allRoutes);
  type Operation = {
    requestBody?: { required: boolean; content: Record<string, { schema: unknown }> };
    responses: Record<string, unknown>;
  };
  const operation = (path: string, method: string) => document.paths[path]?.[method] as Operation;

  it('describes a request body as required JSON, by its input schema', () => {
    const claim = operation('/v1/components/{id}/lock', 'post');
    expect(claim.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              session: expect.objectContaining({ type: 'string' }),
              move: expect.objectContaining({ type: 'boolean' }),
            },
            required: ['session'],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it('gives no request body to a route that declares none', () => {
    expect(operation('/v1/components/{id}', 'get').requestBody).toBeUndefined();
    expect(operation('/v1/components/{id}/lock', 'delete').requestBody).toBeUndefined();
  });

  it('requires a lowercase uuid for a session, matching what Postgres returns', () => {
    const claim = operation('/v1/components/{id}/lock', 'post');
    const schema = (
      claim.requestBody as {
        content: Record<
          string,
          { schema: { properties: Record<string, { allOf?: { pattern: string }[] }> } }
        >;
      }
    ).content['application/json']!.schema;
    const patterns = schema.properties.session?.allOf?.map((each) => each.pattern) ?? [];
    expect(patterns).toContainEqual(
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    );
  });

  it('closes a request body to unknown members, publishing additionalProperties: false', () => {
    const claim = operation('/v1/components/{id}/lock', 'post');
    const schema = (
      claim.requestBody as {
        content: Record<string, { schema: { additionalProperties?: boolean } }>;
      }
    ).content['application/json']!.schema;
    expect(schema.additionalProperties).toBe(false);
  });

  it('checks edit on the component for every write, and declares the refusals a session meets', () => {
    for (const name of ['claimLock', 'releaseLock', 'saveIteration', 'cutVersion'] as const) {
      expect(routes[name].access, name).toEqual({
        check: 'permission',
        permission: 'edit',
        target: { artifact: 'id' },
      });
      expect(routes[name].responses[409], name).toBeDefined();
    }
  });

  it('publishes a refusal with its members, so a client can name the holder without parsing prose', () => {
    const refusal = (
      operation('/v1/components/{id}/iterations/{session}/{sequence}', 'put').responses['409'] as {
        content: Record<string, { schema: { properties: Record<string, unknown> } }>;
      }
    ).content['application/json']!.schema;
    expect(Object.keys(refusal.properties)).toEqual(
      expect.arrayContaining(['code', 'message', 'holder', 'expectedRelease', 'current', 'latest']),
    );
  });
});
