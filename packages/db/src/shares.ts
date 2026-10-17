import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { labelled, labels, recordEvent } from './audit.js';
import { accessPolicy, grant, removeGrant } from './grants.js';
import { invite, invitedAddress, type StoredInvitation } from './invitations.js';
import type { Role } from './roles.js';
import type { TenantTransaction } from './tables.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What a recipient may fetch: an output, or the PDF's veraPDF report. */
export type SharedOutput = 'pdf' | 'docx' | 'provenance' | 'verapdf';

export interface StoredShare {
  /** The grant's id: a share is an ordinary grant at the publication (the R17 plan, R17-B). */
  readonly id: string;
  readonly recipient: {
    readonly id: string;
    readonly email: string | null;
    readonly name: string | null;
    /** Whether they have proved who they are by signing in; until then, an invitation waits. */
    readonly signedIn: boolean;
  };
  readonly expiresAt: Date;
  readonly expired: boolean;
  readonly sharedBy: { readonly id: string; readonly name: string | null };
  readonly sharedAt: Date;
  /** Every access, newest first (PUB-060). */
  readonly accesses: readonly { readonly at: Date; readonly output: SharedOutput | null }[];
}

export type ShareAnswer =
  | {
      readonly answer: 'shared';
      readonly share: StoredShare;
      /** The invitation made or renewed for an address nobody has signed in with; else null. */
      readonly invitation: StoredInvitation | null;
    }
  | {
      readonly answer:
        | 'publication.missing'
        | 'share.member'
        | 'share.invitation_waiting'
        | 'share.erased'
        | 'share.duplicate'
        | 'share.expiry_past'
        | 'share.past_cap';
    };

/** The one fixed role a share grants through: `read` alone, refused change or removal (0114). */
export async function sharedReaderRole(trx: TenantTransaction): Promise<Role> {
  return trx
    .selectFrom('role')
    .select(['id', 'name', 'permissions'])
    .where('fixed', '=', true)
    .executeTakeFirstOrThrow();
}

/**
 * **Shares a publication outside the tenant** (PUB-057, PUB-058, PUB-084; the R17 plan): a named
 * address, taken as the external principal who signed in with it, or invited as one; never one of the
 * tenant's own, who read through the ordinary model. The share is a grant of the fixed role at the
 * publication alone, to the tenant's default expiry or the one asked for within its cap. Who may share
 * - `publish` on its document - is the caller's to decide first. The expiry and a duplicate are refused
 * before anybody is invited, so a refusal leaves nothing behind.
 */
export async function sharePublication(
  trx: TenantTransaction,
  input: {
    readonly publication: string;
    readonly email: string;
    readonly expiresAt?: Date | null;
    readonly sharedBy: string;
  },
): Promise<ShareAnswer> {
  if (!UUID.test(input.publication)) return { answer: 'publication.missing' };
  const publication = await trx
    .selectFrom('publication')
    .select('id')
    .where('id', '=', input.publication)
    .executeTakeFirst();
  if (!publication) return { answer: 'publication.missing' };

  const policy = await accessPolicy(trx);
  const expiresAt =
    input.expiresAt ?? new Date(policy.now.getTime() + policy.externalDefaultDays * DAY_MS);
  if (expiresAt.getTime() <= policy.now.getTime()) return { answer: 'share.expiry_past' };
  if (expiresAt.getTime() > policy.now.getTime() + policy.externalCapDays * DAY_MS) {
    return { answer: 'share.past_cap' };
  }

  const email = invitedAddress(input.email);
  const known = await trx
    .selectFrom('principal')
    .select(['id', 'kind', 'email_verified', sql<boolean>`issuer is not null`.as('signed_in')])
    .select(sql<boolean>`(to_jsonb(principal) ->> 'erased_at') is not null`.as('erased'))
    .where(sql<string>`lower(email)`, '=', email)
    .orderBy('created_at')
    .execute();
  if (known.some((each) => each.kind !== 'external')) return { answer: 'share.member' };
  const role = await sharedReaderRole(trx);
  for (const each of known) {
    if (!each.erased && (await holdsShare(trx, each.id, input.publication, role.id))) {
      return { answer: 'share.duplicate' };
    }
  }
  // Somebody from outside who proved this address at a sign-in; never one who merely shows it.
  const signedIn = known.find((each) => each.signed_in && each.email_verified && !each.erased);

  let recipient = signedIn?.id;
  let invitation: StoredInvitation | null = null;
  if (recipient === undefined) {
    if (known.some((each) => each.erased)) return { answer: 'share.erased' };
    // An administrator's invitation, lapsed or not, waiting with access of its own: a share never
    // renews it, which would revive that access (the pre-flight review).
    const waiting = known.find((each) => !each.signed_in);
    if (waiting && (await holdsBeyondShares(trx, waiting.id, role.id))) {
      return { answer: 'share.invitation_waiting' };
    }
    const invited = await invite(trx, {
      email,
      external: true,
      invitedBy: input.sharedBy,
      expiresAt,
    });
    if ('refused' in invited) return { answer: 'share.member' };
    invitation = invited.invited;
    recipient = invited.invited.principalId;
  }

  const granted = await grant(trx, {
    roleId: role.id,
    subject: { principal: recipient },
    level: { kind: 'artifact', id: input.publication },
    effect: 'allow',
    expiresAt,
    refusePast: true,
    grantedBy: input.sharedBy,
    share: true,
  });
  if ('refused' in granted) {
    switch (granted.refused) {
      case 'grant.duplicate':
        return { answer: 'share.duplicate' };
      case 'grant.subject_erased':
        return { answer: 'share.erased' };
      case 'grant.expiry_past':
        return { answer: 'share.expiry_past' };
      case 'grant.external_past_cap':
        return { answer: 'share.past_cap' };
      default:
        throw new Error(`A share was refused as a grant: ${granted.refused}`);
    }
  }
  const share = (await listShares(trx, input.publication)).find(
    (each) => each.id === granted.granted.id,
  )!;
  return { answer: 'shared', share, invitation };
}

