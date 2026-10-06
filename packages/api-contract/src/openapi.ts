import { z } from 'zod';
import type { RouteContract, RouteResponse } from './contract.js';
import { documentationFor, documentationGroups } from './documentation.js';
import { API_VERSION, SESSION_COOKIE } from './routes.js';
import { ErrorBody } from './schemas.js';

type Json = Record<string, unknown>;

/** A schema-valid, deliberately small specimen; examples do not invent tenant identifiers. */
function exampleFor(schema: z.ZodType, io: 'input' | 'output', name = ''): unknown {
  const root = z.toJSONSchema(schema, { io }) as Json;
  const definitions = (root.$defs ?? {}) as Record<string, Json>;
  const value = (node: Json, seen: ReadonlySet<string>): unknown => {
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
      const name = node.$ref.slice(8);
      if (seen.has(name)) return {};
      return value(definitions[name] ?? {}, new Set([...seen, name]));
    }
    if ('const' in node) return node.const;
    if (Array.isArray(node.enum)) return node.enum[0];
    for (const alternative of ['anyOf', 'oneOf'] as const) {
      const choices = node[alternative] as Json[] | undefined;
      if (choices?.length) return value(choices[0]!, seen);
    }
    if (Array.isArray(node.allOf) && node.type === undefined) {
      return Object.assign({}, ...node.allOf.map((part) => value(part as Json, seen)));
    }
    const type = Array.isArray(node.type)
      ? node.type.find((candidate) => candidate !== 'null')
      : node.type;
    if (type === 'object' || node.properties) {
      const properties = (node.properties ?? {}) as Record<string, Json>;
      return Object.fromEntries(
        ((node.required ?? []) as string[]).map((name) => [
          name,
          name === 'level'
            ? 'tenant'
            : name === 'language'
              ? 'en'
              : value(properties[name] ?? {}, seen),
        ]),
      );
    }
    if (type === 'array') {
      const item = (node.items ?? {}) as Json;
      return Number(node.minItems ?? 0) > 0 ? [value(item, seen)] : [];
    }
    if (type === 'string') {
      if (JSON.stringify(node.allOf ?? node.pattern ?? '').includes('0-9a-fA-F')) {
        return '00000000-0000-4000-8000-000000000001';
      }
      // A lowercase identifier, a SHA-256 in hexadecimal and an instant in UTC, as a dataset
      // version's provenance holds them (the D3 plan).
      const pattern = JSON.stringify(node.allOf ?? node.pattern ?? '');
      if (pattern.includes('[0-9a-f]{8}-[0-9a-f]{4}'))
        return '00000000-0000-4000-8000-000000000001';
      if (pattern.includes('[0-9a-f]{64}')) return '0'.repeat(64);
      if (pattern.includes('\\\\d{4}-\\\\d{2}-\\\\d{2}T')) return '2026-01-01T00:00:00.000Z';
      switch (node.format) {
        case 'uuid':
          return '00000000-0000-4000-8000-000000000001';
        case 'date-time':
          return '2026-01-01T00:00:00.000Z';
        case 'date':
          return '2026-01-01';
        case 'email':
          return 'developer@example.com';
        case 'uri':
        case 'url':
          return 'https://example.com/';
      }
      return 'example';
    }
    if (type === 'integer' || type === 'number') return Number(node.minimum ?? 0);
    if (type === 'boolean') return false;
    return null;
  };
  const candidate =
    name === 'createDefinitionBody'
      ? {
          kind: 'field',
          definition: {
            schemaVersion: 1,
            name: 'Study number',
            dataType: 'text',
            multiplicity: 'one',
            validation: {},
          },
        }
      : name === 'editOutlineBody'
        ? {
            openedFrom: '00000000-0000-4000-8000-000000000001',
            operation: { operation: 'remove', node: 'a'.repeat(26) },
          }
        : // A credential is one secret or an S3 key pair, each optional alone (the D6 plan).
          name === 'setConnectionCredentialBody'
          ? { secret: 'an-invented-password' }
          : value(root, new Set());
  const checked = schema.safeParse(candidate);
  if (!checked.success) {
    throw new Error(
      `Cannot make a valid OpenAPI example: ${JSON.stringify(candidate)} ${JSON.stringify(checked.error.issues)}`,
    );
  }
  return candidate;
}

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string; readonly description: string };
  readonly servers: readonly { readonly url: string }[];
  readonly tags: readonly { readonly name: string; readonly description: string }[];
  readonly 'x-tagGroups': readonly { readonly name: string; readonly tags: readonly string[] }[];
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

