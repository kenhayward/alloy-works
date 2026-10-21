import type { WebhookEventType } from '@alloy-works/domain';
import { sql } from 'kysely';
import { labelled, labels, recordEvent } from './audit.js';
import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
import type { TenantTransaction } from './tables.js';

/**
 * Webhook subscriptions (webhooks.md; the WB plan, WB-H): each a service identity's, an HTTPS URL, the
 * event types it wants, and a secret the connector sealed. The sealed secret is never answered.
 */
export interface WebhookSubscription {
  readonly id: string;
  readonly serviceIdentity: string;
  readonly url: string;
  readonly description: string;
  readonly eventTypes: readonly WebhookEventType[];
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly disabledAt: Date | null;
  readonly disabledReason: 'failing' | 'identity_disabled' | null;
  readonly lastSuccessAt: Date | null;
  readonly failingSince: Date | null;
}

const COLUMNS = [
  'id',
  'service_identity',
  'url',
  'description',
  'event_types',
  'created_by',
  'created_at',
  'disabled_at',
  'disabled_reason',
  'last_success_at',
  'failing_since',
] as const;

type Row = {
  id: string;
  service_identity: string;
  url: string;
  description: string;
  event_types: string[];
  created_by: string | null;
  created_at: Date;
  disabled_at: Date | null;
  disabled_reason: string | null;
  last_success_at: Date | null;
  failing_since: Date | null;
};

function subscriptionOf(row: Row): WebhookSubscription {
  return {
    id: row.id,
    serviceIdentity: row.service_identity,
    url: row.url,
    description: row.description,
    eventTypes: row.event_types as WebhookEventType[],
    createdBy: row.created_by,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
    disabledReason: row.disabled_reason as WebhookSubscription['disabledReason'],
    lastSuccessAt: row.last_success_at,
    failingSince: row.failing_since,
  };
}

/** Records a subscription's change (LIF-071): its description as the label, never its URL. */
export async function recordWebhookChange(
  trx: TenantTransaction,
  subscription: { readonly id: string; readonly description: string },
  detail: {
    readonly change: 'made' | 'changed' | 'rotated' | 'removed' | 'disabled';
    readonly types?: readonly string[];
    readonly urlChanged?: boolean;
    readonly reason?: 'failing' | 'identity_disabled';
  },
): Promise<void> {
  await recordEvent(
    trx,
    { kind: 'webhook.changed', subject: { kind: 'webhook', id: subscription.id }, detail },
    labels(labelled('subject', subscription.description)),
  );
}

/** Whether the service identity is one the tenant holds and may still act: subscribed only then. */
export async function subscribableIdentity(
  trx: TenantTransaction,
  serviceIdentity: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom('service_identity')
    .select('disabled_at')
    .where('principal_id', '=', serviceIdentity)
    .executeTakeFirst();
  return row !== undefined && row.disabled_at === null;
}

/** Makes a subscription by the id its secret was sealed to (WB-G). */
export async function createWebhookSubscription(
  trx: TenantTransaction,
  input: {
    readonly id: string;
    readonly serviceIdentity: string;
    readonly url: string;
    readonly description: string;
    readonly eventTypes: readonly WebhookEventType[];
    readonly sealed: string;
    readonly by: string;
  },
): Promise<WebhookSubscription> {
  const row = await trx
    .insertInto('webhook_subscription')
    .values({
      id: input.id,
      service_identity: input.serviceIdentity,
      url: input.url,
      description: input.description,
      event_types: [...input.eventTypes],
      sealed: input.sealed,
      created_by: input.by,
    })
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();
  await recordWebhookChange(trx, row, { change: 'made', types: input.eventTypes });
  return subscriptionOf(row);
}

export async function webhookSubscription(
  trx: TenantTransaction,
  id: string,
  options: { readonly lock?: boolean } = {},
): Promise<WebhookSubscription | undefined> {
  let found = trx.selectFrom('webhook_subscription').select(COLUMNS).where('id', '=', id);
  if (options.lock === true) found = found.forUpdate();
  const row = await found.executeTakeFirst();
  return row ? subscriptionOf(row) : undefined;
}

export async function listWebhookSubscriptions(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<WebhookSubscription>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const rows = await trx
    .selectFrom('webhook_subscription')
    .select(COLUMNS)
    .$if(page.after !== undefined, (query) => query.where('id', '>', page.after!))
    .orderBy('id')
    .limit(page.limit + 1)
    .execute();
  return paged(rows.map(subscriptionOf), page.limit);
}

/**
 * Changes a subscription. A new URL comes with a secret sealed to it, which replaces the old outright:
 * the old was sealed to the old URL (WB-G). Undefined where there is none.
 */
