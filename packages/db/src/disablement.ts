import { sql } from 'kysely';
import { labelled, labels, principalLabel, recordEvent } from './audit.js';
import { erasedIn } from './erasure.js';
import { lastHolderRemains } from './grant-limits.js';
import { wayInRemains } from './sign-in-settings.js';
import type { TenantTransaction } from './tables.js';

export type DisablementBy = 'person' | 'scim';

export type DisablementAnswer =
  | {
      /** What ended with it, for the caller to say to every replica. */
      readonly sessions: readonly string[];
      readonly tokens: readonly string[];
    }
  | { readonly refused: 'principal.missing' | 'principal.service' | 'principal.erased' }
  | { readonly refused: 'principal.last_way_in' }
  | { readonly refused: 'principal.last_holder' };

/**
 * **Disables a person** (identity.md, "Disabled people"): their sessions and tokens end in this
 * transaction, each recorded before it goes, and they sign in no more until enabled. Disabling somebody
 * disabled changes nothing. A person's act is refused where it would leave nobody able to sign in and
 * configure sign-in (IN-B); SCIM's never is, since a provider retries what it is refused.
 *
 * The principal's row is held first, so a sign-in in flight either finds them disabled or has made its
 * session in time to be ended here. A caller guarding the way in takes the access epoch first.
 */
export async function disablePrincipal(
  trx: TenantTransaction,
  id: string,
  by: DisablementBy,
): Promise<DisablementAnswer> {
  const held = await trx
    .selectFrom('principal')
    .select(['kind', 'disabled_at', 'disabled_by'])
    .select(erasedIn().as('erased'))
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!held) return { refused: 'principal.missing' };
  if (held.kind === 'service') return { refused: 'principal.service' };
  if (held.erased) return { refused: 'principal.erased' };
  if (held.disabled_at !== null) {
    // An administrator's disablement of somebody SCIM disabled is theirs now, so a provider saying
    // active again does not undo it. Nothing else ended: all of it did when SCIM disabled them.
    if (by === 'person' && held.disabled_by === 'scim') {
      await trx.updateTable('principal').set({ disabled_by: by }).where('id', '=', id).execute();
      await recordEvent(
        trx,
        { kind: 'principal.disabled', subject: { kind: 'principal', id }, detail: { by } },
        labels(await principalLabel(trx, 'subject', id)),
      );
    }
    return { sessions: [], tokens: [] };
  }
  if (by === 'person' && !(await wayInRemains(trx, { disabling: id }))) {
    return { refused: 'principal.last_way_in' };
  }
  if (by === 'person' && !(await lastHolderRemains(trx, { disabling: id }))) {
    return { refused: 'principal.last_holder' };
  }
  const subject = labels(await principalLabel(trx, 'subject', id));
  const sessions = await trx
    .selectFrom('session')
    .select('id')
    .where('principal_id', '=', id)
    .orderBy('id')
    .forUpdate()
    .execute();
  for (const session of sessions) {
    await recordEvent(
      trx,
      {
        kind: 'authentication.signed_out',
        subject: { kind: 'principal', id },
        detail: { ended: 'disabled', session: session.id },
      },
      subject,
    );
  }
  await trx.deleteFrom('session').where('principal_id', '=', id).execute();
  const tokens = await trx
    .selectFrom('api_token')
    .select(['id', 'name'])
    .where('principal_id', '=', id)
    .orderBy('id')
    .forUpdate()
    .execute();
  for (const token of tokens) {
    await recordEvent(
      trx,
      { kind: 'token.revoked', subject: { kind: 'token', id: token.id } },
      labels(labelled('subject', token.name, id), await principalLabel(trx, 'holder', id)),
    );
  }
  await trx.deleteFrom('api_token').where('principal_id', '=', id).execute();
  await trx
    .updateTable('principal')
    .set({ disabled_at: sql<Date>`now()`, disabled_by: by })
    .where('id', '=', id)
    .execute();
  await recordEvent(
    trx,
    { kind: 'principal.disabled', subject: { kind: 'principal', id }, detail: { by } },
    subject,
  );
  return {
    sessions: sessions.map((each) => each.id),
    tokens: tokens.map((each) => each.id),
  };
}

/** Enables a person disabled; what ended stays ended. Enabling somebody enabled changes nothing. */
export async function enablePrincipal(
  trx: TenantTransaction,
  id: string,
  by: DisablementBy,
): Promise<'enabled' | 'principal.missing' | 'principal.service' | 'principal.erased'> {
  const held = await trx
    .selectFrom('principal')
    .select(['kind', 'disabled_at'])
    .select(erasedIn().as('erased'))
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!held) return 'principal.missing';
  if (held.kind === 'service') return 'principal.service';
  if (held.erased) return 'principal.erased';
  if (held.disabled_at === null) return 'enabled';
  await trx
    .updateTable('principal')
    .set({ disabled_at: null, disabled_by: null })
    .where('id', '=', id)
    .execute();
  await recordEvent(
    trx,
    { kind: 'principal.enabled', subject: { kind: 'principal', id }, detail: { by } },
    labels(await principalLabel(trx, 'subject', id)),
  );
  return 'enabled';
}
