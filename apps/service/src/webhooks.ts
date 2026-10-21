import { randomBytes, randomUUID } from 'node:crypto';
import type {
  ChangeWebhookBody,
  CreateWebhookBody,
  WebhookAnswer,
  WebhookList,
  WebhookListQuery,
  WebhookParams,
  WebhookRead,
  WebhookRemoved,
  WebhookView,
} from '@alloy-works/api-contract';
import {
  changeWebhookSubscription,
  createWebhookSubscription,
  listWebhookSubscriptions,
  removeWebhookSubscription,
  rotateWebhookSecret,
  subscribableIdentity,
  webhookSubscription,
  type Tenant,
  type WebhookSubscription,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import { createConnectorClient } from './data/connector.js';
import type { ConnectorOptions } from './data/connections.js';
import { AppError } from './errors.js';

function view(subscription: WebhookSubscription): WebhookView {
  return {
    id: subscription.id,
    serviceIdentity: subscription.serviceIdentity,
    url: subscription.url,
    description: subscription.description,
    eventTypes: [...subscription.eventTypes],
    createdBy: subscription.createdBy,
    createdAt: subscription.createdAt.toISOString(),
    disabledAt: subscription.disabledAt && subscription.disabledAt.toISOString(),
    disabledReason: subscription.disabledReason,
    lastSuccessAt: subscription.lastSuccessAt && subscription.lastSuccessAt.toISOString(),
  };
}

/** A signing secret as Standard Webhooks writes one: `whsec_` and 32 random bytes (WB-G). */
const newSecret = () => `whsec_${randomBytes(32).toString('base64')}`;

/**
 * Webhook subscriptions (webhooks.md; the WB plan, WB-H), each run in the transaction `administer` at
 * the tenant was decided in, with a session alone. A secret is sealed by the connector to its
 * subscription and URL, kept sealed, and answered once.
 */
export function webhookHandlers(
  tenantOf: (request: FastifyRequest) => Tenant,
  connector?: ConnectorOptions,
) {
  const client = connector ? createConnectorClient(connector) : undefined;

  /** Sealing reaches no receiver, so it is asked in the deciding transaction, as a model key's is. */
  async function sealed(
    request: FastifyRequest,
    subscription: string,
    url: string,
    secret: string,
  ) {
    if (!client) {
      throw new AppError(503, 'connector_unavailable', 'The connector cannot be reached.');
    }
    const answer = await client.sealWebhook({
      tenant: tenantOf(request).id,
      subscription,
      url,
      secret,
    });
    if ('refused' in answer) {
      throw new AppError(503, answer.refused.code, 'The connector cannot seal the secret now.');
    }
    return answer.answer.sealed;
  }

  return {
    listWebhooks: async (request: FastifyRequest, { trx }: Authorised): Promise<WebhookList> => {
      const query = request.query as WebhookListQuery;
      const after = afterCursor(query.cursor);
      const page = await listWebhookSubscriptions(trx, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      return { items: page.items.map(view), next: cursorAfter(page.after) };
    },

    createWebhook: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<WebhookAnswer> => {
      const body = request.body as CreateWebhookBody;
      if (!(await subscribableIdentity(trx, body.serviceIdentity))) {
        throw new AppError(
          409,
          'service_identity_unavailable',
          'There is no such service identity, or it is disabled.',
        );
      }
      const id = randomUUID();
      const secret = newSecret();
      const made = await createWebhookSubscription(trx, {
        id,
        serviceIdentity: body.serviceIdentity,
        url: body.url,
        description: body.description,
        eventTypes: body.eventTypes,
        sealed: await sealed(request, id, body.url, secret),
        by: principalId,
      });
      return { webhook: view(made), secret };
    },

    getWebhook: async (request: FastifyRequest, { trx }: Authorised): Promise<WebhookRead> => {
      const { id } = request.params as WebhookParams;
      const held = await webhookSubscription(trx, id);
      if (!held) throw notFound();
      return { webhook: view(held) };
    },

    changeWebhook: async (request: FastifyRequest, { trx }: Authorised): Promise<WebhookAnswer> => {
      const { id } = request.params as WebhookParams;
      const body = request.body as ChangeWebhookBody;
      const held = await webhookSubscription(trx, id, { lock: true });
      if (!held) throw notFound();
      // A new URL needs a secret sealed to it: the old one was sealed to the old URL (WB-G).
      const moving = body.url !== undefined && body.url !== held.url;
      const secret = moving ? newSecret() : undefined;
      const changed = await changeWebhookSubscription(trx, id, {
        ...(body.url === undefined ? {} : { url: body.url }),
        ...(moving ? { sealed: await sealed(request, id, body.url!, secret!) } : {}),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.eventTypes === undefined ? {} : { eventTypes: body.eventTypes }),
      });
      return { webhook: view(changed!), ...(secret === undefined ? {} : { secret }) };
    },

    rotateWebhookSecret: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<WebhookAnswer> => {
      const { id } = request.params as WebhookParams;
      const held = await webhookSubscription(trx, id, { lock: true });
      if (!held) throw notFound();
      const secret = newSecret();
      const rotated = await rotateWebhookSecret(
        trx,
        id,
        await sealed(request, id, held.url, secret),
      );
      return { webhook: view(rotated!), secret };
    },

    removeWebhook: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<WebhookRemoved> => {
      const { id } = request.params as WebhookParams;
      if (!(await removeWebhookSubscription(trx, id))) throw notFound();
      return { removed: id };
    },
  };
}
