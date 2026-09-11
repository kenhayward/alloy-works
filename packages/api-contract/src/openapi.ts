import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { API_VERSION } from './routes.js';
import { ErrorBody } from './schemas.js';

type Json = Record<string, unknown>;

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, Record<string, unknown>>;
}

/**
 * Response schemas are published open (API-012): a client must ignore a field it does not know, so
 * a field added later is not a breaking change. The service still sends only declared fields -
 * serialisation strips anything else - so opening the document promises nothing extra.
 */
function open(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(open);
  if (value !== null && typeof value === 'object') {
    const result: Json = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'additionalProperties' && inner === false) continue;
      result[key] = open(inner);
    }
    return result;
  }
  return value;
}

function responseSchema(schema: z.ZodType): Json {
  const json: Json = { ...z.toJSONSchema(schema, { io: 'output' }) };
  delete json.$schema; // the document declares its dialect once, not per schema
  return open(json) as Json;
}

function content(schema: z.ZodType) {
  return { 'application/json': { schema: responseSchema(schema) } };
}

export function buildOpenApi(routes: readonly RouteContract[]): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const ordered = [...routes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  for (const route of ordered) {
    const responses: Json = {};
    for (const [status, response] of Object.entries(route.responses)) {
      responses[status] = { description: response.description, content: content(response.schema) };
    }
    responses.default = {
      description: 'An error, in the one shape every error takes',
      content: content(ErrorBody),
    };
    (paths[route.path] ??= {})[route.method.toLowerCase()] = {
      operationId: route.operationId,
      summary: route.summary,
      responses,
    };
  }
  return { openapi: '3.1.0', info: { title: 'Alloy Works', version: API_VERSION }, paths };
}
