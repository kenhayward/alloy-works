import { z } from 'zod';
import type { RouteContract, RouteResponse } from './contract.js';
import { API_VERSION, SESSION_COOKIE } from './routes.js';
import { ErrorBody } from './schemas.js';

type Json = Record<string, unknown>;

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string };
  readonly components: { readonly securitySchemes: Record<string, unknown> };
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

function response(status: number, declared: RouteResponse): Json {
  if (declared.stream) {
    return {
      description: declared.description,
      content: { 'text/event-stream': { schema: { type: 'string' } } },
    };
  }
  if (declared.schema) {
    return { description: declared.description, content: content(declared.schema) };
  }
  if (status >= 300 && status < 400) {
    return {
      description: declared.description,
      headers: { Location: { description: 'Where to go next', schema: { type: 'string' } } },
    };
  }
  return { description: declared.description };
}

function queryParameters(query: z.ZodObject): Json[] {
  const json = z.toJSONSchema(query, { io: 'input' }) as {
    properties?: Record<string, Json>;
    required?: string[];
  };
  return Object.entries(json.properties ?? {}).map(([name, schema]) => ({
    name,
    in: 'query',
    required: (json.required ?? []).includes(name),
    schema: open(schema),
  }));
}

function pathParameters(params: z.ZodObject): Json[] {
  const json = z.toJSONSchema(params, { io: 'input' }) as { properties?: Record<string, Json> };
  return Object.entries(json.properties ?? {}).map(([name, schema]) => ({
    name,
    in: 'path',
    required: true,
    schema: open(schema),
  }));
}

export function buildOpenApi(routes: readonly RouteContract[]): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const ordered = [...routes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  for (const route of ordered) {
    const responses: Json = {};
    for (const [status, declared] of Object.entries(route.responses)) {
      responses[status] = response(Number(status), declared);
    }
    responses.default = {
      description: 'An error, in the one shape every error takes',
      content: content(ErrorBody),
    };
    const parameters = [
      ...(route.params ? pathParameters(route.params) : []),
      ...(route.query ? queryParameters(route.query) : []),
    ];
    (paths[route.path] ??= {})[route.method.toLowerCase()] = {
      operationId: route.operationId,
      summary: route.summary,
      security: route.authenticated ? [{ session: [] }] : [],
      ...(parameters.length > 0 ? { parameters } : {}),
      responses,
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Alloy Works', version: API_VERSION },
    components: {
      securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE } },
    },
    paths,
  };
}
