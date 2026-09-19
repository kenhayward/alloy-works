import type { ErrorBody } from '@alloy-works/api-contract';

/**
 * A refusal the service means to make: its code, message and rule reach the caller as they are, and so
 * do its members - what a client needs to act on, such as who holds a lock - which the route's declared
 * refusal schema names, and which never replace the code, message or trace id.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly rule: string | undefined;
  readonly members: Readonly<Record<string, unknown>>;

  constructor(
    status: number,
    code: string,
    message: string,
    rule?: string,
    members: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.rule = rule;
    this.members = members;
  }
}

/** An environment with no object store yet: said once, wherever an object is wanted. */
export const storageUnavailable = () =>
  new AppError(
    503,
    'storage_unavailable',
    'This environment has nowhere to keep documents yet. Try again later.',
  );

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
        ...error.members,
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