export async function changeWebhookSubscription(
  trx: TenantTransaction,
  id: string,
  change: {
    readonly url?: string;
    readonly sealed?: string;
    readonly description?: string;
    readonly eventTypes?: readonly WebhookEventType[];
  },
): Promise<WebhookSubscription | undefined> {
  const held = await webhookSubscription(trx, id, { lock: true });
  if (!held) return undefined;
  const urlChanged = change.url !== undefined && change.url !== held.url;
  if (urlChanged && change.sealed === undefined) {
    throw new Error('A new URL needs a secret sealed to it');
  }
  const row = await trx
    .updateTable('webhook_subscription')
    .set({
      ...(urlChanged
        ? { url: change.url!, sealed: change.sealed!, sealed_previous: null, previous_until: null }
        : {}),
      ...(change.description === undefined ? {} : { description: change.description }),
      ...(change.eventTypes === undefined ? {} : { event_types: [...change.eventTypes] }),
    })
    .where('id', '=', id)
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();
  await recordWebhookChange(trx, row, {
    change: 'changed',
    ...(change.eventTypes === undefined ? {} : { types: change.eventTypes }),
    urlChanged,
  });
  return subscriptionOf(row);
}

/** A new secret, the old signing beside it for 24 hours (WB-G). */
export async function rotateWebhookSecret(
  trx: TenantTransaction,
  id: string,
  sealed: string,
): Promise<WebhookSubscription | undefined> {
  const row = await trx
    .updateTable('webhook_subscription')
    .set({
      sealed_previous: sql<string>`sealed`,
      previous_until: sql<Date>`now() + interval '24 hours'`,
      sealed,
    })
    .where('id', '=', id)
    .returning(COLUMNS)
    .executeTakeFirst();
  if (!row) return undefined;
  await recordWebhookChange(trx, row, { change: 'rotated' });
  return subscriptionOf(row);
}

/** Removes a subscription, its deliveries with it; recorded first. */
export async function removeWebhookSubscription(
  trx: TenantTransaction,
  id: string,
): Promise<boolean> {
  const held = await webhookSubscription(trx, id, { lock: true });
  if (!held) return false;
  await recordWebhookChange(trx, held, { change: 'removed' });
  await trx.deleteFrom('webhook_subscription').where('id', '=', id).execute();
  return true;
}

/** Disables every enabled subscription of a service identity disabled (WB-B), each recorded. */
export async function disableIdentitySubscriptions(
  trx: TenantTransaction,
  serviceIdentity: string,
): Promise<void> {
  const rows = await trx
    .updateTable('webhook_subscription')
    .set({ disabled_at: sql<Date>`now()`, disabled_reason: 'identity_disabled' })
    .where('service_identity', '=', serviceIdentity)
    .where('disabled_at', 'is', null)
    .returning(['id', 'description'])
    .execute();
  for (const row of rows) {
    await recordWebhookChange(trx, row, { change: 'disabled', reason: 'identity_disabled' });
  }
}

/** A delivery claimed for an attempt: what the worker sends, and whose view decides it (WB-B). */
export interface ClaimedDelivery {
  readonly id: string;
  readonly subscriptionId: string;
  readonly serviceIdentity: string;
  readonly url: string;
  /** The secrets that sign it, the newer first (WB-G). */
  readonly sealed: readonly string[];
  readonly artifactId: string | null;
  readonly body: string;
}

/** The longest backoff between attempts, and how long a delivery is tried (WB-E). */
const BACKOFF_FIRST_S = 30;
const BACKOFF_MOST_S = 60 * 60;

/**
 * The deliveries due now, at most `limit`, each leased for `leaseMs` so no other worker takes it while
 * it is sent; claimed past any another holds (WB-I). A disabled subscription's wait.
 */
export async function claimDeliveries(
  trx: TenantTransaction,
  limit: number,
  leaseMs: number,
): Promise<readonly ClaimedDelivery[]> {
  const { rows } = await sql<{
    id: string;
    subscription_id: string;
    service_identity: string;
    url: string;
    sealed: string;
    previous: string | null;
    artifact_id: string | null;
    body: string;
  }>`
    with due as (
      select d.id from webhook_delivery d
      join webhook_subscription s on s.id = d.subscription_id
      where d.state = 'pending' and d.next_at <= now()
        and (d.locked_until is null or d.locked_until < now())
        and s.disabled_at is null
      order by d.next_at
      limit ${limit}
      for update of d skip locked
    )
    update webhook_delivery d
       set locked_until = now() + make_interval(secs => ${leaseMs / 1000})
      from due, webhook_subscription s
     where d.id = due.id and s.id = d.subscription_id
    returning d.id, d.subscription_id, s.service_identity, s.url, s.sealed,
              case when s.previous_until > now() then s.sealed_previous end as previous,
              d.artifact_id, d.payload::text as body`.execute(trx);
  return rows.map((row) => ({
    id: row.id,
    subscriptionId: row.subscription_id,
    serviceIdentity: row.service_identity,
    url: row.url,
    sealed: row.previous === null ? [row.sealed] : [row.sealed, row.previous],
    artifactId: row.artifact_id,
    body: row.body,
  }));
}

