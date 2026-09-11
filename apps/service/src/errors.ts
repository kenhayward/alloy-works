import type { ErrorBody } from '@alloy-works/api-contract';

/** A refusal the service means to make: its code, message and rule reach the caller as they are. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly rule: string | undefined;

  constructor(status: number, code: string, message: string, rule?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.rule = rule;
  }
}

interface FastifyErrorLike {
  code?: string;
  statusCode?: number;
  validationContext?: string;
  issues?: readonly { path: readonly PropertyKey[]; message: string }[];
}

/**
 * Every failure to the one shape (API-005, API-006). Only an AppError's own words reach the caller;
 * anything else says what kind of failure it was and nothing of its detail, which is logged instead.
 */
export function toErrorBody(error: unknown, traceId: string): { status: number; body: ErrorBody } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        code: error.code,
        message: error.message,
        traceId,
        ...(error.rule === undefined ? {} : { rule: error.rule }),
      },
    };
  }
  const fastify = (error ?? {}) as FastifyErrorLike;
  if (fastify.code === 'FST_ERR_VALIDATION') {
    // The zod issues name fields and rules; their messages never quote the value that failed.
    const fields = (fastify.issues ?? []).map(
      (issue) => `${issue.path.join('.') || '(the whole)'}: ${issue.message}`,
    );
    return {
      status: 400,
      body: {
        code: 'invalid_request',
        message: `The request's ${fastify.validationContext ?? 'input'} is not valid. ${fields.join('; ')}`,
        traceId,
      },
    };
  }
  if (fastify.statusCode && fastify.statusCode >= 400 && fastify.statusCode < 500) {
    return {
      status: fastify.statusCode,
      body: { code: 'invalid_request', message: 'The request could not be accepted.', traceId },
    };
  }
  return {
    status: 500,
    body: {
      code: 'internal',
      message: 'Something went wrong on our side. Quote the trace id if you report it.',
      traceId,
    },
  };
}
