import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { LogLevel } from './config.js';
import { toErrorBody } from './errors.js';

export interface HttpOptions {
  readonly logLevel: LogLevel;
  /** Where log lines go; standard output unless a test captures them. */
  readonly logStream?: Writable;
}

/**
 * The HTTP layer every route shares: structured logs labelled with a trace id per request, zod for
 * validating requests and serialising responses, and one error shape for every failure.
 */
export function createHttp(options: HttpOptions): FastifyInstance {
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

  app.setErrorHandler((error, request, reply) => {
    const { status, body } = toErrorBody(error, request.id);
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      code: 'not_found',
      message: 'There is nothing at this address.',
      traceId: request.id,
    }),
  );

  return app;
}