/** Whether the principal holds any grant but a share, or belongs to any group. */
async function holdsBeyondShares(
  trx: TenantTransaction,
  principal: string,
  role: string,
): Promise<boolean> {
  const granted = await trx
    .selectFrom('access_grant')
    .select('id')
    .where('principal_id', '=', principal)
    .where('role_id', '!=', role)
    .executeTakeFirst();
  if (granted) return true;
  const member = await trx
    .selectFrom('group_member')
    .select('group_id')
    .where('principal_id', '=', principal)
    .executeTakeFirst();
  return member !== undefined;
}

async function holdsShare(
  trx: TenantTransaction,
  principal: string,
  publication: string,
  role: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom('access_grant')
    .select('id')
    .where('principal_id', '=', principal)
    .where('artifact_id', '=', publication)
    .where('role_id', '=', role)
    .where('effect', '=', 'allow')
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * A publication's shares, oldest first, each with its recipient, expiry and every access (PUB-060):
 * the grants of the fixed role at the publication, however they were made. Who may read them -
 * whoever may share it - is the caller's to decide first.
 */
export async function listShares(
  trx: TenantTransaction,
  publication: string,
): Promise<StoredShare[]> {
  const rows = await trx
    .selectFrom('access_grant as g')
    .innerJoin('role as r', 'r.id', 'g.role_id')
    .innerJoin('principal as p', 'p.id', 'g.principal_id')
    .innerJoin('principal as by', 'by.id', 'g.granted_by')
    .select([
      'g.id',
      'g.expires_at',
      'g.granted_at',
      'p.id as recipient',
      'p.email',
      'p.display_name',
      sql<boolean>`p.issuer is not null`.as('signed_in'),
      'by.id as by_id',
      'by.display_name as by_name',
      sql<boolean>`g.expires_at <= now()`.as('expired'),
    ])
    .where('g.artifact_id', '=', publication)
    .where('r.fixed', '=', true)
    .where('g.effect', '=', 'allow')
    .orderBy('g.granted_at')
    .orderBy('g.id')
    .execute();
  if (rows.length === 0) return [];
  const accesses = await trx
    .selectFrom('audit_event')
    .select(['actor', 'at', sql<SharedOutput | null>`detail ->> 'output'`.as('output')])
    .where('kind', '=', 'publication.shared_accessed')
    .where('subject', '=', publication)
    .where(
      'actor',
      'in',
      rows.map((row) => row.recipient),
    )
    .orderBy('sequence', 'desc')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    recipient: {
      id: row.recipient,
      email: row.email,
      name: row.display_name,
      signedIn: row.signed_in,
    },
    // A share always carries an expiry: one to somebody from outside is defaulted where none is named.
    expiresAt: row.expires_at!,
    expired: row.expired,
    sharedBy: { id: row.by_id, name: row.by_name },
    sharedAt: row.granted_at,
    accesses: accesses
      .filter((each) => each.actor === row.recipient)
      .map((each) => ({ at: each.at, output: each.output })),
  }));
}

