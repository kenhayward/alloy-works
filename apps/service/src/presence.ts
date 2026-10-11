import type { PresenceBody, PresenceParams } from '@alloy-works/api-contract';
import {
  beatPresence,
  leavePresence,
  streamScope,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { notFound } from './access.js';
import type { SessionPrincipal } from './sessions.js';

/**
 * **A window's presence** (COL-001, COL-002; the PL plan, PL-C), each beat checked as the stream is: a
 * document the person may read, a component of it they may read, or neither, and their own window.
 * Anything else is not there.
 */
export function presenceHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    beatPresence: async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const body = request.body as PresenceBody;
      const principalId = principalOf(request).principalId;
      const said = await db.withTenant(tenantOf(request), async (trx) => {
        const readable = await streamScope(trx, principalId, { document: body.document });
        if (readable === undefined) return false;
        if (body.component !== null && !readable.has(body.component)) return false;
        return beatPresence(trx, {
          viewer: body.viewer,
          principalId,
          document: body.document,
          component: body.component,
          mode: body.mode,
        });
      });
      if (!said) throw notFound();
      return reply.status(204).send();
    },

    leavePresence: async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const { viewer } = request.params as PresenceParams;
      const left = await db.withTenant(tenantOf(request), (trx) =>
        leavePresence(trx, principalOf(request).principalId, viewer),
      );
      // Nothing of theirs there - gone already, or never theirs - is nothing at this address.
      if (!left) throw notFound();
      return reply.status(204).send();
    },
  };
}
