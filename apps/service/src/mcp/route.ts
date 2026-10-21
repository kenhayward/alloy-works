import { findApiToken, recordEvent, type Tenant, type TenantDatabase } from '@alloy-works/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { contextOf } from '../audit.js';
import { REQUEST_ID_HEADER } from '../http.js';
import { hashToken } from '../sessions.js';
import { bearerSecret, isBearer } from '../tokens.js';
import {
  failure,
  initialized,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  negotiate,
  PARSE_ERROR,
  parseMessage,
  result,
  versionOf,
  type RequestId,
} from './protocol.js';
import { listed, tools, type Answer, type Call, type Tool } from './tools.js';

const byName = new Map(tools.map((tool) => [tool.name, tool]));

/** A code from a route's refusal, for the model and the audit: the route's own. */
const codeOf = (body: unknown): string | undefined => {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : undefined;
};

/** The JSON a result's text holds: the structured answer itself, never prose (G8-E). */
const asText = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }];

/**
 * `/mcp` (ADR-0065; the G8 plan, G8-A and G8-B): a raw route, as the docs' are, doing what a contract
 * route's hooks do - the tenant by host, the bearer token - with its own errors in JSON-RPC.
 */
export function registerMcp(
  app: FastifyInstance,
  db: TenantDatabase,
  resolve: (hostname: string) => Promise<Tenant | undefined>,
): void {
  const send = (reply: FastifyReply, status: number, body: unknown) =>
    reply.status(status).header('Cache-Control', 'no-store').type('application/json').send(body);

  /** One wrapped route, in process, as the caller: their token, the host, the trace id (G8-B). */
  const callerOf =
    (request: FastifyRequest): Call =>
    async (method, path, options = {}) => {
      const query = new URLSearchParams(options.query ?? {}).toString();
      const answer = await app.inject({
        method,
        url: query === '' ? path : `${path}?${query}`,
        headers: {
          host: request.host,
          authorization: request.headers.authorization!,
          [REQUEST_ID_HEADER]: request.id,
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
      });
      let body: unknown;
      try {
        body = answer.body === '' ? null : JSON.parse(answer.body);
      } catch {
        body = null;
      }
      return { status: answer.statusCode, body };
    };

  /** Records the call (API-023; G8-F), in its own transaction, so a refusal is recorded too. */
  const audit = async (
    request: FastifyRequest,
    tenant: Tenant,
    tool: Tool,
    args: unknown,
    outcome: 'ok' | 'refused' | 'failed',
    code: string | undefined,
  ) => {
    try {
      const subject = tool.subject(args as never);
      await db.withTenant(
        tenant,
        (trx) =>
          recordEvent(trx, {
            kind: 'tool.used',
            subject: subject ?? { kind: 'tenant' },
            outcome: outcome === 'refused' ? 'refused' : 'done',
            detail: {
              tool: tool.name,
              arguments: tool.audited(args as never),
              outcome,
              ...(code === undefined ? {} : { code }),
            },
          }),
        contextOf(request),
      );
    } catch (error) {
      // The call stands; its record does not, which is logged as a refusal's would be (G8-F).
      request.log.error({ err: error, tool: tool.name }, 'A tool call could not be recorded');
    }
  };

  const callTool = async (
    request: FastifyRequest,
    tenant: Tenant,
    id: RequestId,
    params: Readonly<Record<string, unknown>>,
  ) => {
    const tool = typeof params['name'] === 'string' ? byName.get(params['name']) : undefined;
    if (!tool) return failure(id, INVALID_PARAMS, 'No tool of that name.');
    const parsed = tool.input.safeParse(params['arguments'] ?? {});
    if (!parsed.success) {
      // Invalid arguments are the tool's error, so the model can correct them (2025-11-25).
      return result(id, {
        content: asText({ code: 'invalid_arguments', issues: parsed.error.issues }),
        isError: true,
      });
    }
    let answer: Answer;
    try {
      answer = await tool.run(parsed.data as never, callerOf(request));
    } catch (error) {
      request.log.error({ err: error, tool: tool.name }, 'A tool call failed');
      await audit(request, tenant, tool, parsed.data, 'failed', undefined);
      return failure(id, INTERNAL_ERROR, 'The tool failed.');
    }
    if (answer.ok) {
      await audit(request, tenant, tool, parsed.data, 'ok', undefined);
      return result(id, { content: asText(answer.value), structuredContent: answer.value });
    }
    const code = codeOf(answer.body);
    if (answer.status >= 500) {
      await audit(request, tenant, tool, parsed.data, 'failed', code);
      return failure(id, INTERNAL_ERROR, 'The tool failed.');
    }
    await audit(request, tenant, tool, parsed.data, 'refused', code);
    return result(id, { content: asText(answer.body), isError: true });
  };

  app.get('/mcp', (_request, reply) =>
    send(reply.header('Allow', 'POST'), 405, failure(null, INVALID_REQUEST, 'POST a message.')),
  );

  app.post(
    '/mcp',
    {
      // A body that is not JSON is the protocol's parse error, never the API's.
      errorHandler: (error, request, reply) => {
        if ((error as { statusCode?: number }).statusCode === 400) {
          return send(reply, 400, failure(null, PARSE_ERROR, 'The body is not JSON.'));
        }
        request.log.error({ err: error }, 'The MCP endpoint failed');
        return send(reply, 500, failure(null, INTERNAL_ERROR, 'The server failed.'));
      },
    },
    async (request, reply) => {
      const tenant = await resolve(request.hostname);
      if (!tenant) {
        return send(reply, 404, failure(null, INVALID_REQUEST, 'No environment is served here.'));
      }
      // Only this environment's pages may call it from a browser (the specification's DNS rebinding
      // guard); a client that is not a browser sends no Origin.
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== `${request.protocol}://${request.host}`) {
        return send(reply, 403, failure(null, INVALID_REQUEST, 'Not from this environment.'));
      }
      // A bearer token alone: a cookie is never read, so no page drives a session through it.
      const authorization = request.headers.authorization;
      const secret =
        authorization !== undefined && isBearer(authorization)
          ? bearerSecret(authorization)
          : undefined;
      const holder =
        secret === undefined
          ? undefined
          : await db.withTenant(tenant, (trx) =>
              findApiToken(trx, hashToken(secret), new Date(), request.id),
            );
      if (!holder) {
        return send(
          reply.header('WWW-Authenticate', 'Bearer'),
          401,
          failure(null, INVALID_REQUEST, 'Connect with an API token, as a bearer.'),
        );
      }
      request.tenant = tenant;
      request.principal = {
        principalId: holder.principalId,
        email: holder.email,
        displayName: holder.displayName,
      };
      request.credential = { kind: 'token', id: holder.tokenId, scopes: holder.scopes };

      const message = parseMessage(request.body);
      if (message.kind === 'invalid') {
        return send(reply, 400, failure(message.id, INVALID_REQUEST, message.message));
      }
      if (message.kind !== 'request') return reply.status(202).send();
      if (message.method === 'initialize') {
        return send(
          reply,
          200,
          result(message.id, initialized(negotiate(message.params['protocolVersion']))),
        );
      }
      const header = request.headers['mcp-protocol-version'];
      if (versionOf(typeof header === 'string' ? header : undefined) === undefined) {
        return send(
          reply,
          400,
          failure(message.id, INVALID_REQUEST, 'That protocol version is not held.'),
        );
      }
      switch (message.method) {
        case 'ping':
          return send(reply, 200, result(message.id, {}));
        case 'tools/list':
          return send(reply, 200, result(message.id, { tools: tools.map(listed) }));
        case 'tools/call':
          return send(reply, 200, await callTool(request, tenant, message.id, message.params));
        default:
          return send(reply, 200, failure(message.id, METHOD_NOT_FOUND, 'No such method.'));
      }
    },
  );
}
