import { mailBackoffSeconds, type MailFailureCode, type MailRelay } from '@alloy-works/domain';
import { sql } from 'kysely';
import { recordEvent } from './audit.js';
import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
import type { TenantTransaction } from './tables.js';

/** A tenant's mail channel (mail.md; the EM plan), never its sealed password. */
export interface MailChannel {
  readonly id: string;
  readonly enabled: boolean;
  readonly relay: MailRelay;
  readonly host: string | null;
  readonly port: number | null;
  readonly username: string | null;
  readonly fromAddress: string | null;
  readonly fromName: string | null;
  readonly hasPassword: boolean;
  /** Since when its relay has failed, cleared by a send (EM-N). */
  readonly failingSince: Date | null;
  readonly lastSuccessAt: Date | null;
}

/** What is left where nobody has set a channel: off, by the operator's relay (EM-D). */
export const NO_MAIL_CHANNEL: Omit<MailChannel, 'id'> = {
  enabled: false,
  relay: 'platform',
  host: null,
  port: null,
  username: null,
  fromAddress: null,
  fromName: null,
  hasPassword: false,
  failingSince: null,
  lastSuccessAt: null,
};

type Change = 'made' | 'changed' | 'password_set' | 'enabled' | 'disabled';

/** A change to the channel: what kind, and never a host, address or password (LIF-030). */
async function recordChange(
  trx: TenantTransaction,
  id: string,
  detail: { readonly change: Change; readonly relay?: MailRelay; readonly moved?: boolean },
): Promise<void> {
  await recordEvent(trx, {
    kind: 'mail_channel.changed',
    subject: { kind: 'mail_channel', id },
    detail,
  });
}

