import type {
  InboxPreferences,
  InboxPreferencesBody,
  InboxQuery,
  InboxView,
  NotificationParams,
} from '@alloy-works/api-contract';
import {
  cadencesOf,
  deleteNotification,
  listInbox,
  markRead,
  setCadences,
  titlesFor,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { notFound } from './access.js';
import { keysetAfter, keysetCursor } from './keyset.js';
import type { SessionPrincipal } from './sessions.js';

const PAGE = 50;

/**
 * **A person's inbox** (COL-063; the TH plan, Task 2): their own alone, each route taking whoever is
 * asking. A notification holds identifiers; a title is read as the reader, now, and shown only where
 * they may read it (COL-036). Anybody else's notification is not there.
 */
export function inboxHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    listInbox: async (request: FastifyRequest): Promise<InboxView> => {
      const query = request.query as InboxQuery;
      const limit = query.limit === undefined ? PAGE : Number(query.limit);
      const after = keysetAfter('inbox', query.cursor);
      const recipient = principalOf(request).principalId;
      return db.withTenant(tenantOf(request), async (trx) => {
        const page = await listInbox(trx, recipient, {
          ...(query.unread === 'true' ? { unread: true } : {}),
          ...(after === undefined ? {} : { after }),
          limit: limit + 1,
        });
        const shown = page.notifications.slice(0, limit);
        const titles = await titlesFor(
          trx,
          recipient,
          shown.flatMap((each) => [
            ...(each.artifact === null ? [] : [each.artifact]),
            ...(each.counts?.artifacts ?? []),
          ]),
        );
        const place = (id: string) => ({ id, title: titles.get(id) ?? null });
        const last = shown[shown.length - 1];
        return {
          notifications: shown.map((each) => ({
            id: each.id,
            kind: each.kind,
            actor: each.actor,
            thread: each.thread,
            on: each.artifact === null ? null : place(each.artifact),
            counts:
              each.counts === null
                ? null
                : {
                    mention: each.counts.mention,
                    reply: each.counts.reply,
                    resolution: each.counts.resolution,
                    threads: [...each.counts.threads],
                    places: each.counts.artifacts.map(place),
                  },
            at: each.at.toISOString(),
            read: each.readAt !== null,
          })),
          unread: page.unread,
          next:
            page.notifications.length > limit && last
              ? keysetCursor('inbox', { at: last.at, id: last.id })
              : null,
        };
      });
    },

    markNotificationRead: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<FastifyReply> => {
      const { id } = request.params as NotificationParams;
      const marked = await db.withTenant(tenantOf(request), (trx) =>
        markRead(trx, principalOf(request).principalId, id),
      );
      if (!marked) throw notFound();
      return reply.status(204).send();
    },

    deleteNotification: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<FastifyReply> => {
      const { id } = request.params as NotificationParams;
      const deleted = await db.withTenant(tenantOf(request), (trx) =>
        deleteNotification(trx, principalOf(request).principalId, id),
      );
      if (!deleted) throw notFound();
      return reply.status(204).send();
    },

    getInboxPreferences: async (request: FastifyRequest): Promise<InboxPreferences> =>
      db.withTenant(tenantOf(request), (trx) => cadencesOf(trx, principalOf(request).principalId)),

    setInboxPreferences: async (request: FastifyRequest): Promise<InboxPreferences> => {
      const body = request.body as InboxPreferencesBody;
      const principal = principalOf(request).principalId;
      return db.withTenant(tenantOf(request), async (trx) => {
        await setCadences(trx, principal, body);
        return cadencesOf(trx, principal);
      });
    },
  };
}
