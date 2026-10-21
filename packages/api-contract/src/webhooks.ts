import { webhookEventTypes } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { nextCursor, pageQuery } from './listing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/**
 * Webhook subscriptions (webhooks.md; the WB plan, WB-H): each a service identity's, administered by
 * whoever administers the environment, with a session alone. A signing secret is answered once, where
 * it is made; a kept answer would keep it, so these routes take no idempotency key.
 */
export const WebhookParams = z.object({ id: LowercaseUuid.describe('The subscription') });
export type WebhookParams = z.infer<typeof WebhookParams>;

export const WebhookEventType = z.enum(webhookEventTypes);

const url = z
  .url({ protocol: /^https$/ })
  .max(2000)
  .describe('Where events are posted: HTTPS, to a public address, at most 2,000 characters');
const description = z
  .string()
  .trim()
  .max(500)
  .describe('What receives it and who looks after it: at most 500 characters, trimmed');
const eventTypes = z
  .array(WebhookEventType)
  .min(1)
  .max(webhookEventTypes.length)
  .refine((types) => new Set(types).size === types.length, { message: 'Each type once' })
  .describe('The events it receives, by their audit kind’s name');

export const WebhookView = z.object({
  id: z.string(),
  serviceIdentity: z
    .string()
    .describe('Whose view decides what it receives: only events about what it may read'),
  url: z.string(),
  description: z.string(),
  eventTypes: z.array(WebhookEventType),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  disabledAt: z.string().nullable(),
  disabledReason: z
    .enum(['failing', 'identity_disabled'])
    .nullable()
    .describe(
      '`failing`: three days of failures with no success; `identity_disabled`: its service identity was',
    ),
  lastSuccessAt: z.string().nullable(),
});
export type WebhookView = z.infer<typeof WebhookView>;

export const WebhookListQuery = z.object(pageQuery);
export type WebhookListQuery = z.infer<typeof WebhookListQuery>;

export const WebhookList = z.object({ items: z.array(WebhookView), next: nextCursor });
export type WebhookList = z.infer<typeof WebhookList>;

export const CreateWebhookBody = z.strictObject({
  serviceIdentity: LowercaseUuid.describe('A service identity, not disabled'),
  url,
  description: description.default(''),
  eventTypes,
});
export type CreateWebhookBody = z.infer<typeof CreateWebhookBody>;

export const ChangeWebhookBody = z.strictObject({
  url: url.optional().describe('A new URL: answered with a new secret, the old one ended at once'),
  description: description.optional(),
  eventTypes: eventTypes.optional(),
  enabled: z
    .literal(true)
    .optional()
    .describe(
      'On again after it was turned off, its failures counted afresh; its service identity must be enabled',
    ),
});
export type ChangeWebhookBody = z.infer<typeof ChangeWebhookBody>;

export const WebhookAnswer = z.object({
  webhook: WebhookView,
  secret: z
    .string()
    .optional()
    .describe(
      'The signing secret, `whsec_` and base64, shown this once: only where it was made or rotated, or the URL changed',
    ),
});
export type WebhookAnswer = z.infer<typeof WebhookAnswer>;

/** A subscription as read: never its secret. */
export const WebhookRead = z.object({ webhook: WebhookView });
export type WebhookRead = z.infer<typeof WebhookRead>;

export const WebhookRemoved = z.object({ removed: z.string() });
export type WebhookRemoved = z.infer<typeof WebhookRemoved>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notAdministering = {
  description:
    'forbidden: the caller may not administer this environment; or token_not_allowed: webhooks are managed with a signed-in session, never a token',
  schema: ErrorBody,
} as const;
const missing = {
  description: 'No such subscription in this environment',
  schema: ErrorBody,
} as const;
const ADMINISTER = {
  check: 'permission',
  permission: 'administer',
  target: { tenant: true },
  credential: 'session',
} as const;

