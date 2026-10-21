import type { WebhookEventType } from '@alloy-works/domain';
import { sql } from 'kysely';
import { labelled, labels, recordEvent } from './audit.js';
import { mayBeToldOfSpend } from './generation-budget.js';
import { notifyTenant } from './realtime.js';
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
    readonly change: 'made' | 'changed' | 'rotated' | 'removed' | 'disabled' | 'enabled';
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
    /** On again after it was disabled for failing, its count started afresh. */
    readonly enable?: true;
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
      ...(change.enable === true && held.disabledAt !== null
        ? { disabled_at: null, disabled_reason: null, failing_since: null }
        : {}),
    })
    .where('id', '=', id)
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();
  // A type no longer wanted is not sent, though it was queued while it was (the final review).
  if (change.eventTypes !== undefined) {
    await trx
      .deleteFrom('webhook_delivery')
      .where('subscription_id', '=', id)
      .where('state', '=', 'pending')
      .where('type', 'not in', [...change.eventTypes])
      .execute();
  }
  if (change.enable === true && held.disabledAt !== null) {
    await recordWebhookChange(trx, row, { change: 'enabled' });
  }
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
  /** The lease this claim holds: an attempt is recorded only under it (the final review). */
  readonly lease: string;
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
    lease: string;
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
              d.artifact_id, d.payload::text as body, d.locked_until::text as lease`.execute(trx);
  return rows.map((row) => ({
    id: row.id,
    subscriptionId: row.subscription_id,
    serviceIdentity: row.service_identity,
    url: row.url,
    sealed: row.previous === null ? [row.sealed] : [row.sealed, row.previous],
    artifactId: row.artifact_id,
    body: row.body,
    lease: row.lease,
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
  /** The claim's lease: a worker whose lease ran out, and was claimed past, records nothing. */
  lease?: string,
): Promise<{ readonly disabled?: string }> {
  const { rows: held } = await sql<{ state: string; lease: string | null }>`
    select state, locked_until::text as lease from webhook_delivery where id = ${deliveryId}
    for update`.execute(trx);
  const now = held[0];
  if (!now || now.state !== 'pending' || (lease !== undefined && now.lease !== lease)) return {};
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
             ${BACKOFF_MOST_S}, ${BACKOFF_FIRST_S} * power(2, least(attempts, 7))::integer))
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
  // A day with no attempt at all is a quiet endpoint, not a failing one: its count starts again.
  const { rows: before } = await sql<{ quiet: boolean }>`
    select a.at < now() - interval '24 hours' as quiet
      from webhook_attempt a join webhook_delivery d on d.id = a.delivery_id
     where d.subscription_id = ${subscription}
     order by a.at desc, a.id desc offset 1 limit 1`.execute(trx);
  const restarted = before[0]?.quiet === true;
  const failing = await trx
    .updateTable('webhook_subscription')
    .set({
      failing_since: restarted ? sql<Date>`now()` : sql<Date>`coalesce(failing_since, now())`,
    })
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
    await giveUpWaiting(trx, subscription);
    await tellOfDisabling(trx, subscription);
    return { disabled: subscription };
  }
  return {};
}

/**
 * The administrator who made a subscription told it was disabled (WB-E), where they still may
 * administer: in a savepoint, so a failure to tell never undoes the disabling.
 */
async function tellOfDisabling(trx: TenantTransaction, subscription: string): Promise<void> {
  await sql`savepoint tell_of_disabling`.execute(trx);
  try {
    const { rows } = await sql<{ created_by: string | null }>`
      select created_by from webhook_subscription where id = ${subscription}`.execute(trx);
    const maker = rows[0]?.created_by ?? null;
    if (maker !== null && (await mayBeToldOfSpend(trx, maker))) {
      await sql`insert into notification (recipient, kind, counts)
        values (${maker}, 'webhook', ${JSON.stringify({ webhook: subscription })}::jsonb)`.execute(
        trx,
      );
      await notifyTenant(trx, { kind: 'inbox', recipient: maker });
    }
    await sql`release savepoint tell_of_disabling`.execute(trx);
  } catch {
    await sql`rollback to savepoint tell_of_disabling`.execute(trx);
  }
}

/** A disabled subscription's waiting deliveries given up: none is sent once it is enabled again. */
async function giveUpWaiting(trx: TenantTransaction, subscription: string): Promise<void> {
  await trx
    .updateTable('webhook_delivery')
    .set({ state: 'given_up', locked_until: null })
    .where('subscription_id', '=', subscription)
    .where('state', '=', 'pending')
    .execute();
}

/**
 * Deliveries past 30 days, and their attempts (WB-I): done with, or waiting where nothing sends them,
 * a worker given no deliver key. How many went.
 */
export async function sweepWebhookDeliveries(trx: TenantTransaction): Promise<number> {
  const gone = await trx
    .deleteFrom('webhook_delivery')
    .where('created_at', '<', sql<Date>`now() - interval '30 days'`)
    .executeTakeFirst();
  return Number(gone.numDeletedRows);
}

/** A delivery as an administrator reads it (API-029): what was sent, and every attempt at it. */
export interface DeliveryRecord {
  readonly id: string;
  readonly type: string;
  readonly sequence: string;
  readonly state: 'pending' | 'delivered' | 'given_up' | 'dropped';
  readonly attempts: number;
  readonly nextAt: Date | null;
  readonly createdAt: Date;
  readonly payload: unknown;
  readonly tried: readonly {
    readonly at: Date;
    readonly status: number | null;
    readonly latencyMs: number;
    readonly failure: string | null;
    readonly reply: string | null;
  }[];
}

/** A subscription's deliveries, newest first, a page at a time, each without its attempts. */
export async function listDeliveries(
  trx: TenantTransaction,
  subscription: string,
  request: PageRequest,
): Promise<Page<Omit<DeliveryRecord, 'payload' | 'tried'>>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const rows = await trx
    .selectFrom('webhook_delivery')
    .select(['id', 'type', 'sequence', 'state', 'attempts', 'next_at', 'created_at'])
    .where('subscription_id', '=', subscription)
    .$if(page.after !== undefined, (query) =>
      query.where(
        sql<boolean>`(created_at, id) < (select created_at, id from webhook_delivery
          where id = ${page.after!}::uuid and subscription_id = ${subscription})`,
      ),
    )
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(page.limit + 1)
    .execute();
  return paged(
    rows.map((row) => ({
      id: row.id,
      type: row.type,
      sequence: row.sequence,
      state: row.state,
      attempts: row.attempts,
      nextAt: row.state === 'pending' ? row.next_at : null,
      createdAt: row.created_at,
    })),
    page.limit,
  );
}

/** One delivery of a subscription's, its payload and every attempt; undefined where none. */
export async function deliveryRecord(
  trx: TenantTransaction,
  subscription: string,
  id: string,
): Promise<DeliveryRecord | undefined> {
  const row = await trx
    .selectFrom('webhook_delivery')
    .select(['id', 'type', 'sequence', 'state', 'attempts', 'next_at', 'created_at', 'payload'])
    .where('subscription_id', '=', subscription)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  const tried = await trx
    .selectFrom('webhook_attempt')
    .select(['at', 'status', 'latency_ms', 'failure', 'reply'])
    .where('delivery_id', '=', id)
    .orderBy('at')
    .orderBy('id')
    .execute();
  return {
    id: row.id,
    type: row.type,
    sequence: row.sequence,
    state: row.state,
    attempts: row.attempts,
    nextAt: row.state === 'pending' ? row.next_at : null,
    createdAt: row.created_at,
    payload: row.payload,
    tried: tried.map((each) => ({
      at: each.at,
      status: each.status,
      latencyMs: each.latency_ms,
      failure: each.failure,
      reply: each.reply,
    })),
  };
}
