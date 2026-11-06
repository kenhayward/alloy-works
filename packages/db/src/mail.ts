import {
  type ClosureNotice,
  decide,
  MAIL_KINDS,
  mailBackoffSeconds,
  type MailCounts,
  type MailFailureCode,
  type MailKind,
  type MailRelay,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFacts } from './access-facts.js';
import { recordEvent } from './audit.js';
import { mayStillBeTold, type DigestCounts } from './inbox.js';
import { notifyTenant } from './realtime.js';
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
  /** The kinds it never mails, the environment's own policy (COL-060; EM-W). */
  readonly kindsOff: readonly MailKind[];
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
  kindsOff: [],
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
    .select(['failing_since', 'last_success_at', 'kinds_off'])
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
    kindsOff: MAIL_KINDS.filter((kind) => row.kinds_off.includes(kind)),
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
    /** The kinds never mailed; those it held where not named. */
    readonly kindsOff?: readonly MailKind[];
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
    kinds_off: [...(input.kindsOff ?? held?.kindsOff ?? [])],
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

/** Whether a person is mailed of each kind (EM-W): mailed, unless they chose not to be. */
export async function mailChoicesOf(
  trx: TenantTransaction,
  principal: string,
): Promise<Record<MailKind, boolean>> {
  const off = await trx
    .selectFrom('notification_email_off')
    .select('kind')
    .where('principal_id', '=', principal)
    .execute();
  return Object.fromEntries(
    MAIL_KINDS.map((kind) => [kind, !off.some((row) => row.kind === kind)]),
  ) as Record<MailKind, boolean>;
}

/** Changes whether a person is mailed of each kind, the kinds named alone. */
export async function setMailChoices(
  trx: TenantTransaction,
  principal: string,
  choices: { readonly [kind in MailKind]?: boolean | undefined },
): Promise<void> {
  for (const kind of MAIL_KINDS) {
    const mailed = choices[kind];
    if (mailed === undefined) continue;
    if (mailed) {
      await trx
        .deleteFrom('notification_email_off')
        .where('principal_id', '=', principal)
        .where('kind', '=', kind)
        .execute();
    } else {
      await trx
        .insertInto('notification_email_off')
        .values({ principal_id: principal, kind })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    }
  }
}

/** Why a mail is sent (EM-F): a test, a notification, an invitation, a notice of closing. */
export type MailPurpose = 'test' | 'notification' | 'invitation' | 'closure';

/**
 * How long a mail is tried, from its first attempt, decided at claiming (EM-M). A notice of closing is
 * tried to the end of its grace, or a week where it has none, as a cancelling's has not.
 */
const AGE: Readonly<Record<Exclude<MailPurpose, 'closure'>, string>> = {
  test: '1 hour',
  notification: '24 hours',
  invitation: '14 days',
};

/** Whether a person may be mailed at all: a person, not erased or disabled, at a verified address (EM-G). */
export async function mailableAddress(
  trx: TenantTransaction,
  principalId: string,
): Promise<boolean> {
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
  /** A notification's kind, and a digest's counts of the kinds left on; null on any other. */
  readonly notification: { readonly kind: MailKind; readonly counts?: MailCounts } | null;
  /** A notice of closing, and when its grace ends where it has one; null on any other (EM-V). */
  readonly closure: { readonly notice: ClosureNotice; readonly graceEndsAt: Date | null } | null;
  /** The person's interface language, where they chose one (EM-E). */
  readonly language: string | null;
  /** The lease this claim holds: an attempt is recorded only under it. */
  readonly lease: string;
}

/** Why a mail was dropped unsent at claiming (EM-G, EM-H, EM-W). */
type Unsendable =
  | 'service_identity'
  | 'erased'
  | 'disabled'
  | 'no_address'
  | 'unverified'
  | 'channel_off'
  | 'read'
  | 'environment_off'
  | 'opted_out'
  | 'no_longer_told'
  | 'accepted'
  | 'expired';

