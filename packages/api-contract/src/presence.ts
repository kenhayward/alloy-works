import { z } from 'zod';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const PresenceBody = z.strictObject({
  viewer: LowercaseUuid.describe(
    "The window's own id, made when it opens and sent with its stream",
  ),
  document: LowercaseUuid,
  component: LowercaseUuid.nullable().describe('The component it is in, or null between them'),
  mode: z.enum(['read', 'review', 'author']).describe('What it is doing: the document view’s mode'),
});
export type PresenceBody = z.infer<typeof PresenceBody>;

export const PresenceParams = z.object({ viewer: LowercaseUuid });
export type PresenceParams = z.infer<typeof PresenceParams>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const tokenNotAllowed = {
  description: 'token_not_allowed: presence is a signed-in window’s, never a token’s',
  schema: ErrorBody,
} as const;

/**
 * Presence (COL-001 to COL-004, COL-055; the PL plan, PL-C): each window beats every 20 seconds and on
 * each change, and is absent a minute after its last. A session alone, as the stream is.
 */
export const presenceRoutes = {
  beatPresence: {
    operationId: 'beatPresence',
    method: 'PUT',
    path: '/v1/presence',
    summary: 'Say this window is in a document, where and doing what',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    body: PresenceBody,
    responses: {
      204: { description: 'Said: the document’s other viewers hear it on their streams' },
      401: unauthenticated,
      403: tokenNotAllowed,
      404: {
        description:
          'No such document or component in it, none the caller may read, or another person’s window',
        schema: ErrorBody,
      },
    },
  },
  leavePresence: {
    operationId: 'leavePresence',
    method: 'DELETE',
    path: '/v1/presence/{viewer}',
    summary: 'Say this window has left; its stream closing says so too',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    params: PresenceParams,
    responses: {
      204: { description: 'Gone' },
      401: unauthenticated,
      403: tokenNotAllowed,
      404: { description: 'No window of the caller’s by that id: gone already', schema: ErrorBody },
    },
  },
} as const;