function content(schema: z.ZodType, name: string, definitions: Definitions, example = false) {
  return {
    'application/json': {
      schema: responseSchema(schema, name, definitions),
      ...(example ? { example: exampleFor(schema, 'output') } : {}),
    },
  };
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
      content: content(declared.schema, name, definitions, status < 300),
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
    content: {
      'application/json': {
        schema: hoist(json, name, definitions),
        example: exampleFor(body, 'input', name),
      },
    },
  };
}

/**
 * What a caller may rely on across an API version (API-012), said where every caller reads first.
 * Callers are told, not only published open: an open schema permits a new field, and this is what
 * makes ignoring one the caller's side of the bargain.
 */
const COMPATIBILITY =
  'Adding a field to a response is never a breaking change, so a caller must ignore any field it ' +
  'does not know. Within an API version no field is removed and none changes its meaning. ' +
  'Use a personal token in Authorization: Bearer for token-enabled operations; sign-in and token ' +
  'management require a browser session. Errors use one JSON shape with a code and traceId. ' +
  'X-Request-Id may be supplied by a caller and is returned on every response. Listings use opaque ' +
  'cursors; send the next cursor without editing it. For supported mutations, Idempotency-Key ' +
  'makes a retry safe and Idempotent-Replayed marks a replay. Versioned edits require the version ' +
  'the caller read; a conflict means read again before editing. The current v1 document describes ' +
  'the synchronous HTTP API; the event stream has a separately specified protocol.';

export function buildOpenApi(routes: readonly RouteContract[]): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const definitions: Definitions = {};
  const ordered = [...routes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  for (const route of ordered) {
    const documentation = documentationFor(route);
    const keyed =
      (route.method !== 'GET' &&
        route.access.check === 'permission' &&
        route.idempotencyKey !== false) ||
      route.operationId === 'requestSample';
    const responses: Json = {};
    for (const [status, declared] of Object.entries(route.responses)) {
      const described = response(
        Number(status),
        declared,
        `${route.operationId}${status}`,
        definitions,
      );
      responses[status] = {
        ...described,
        headers: {
          ...(described.headers as Json | undefined),
          'X-Request-Id': {
            description: 'Trace identifier assigned to this request.',
            schema: { type: 'string' },
          },
          ...(keyed && Number(status) < 300
            ? {
                'Idempotent-Replayed': {
                  description: 'True when this answer is a replay of an earlier keyed request.',
                  schema: { type: 'string', enum: ['true'] },
                },
              }
            : {}),
        },
      };
    }
    responses.default = {
      description: 'An error, in the one shape every error takes',
      content: content(ErrorBody, `${route.operationId}Default`, definitions),
      headers: {
        'X-Request-Id': {
          description: 'Trace identifier assigned to this request.',
          schema: { type: 'string' },
        },
      },
    };
    const parameters = [
      ...(route.params ? pathParameters(route.params) : []),
      ...(route.query ? queryParameters(route.query) : []),
    ];
    (paths[route.path] ??= {})[route.method.toLowerCase()] = {
      operationId: route.operationId,
      summary: route.summary,
      description: documentation.description,
      tags: [documentation.tag],
      'x-alloy-token-enabled':
        route.access.check !== 'none' && route.access.credential !== 'session',
      ...(route.access.check === 'permission'
        ? { 'x-alloy-permission': route.access.permission }
        : {}),
      security:
        route.access.check === 'none'
          ? []
          : route.access.credential === 'session'
            ? [{ session: [] }]
            : [{ session: [] }, { token: [] }],
      parameters: [
        ...parameters,
        {
          name: 'X-Request-Id',
          in: 'header',
          required: false,
          description: 'Optional caller-supplied trace identifier (up to 128 safe characters).',
          schema: { type: 'string', maxLength: 128 },
        },
        ...(keyed
          ? [
              {
                name: 'Idempotency-Key',
                in: 'header',
                required: false,
                description: 'Use the same key to retry this mutation without applying it twice.',
                schema: { type: 'string' },
              },
            ]
          : []),
      ],
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
    servers: [{ url: '/' }],
    tags: documentationGroups.flatMap((group) => [...group.tags]),
    'x-tagGroups': documentationGroups.map((group) => ({
      name: group.name,
      tags: group.tags.map((tag) => tag.name),
    })),
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
        token: {
          type: 'http',
          scheme: 'bearer',
          description:
            'A personal API token, awt_ and 43 characters, issued by POST /v1/tokens. It acts as the person who issued it, masked to its scopes',
        },
      },
      ...(Object.keys(definitions).length > 0 ? { schemas: definitions } : {}),
    },
    paths,
  };
}