/** How an attempt ended, as the worker saw it (WB-E, WB-F). */
export type AttemptOutcome =
  | {
      readonly kind: 'answered';
      readonly status: number;
      readonly latencyMs: number;
      readonly reply: string;
    }
  | { readonly kind: 'failed'; readonly failure: string; readonly latencyMs: number }
  /** Its service identity may not read what it is about: never sent (WB-B). */
  | { readonly kind: 'unreadable' }
  /** The connector was full: no attempt, tried again shortly. */
  | { readonly kind: 'busy' };

/**
 * Records an attempt and what follows from it (WB-E): a 2xx delivered; else retried with backoff from
 * 30 seconds doubling to an hour for a day from the first attempt, then given up; and the subscription
 * disabled where its first failure since its last success, or since it was made, is three days old.
 * Answers the subscription disabled, if one was.
 */
export async function recordAttempt(
  trx: TenantTransaction,
  deliveryId: string,
  outcome: AttemptOutcome,
): Promise<{ readonly disabled?: string }> {
  if (outcome.kind === 'busy') {
    await trx
      .updateTable('webhook_delivery')
      .set({ locked_until: null, next_at: sql<Date>`now() + interval '5 seconds'` })
      .where('id', '=', deliveryId)
      .execute();
    return {};
  }
  if (outcome.kind === 'unreadable') {
    await trx
      .insertInto('webhook_attempt')
      .values({
        delivery_id: deliveryId,
        status: null,
        latency_ms: 0,
        failure: 'unreadable',
        reply: null,
      })
      .execute();
    await trx
      .updateTable('webhook_delivery')
      .set({ state: 'dropped', locked_until: null })
      .where('id', '=', deliveryId)
      .execute();
    return {};
  }
  const delivered = outcome.kind === 'answered' && outcome.status >= 200 && outcome.status < 300;
  await trx
    .insertInto('webhook_attempt')
    .values({
      delivery_id: deliveryId,
      status: outcome.kind === 'answered' ? outcome.status : null,
      latency_ms: outcome.latencyMs,
      failure: outcome.kind === 'failed' ? outcome.failure : null,
      reply: outcome.kind === 'answered' ? outcome.reply : null,
    })
    .execute();
  const { rows } = await sql<{ subscription_id: string; attempts: number; state: string }>`
    update webhook_delivery
       set attempts = attempts + 1,
           first_attempt_at = coalesce(first_attempt_at, now()),
           locked_until = null,
           state = case
             when ${delivered} then 'delivered'
             when coalesce(first_attempt_at, now()) <= now() - interval '24 hours' then 'given_up'
             else 'pending' end,
           next_at = now() + make_interval(secs => least(
             ${BACKOFF_MOST_S}, ${BACKOFF_FIRST_S} * power(2, attempts)::integer))
     where id = ${deliveryId}
    returning subscription_id, attempts, state`.execute(trx);
  const subscription = rows[0]!.subscription_id;
  if (delivered) {
    await trx
      .updateTable('webhook_subscription')
      .set({ last_success_at: sql<Date>`now()`, failing_since: null })
      .where('id', '=', subscription)
      .execute();
    return {};
  }
  const failing = await trx
    .updateTable('webhook_subscription')
    .set({ failing_since: sql<Date>`coalesce(failing_since, now())` })
    .where('id', '=', subscription)
    .returning(['id', 'description', 'failing_since', 'disabled_at'])
    .executeTakeFirstOrThrow();
  const since = failing.failing_since!;
  if (failing.disabled_at === null && Date.now() - since.getTime() >= 3 * 24 * 60 * 60 * 1000) {
    await trx
      .updateTable('webhook_subscription')
      .set({ disabled_at: sql<Date>`now()`, disabled_reason: 'failing' })
      .where('id', '=', subscription)
      .execute();
    await recordWebhookChange(trx, failing, { change: 'disabled', reason: 'failing' });
    return { disabled: subscription };
  }
  return {};
}

/** Deliveries done with, and their attempts, kept 30 days (WB-I): how many went. */
export async function sweepWebhookDeliveries(trx: TenantTransaction): Promise<number> {
  const gone = await trx
    .deleteFrom('webhook_delivery')
    .where('state', '<>', 'pending')
    .where('created_at', '<', sql<Date>`now() - interval '30 days'`)
    .executeTakeFirst();
  return Number(gone.numDeletedRows);
}
