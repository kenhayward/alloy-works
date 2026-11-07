import { SECRET_CONSUMER_KINDS, SECRET_KINDS } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

export const SecretKindName = z
  .enum(SECRET_KINDS)
  .describe(
    'sign_in_client_secret, shared_provider_secret (copied into each tenant of the organisation), connection_credential, delivery_store_password, model_endpoint_key, webhook_signing_secret, extension_secret, mail_relay_password, scim_token, ct_studio_token or service_identity_token',
  );

export const SecretConsumerView = z.object({
  kind: z
    .enum(SECRET_CONSUMER_KINDS)
    .describe(
      'What uses it: sign_in, member_tenant, query_definition, dataset, data_delivery (a space delivered to), purpose (a model purpose routed to the endpoint), guardrails, translation_policy, webhook_subscription, reference_source, mail_delivery, provisioning, ct_studio_space or service_identity',
    ),
  id: z.string().nullable().describe('Its id, or the purpose; null where it has none'),
  name: z.string().nullable().describe('Its name; null where it has none'),
});
export type SecretConsumerView = z.infer<typeof SecretConsumerView>;

export const SecretView = z.object({
  kind: SecretKindName,
  of: z
    .object({ id: z.string(), name: z.string().nullable() })
    .describe('What the secret belongs to: a provider, connection, endpoint, webhook and the like'),
  replacedAt: z.iso
    .datetime()
    .nullable()
    .describe('When its value was last set or replaced; null where no record says'),
  previousUntil: z.iso
    .datetime()
    .nullable()
    .describe('Until when the value it replaced is still accepted; null where none is'),
  replacement: z
    .object({
      operation: z.string().describe('The operation that replaces it'),
      permission: z.string().describe('The permission that operation needs'),
      how: z
        .enum(['overlap', 'atomic', 'beside'])
        .describe(
          'overlap: the old value is still accepted for a time; atomic: the product is its only holder, and reads the new value at once; beside: a new one is issued beside the old, which is revoked once its holder has moved',
        ),
    })
    .describe('How it is replaced'),
  consumers: z.array(SecretConsumerView).describe('Everything here that uses it, resolved now'),
});
export type SecretView = z.infer<typeof SecretView>;

export const SecretList = z.object({
  items: z.array(SecretView).describe('Every secret this environment holds, never a value or hash'),
  absent: z
    .array(z.object({ what: z.string(), why: z.string() }))
    .describe('What holds no secret here, and why'),
});
export type SecretList = z.infer<typeof SecretList>;

/** A tenant's secrets and what uses each (docs/design/secrets.md; ADM-007, ADM-047). */
export const secretRoutes = {
  listSecrets: {
    operationId: 'listSecrets',
    method: 'GET',
    path: '/v1/secrets',
    summary: 'Every secret this environment holds, and everything that uses each',
    tenantScoped: true,
    reads: 'metadata',
    access: { check: 'permission', permission: 'rotate_secrets', target: { tenant: true } },
    responses: {
      200: { description: 'Every secret, never its value', schema: SecretList },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
      403: {
        description: 'The caller does not hold rotate_secrets at the environment',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