interface DueRow {
  readonly id: string;
  readonly purpose: MailPurpose;
  readonly principal_id: string;
  readonly notification_id: string | null;
  readonly notice: ClosureNotice | null;
  readonly grace_ends_at: Date | null;
  /** An invitation's own address, and whether it may still be claimed (EM-G). */
  readonly invited_email: string | null;
  readonly invitation_open: boolean | null;
  readonly invitation_lapsed: boolean | null;
  readonly language: string | null;
  readonly lease: string;
  readonly kind: string;
  readonly email: string | null;
  readonly email_verified: boolean;
  readonly erased: boolean;
  readonly disabled: boolean;
}

function unsendable(row: DueRow): Unsendable | undefined {
  if (row.purpose === 'invitation') {
    // To the address invited, never verified until it is claimed by signing in with it (EM-G).
    if (row.invitation_open !== true) return 'accepted';
    if (row.invitation_lapsed === true) return 'expired';
    if (row.disabled) return 'disabled';
    return undefined;
  }
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
  /** Those purposes alone: a closing environment sends its notices and nothing else (EM-T). */
  options: { readonly purposes?: readonly MailPurpose[] } = {},
): Promise<{ readonly claimed: readonly ClaimedMail[]; readonly dropped: number }> {
  const purposes: readonly MailPurpose[] = options.purposes ?? [
    'test',
    'notification',
    'invitation',
    'closure',
  ];
  const among = sql.join(purposes.map((each) => sql.lit(each)));
  for (const [purpose, age] of Object.entries(AGE)) {
    // Never one another worker holds while it is sent: its send would go unrecorded.
    await sql`update email_delivery set state = 'given_up', locked_until = null
       where state = 'pending' and purpose = ${purpose}
         and (locked_until is null or locked_until < now())
         and first_attempt_at <= now() - ${age}::interval`.execute(trx);
  }
  await sql`update email_delivery set state = 'given_up', locked_until = null
     where state = 'pending' and purpose = 'closure'
       and (locked_until is null or locked_until < now())
       and coalesce(grace_ends_at, first_attempt_at + interval '7 days') <= now()`.execute(trx);
  // A relay that failed holds the environment's mail back as a whole until it is due again, so a
  // black-holed relay takes no lane meanwhile, whatever is queued after it (the final review).
  const { rows: waiting } = await sql<{ held: boolean }>`
    select exists (select from email_delivery
                    where state = 'pending' and attempts > 0 and next_at > now()
                      and purpose in (${among})) as held`.execute(trx);
  if (waiting[0]?.held) return { claimed: [], dropped: 0 };
  const { rows } = await sql<DueRow>`
    with due as (
      select d.id from email_delivery d
       where d.state = 'pending' and d.next_at <= now() and d.purpose in (${among})
         and (d.locked_until is null or d.locked_until < now())
       order by d.next_at
       limit ${limit}
       for update of d skip locked
    )
    update email_delivery d
       set locked_until = now() + make_interval(secs => ${leaseMs / 1000}),
           first_attempt_at = coalesce(d.first_attempt_at, now())
      from due, principal p
     where d.id = due.id and p.id = d.principal_id
    returning d.id, d.purpose, d.principal_id, d.notification_id, d.notice, d.grace_ends_at,
              d.locked_until::text as lease,
              (select i.email from invitation i where i.id = d.invitation_id) as invited_email,
              (select i.accepted_at is null from invitation i where i.id = d.invitation_id)
                as invitation_open,
              (select i.expires_at is not null and i.expires_at <= now()
                 from invitation i where i.id = d.invitation_id) as invitation_lapsed,
              p.kind, p.email, p.email_verified, p.erased_at is not null as erased,
              p.disabled_at is not null as disabled,
              to_jsonb(p) ->> 'interface_language' as language`.execute(trx);
  if (rows.length === 0) return { claimed: [], dropped: 0 };
  const channel = await trx
    .selectFrom('mail_channel')
    .select(['relay', 'host', 'port', 'username', 'sealed_password', 'from_address', 'from_name'])
    .select(['enabled', 'kinds_off'])
    .executeTakeFirst();
  let dropped = 0;
  const sendable: { readonly row: DueRow; readonly told: ClaimedMail['notification'] }[] = [];
  for (const row of rows) {
    let reason = unsendable(row);
    let told: ClaimedMail['notification'] = null;
    if (reason === undefined && row.notification_id !== null) {
      const decided = await toldOf(trx, row.notification_id, row.principal_id, channel);
      if (typeof decided === 'string') reason = decided;
      else told = decided;
    }
    if (reason === undefined) {
      sendable.push({ row, told });
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
  const own: ClaimedRelay | undefined =
    channel?.relay === 'own'
      ? {
          kind: 'own',
          host: channel.host!,
          port: channel.port as 465 | 587,
          username: channel.username,
          sealed: channel.sealed_password,
          fromAddress: channel.from_address!,
        }
      : undefined;
  // A notice of closing leaves by the operator's relay always, an invitation by it where the
  // environment's mail is off (EM-U, EM-V): neither waits on a relay the environment chose.
  const relayOf = (purpose: MailPurpose): ClaimedRelay =>
    own === undefined ||
    purpose === 'closure' ||
    (purpose === 'invitation' && channel?.enabled !== true)
      ? { kind: 'platform' }
      : own;
  return {
    claimed: sendable.map(({ row, told }) => ({
      id: row.id,
      purpose: row.purpose,
      to: row.purpose === 'invitation' ? row.invited_email! : row.email!,
      relay: relayOf(row.purpose),
      fromName: channel?.from_name ?? null,
      notification: told,
      closure:
        row.notice === null ? null : { notice: row.notice, graceEndsAt: row.grace_ends_at },
      language: row.language,
      lease: row.lease,
    })),
    dropped,
  };
}

/**
 * A notification's mail decided again at sending (EM-G, EM-H, EM-W): the channel still on, the
 * notification unread, its kind mailed by the environment and the person, and theirs to be told of
 * still; a digest counting the kinds left on alone, and sent only where any is. Answers what it tells,
 * or why it is dropped.
 */
async function toldOf(
  trx: TenantTransaction,
  notificationId: string,
  recipient: string,
  channel: { readonly enabled: boolean; readonly kinds_off: string[] } | undefined,
): Promise<NonNullable<ClaimedMail['notification']> | Unsendable> {
  if (!channel?.enabled) return 'channel_off';
  const notification = await trx
    .selectFrom('notification')
    .select(['recipient', 'kind', 'thread_id', 'artifact_id', 'counts', 'read_at'])
    .where('id', '=', notificationId)
    .executeTakeFirstOrThrow();
  if (notification.read_at !== null) return 'read';
  const kind = notification.kind as MailKind;
  if (channel.kinds_off.includes(kind)) return 'environment_off';
  const mailed = await mailChoicesOf(trx, recipient);
  if (!mailed[kind]) return 'opted_out';
  if (!(await mayStillBeTold(trx, notification))) return 'no_longer_told';
  if (kind !== 'digest') return { kind };
  const held = notification.counts as DigestCounts;
  const on = (each: MailKind) => mailed[each] && !channel.kinds_off.includes(each);
  const counts: MailCounts = {
    mention: on('mention') ? held.mention : 0,
    reply: on('reply') ? held.reply : 0,
    resolution: on('resolution') ? held.resolution : 0,
    round: on('round') ? (held.round ?? 0) : 0,
  };
  if (counts.mention + counts.reply + counts.resolution + counts.round === 0) {
    // Whose choice emptied it: the person's own, or the environment's over what they kept on.
    const kept = (['mention', 'reply', 'resolution', 'round'] as const).some(
      (each) => mailed[each] && (held[each] ?? 0) > 0,
    );
    return kept ? 'environment_off' : 'opted_out';
  }
  return { kind, counts };
}

/**
 * Queues the notice 7 days before a closing's grace ends (EM-V), once to each person who signs in in
 * the ordinary way, however often it is asked: the closure sweep asks on each of its passes. Answers
 * how many it queued.
 */
export async function queueClosureReminders(trx: TenantTransaction): Promise<number> {
  const { rows } = await sql<{ id: string }>`
    insert into email_delivery (purpose, principal_id, notice, grace_ends_at)
    select 'closure', p.id, 'seven_days', s.grace_ends_at
      from platform.own_tenant_state() s, principal p
     where s.state = 'closing' and s.grace_ends_at > now()
       and s.grace_ends_at <= now() + interval '7 days'
       and p.kind in ('user', 'external') and p.issuer is not null
       and p.disabled_at is null and p.erased_at is null
    on conflict do nothing
    returning id`.execute(trx);
  return rows.length;
}

/** Drops a claimed mail unsent, as its worker decided (EM-Q): no address for the environment. */
export async function dropMail(
  trx: TenantTransaction,
  deliveryId: string,
  reason: 'no_hostname',
  lease: string,
): Promise<void> {
  await trx
    .updateTable('email_delivery')
    .set({ state: 'dropped', dropped_reason: reason, locked_until: null })
    .where('id', '=', deliveryId)
    .where('state', '=', 'pending')
    .where(sql<boolean>`locked_until::text = ${lease}`)
    .execute();
}

/**
 * Tells those who may configure services, once, that the channel is failing (EM-N), until a send
 * clears it: by an inbox kind that is never mailed, in a savepoint, so the telling never undoes the
 * attempt recorded. Candidates are those granted at the environment a role holding the permission,
 * each decided again on their grants as every check is.
 */
async function tellFailing(trx: TenantTransaction): Promise<void> {
  await sql`savepoint tell_failing`.execute(trx);
  try {
    const { rows: untold } = await sql<{ id: string }>`
      select id from mail_channel where told_at is null for update`.execute(trx);
    let told = 0;
    if (untold.length > 0) {
      // Granted it directly or through a group (the final review): each decided again below.
      const { rows: candidates } = await sql<{ id: string }>`
        select distinct p.id from access_grant g
          join role r on r.id = g.role_id
          left join group_member m on m.group_id = g.group_id
          join principal p on p.id = coalesce(g.principal_id, m.principal_id)
         where g.level = 'tenant' and g.effect = 'allow'
           and 'configure_services' = any (r.permissions)
           and p.kind = 'user' and p.disabled_at is null and p.erased_at is null`.execute(trx);
      for (const { id } of candidates) {
        const facts = await loadFacts(trx, id, { kind: 'tenant' });
        if (facts === undefined || !decide('configure_services', facts).allowed) continue;
        await sql`insert into notification (recipient, kind) values (${id}, 'mail')`.execute(trx);
        await notifyTenant(trx, { kind: 'inbox', recipient: id });
        told += 1;
      }
    }
    // Told once, and only once somebody was: with nobody to tell, the next failure asks again.
    if (told > 0) await sql`update mail_channel set told_at = now()`.execute(trx);
    await sql`release savepoint tell_failing`.execute(trx);
  } catch {
    await sql`rollback to savepoint tell_failing`.execute(trx);
  }
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
      .set({ failing_since: null, told_at: null, last_success_at: sql<Date>`now()` })
      .execute();
    return { relayFailed: false };
  }
  // A recipient refused for good is that mail's; no relay offered is the operator's, not the channel's.
  if (state !== 'pending') return { relayFailed: false };
  await trx
    .updateTable('mail_channel')
    .set({ failing_since: sql<Date>`coalesce(failing_since, now())` })
    .execute();
  // The rest wait as long as this one does: the relay is failing, not this mail.
  await sql`update email_delivery set next_at = (select next_at from email_delivery where id = ${deliveryId})
     where state = 'pending' and id <> ${deliveryId}
       and next_at < (select next_at from email_delivery where id = ${deliveryId})`.execute(trx);
  await tellFailing(trx);
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
      last: row.at === null ? null : { at: row.at, failure: row.failure, smtpCode: row.smtp_code },
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
