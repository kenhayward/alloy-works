import { z } from 'zod';
import type { RouteContract, RouteResponse } from './contract.js';
import { API_VERSION, SESSION_COOKIE } from './routes.js';
import { ErrorBody } from './schemas.js';

type Json = Record<string, unknown>;

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string; readonly description: string };
  readonly components: {
    readonly securitySchemes: Record<string, unknown>;
    readonly schemas?: Record<string, unknown>;
  };
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

/** Where a schema's own definitions go: the document's `components.schemas`, by a unique name. */
type Definitions = Record<string, Json>;

/**
 * A schema's own definitions - what a recursive schema, such as a template's nested starting sections,
 * is written with - moved into the document's `components.schemas` under names unique to where the
 * schema stands, and every reference to them rewritten to point there. Left inside the schema, a
 * reference `#/$defs/...` would resolve from the document's root, where there is nothing.
 */
function hoist(json: Json, name: string, definitions: Definitions): Json {
  const own = json.$defs as Record<string, Json> | undefined;
  if (own === undefined) return json;
  delete json.$defs;
  const renamed = new Map(
    Object.keys(own).map((key) => [key, `${name}_${key.replace(/^_+/, '')}`]),
  );
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => {
          if (key === '$ref' && typeof inner === 'string' && inner.startsWith('#/$defs/')) {
            const target = renamed.get(inner.slice('#/$defs/'.length));
            if (target !== undefined) return [key, `#/components/schemas/${target}`];
          }
          return [key, rewrite(inner)];
        }),
      );
    }
    return value;
  };
  for (const [key, definition] of Object.entries(own)) {
    definitions[renamed.get(key)!] = rewrite(definition) as Json;
  }
  return rewrite(json) as Json;
}

function responseSchema(schema: z.ZodType, name: string, definitions: Definitions): Json {
  const json: Json = { ...z.toJSONSchema(schema, { io: 'output' }) };
  delete json.$schema; // the document declares its dialect once, not per schema
  return open(hoist(json, name, definitions)) as Json;
}

function content(schema: z.ZodType, name: string, definitions: Definitions) {
  return { 'application/json': { schema: responseSchema(schema, name, definitions) } };
}

function response(
  status: number,
  declared: RouteResponse,
  name: string,
  definitions: Definitions,
): Json {
  if (declared.binary) {
    return {
      description: declared.description,
      content: Object.fromEntries(
        declared.binary.contentTypes.map((type) => [
          type,
          { schema: { type: 'string', contentMediaType: type } },
        ]),
      ),
    };
  }
  if (declared.stream) {
    return {
      description: declared.description,
      content: { 'text/event-stream': { schema: { type: 'string' } } },
    };
  }
  if (declared.schema) {
    return {
      description: declared.description,
      content: content(declared.schema, name, definitions),
    };
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

/**
 * A JSON request body, as its input schema describes it: required, and closed to a member the schema
 * did not declare (`additionalProperties: false`, where the schema is strict) - unlike a response,
 * published open, a request body is never run through `open()`: a caller that sends an unknown member
 * is telling the service something it does not understand, and dropping it silently would accept and
 * discard part of the request rather than refuse it.
 */
function requestBody(body: z.ZodObject, name: string, definitions: Definitions): Json {
  const json: Json = { ...z.toJSONSchema(body, { io: 'input' }) };
  delete json.$schema;
  return {
    required: true,
    content: { 'application/json': { schema: hoist(json, name, definitions) } },
  };
}

/**
 * What a caller may rely on across an API version (API-012), said where every caller reads first.
 * Callers are told, not only published open: an open schema permits a new field, and this is what
 * makes ignoring one the caller's side of the bargain.
 */
const COMPATIBILITY =
  'Adding a field to a response is never a breaking change, so a caller must ignore any field it ' +
  'does not know. Within an API version no field is removed and none changes its meaning.';

export function buildOpenApi(routes: readonly RouteContract[]): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const definitions: Definitions = {};
  const ordered = [...routes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  for (const route of ordered) {
    const responses: Json = {};
    for (const [status, declared] of Object.entries(route.responses)) {
      responses[status] = response(
        Number(status),
        declared,
        `${route.operationId}${status}`,
        definitions,
      );
    }
    responses.default = {
      description: 'An error, in the one shape every error takes',
      content: content(ErrorBody, `${route.operationId}Default`, definitions),
    };
    const parameters = [
      ...(route.params ? pathParameters(route.params) : []),
      ...(route.query ? queryParameters(route.query) : []),
    ];
    (paths[route.path] ??= {})[route.method.toLowerCase()] = {
      operationId: route.operationId,
      summary: route.summary,
      security: route.access.check === 'none' ? [] : [{ session: [] }],
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(route.body
        ? { requestBody: requestBody(route.body, `${route.operationId}Body`, definitions) }
        : {}),
      ...(route.rawBody
        ? {
            requestBody: {
              required: true,
              content: {
                [route.rawBody.contentType]: {
                  schema: {
                    type: 'string',
                    contentMediaType: route.rawBody.contentType,
                    maxLength: route.rawBody.maxBytes,
                  },
                },
              },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Alloy Works', version: API_VERSION, description: COMPATIBILITY },
    components: {
      securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE } },
      ...(Object.keys(definitions).length > 0 ? { schemas: definitions } : {}),
    },
    paths,
  };
}
