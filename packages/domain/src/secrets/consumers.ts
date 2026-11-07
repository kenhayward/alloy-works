import type { Permission } from '../access/permissions.js';

/**
 * **A tenant's secrets and what consumes each** (secrets.md; ADM-007, ADM-047; the SA plan, SA-H): one
 * row per kind, naming where it is stored, what reads it, how it is replaced and how a break after a
 * replacement is read. A test holds the rows to every sealed or hashed column the migrations make, so a
 * secret cannot be added without saying what uses it.
 */
export const SECRET_KINDS = [
  'sign_in_client_secret',
  'shared_provider_secret',
  'connection_credential',
  'delivery_store_password',
  'model_endpoint_key',
  'webhook_signing_secret',
  'extension_secret',
  'mail_relay_password',
  'scim_token',
  'ct_studio_token',
  'service_identity_token',
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** What a secret is used by, as `GET /v1/secrets` resolves it in a tenant. */
export const SECRET_CONSUMER_KINDS = [
  'sign_in',
  'member_tenant',
  'query_definition',
  'dataset',
  'data_delivery',
  'purpose',
  'guardrails',
  'translation_policy',
  'webhook_subscription',
  'reference_source',
  'mail_delivery',
  'provisioning',
  'ct_studio_space',
  'service_identity',
] as const;
export type SecretConsumerKind = (typeof SECRET_CONSUMER_KINDS)[number];

/**
 * `overlap`: the old value is still accepted for `hours` after the new one is made, so its holder
 * moves without a gap; `atomic`: the product itself is the one holder and reads the new value from
 * the replacing transaction on, so there is never a moment when neither is valid (ADM-007); `beside`:
 * a new value is issued beside the old, which stays valid until revoked, once its holder has moved.
 */
export type SecretReplacement =
  | { readonly how: 'overlap'; readonly hours: number }
  | { readonly how: 'atomic' }
  | { readonly how: 'beside' };

/**
 * How a consumer's authentication failure after a replacement is read, from records already kept
 * (no write per request): the table and what in it says so; or why nothing can be read.
 */
export type SecretBreakRead =
  | { readonly read: true; readonly from: string; readonly failure: string }
  | { readonly read: false; readonly why: string };

export interface SecretConsumers {
  readonly kind: SecretKind;
  readonly what: string;
  /** `table.column`, as the migrations make it. */
  readonly stored: readonly string[];
  readonly consumers: readonly SecretConsumerKind[];
  /** Who reads the value itself. */
  readonly readBy: string;
  /** The operation that replaces it, and the permission it needs. */
  readonly operation: string;
  readonly permission: Permission;
  readonly replacement: SecretReplacement;
  readonly breaks: SecretBreakRead;
}

/** A token's old value is accepted this long after the next is issued, as a webhook's signs (SA-C). */
export const SECRET_OVERLAP_HOURS = 24;

const OVERLAP = { how: 'overlap', hours: SECRET_OVERLAP_HOURS } as const;
const ATOMIC = { how: 'atomic' } as const;
const STRANGER = {
  read: false,
  why: 'A refused token is not found, so an old one cannot be told from a stranger',
} as const;

export const SECRET_CONSUMERS: readonly SecretConsumers[] = [
  {
    kind: 'sign_in_client_secret',
    what: "An identity provider's client secret",
    stored: ['identity_provider.sealed_secret'],
    consumers: ['sign_in'],
    readBy: 'The service, at each sign-in through the provider',
    operation: 'replaceProviderSecret',
    permission: 'rotate_secrets',
    replacement: ATOMIC,
    breaks: {
      read: false,
      why: 'A provider refusing the secret fails a sign-in, which records no reason',
    },
  },
  {
    kind: 'shared_provider_secret',
    what: "A shared provider's client secret, copied into each tenant of the organisation",
    stored: ['identity_provider.sealed_secret'],
    consumers: ['sign_in', 'member_tenant'],
    readBy: 'The steward, which reseals it for each member tenant',
    operation: 'replaceProviderSecret',
    permission: 'rotate_secrets',
    replacement: ATOMIC,
    breaks: {
      read: false,
      why: 'A provider refusing the secret fails a sign-in, which records no reason',
    },
  },
  {
    kind: 'connection_credential',
    what: "A connection's credential",
    stored: ['connection_credential.sealed'],
    consumers: ['query_definition', 'dataset'],
    readBy: 'The connector, at each run on the connection',
    operation: 'setConnectionCredential',
    permission: 'rotate_secrets',
    replacement: ATOMIC,
    breaks: {
      read: true,
      from: 'query_run, connection_test',
      failure: "failure = 'connection_failed'",
    },
  },
  {
    kind: 'delivery_store_password',
    what: "The delivery store's password, sealed into each delivery connection",
    stored: ['connection_credential.sealed'],
    consumers: ['data_delivery', 'query_definition', 'dataset'],
    readBy: 'The connector, at each delivery and each run on the connection',
    operation: 'putBridgeSettings',
    permission: 'configure_services',
    replacement: ATOMIC,
    breaks: {
      read: true,
      from: 'query_run, connection_test',
      failure: "failure = 'connection_failed'",
    },
  },
  {
    kind: 'model_endpoint_key',
    what: "A model endpoint's key",
    stored: ['model_credential.sealed'],
    consumers: ['purpose', 'guardrails', 'translation_policy'],
    readBy: 'The connector, at each call to the endpoint',
    operation: 'setModelEndpointKey',
    permission: 'rotate_secrets',
    replacement: ATOMIC,
    breaks: { read: true, from: 'generation_run', failure: "outcome = 'model_unavailable'" },
  },
  {
    kind: 'webhook_signing_secret',
    what: "A webhook's signing secret",
    stored: ['webhook_subscription.sealed', 'webhook_subscription.sealed_previous'],
    consumers: ['webhook_subscription'],
    readBy: 'The receiver, checking each delivery’s signature',
    operation: 'rotateWebhookSecret',
    permission: 'rotate_secrets',
    replacement: OVERLAP,
    breaks: { read: true, from: 'webhook_attempt', failure: 'status in (401, 403)' },
  },
  {
    kind: 'extension_secret',
    what: 'The secret a reference extension is sent',
    stored: ['extension_credential.sealed'],
    consumers: ['reference_source'],
    readBy: 'The connector, at each check against the extension',
    operation: 'setExtensionSecret',
    permission: 'rotate_secrets',
    replacement: ATOMIC,
    breaks: { read: false, why: 'A check that fails records when, not why' },
  },
  {
    kind: 'mail_relay_password',
    what: "The password of the environment's own mail relay",
    stored: ['mail_channel.sealed_password'],
    consumers: ['mail_delivery'],
    readBy: 'The connector, at each mail sent',
    operation: 'setMailPassword',
    permission: 'rotate_secrets',
    replacement: ATOMIC,
    breaks: { read: true, from: 'email_attempt', failure: "failure = 'auth_failed'" },
  },
  {
    kind: 'scim_token',
    what: "A provider's SCIM token",
    stored: ['api_token.token_hash'],
    consumers: ['provisioning'],
    readBy: "The provider's SCIM client, at each push",
    operation: 'issueScimToken',
    permission: 'rotate_secrets',
    replacement: OVERLAP,
    breaks: STRANGER,
  },
  {
    kind: 'ct_studio_token',
    what: "CT Studio's token",
    stored: ['api_token.token_hash'],
    consumers: ['ct_studio_space'],
    readBy: 'CT Studio, at each delivery',
    operation: 'issueCtStudioToken',
    permission: 'administer',
    replacement: OVERLAP,
    breaks: STRANGER,
  },
  {
    kind: 'service_identity_token',
    what: "A service identity's token",
    stored: ['api_token.token_hash'],
    consumers: ['service_identity'],
    readBy: 'Whatever the identity is given to, at each request',
    operation: 'issueServiceIdentityToken',
    permission: 'administer',
    replacement: { how: 'beside' },
    breaks: STRANGER,
  },
];

/** Sealed or hashed columns that are not a tenant's secret to replace, each with why (ADM-007). */
export const SECRET_EXCLUSIONS: readonly { readonly stored: string; readonly why: string }[] = [
  {
    stored: 'object_store_credential.sealed_secret',
    why: "The operator's: the store issues it, and nothing in the product rotates it",
  },
  { stored: 'session.token_hash', why: 'A session’s own, ended by signing out' },
  { stored: 'session.sealed_refresh', why: 'A session’s own, ended with it' },
  {
    stored: 'model_credential.sealed_for',
    why: 'The digest of the origin a key was sealed for, not a secret',
  },
];

/** What ADM-047 names that holds no secret here, said so rather than left out. */
export const SECRETS_ABSENT: readonly { readonly what: string; readonly why: string }[] = [
  { what: 'Scanning services', why: 'None exists (AST-Q03)' },
  {
    what: 'Translation services',
    why: 'Machine translation is a model endpoint’s, whose key is listed',
  },
];

export const secretConsumers = (kind: SecretKind): SecretConsumers =>
  SECRET_CONSUMERS.find((each) => each.kind === kind)!;