/** Revokes a share at once (PUB-058): its grant goes, audited `access.revoked`, as any grant's does. */
export async function revokeShare(
  trx: TenantTransaction,
  input: { readonly publication: string; readonly share: string },
): Promise<{ readonly answer: 'revoked' | 'share.missing' }> {
  const share = (await listShares(trx, input.publication)).find((each) => each.id === input.share);
  if (!share) return { answer: 'share.missing' };
  const removed = await removeGrant(trx, share.id);
  if ('refused' in removed) return { answer: 'share.missing' };
  return { answer: 'revoked' };
}

/**
 * Records an access to a shared publication (PUB-060, LIF-070): somebody from outside reading it, or
 * one of its outputs, audited `publication.shared_accessed` - who and when are the event's own. A
 * member's read is no share's access and records nothing. Read is the caller's to decide first.
 */
export async function recordSharedAccess(
  trx: TenantTransaction,
  input: {
    readonly publication: string;
    readonly output: SharedOutput | null;
    readonly principal: string;
  },
): Promise<void> {
  const reader = await trx
    .selectFrom('principal')
    .select('kind')
    .where('id', '=', input.principal)
    .executeTakeFirst();
  if (reader?.kind !== 'external') return;
  const placed = await trx
    .selectFrom('artifact as a')
    .innerJoin('publication as p', 'p.id', 'a.id')
    .innerJoin('artifact_version as v', 'v.id', 'p.document_version_id')
    .leftJoin('space as s', 's.id', 'a.space_id')
    .select(['a.space_id', 's.name as space_name', sql<string>`v.content ->> 'title'`.as('title')])
    .where('a.id', '=', input.publication)
    .executeTakeFirst();
  await recordEvent(
    trx,
    {
      kind: 'publication.shared_accessed',
      subject: { kind: 'publication', id: input.publication },
      space: placed?.space_id ?? null,
      detail: { output: input.output },
    },
    labels(
      labelled('subject', placed?.title, input.publication),
      labelled('space', placed?.space_name, placed?.space_id ?? null),
    ),
  );
}

/**
 * Whether the principal is from outside and may read no space: somebody shared a publication, whom
 * nothing that lists the organisation's people or spaces answers (the R17 plan, R17-I).
 */
export async function readsOnlyShares(
  trx: TenantTransaction,
  principalId: string,
): Promise<boolean> {
  const who = await trx
    .selectFrom('principal')
    .select('kind')
    .where('id', '=', principalId)
    .executeTakeFirst();
  if (who?.kind !== 'external') return false;
  const readable = await loadReadableSet(trx, principalId);
  return readable !== undefined && !readable.tenant && readable.spaces.length === 0;
}

/**
 * Whether a later publication of its document supersedes it (PUB-059; the R17 plan, R17-G), and the
 * newest such. Whether the reader may read the newer one is the caller's to decide: a share never
 * follows to it.
 */
export async function supersession(
  trx: TenantTransaction,
  publication: string,
): Promise<{ readonly superseded: boolean; readonly newer: string | null }> {
  if (!UUID.test(publication)) return { superseded: false, newer: null };
  // Later as the listing orders them - published to the second, then made - under the same profile,
  // from a later version: neither a variant nor an earlier version published again supersedes it.
  const newer = await trx
    .selectFrom('publication as later')
    .innerJoin('artifact as la', 'la.id', 'later.id')
    .innerJoin('artifact_version as lv', 'lv.id', 'later.document_version_id')
    .innerJoin('publication as this', 'this.document_id', 'later.document_id')
    .innerJoin('artifact as ta', 'ta.id', 'this.id')
    .innerJoin('artifact_version as tv', 'tv.id', 'this.document_version_id')
    .select('later.id')
    .where('this.id', '=', publication)
    .where(sql<boolean>`(later.published_at, la.created_at) > (this.published_at, ta.created_at)`)
    .where(sql<boolean>`later.profile is not distinct from this.profile`)
    .where(sql<boolean>`(lv.revision_no, lv.version_no) > (tv.revision_no, tv.version_no)`)
    .orderBy('later.published_at', 'desc')
    .orderBy('la.created_at', 'desc')
    .executeTakeFirst();
  return { superseded: newer !== undefined, newer: newer?.id ?? null };
}
