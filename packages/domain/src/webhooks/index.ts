import { z } from 'zod';
import type { AuditKind } from '../audit/kinds.js';

/**
 * Webhooks (webhooks.md; the WB plan): the closed list of event types a subscription may want, each
 * an audit kind's own name but `notification.created`, which the notification table raises. Held to
 * the queueing trigger's list (0139) by a test.
 */
export const webhookAuditTypes = [
  'content.version_cut',
  'content.restored',
  'artifact.archived',
  'artifact.unarchived',
  'workflow.transitioned',
  'approval.given',
  'gate.rejected',
  'revision.effective',
  'round.opened',
  'round.closed',
  'review.completed',
  'review.reopened',
  'review.lapsed',
  'publication.requested',
  'publication.produced',
  'publication.failed',
  'bridge.delivered',
  'bridge.refused',
] as const satisfies readonly AuditKind[];

export const webhookEventTypes = [...webhookAuditTypes, 'notification.created'] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];

const tenant = z.string().regex(/^[0-9a-z]{1,40}$/);

/** A subscription's URL: HTTPS, a host, no credentials, at most 2,000 characters (WB-H). */
export const webhookUrlSchema = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.hostname !== '' &&
        url.username === '' &&
        url.password === ''
      );
    } catch {
      return false;
    }
  }, 'An https URL, with no user or password in it');

/** A signing secret, as Standard Webhooks writes one: `whsec_` and base64 of 32 bytes (WB-G). */
export const webhookSecretSchema = z.string().regex(/^whsec_[A-Za-z0-9+/]{43}=$/);

/**
 * What a secret is sealed to: its subscription and URL, so a sealed secret copied to another row, or
 * kept past a change of URL, opens as nothing (WB-G).
 */
export function webhookSecretContext(subscription: string, url: string): string {
  return JSON.stringify([subscription, url]);
}

export const webhookSealRequestSchema = z.strictObject({
  tenant,
  subscription: z.uuid(),
  url: webhookUrlSchema,
  secret: webhookSecretSchema,
});
export type WebhookSealRequest = z.infer<typeof webhookSealRequestSchema>;

/** The most a delivery's body may be: a thin payload, never content (WB-A). */
export const DELIVERY_BODY_MOST = 64 * 1024;

/** The most of a receiver's reply kept for an administrator to read (WB-F, API-029). */
export const DELIVERY_REPLY_MOST = 2048;

/** How long a delivery may take, connecting, sending and reading the start of its reply (WB-F). */
export const DELIVERY_DEADLINE_MS = 10_000;

const sealed = z.string().min(1).max(4096);

/**
 * A delivery, as the worker asks the connector to make it (WB-F): the subscription's sealed secrets,
 * the newer first, which only the connector opens; its URL; and the body, signed there.
 */
export const deliverRequestSchema = z.strictObject({
  requestId: z.uuid(),
  tenant,
  subscription: z.uuid(),
  url: webhookUrlSchema,
  sealed: z.array(sealed).min(1).max(2),
  /** The payload's `id`, the `webhook-id` a receiver deduplicates by. */
  id: z.uuid(),
  body: z.string().min(2).max(DELIVERY_BODY_MOST),
});
export type DeliverRequest = z.infer<typeof deliverRequestSchema>;

/** Why a delivery reached no answer: never the receiver's or the network's own words. */
export const deliveryFailureCodes = [
  'host_refused',
  'connection_failed',
  'timeout',
  'secret_refused',
  'connector_error',
] as const;

export const deliverAnswerSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('answered'),
    status: z.number().int().min(100).max(599),
    latencyMs: z.number().int().min(0),
    reply: z.string().max(DELIVERY_REPLY_MOST),
  }),
  z.strictObject({
    type: z.literal('failed'),
    code: z.enum(deliveryFailureCodes),
    latencyMs: z.number().int().min(0),
  }),
]);
export type DeliverAnswer = z.infer<typeof deliverAnswerSchema>;

/** The line the supervisor writes to a delivery's child: its secrets opened, the guard's ranges. */
export const childDeliverRequestSchema = z.strictObject({
  kind: z.literal('deliver'),
  request: deliverRequestSchema,
  secrets: z.array(webhookSecretSchema).min(1).max(2),
  deny: z.array(z.string()),
  connectTimeoutMs: z.number().int().min(1).max(60_000),
  ca: z
    .string()
    .max(256 * 1024)
    .optional(),
});
export type ChildDeliverRequest = z.infer<typeof childDeliverRequestSchema>;

/**
 * What Standard Webhooks signs: `id.timestamp.body`, with the secret's bytes after `whsec_` as the HMAC
 * key; the signature header is each secret's `v1,<base64>`, space-separated. Pure, with the HMAC given,
 * so domain stays free of `node:crypto`.
 */
export function signedContent(id: string, timestamp: number, body: string): string {
  return `${id}.${timestamp}.${body}`;
}

export function signatureHeader(signatures: readonly string[]): string {
  return signatures.map((each) => `v1,${each}`).join(' ');
}

/** A secret's key bytes, as base64: what follows `whsec_`. */
export const secretKey = (secret: string): string => secret.slice('whsec_'.length);
