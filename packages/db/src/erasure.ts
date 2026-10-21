import { sql } from 'kysely';
import { lockAccessForChange } from './access-facts.js';
import { erasePersonalPrompts } from './personal-prompts.js';
import { erasePersonLimit } from './generation-limits.js';
import { eraseQueryEmbeddings } from './embeddings.js';
import { revokeApiToken } from './api-tokens.js';
import { eraseLabels, labels, principalLabel, recordEvent } from './audit.js';
import { recordGrantsRevoked } from './grants.js';
import { recordMembershipsRemoved } from './groups.js';
import { withdrawInvitation } from './invitations.js';
import { notifyTenant } from './realtime.js';
import { lockNaming, reindexNaming, rewriteEarlierNaming } from './search.js';
import { rebuildHistory } from './search-history.js';
import type { TenantTransaction } from './tables.js';

/**
 * Erasure of a person (VER-038; lifecycle.md, "Erasure"; the ER plan, ER-A to ER-E): their name and
 * address wherever the tenant holds them as theirs, and every audit label naming them, by one audited
 * act that also ends their access. Their id, issuer and subject stay, so every reference holds and a
 * later sign-in by them is refused. Who may - `administer` at the tenant - is the caller's to decide.
 */

/** What an erased person's name reads as, wherever it is shown (ER-A). */
export const ERASED_NAME = 'Erased person';

/** Whether the principal row `alias` names is erased, read so a schema before 0087 answers no. */
export const erasedIn = (alias = 'principal') =>
  sql<boolean>`(to_jsonb(${sql.table(alias)}) ->> 'erased_at') is not null`;

/** Why erasing a person is refused (ER-C): every reason, not the first. */
export type ErasureRefusal =
  | { readonly reason: 'granted'; readonly grants: number }
  | { readonly reason: 'self' }
  | { readonly reason: 'service' };

/** What erasing a person would do now, and what refuses it (ER-B). */
export interface ErasureState {
  readonly person: {
    readonly id: string;
    readonly kind: 'user' | 'service' | 'external';
    /** Invited by address and never signed in: the act withdraws the invitation. */
    readonly invited: boolean;
    readonly erased: boolean;
  };
  /** What the act takes, counted now; the labels its own events write are erased too. */
  readonly erases: {
    readonly sessions: number;
    readonly tokens: number;
    readonly memberships: number;
    readonly invitation: boolean;
    readonly labels: number;
  };
  /** What stays: the events recorded against their id, which the erased labels leave readable. */
  readonly remains: { readonly events: number };
  readonly refusals: readonly ErasureRefusal[];
}

export type ErasureAnswer =
  | { readonly answer: 'erased'; readonly labels: number }
  | { readonly answer: 'unchanged' }
  | { readonly answer: 'refused'; readonly refusals: readonly ErasureRefusal[] };

const counted = (row: { count: string | number | bigint } | undefined) => Number(row?.count ?? 0);

/** The person, their invitation, and each count, read under whatever lock the caller holds. */
async function stateOf(
  trx: TenantTransaction,
  person: string,
  by: string,
  lock: boolean,
): Promise<(ErasureState & { readonly invitationId: string | null }) | undefined> {
  // The invitation's row before the principal's, as a claim takes them, so the two never wait on
  // each other in a cycle.
  let invitation = trx.selectFrom('invitation').select('id').where('principal_id', '=', person);
  if (lock) invitation = invitation.forUpdate();
  const invited = await invitation.executeTakeFirst();
  let principal = trx
    .selectFrom('principal')
    .select(['id', 'kind'])
    .select(sql<boolean>`issuer is null and kind <> 'service'`.as('invited'))
    .select(erasedIn().as('erased'))
    .where('id', '=', person);
  if (lock) principal = principal.forUpdate();
  const row = await principal.executeTakeFirst();
  if (!row) return undefined;
  const count = (table: 'session' | 'api_token' | 'group_member' | 'access_grant') =>
    trx
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('principal_id', '=', person)
      .executeTakeFirst()
      .then(counted);
  const grants = await count('access_grant');
  // Somebody invited is withdrawn, which removes and records their grants (the ER final review, L1).
  const refusals: ErasureRefusal[] = row.erased
    ? []
    : [
        ...(grants > 0 && !row.invited ? [{ reason: 'granted' as const, grants }] : []),
        ...(row.id === by.toLowerCase() ? [{ reason: 'self' as const }] : []),
        ...(row.kind === 'service' ? [{ reason: 'service' as const }] : []),
      ];
  return {
    person: { id: row.id, kind: row.kind, invited: row.invited, erased: row.erased },
    erases: {
      sessions: await count('session'),
      tokens: await count('api_token'),
      memberships: await count('group_member'),
      invitation: invited !== undefined,
      labels: counted(
        await trx
          .selectFrom('audit_label')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('refers_to', '=', person)
          .where('erased_at', 'is', null)
          .executeTakeFirst(),
      ),
    },
    remains: {
      events: counted(
        await trx
          .selectFrom('audit_event')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where((eb) => eb.or([eb('actor', '=', person), eb('subject', '=', person)]))
          .executeTakeFirst(),
      ),
    },
    refusals,
    invitationId: invited?.id ?? null,
  };
}

/** What erasing `person` would do and what refuses it, as `by` would be refused; undefined for nobody. */
export async function erasureOf(
  trx: TenantTransaction,
  person: string,
  by: string,
): Promise<ErasureState | undefined> {
  const state = await stateOf(trx, person, by, false);
  return (
    state && {
      person: state.person,
      erases: state.erases,
      remains: state.remains,
      refusals: state.refusals,
    }
  );
}

