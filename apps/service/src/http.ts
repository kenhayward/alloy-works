import { randomUUID } from 'node:crypto';
import { ErrorBody } from '@alloy-works/api-contract';
import type { Writable } from 'node:stream';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type { z } from 'zod';
import type { LogLevel } from './config.js';
import { toErrorBody } from './errors.js';

export interface HttpOptions {
  readonly logLevel: LogLevel;
  /** Where log lines go; standard output unless a test captures them. */
  readonly logStream?: Writable;
  /**
   * Told of every route as it is registered, a HEAD beside each GET included: how a test holds the
   * routes served to the contract's, both ways (API-003). Registered first, so it hears every one.
   */
  readonly onRoute?: (route: { readonly method: string; readonly url: string }) => void;
}

/** What answers an address no route claims: the API saying, in its own shape, that there is none. */
export function apiNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.status(404).send({
    code: 'not_found',
    message: 'There is nothing at this address.',
    traceId: request.id,
  });
}

/**
 * The HTTP layer every route shares: structured logs labelled with a trace id per request, zod for
 * validating requests and serialising responses, and one error shape for every failure.
 */
export function createHttp(
  options: HttpOptions,
  /** Answers an address no route claims; the API's own refusal unless the renderer is served too. */
  notFound: (request: FastifyRequest, reply: FastifyReply) => unknown = apiNotFound,
): FastifyInstance {
  const app = Fastify({
    logger: {
      level: options.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      // The request line without its query string: a sign-in callback carries an authorisation
      // code, which is a credential for as long as it lives.
      serializers: {
        req: (request: { method: string; url: string; host: string }) => ({
          method: request.method,
          url: request.url.replace(/\?.*/s, ''),
          host: request.host,
        }),
      },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    genReqId: () => randomUUID(),
    // Fastify 5.12 deprecates the top-level requestIdLogLabel option, with a warning on stderr.
    logController: new LogController({ requestIdLogLabel: 'traceId' }),
  });

  if (options.onRoute) {
    const told = options.onRoute;
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) told({ method, url: route.url });
    });
  }

  app.setValidatorCompiler(({ schema }) => (data) => {
    const result = (schema as z.ZodType).safeParse(data);
    return result.success ? { value: result.data } : { error: result.error };
  });

  // Parsing on the way out strips undeclared fields, so nothing leaves that the contract does not
  // name; a response that fails its own schema is the service's fault and becomes a 500.
  app.setSerializerCompiler(
    ({ schema }) =>
      (data) =>
        JSON.stringify((schema as z.ZodType).parse(data)),
  );

  // Every status a route does not list is declared as the one error shape, as the published contract
  // declares it (`default`), so a status the contract does not name is serialised against that
  // shape: an error body goes out as one, with nothing it does not name, and anything else is the
  // service failing, never sent as it came (API-003, issue #240). A route declaring no responses at
  // all - the renderer's files - is left alone.
  app.addHook('onRoute', (route) => {
    const response = route.schema?.response as Record<string, unknown> | undefined;
    if (response !== undefined && !('default' in response)) {
      route.schema!.response = { ...response, default: ErrorBody };
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const { status, body } = toErrorBody(error, request.id);
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler(notFound);

  return app;
}
