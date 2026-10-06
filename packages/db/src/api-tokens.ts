// packages/db/src/api-tokens.ts
import { isPermission, type Permission } from '@alloy-works/domain';
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
  return stored(row);
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
): Promise<ApiTokenHolder | undefined> {
  const row = await trx
    .selectFrom('api_token as t')
    .innerJoin('principal as p', 'p.id', 't.principal_id')
    .select([
      't.id',
      't.scopes',
      't.last_used_at',
      'p.id as principal_id',
      'p.email',
      'p.display_name',
    ])
    .where('t.token_hash', '=', tokenHash)
    .where('t.expires_at', '>', now)
    .executeTakeFirst();
  if (!row) return undefined;
  if (
    row.last_used_at === null ||
    now.getTime() - row.last_used_at.getTime() > TOKEN_TOUCH_AFTER_MS
  ) {
    await trx
      .updateTable('api_token')
      .set({ last_used_at: now })
      .where('id', '=', row.id)
      .execute();
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
  const removed = await trx
    .deleteFrom('api_token')
    .where('id', '=', id)
    .where('principal_id', '=', principalId)
    .executeTakeFirst();
  return removed.numDeletedRows > 0n;
}
