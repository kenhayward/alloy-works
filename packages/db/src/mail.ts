import type { MailRelay } from '@alloy-works/domain';
import { recordEvent } from './audit.js';
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
