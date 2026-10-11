import { z } from 'zod';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const SessionView = z.object({
  id: z.string(),
  route: z
    .enum(['organisation', 'google'])
    .describe("How it signed in: the organisation's provider, or Google"),
  startedAt: z.string(),
  lastActiveAt: z.string().describe('When it was last used, to within a minute'),
  expiresAt: z.string().describe('When it ends of itself, however much it is used'),
  current: z.boolean().describe('Whether this is the session the request was made with'),
});
export type SessionView = z.infer<typeof SessionView>;

export const SessionList = z.object({
  sessions: z
    .array(SessionView)
    .describe("Every session of the caller's that has not ended, the newest first"),
});
export type SessionList = z.infer<typeof SessionList>;

export const SessionParams = z.object({ id: LowercaseUuid });
export type SessionParams = z.infer<typeof SessionParams>;

export const SessionsEnded = z.object({
  ended: z.number().int().describe('How many of the caller’s other sessions were ended'),
});
export type SessionsEnded = z.infer<typeof SessionsEnded>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const tokenNotAllowed = {
  description:
    'token_not_allowed: sessions are seen and ended with a signed-in session, never a token',
  schema: ErrorBody,
} as const;

/**
 * A person's own sessions (IAM-040; service-foundations.md, "Sessions and tokens"): seen and ended
 * with a session alone, never a token, as tokens are managed (TK-D).
 */
export const sessionRoutes = {
  listSessions: {
    operationId: 'listSessions',
    method: 'GET',
    path: '/v1/sessions',
    summary: "The caller's own sessions that have not ended",
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    responses: {
      200: { description: "The caller's sessions", schema: SessionList },
      401: unauthenticated,
      403: tokenNotAllowed,
    },
  },
  endSession: {
    operationId: 'endSession',
    method: 'DELETE',
    path: '/v1/sessions/{id}',
    summary: "End one of the caller's own sessions; ending this one signs out",
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    params: SessionParams,
    responses: {
      204: { description: 'Ended: its next request is refused, and what it was doing stops' },
      401: unauthenticated,
      403: tokenNotAllowed,
      404: { description: 'No session of the caller’s by that id', schema: ErrorBody },
    },
  },
  endOtherSessions: {
    operationId: 'endOtherSessions',
    method: 'DELETE',
    path: '/v1/sessions',
    summary: "End every session of the caller's but this one",
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    responses: {
      200: { description: 'Ended', schema: SessionsEnded },
      401: unauthenticated,
      403: tokenNotAllowed,
    },
  },
} as const;