export const webhookRoutes = {
  listWebhooks: {
    operationId: 'listWebhooks',
    method: 'GET',
    path: '/v1/webhooks',
    summary: "The environment's webhook subscriptions, a page at a time, never their secrets",
    tenantScoped: true,
    access: ADMINISTER,
    query: WebhookListQuery,
    responses: {
      200: { description: 'A page of subscriptions', schema: WebhookList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: notAdministering,
    },
  },
  createWebhook: {
    operationId: 'createWebhook',
    method: 'POST',
    path: '/v1/webhooks',
    summary: 'Subscribe a service identity’s endpoint to events, answering its signing secret once',
    tenantScoped: true,
    access: ADMINISTER,
    body: CreateWebhookBody,
    idempotencyKey: false,
    responses: {
      200: { description: 'Made, with its secret', schema: WebhookAnswer },
      400: { description: 'invalid_request', schema: ErrorBody },
      401: unauthenticated,
      403: notAdministering,
      409: {
        description: 'service_identity_unavailable: no such service identity, or it is disabled',
        schema: ErrorBody,
      },
    },
  },
  getWebhook: {
    operationId: 'getWebhook',
    method: 'GET',
    path: '/v1/webhooks/{id}',
    summary: 'A webhook subscription, never its secret',
    tenantScoped: true,
    access: ADMINISTER,
    params: WebhookParams,
    responses: {
      200: { description: 'The subscription', schema: WebhookRead },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
    },
  },
  changeWebhook: {
    operationId: 'changeWebhook',
    method: 'PATCH',
    path: '/v1/webhooks/{id}',
    summary: 'Change a subscription’s URL, description or event types',
    tenantScoped: true,
    access: ADMINISTER,
    params: WebhookParams,
    body: ChangeWebhookBody,
    idempotencyKey: false,
    responses: {
      200: {
        description: 'Changed; with a new secret where the URL changed',
        schema: WebhookAnswer,
      },
      400: { description: 'invalid_request', schema: ErrorBody },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
    },
  },
  rotateWebhookSecret: {
    operationId: 'rotateWebhookSecret',
    method: 'POST',
    path: '/v1/webhooks/{id}/secret',
    summary: 'Rotate a subscription’s signing secret; the old one signs beside it for 24 hours',
    tenantScoped: true,
    access: ADMINISTER,
    params: WebhookParams,
    idempotencyKey: false,
    responses: {
      200: { description: 'Rotated, with the new secret', schema: WebhookAnswer },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
    },
  },
  removeWebhook: {
    operationId: 'removeWebhook',
    method: 'DELETE',
    path: '/v1/webhooks/{id}',
    summary: 'Remove a subscription, and every delivery waiting for it',
    tenantScoped: true,
    access: ADMINISTER,
    params: WebhookParams,
    responses: {
      200: { description: 'Removed', schema: WebhookRemoved },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
    },
  },
} as const satisfies Record<string, RouteContract>;

export const DeliveryParams = z.object({
  id: LowercaseUuid.describe('The subscription'),
  delivery: LowercaseUuid.describe('Its delivery'),
});
export type DeliveryParams = z.infer<typeof DeliveryParams>;

const DeliveryState = z
  .enum(['pending', 'delivered', 'given_up', 'dropped'])
  .describe(
    '`pending`: to be tried, at `nextAt`; `delivered`: a 2xx came back; `given_up`: a day of failures; `dropped`: its service identity may not read what it is about, so it was never sent',
  );

export const DeliverySummary = z.object({
  id: z.string().describe('The payload’s `id`, the `webhook-id` it was sent as'),
  type: WebhookEventType,
  sequence: z.string().describe('`audit:<n>` or `notification:<n>`: the order its source holds'),
  state: DeliveryState,
  attempts: z.number().int(),
  nextAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DeliverySummary = z.infer<typeof DeliverySummary>;

export const DeliveryList = z.object({ items: z.array(DeliverySummary), next: nextCursor });
export type DeliveryList = z.infer<typeof DeliveryList>;

export const DeliveryView = DeliverySummary.extend({
  payload: z
    .record(z.string(), z.unknown())
    .describe('Exactly what was sent: identifiers and versions, never content'),
  tried: z
    .array(
      z.object({
        at: z.string(),
        status: z
          .number()
          .int()
          .nullable()
          .describe('What the receiver answered, or null for none'),
        latencyMs: z.number().int(),
        failure: z
          .string()
          .nullable()
          .describe(
            'Why there was no answer, by code: `host_refused`, `timeout`, `unreadable` and the like',
          ),
        reply: z.string().nullable().describe('At most 2 KiB of what the receiver answered'),
      }),
    )
    .describe('Every attempt, oldest first'),
});
export type DeliveryView = z.infer<typeof DeliveryView>;

export const webhookDeliveryRoutes = {
  listWebhookDeliveries: {
    operationId: 'listWebhookDeliveries',
    method: 'GET',
    path: '/v1/webhooks/{id}/deliveries',
    summary: 'A subscription’s deliveries, newest first, kept 30 days',
    tenantScoped: true,
    access: ADMINISTER,
    params: WebhookParams,
    query: WebhookListQuery,
    responses: {
      200: { description: 'A page of its deliveries', schema: DeliveryList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
    },
  },
  getWebhookDelivery: {
    operationId: 'getWebhookDelivery',
    method: 'GET',
    path: '/v1/webhooks/{id}/deliveries/{delivery}',
    summary: 'One delivery: what was sent, and what came back at each attempt',
    tenantScoped: true,
    access: ADMINISTER,
    params: DeliveryParams,
    responses: {
      200: { description: 'The delivery', schema: DeliveryView },
      401: unauthenticated,
      403: notAdministering,
      404: { description: 'No such delivery of this subscription', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