/** The channel, if one was ever set; `lock` holds it for a change. */
export async function mailChannel(
  trx: TenantTransaction,
  options: { readonly lock?: boolean } = {},
): Promise<MailChannel | undefined> {
  let query = trx
    .selectFrom('mail_channel')
    .select(['id', 'enabled', 'relay', 'host', 'port', 'username', 'from_address', 'from_name'])
    .select(['failing_since', 'last_success_at'])
    .select((eb) => eb('sealed_password', 'is not', null).as('has_password'));
  if (options.lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (!row) return undefined;
  return {
    id: row.id,
    enabled: row.enabled,
    relay: row.relay as MailRelay,
    host: row.host,
    port: row.port,
    username: row.username,
    fromAddress: row.from_address,
    fromName: row.from_name,
    hasPassword: Boolean(row.has_password),
    failingSince: row.failing_since,
    lastSuccessAt: row.last_success_at,
  };
}

/**
 * Sets the channel. A password opens only for the host, port and username it was sealed to, so one
 * moved past is dropped here, whoever asks (EM-I). Answers the channel as it now stands.
 */
export async function setMailChannel(
  trx: TenantTransaction,
  input: {
    readonly enabled: boolean;
    readonly relay: MailRelay;
    readonly host: string | null;
    readonly port: number | null;
    readonly username: string | null;
    readonly fromAddress: string | null;
    readonly fromName: string | null;
    readonly by: string;
  },
): Promise<MailChannel> {
  const held = await mailChannel(trx, { lock: true });
  const moved =
    held !== undefined &&
    (held.host !== input.host || held.port !== input.port || held.username !== input.username);
  const values = {
    enabled: input.enabled,
    relay: input.relay,
    host: input.host,
    port: input.port,
    username: input.username,
    from_address: input.fromAddress,
    from_name: input.fromName,
    updated_by: input.by,
  };
  const row = held
    ? await trx
        .updateTable('mail_channel')
        .set({
          ...values,
          updated_at: new Date(),
          ...(moved ? { sealed_password: null } : {}),
        })
        .where('id', '=', held.id)
        .returning('id')
        .executeTakeFirstOrThrow()
    : await trx.insertInto('mail_channel').values(values).returning('id').executeTakeFirstOrThrow();
  const change: Change = !held
    ? 'made'
    : held.enabled !== input.enabled
      ? input.enabled
        ? 'enabled'
        : 'disabled'
      : 'changed';
  await recordChange(trx, row.id, { change, relay: input.relay, ...(moved ? { moved } : {}) });
  return (await mailChannel(trx))!;
}

/** Keeps a password the connector sealed to the channel's relay as it stands. */
export async function setMailPassword(
  trx: TenantTransaction,
  id: string,
  sealed: string,
  by: string,
): Promise<void> {
  await trx
    .updateTable('mail_channel')
    .set({ sealed_password: sealed, updated_at: new Date(), updated_by: by })
    .where('id', '=', id)
    .execute();
  await recordChange(trx, id, { change: 'password_set' });
}

/** Why a mail is sent (EM-F); a test alone until EMc and EMd. */
export type MailPurpose = 'test';

/** How long a mail is tried, from its first attempt, decided at claiming (EM-M). */
const AGE: Readonly<Record<MailPurpose, string>> = { test: '1 hour' };

/** Whether a person may be mailed at all: a person, not erased or disabled, at a verified address (EM-G). */
export async function mailableAddress(trx: TenantTransaction, principalId: string): Promise<boolean> {
  const row = await trx
    .selectFrom('principal')
    .select(['kind', 'email', 'email_verified', 'erased_at', 'disabled_at'])
    .where('id', '=', principalId)
    .executeTakeFirst();
  return (
    row !== undefined &&
    row.kind !== 'service' &&
    row.erased_at === null &&
    row.disabled_at === null &&
    row.email !== null &&
    row.email_verified
  );
}

/** Queues a test of the channel to the caller's own address (EM-P). Answers its id. */
export async function queueTestMail(trx: TenantTransaction, principalId: string): Promise<string> {
  const { id } = await trx
    .insertInto('email_delivery')
    .values({ purpose: 'test', principal_id: principalId })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

/** Whose relay a claimed mail leaves by, as the connector is asked to use it (EM-I). */
export type ClaimedRelay =
  | { readonly kind: 'platform' }
  | {
      readonly kind: 'own';
      readonly host: string;
      readonly port: 465 | 587;
      readonly username: string | null;
      readonly sealed: string | null;
      readonly fromAddress: string;
    };

/** A mail claimed for an attempt: its address read now, never kept on the row (EM-F). */
export interface ClaimedMail {
  readonly id: string;
  readonly purpose: MailPurpose;
  readonly to: string;
  readonly relay: ClaimedRelay;
  /** The channel's name for the sender, or null for the tenant's own name. */
  readonly fromName: string | null;
  /** The lease this claim holds: an attempt is recorded only under it. */
  readonly lease: string;
}

/** Why a mail was dropped unsent at claiming (EM-G). */
type Unsendable = 'service_identity' | 'erased' | 'disabled' | 'no_address' | 'unverified';

interface DueRow {
  readonly id: string;
  readonly purpose: MailPurpose;
  readonly lease: string;
  readonly kind: string;
  readonly email: string | null;
  readonly email_verified: boolean;
  readonly erased: boolean;
  readonly disabled: boolean;
}

function unsendable(row: DueRow): Unsendable | undefined {
  if (row.kind === 'service') return 'service_identity';
  if (row.erased) return 'erased';
  if (row.disabled) return 'disabled';
  if (row.email === null) return 'no_address';
  if (!row.email_verified) return 'unverified';
  return undefined;
}

/**
 * The mails due now, at most `limit`, each leased for `leaseMs`, claimed past any another holds
 * (EM-M). Those past their age are given up first; each claimed is decided again for whom it is to,
 * and dropped unsent, with the reason, where they may no longer be mailed (EM-G).
 */
export async function claimMail(
  trx: TenantTransaction,
  limit: number,
  leaseMs: number,
): Promise<{ readonly claimed: readonly ClaimedMail[]; readonly dropped: number }> {
  for (const [purpose, age] of Object.entries(AGE)) {
    await sql`update email_delivery set state = 'given_up', locked_until = null
       where state = 'pending' and purpose = ${purpose}
         and first_attempt_at <= now() - ${age}::interval`.execute(trx);
  }
  const { rows } = await sql<DueRow>`
    with due as (
      select d.id from email_delivery d
       where d.state = 'pending' and d.next_at <= now()
         and (d.locked_until is null or d.locked_until < now())
       order by d.next_at
       limit ${limit}
       for update of d skip locked
    )
    update email_delivery d
       set locked_until = now() + make_interval(secs => ${leaseMs / 1000})
      from due, principal p
     where d.id = due.id and p.id = d.principal_id
    returning d.id, d.purpose, d.locked_until::text as lease, p.kind, p.email, p.email_verified,
              p.erased_at is not null as erased, p.disabled_at is not null as disabled`.execute(trx);
  let dropped = 0;
  const sendable: DueRow[] = [];
  for (const row of rows) {
    const reason = unsendable(row);
    if (reason === undefined) {
      sendable.push(row);
      continue;
    }
    dropped += 1;
    await trx
      .updateTable('email_delivery')
      .set({ state: 'dropped', dropped_reason: reason, locked_until: null })
      .where('id', '=', row.id)
      .execute();
  }
  if (sendable.length === 0) return { claimed: [], dropped };
  const channel = await trx
    .selectFrom('mail_channel')
    .select(['relay', 'host', 'port', 'username', 'sealed_password', 'from_address', 'from_name'])
    .executeTakeFirst();
  const relay: ClaimedRelay =
    channel?.relay === 'own'
      ? {
          kind: 'own',
          host: channel.host!,
          port: channel.port as 465 | 587,
          username: channel.username,
          sealed: channel.sealed_password,
          fromAddress: channel.from_address!,
        }
      : { kind: 'platform' };
  return {
    claimed: sendable.map((row) => ({
      id: row.id,
      purpose: row.purpose,
      to: row.email!,
      relay,
      fromName: channel?.from_name ?? null,
      lease: row.lease,
    })),
    dropped,
  };
}

/** How an attempt ended, as the worker saw it (EM-M). */
export type MailOutcome =
  | { readonly kind: 'sent'; readonly latencyMs: number }
  | {
      readonly kind: 'failed';
      readonly failure: MailFailureCode;
      readonly smtpCode?: number;
      readonly latencyMs: number;
    }
  /** The connector was full: no attempt, tried again shortly. */
  | { readonly kind: 'wait' };

/**
 * Records an attempt and what follows (EM-M, EM-N): sent; one recipient refused for good, given up;
 * no relay offered, dropped; a full connector or a spent hour, waiting with no attempt; anything else
 * the relay's, retried from 30 seconds doubling to an hour and the channel marked failing until a send
 * clears it. Answers whether the relay failed, which ends this tenant's pass.
 */
export async function recordMailAttempt(
  trx: TenantTransaction,
  deliveryId: string,
  outcome: MailOutcome,
  /** The claim's lease: a worker whose lease ran out, and was claimed past, records nothing. */
  lease: string,
): Promise<{ readonly relayFailed: boolean }> {
  const { rows: held } = await sql<{ state: string; lease: string | null; attempts: number }>`
    select state, locked_until::text as lease, attempts from email_delivery
     where id = ${deliveryId} for update`.execute(trx);
  const now = held[0];
  if (!now || now.state !== 'pending' || now.lease !== lease) return { relayFailed: false };
  const waits =
    outcome.kind === 'wait' || (outcome.kind === 'failed' && outcome.failure === 'quota_reached');
  if (waits) {
    await trx
      .updateTable('email_delivery')
      .set({
        locked_until: null,
        next_at:
          outcome.kind === 'wait'
            ? sql<Date>`now() + interval '5 seconds'`
            : sql<Date>`now() + interval '5 minutes'`,
      })
      .where('id', '=', deliveryId)
      .execute();
    return { relayFailed: false };
  }
  const failure = outcome.kind === 'failed' ? outcome.failure : undefined;
  await trx
    .insertInto('email_attempt')
    .values({
      delivery_id: deliveryId,
      failure: failure ?? null,
      smtp_code: outcome.kind === 'failed' ? (outcome.smtpCode ?? null) : null,
      latency_ms: outcome.latencyMs,
    })
    .execute();
  const state =
    failure === undefined
      ? 'sent'
      : failure === 'recipient_refused'
        ? 'given_up'
        : failure === 'relay_not_configured'
          ? 'dropped'
          : 'pending';
  await trx
    .updateTable('email_delivery')
    .set({
      state,
      dropped_reason: state === 'dropped' ? (failure ?? null) : null,
      attempts: now.attempts + 1,
      first_attempt_at: sql<Date>`coalesce(first_attempt_at, now())`,
      locked_until: null,
      next_at: sql<Date>`now() + make_interval(secs => ${mailBackoffSeconds(now.attempts)})`,
    })
    .where('id', '=', deliveryId)
    .execute();
  if (state === 'sent') {
    await trx
      .updateTable('mail_channel')
      .set({ failing_since: null, last_success_at: sql<Date>`now()` })
      .execute();
    return { relayFailed: false };
  }
  if (state === 'given_up') return { relayFailed: false };
  await trx
    .updateTable('mail_channel')
    .set({ failing_since: sql<Date>`coalesce(failing_since, now())` })
    .execute();
  return { relayFailed: true };
}

/** Mails past 30 days, and their attempts (EM-M). How many went. */
export async function sweepMail(trx: TenantTransaction): Promise<number> {
  const gone = await trx
    .deleteFrom('email_delivery')
    .where('created_at', '<', sql<Date>`now() - interval '30 days'`)
    .executeTakeFirst();
  return Number(gone.numDeletedRows);
}

/** A mail as an administrator reads it (EM-N): never its address, its words or the relay's. */
export interface MailRecord {
  readonly id: string;
  readonly purpose: MailPurpose;
  readonly state: 'pending' | 'sent' | 'given_up' | 'dropped';
  readonly droppedReason: string | null;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly nextAt: Date | null;
  readonly last: {
    readonly at: Date;
    readonly failure: string | null;
    readonly smtpCode: number | null;
  } | null;
}

interface ListedRow {
  readonly id: string;
  readonly purpose: MailPurpose;
  readonly state: MailRecord['state'];
  readonly dropped_reason: string | null;
  readonly attempts: number;
  readonly created_at: Date;
  readonly next_at: Date;
  readonly at: Date | null;
  readonly failure: string | null;
  readonly smtp_code: number | null;
}

/** The mails of these 30 days, newest first, a page at a time. */
export async function listMail(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<MailRecord>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const after =
    page.after === undefined
      ? sql`true`
      : sql`(d.created_at, d.id) < (select created_at, id from email_delivery
               where id = ${page.after}::uuid)`;
  const { rows } = await sql<ListedRow>`
    select d.id, d.purpose, d.state, d.dropped_reason, d.attempts, d.created_at, d.next_at,
           a.at, a.failure, a.smtp_code
      from email_delivery d
      left join lateral (
        select at, failure, smtp_code from email_attempt
         where delivery_id = d.id order by at desc, id desc limit 1) a on true
     where ${after}
     order by d.created_at desc, d.id desc
     limit ${page.limit + 1}`.execute(trx);
  return paged(
    rows.map((row) => ({
      id: row.id,
      purpose: row.purpose,
      state: row.state,
      droppedReason: row.dropped_reason,
      attempts: row.attempts,
      createdAt: row.created_at,
      nextAt: row.state === 'pending' ? row.next_at : null,
      last:
        row.at === null ? null : { at: row.at, failure: row.failure, smtpCode: row.smtp_code },
    })),
    page.limit,
  );
}

/** What waits, and what of these 30 days was sent, given up and dropped, by reason (EM-N). */
export async function mailCounts(trx: TenantTransaction): Promise<{
  readonly waiting: number;
  readonly sent: number;
  readonly givenUp: number;
  readonly dropped: Readonly<Record<string, number>>;
}> {
  const rows = await trx
    .selectFrom('email_delivery')
    .select(['state', 'dropped_reason'])
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .groupBy(['state', 'dropped_reason'])
    .execute();
  const of = (state: string) =>
    rows.filter((row) => row.state === state).reduce((sum, row) => sum + Number(row.count), 0);
  const dropped: Record<string, number> = {};
  for (const row of rows) {
    if (row.state === 'dropped' && row.dropped_reason !== null) {
      dropped[row.dropped_reason] = Number(row.count);
    }
  }
  return { waiting: of('pending'), sent: of('sent'), givenUp: of('given_up'), dropped };
}
