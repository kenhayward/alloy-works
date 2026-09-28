import { tokenScopes } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { nextCursor, pageQuery } from './listing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** A permission a token may be scoped to: any but `read`, which is never masked (TK-B). */
export const TokenScope = z.enum(tokenScopes);

export const TokenView = z.object({
  id: z.string(),
  name: z.string().describe('What the person called it, to tell their tokens apart'),
  scopes: z
    .array(TokenScope)
    .describe(
      'The permissions it may use, of those its creator holds; reading is never masked, so none reads and does nothing else',
    ),
  createdAt: z.string(),
  expiresAt: z.string().describe('When it stops working; nothing extends a token'),
  lastUsedAt: z
    .string()
    .nullable()
    .describe('When a request last used it, to the minute, or null for never'),
});
export type TokenView = z.infer<typeof TokenView>;

export const TokenListQuery = z.object(pageQuery);
export type TokenListQuery = z.infer<typeof TokenListQuery>;

export const TokenList = z.object({ items: z.array(TokenView), next: nextCursor });
export type TokenList = z.infer<typeof TokenList>;

export const CreateTokenBody = z.strictObject({
  name: z.string().trim().min(1).max(80).describe('1 to 80 characters, trimmed'),
  scopes: z
    .array(TokenScope)
    .max(tokenScopes.length)
    .refine((scopes) => new Set(scopes).size === scopes.length, {
      message: 'Each scope may be named once',
    })
    .describe("The permissions it may use: a mask over its creator's grants, never a grant"),
  expiresAt: z.iso
    .datetime({ offset: true })
    .describe('When it stops working: required, in the future and at most 365 days away'),
});
export type CreateTokenBody = z.infer<typeof CreateTokenBody>;

export const TokenIssued = z.object({
  ...TokenView.shape,
  secret: z
    .string()
    .describe('The token, awt_ and 43 characters, shown this once: only its hash is kept'),
});
export type TokenIssued = z.infer<typeof TokenIssued>;

export const TokenParams = z.object({ id: LowercaseUuid });
export type TokenParams = z.infer<typeof TokenParams>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const tokenNotAllowed = {
  description: 'token_not_allowed: tokens are managed with a signed-in session, never a token',
  schema: ErrorBody,
} as const;

/**
 * A person's own personal tokens (service-foundations.md, "Personal tokens, as W12 builds them"). Each
 * takes a session alone (TK-D): a token cannot mint a successor that outlives it, list its siblings or
 * revoke them. A token issued is not taken with an idempotency key, since the answer carries the secret
 * and a kept answer would keep it; a retry issues another, which the person can revoke.
 */
export const tokenRoutes = {
  listTokens: {
    operationId: 'listTokens',
    method: 'GET',
    path: '/v1/tokens',
    summary: "The caller's own tokens, a page at a time, never their secrets",
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    query: TokenListQuery,
    responses: {
      200: { description: "A page of the caller's tokens", schema: TokenList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: tokenNotAllowed,
    },
  },
  createToken: {
    operationId: 'createToken',
    method: 'POST',
    path: '/v1/tokens',
    summary: 'Issue the caller a token that acts as them, masked to its scopes, until it expires',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    body: CreateTokenBody,
    responses: {
      200: { description: 'Issued, with its secret, shown this once', schema: TokenIssued },
      400: {
        description:
          'invalid_request, or token_expiry_invalid: an expiry past, or more than 365 days away',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: tokenNotAllowed,
    },
  },
  revokeToken: {
    operationId: 'revokeToken',
    method: 'DELETE',
    path: '/v1/tokens/{id}',
    summary: "Revoke one of the caller's own tokens: the next request with it is refused",
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    params: TokenParams,
    responses: {
      204: { description: 'Revoked' },
      401: unauthenticated,
      403: tokenNotAllowed,
      404: { description: "No such token of the caller's in this environment", schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
