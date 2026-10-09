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
import { AppError, toErrorBody } from './errors.js';
import { spaceRefusal } from './space-refusals.js';

export interface HttpOptions {
  readonly logLevel: LogLevel;
  /** Where log lines go; standard output unless a test captures them. */
  readonly logStream?: Writable;
  /**
   * Told of every route as it is registered, a HEAD beside each GET included: how a test holds the
   * routes served to the contract's, both ways (API-003). Registered first, so it hears every one.
   */
  readonly onRoute?: (route: { readonly method: string; readonly url: string }) => void;
  /** A proxy's addresses or ranges, whose forwarded protocol and host are believed (`Config`). */
  readonly trustProxy?: string;
}

/** What a route's failure is told to before it is answered (`createHttp`). */
export type FailureHook = (request: FastifyRequest, error: unknown) => Promise<void>;

/** The header a request identifier travels in, both ways (API-047). */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * A caller's own request identifier, where it is one to keep: a plain token of at most 128
 * characters. Anything else is not taken - it would be written into the log as it came - and the
 * request is given a fresh one, as one that sent none is.
 */
const CALLERS_OWN = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestIdOf(header: string | string[] | undefined): string {
  return typeof header === 'string' && CALLERS_OWN.test(header) ? header : randomUUID();
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
/**
 * Logs a request that failed. The service's own failure is an error, with its stack; a data failure
 * laid at the source or a query's author (DAT-049) - a describe's `connection_failed`, a 502 - is
 * theirs, not the product's, and is a warning naming its code and whose it is, with no stack: an
 * operator reads it as a tenant's source misbehaving, not as the service breaking.
 */
export function logFailure(request: FastifyRequest, error: unknown, status: number): void {
  const attribution = error instanceof AppError ? error.members.attribution : undefined;
  if (attribution === 'connector' || attribution === 'query') {
    request.log.warn({ code: (error as AppError).code, attribution, status }, 'the source failed');
    return;
  }
  if (status >= 500) request.log.error({ err: error }, 'request failed');
}

export function createHttp(
  options: HttpOptions,
  /** Answers an address no route claims; the API's own refusal unless the renderer is served too. */
  notFound: (request: FastifyRequest, reply: FastifyReply) => unknown = apiNotFound,
  /**
   * Told of every failure before it is answered: how a refused authorisation reaches the audit log
   * (the AU1 plan, AU1-E). It must not throw; the answer is the same whatever it does.
   */
  failed: FailureHook = async () => {},
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
    // The trace id every log line and every error carries, and the header every response does.
    genReqId: (request) => requestIdOf(request.headers[REQUEST_ID_HEADER]),
    // Fastify 5.12 deprecates the top-level requestIdLogLabel option, with a warning on stderr.
    logController: new LogController({ requestIdLogLabel: 'traceId' }),
    ...(options.trustProxy ? { trustProxy: options.trustProxy } : {}),
  });

  if (options.onRoute) {
    const told = options.onRoute;
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) told({ method, url: route.url });
    });
  }

  // On every response, whatever answered it - a route, a refusal, the not-found handler, the
  // renderer - so a caller can quote it whether or not anything went wrong (API-047).
  app.addHook('onSend', async (request, reply, payload) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    return payload;
  });

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

  app.setErrorHandler(async (error, request, reply) => {
    await failed(request, error);
    // A creation in an archived space is refused wherever it was tried (the SP1 plan, SP-C).
    const { status, body } = toErrorBody(spaceRefusal(error) ?? error, request.id);
    logFailure(request, error, status);
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler(notFound);

  return app;
}
