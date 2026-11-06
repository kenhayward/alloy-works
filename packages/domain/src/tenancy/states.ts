/**
 * What a tenant's state stops, declared once (ADM-045; tenant-lifecycle.md, TL-A and TL-C). Read by the
 * previews of each act and the guide's table, so what is promised and what is said cannot part.
 */
export const TENANT_STATES = [
  'active',
  'suspended',
  'closing',
  'retained',
  'deleting',
  'deleted',
] as const;

export type TenantState = (typeof TENANT_STATES)[number];

/** How long a closed tenant can still be brought back, and then how long it takes to go (IAM-086). */
export const GRACE_DAYS = 30;
export const DELETION_DAYS = 1;

export const TENANT_EFFECT_CAPABILITIES = [
  'signInAndApi',
  'sharedPublicationLinks',
  'webhookDelivery',
  'backgroundWork',
  'realtimeConnections',
  'modelEndpoints',
  'searchIndexes',
  'notificationDelivery',
  'inFlightPublications',
] as const;

export type TenantEffectCapability = (typeof TENANT_EFFECT_CAPABILITIES)[number];

type Effects = Readonly<Record<TenantEffectCapability, string>>;

const FINISHES = 'finishes within its lease';

const SUSPENDED: Effects = {
  signInAndApi: 'stops',
  sharedPublicationLinks: 'stops',
  webhookDelivery: 'stops, kept and resumed',
  backgroundWork: 'stops, caught up on lifting',
  realtimeConnections: 'ends',
  modelEndpoints: 'stops',
  searchIndexes: 'stops, caught up on lifting',
  notificationDelivery: 'stops, kept; mail waits to its age',
  inFlightPublications: FINISHES,
};

const CLOSING: Effects = {
  signInAndApi: 'those allowed only',
  sharedPublicationLinks: 'stops',
  webhookDelivery: 'stops, dropped at deletion',
  backgroundWork: 'stops, except the export',
  realtimeConnections: 'ends',
  modelEndpoints: 'stops',
  searchIndexes: 'stops',
  notificationDelivery: 'stops; notices of the closing are mailed',
  inFlightPublications: FINISHES,
};

/** `retained` is `closing` carried on: a legal hold outlasting the grace period (TL-H). */
export const TENANT_STATE_EFFECTS = {
  suspended: SUSPENDED,
  closing: CLOSING,
  retained: CLOSING,
} as const satisfies Readonly<Record<string, Effects>>;