/**
 * Erases `person`, as `by` (ER-A): under the access epoch, then their invitation's row and theirs, so
 * a sign-in or a claim of them waits and then finds them erased (ER-D), as does a version being
 * indexed, whose words search rewrites. Every event the act records -
 * sessions ended, tokens revoked, memberships removed, an invitation withdrawn - comes before their
 * name is blanked, and `erase_labels` last, so no label it writes outlives it. Somebody invited who
 * never signed in is withdrawn, and so goes whole. Undefined for nobody this tenant holds. Erasing the
 * erased ends whatever access a race left them, naming nobody, and answers unchanged.
 */
export async function erasePerson(
  trx: TenantTransaction,
  person: string,
  by: string,
): Promise<ErasureAnswer | undefined> {
  // Memberships change access, and a sign-in settling them takes the epoch before their row.
  await lockAccessForChange(trx);
  // Every artifact naming them, before their row: a save holds its artifact, then their row (SV H1).
  await lockNaming(trx, person);
  const state = await stateOf(trx, person, by, true);
  if (!state) return undefined;
  if (state.person.erased) {
    await endAccess(trx, state.person.id);
    return { answer: 'unchanged' };
  }
  if (state.refusals.length > 0) return { answer: 'refused', refusals: state.refusals };

  if (state.person.invited) {
    // Its principal goes, with its grants, and the invitation with it (ER-A).
    const withdrawn =
      state.invitationId === null ? undefined : await withdrawInvitation(trx, state.invitationId);
    if (!withdrawn || 'refused' in withdrawn) {
      throw new Error(`The invitation of ${person} could not be withdrawn`);
    }
    await unsayName(trx, state.person.id);
    return { answer: 'erased', labels: await eraseLabels(trx, person) };
  }

  await endAccess(trx, state.person.id);
  // Their own saved words go: nobody else reads them (G5-G).
  await erasePersonalPrompts(trx, state.person.id);
  await erasePersonLimit(trx, state.person.id);
  // What they searched for, by meaning (the G7 plan, G7-G).
  await eraseQueryEmbeddings(trx, state.person.id);
  // The accepted invitation's row holds their address; it records nothing anything reads after.
  if (state.invitationId !== null) {
    await trx.deleteFrom('invitation').where('id', '=', state.invitationId).execute();
  }
  await trx
    .updateTable('principal')
    .set({
      display_name: ERASED_NAME,
      email: null,
      email_verified: false,
      erased_at: sql<Date>`now()`,
    })
    .where('id', '=', person)
    .execute();
  await unsayName(trx, state.person.id);
  return { answer: 'erased', labels: await eraseLabels(trx, person) };
}

/**
 * Search said their name wherever a value named them; it says the fixed word now (#594), in earlier
 * versions' words too (SV-J). A fold never takes a word out, so every artifact either rewrite touched
 * has its history made again, after both, under the locks they took (SV3-K).
 */
async function unsayName(trx: TenantTransaction, person: string): Promise<void> {
  const current = await reindexNaming(trx, person);
  const earlier = await rewriteEarlierNaming(trx, person);
  for (const artifact of [...new Set([...current, ...earlier])].sort()) {
    await rebuildHistory(trx, artifact);
  }
}

/**
 * Ends everything giving `person` access, recording each before it goes: sessions, tokens, hand-offs,
 * grants (none, but for the erased) and memberships.
 */
async function endAccess(trx: TenantTransaction, person: string): Promise<void> {
  const sessions = await trx
    .selectFrom('session')
    .select('id')
    .where('principal_id', '=', person)
    .orderBy('id')
    .forUpdate()
    .execute();
  const subject = labels(await principalLabel(trx, 'subject', person));
  for (const session of sessions) {
    await recordEvent(
      trx,
      {
        kind: 'authentication.signed_out',
        subject: { kind: 'principal', id: person },
        detail: { ended: 'erased', session: session.id },
      },
      subject,
    );
  }
  await trx.deleteFrom('session').where('principal_id', '=', person).execute();
  // Every replica stops what each was doing (IAM-082).
  for (const session of sessions) {
    await notifyTenant(trx, { kind: 'credential_ended', session: session.id });
  }
  const tokens = await trx
    .selectFrom('api_token')
    .select('id')
    .where('principal_id', '=', person)
    .orderBy('id')
    .execute();
  for (const token of tokens) {
    await revokeApiToken(trx, person, token.id);
    await notifyTenant(trx, { kind: 'credential_ended', token: token.id });
  }
  await trx.deleteFrom('sign_in_handoff').where('principal_id', '=', person).execute();
  await recordGrantsRevoked(trx, { principal: person });
  await trx.deleteFrom('access_grant').where('principal_id', '=', person).execute();
  await recordMembershipsRemoved(trx, { principal: person });
  await trx.deleteFrom('group_member').where('principal_id', '=', person).execute();
}

/**
 * `person`'s row held FOR SHARE to the end of the transaction, answering whether they are erased or
 * gone: a sign-in asks it after any lock on the access epoch and before it changes anything, so an
 * erasure - the epoch, then the row - ends the session or is seen here (ER-D).
 */
export async function holdPrincipal(
  trx: TenantTransaction,
  person: string,
): Promise<'held' | 'erased' | 'missing'> {
  const row = await trx
    .selectFrom('principal')
    .select(erasedIn().as('erased'))
    .where('id', '=', person)
    .forShare()
    .executeTakeFirst();
  return !row ? 'missing' : row.erased ? 'erased' : 'held';
}
