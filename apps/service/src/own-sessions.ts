import type { SessionList, SessionParams, SessionsEnded } from '@alloy-works/api-contract';
import { notifyTenant, type Tenant, type TenantDatabase } from '@alloy-works/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { notFound } from './access.js';
import { contextOf } from './audit.js';
import { endOwnSessions, listOwnSessions, type SessionPrincipal } from './sessions.js';

/** The cookie's own name and its options, as sign-out clears it. */
export interface SessionCookie {
  readonly name: string;
  readonly options: Parameters<FastifyReply['clearCookie']>[1];
}

/**
 * **A person's own sessions** (IAM-040; the AU2 plan, SE-A to SE-C), each route taking a session
 * alone. Ending one says so to every replica in the transaction that ends it, so its stream and long
 * acts stop as a signed-out session's do (D7-I); ending the one asking also clears its cookie.
 */
export function ownSessionHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
  cookie: SessionCookie,
) {
  const current = (request: FastifyRequest) =>
    request.credential?.kind === 'session' ? request.credential.id : null;

  const ending = (request: FastifyRequest, which: Parameters<typeof endOwnSessions>[2]) =>
    db.withTenant(
      tenantOf(request),
      async (trx) => {
        const ended = await endOwnSessions(trx, principalOf(request).principalId, which);
        for (const session of ended) {
          await notifyTenant(trx, { kind: 'credential_ended', session });
        }
        return ended;
      },
      contextOf(request),
    );

  return {
    listSessions: async (request: FastifyRequest): Promise<SessionList> => {
      const sessions = await db.withTenant(tenantOf(request), (trx) =>
        listOwnSessions(trx, principalOf(request).principalId),
      );
      const asking = current(request);
      return {
        sessions: sessions.map((session) => ({
          id: session.id,
          route: session.route,
          startedAt: session.createdAt.toISOString(),
          lastActiveAt: session.lastSeenAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          current: session.id === asking,
        })),
      };
    },

    endSession: async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const { id } = request.params as SessionParams;
      const ended = await ending(request, { id });
      if (ended.length === 0) throw notFound();
      if (id === current(request)) reply.clearCookie(cookie.name, cookie.options);
      return reply.status(204).send();
    },

    endOtherSessions: async (request: FastifyRequest): Promise<SessionsEnded> => {
      const asking = current(request);
      if (asking === null) return { ended: 0 };
      return { ended: (await ending(request, { allBut: asking })).length };
    },
  };
}
