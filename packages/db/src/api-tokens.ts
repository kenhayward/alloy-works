// packages/db/src/api-tokens.ts
import { isPermission, type Permission } from '@alloy-works/domain';
import { labelled, labels, principalLabel, recordEvent, setAuditContext } from './audit.js';
import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
import type { TenantTransaction } from './tables.js';

/**
 * How long a token goes unrecorded between uses, so every request made with it is not also a write
 * (service-foundations.md, "Personal tokens, as W12 builds them").
 */
export const TOKEN_TOUCH_AFTER_MS = 60 * 1000;

/** A personal token as its owner is shown it: never its secret, and never its hash. */
export interface StoredApiToken {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly Permission[];
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastUsedAt: Date | null;
}

/** Who a token acts as, and the mask its scopes put over their grants (TK-A). */
export interface ApiTokenHolder {
  /** The token's row, which its revocation names to every replica (the D7 plan, D7-I). */
  readonly tokenId: string;
  readonly principalId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly scopes: readonly Permission[];
}

const COLUMNS = ['id', 'name', 'scopes', 'created_at', 'expires_at', 'last_used_at'] as const;

/** The table's check keeps a scope in the closed set; this keeps the type honest about it. */
const scopesOf = (stored: readonly string[]): Permission[] => stored.filter(isPermission);

function stored(row: {
  id: string;
  name: string;
  scopes: string[];
  created_at: Date;
  expires_at: Date;
  last_used_at: Date | null;
}): StoredApiToken {
  return {
    id: row.id,
    name: row.name,
    scopes: scopesOf(row.scopes),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * Keeps a token for its principal, by the hash of its secret, which the caller made and never hands
 * here. The table bounds the expiry by the transaction's own clock (0038); the caller checks it first,
 * by the same clock, so a refusal is the caller's words rather than a constraint's.
 */
export async function issueApiToken(
  trx: TenantTransaction,
  input: {
    readonly principalId: string;
    readonly name: string;
    readonly tokenHash: string;
    readonly scopes: readonly Permission[];
    readonly expiresAt: Date;
  },
): Promise<StoredApiToken> {
  const row = await trx
    .insertInto('api_token')
    .values({
      principal_id: input.principalId,
      name: input.name,
      token_hash: input.tokenHash,
      scopes: [...input.scopes],
      expires_at: input.expiresAt,
    })
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();
  await recordTokenEvent(trx, 'token.issued', row, input.principalId, {
    scopes: scopesOf(row.scopes),
  });
  return stored(row);
}

/** Records a token's act (IAM-037): its name and its holder's as labels, never its secret or hash. */
async function recordTokenEvent(
  trx: TenantTransaction,
  kind: 'token.issued' | 'token.used' | 'token.revoked',
  token: { readonly id: string; readonly name: string },
  holder: string,
  detail: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await recordEvent(
    trx,
    { kind, subject: { kind: 'token', id: token.id }, detail },
    // A token's name is its holder's to erase, as their own is (the AU1 review, L9).
    labels(labelled('subject', token.name, holder), await principalLabel(trx, 'holder', holder)),
  );
}

/**
 * Who the token with this hash acts as, while it has not expired and has not been revoked; using it
 * records the use, at most once a minute. Read on every request, which is what makes a revocation take
 * effect at the next one (IAM-035). Only this tenant's tokens are here, so another environment's is
 * simply not found (IAM-003).
 */
export async function findApiToken(
  trx: TenantTransaction,
  tokenHash: string,
  now: Date = new Date(),
  /** The request's trace id, for the use's event. */
  traceId?: string,
): Promise<ApiTokenHolder | undefined> {
  const row = await trx
    .selectFrom('api_token as t')
    .innerJoin('principal as p', 'p.id', 't.principal_id')
    .select(['t.id', 't.name', 't.scopes', 'p.id as principal_id', 'p.email', 'p.display_name'])
    .where('t.token_hash', '=', tokenHash)
    .where('t.expires_at', '>', now)
    .executeTakeFirst();
  if (!row) return undefined;
  // Recorded by the one request whose update lands (the AU1 plan, AU1-G): a concurrent one waits on
  // the row, then finds it used within the minute and records nothing.
  const used = await trx
    .updateTable('api_token')
    .set({ last_used_at: now })
    .where('id', '=', row.id)
    .where((eb) =>
      eb.or([
        eb('last_used_at', 'is', null),
        eb('last_used_at', '<', new Date(now.getTime() - TOKEN_TOUCH_AFTER_MS)),
      ]),
    )
    .returning('id')
    .executeTakeFirst();
  if (used) {
    // The token acts here: nobody else is named in this transaction (the AU1 plan, AU1-D).
    const actorLabel = row.display_name?.trim().slice(0, 400);
    await setAuditContext(trx, {
      actorKind: 'token',
      actor: row.principal_id,
      token: row.id,
      ...(actorLabel ? { actorLabel } : {}),
      ...(traceId === undefined ? {} : { traceId }),
    });
    await recordTokenEvent(trx, 'token.used', row, row.principal_id);
  }
  return {
    tokenId: row.id,
    principalId: row.principal_id,
    email: row.email,
    displayName: row.display_name,
    scopes: scopesOf(row.scopes),
  };
}

/** A principal's own tokens, a page at a time, by id. */
export async function listApiTokens(
  trx: TenantTransaction,
  principalId: string,
  request: PageRequest,
): Promise<Page<StoredApiToken>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const rows = await trx
    .selectFrom('api_token')
    .select(COLUMNS)
    .where('principal_id', '=', principalId)
    .$if(page.after !== undefined, (query) => query.where('id', '>', page.after!))
    .orderBy('id')
    .limit(page.limit + 1)
    .execute();
  return paged(rows.map(stored), page.limit);
}

/**
 * Revokes one of a principal's own tokens by deleting its row (IAM-035): true if there was one. A token
 * of somebody else's is not the principal's to revoke, and is answered as absent.
 */
export async function revokeApiToken(
  trx: TenantTransaction,
  principalId: string,
  id: string,
): Promise<boolean> {
  const held = await trx
    .selectFrom('api_token')
    .select(['id', 'name'])
    .where('id', '=', id)
    .where('principal_id', '=', principalId)
    .forUpdate()
    .executeTakeFirst();
  if (!held) return false;
  // Before the row goes (audit.md, "Writing").
  await recordTokenEvent(trx, 'token.revoked', held, principalId);
  const removed = await trx.deleteFrom('api_token').where('id', '=', id).executeTakeFirst();
  return removed.numDeletedRows > 0n;
}
