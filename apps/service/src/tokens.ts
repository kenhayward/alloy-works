// apps/service/src/tokens.ts
import { randomBytes } from 'node:crypto';
import type {
  CreateTokenBody,
  PrincipalTokenParams,
  PrincipalTokensParams,
  TokenIssued,
  TokenList,
  TokenListQuery,
  TokenParams,
  TokenRevoked,
  TokenView,
} from '@alloy-works/api-contract';
import {
  issueApiToken,
  listApiTokens,
  notifyTenant,
  revokeApiToken,
  type StoredApiToken,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import { AppError } from './errors.js';
import type { SessionPrincipal } from './sessions.js';
import { hashToken } from './sessions.js';

/** A secret scanner's handle on a token committed by mistake (TK-F). */
export const TOKEN_PREFIX = 'awt_';

/** `awt_` and 32 random bytes as base64url: 43 characters. */
const TOKEN_SHAPE = /^awt_[A-Za-z0-9_-]{43}$/;

/** A token lives at most a year (IAM-034, TK-C); the table holds the same bound (0038). */
const TOKEN_MAX_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A fresh secret, returned once and never kept: only its hash is. */
export function newTokenSecret(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * Whether an Authorization header names the Bearer scheme, however well or badly it follows it. Only
 * that scheme is a credential of ours: any other - `Basic` from a reverse proxy in front, `Negotiate`
 * from a browser on a domain - is passed over and the cookie decides (W12.1's final review), since
 * refusing it would sign out every browser behind such a proxy. Schemes are case-insensitive (RFC 9110).
 */
export function isBearer(header: string): boolean {
  return /^Bearer(?:[ ]|$)/i.test(header);
}

/**
 * The secret a Bearer header carries, if it is shaped like one of ours; undefined for any other, which
 * the request path refuses as unauthenticated rather than falling back to the cookie - a caller who
 * sent a bearer meant that one.
 */
export function bearerSecret(header: string): string | undefined {
  const match = /^Bearer[ ]+(\S+)$/i.exec(header);
  const secret = match?.[1];
  return secret !== undefined && TOKEN_SHAPE.test(secret) ? secret : undefined;
}

export const unauthenticated = () => new AppError(401, 'unauthenticated', 'Sign in to continue.');

/** A token at a route that takes a session alone (service-foundations.md, TK-D). */
export const tokenNotAllowed = () =>
  new AppError(
    403,
    'token_not_allowed',
    'This takes a signed-in session: an API token cannot do it.',
  ).refusing({
    permission: null,
    target: null,
    reason: 'token_not_allowed',
    level: null,
    hidden: false,
  });

function tokenView(stored: StoredApiToken): TokenView {
  return {
    id: stored.id,
    name: stored.name,
    scopes: [...stored.scopes] as TokenView['scopes'],
    createdAt: stored.createdAt.toISOString(),
    expiresAt: stored.expiresAt.toISOString(),
    lastUsedAt: stored.lastUsedAt && stored.lastUsedAt.toISOString(),
  };
}

/**
 * A person's own tokens: issued, listed and revoked by them, with a session alone (TK-D). The routes
 * decide no permission - a token is the person's to make, and can do no more than they may - so each
 * runs in a transaction of its own.
 */
export function tokenHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    listTokens: async (request: FastifyRequest): Promise<TokenList> => {
      const query = request.query as TokenListQuery;
      const after = afterCursor(query.cursor);
      const page = await db.withTenant(tenantOf(request), (trx) =>
        listApiTokens(trx, principalOf(request).principalId, {
          ...(after === undefined ? {} : { after }),
          limit: pageLimit(query.limit),
        }),
      );
      return { items: page.items.map(tokenView), next: cursorAfter(page.after) };
    },

    createToken: async (request: FastifyRequest, reply: FastifyReply): Promise<TokenIssued> => {
      const body = request.body as CreateTokenBody;
      const expiresAt = new Date(body.expiresAt);
      const secret = newTokenSecret();
      const issued = await db.withTenant(tenantOf(request), async (trx) => {
        // By the transaction's clock, which is the one the table bounds the expiry by.
        const { now } = await trx
          .selectNoFrom((eb) => eb.fn<Date>('now').as('now'))
          .executeTakeFirstOrThrow();
        const latest = now.getTime() + TOKEN_MAX_DAYS * DAY_MS;
        if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > latest) {
          throw new AppError(
            400,
            'token_expiry_invalid',
            'A token needs an expiry in the future, and no more than 365 days away.',
            'IAM-034',
          );
        }
        return issueApiToken(trx, {
          principalId: principalOf(request).principalId,
          name: body.name,
          tokenHash: hashToken(secret),
          scopes: body.scopes,
          expiresAt,
        });
      });
      // The secret, once: never kept by a cache between the service and the caller (final review).
      void reply.header('Cache-Control', 'no-store');
      return { ...tokenView(issued), secret };
    },

    revokeToken: async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const { id } = request.params as TokenParams;
      const revoked = await db.withTenant(tenantOf(request), async (trx) => {
        const removed = await revokeApiToken(trx, principalOf(request).principalId, id);
        // Every replica stops what the token was doing within two seconds (IAM-082, D7-I).
        if (removed) await notifyTenant(trx, { kind: 'credential_ended', token: id });
        return removed;
      });
      if (!revoked) throw notFound();
      return reply.status(204).send();
    },
  };
}

/**
 * Anybody's tokens, for an administrator of the environment (TK-E), each run in the transaction
 * `administer` at the tenant was decided in. A person the environment does not hold is not found, so
 * another environment's is never told apart from nobody (IAM-003).
 */
export function administeredTokenHandlers() {
  return {
    listPrincipalTokens: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TokenList> => {
      const { id } = request.params as PrincipalTokensParams;
      const query = request.query as TokenListQuery;
      const held = await trx
        .selectFrom('principal')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!held) throw notFound();
      const after = afterCursor(query.cursor);
      const page = await listApiTokens(trx, id, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      return { items: page.items.map(tokenView), next: cursorAfter(page.after) };
    },

    revokePrincipalToken: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TokenRevoked> => {
      const { id, token } = request.params as PrincipalTokenParams;
      // The token's row is read on every request, so it is refused at the next (IAM-035).
      if (!(await revokeApiToken(trx, id, token))) throw notFound();
      // Every replica stops what the token was doing within two seconds (IAM-082, D7-I).
      await notifyTenant(trx, { kind: 'credential_ended', token });
      return { revoked: token };
    },
  };
}
