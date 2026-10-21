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
