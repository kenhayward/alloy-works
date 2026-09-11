import { timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import {
  routes,
  SESSION_COOKIE,
  type RouteContract,
  type SignInCallback,
} from '@alloy-works/api-contract';
import type { Tenant, TenantDatabase } from '@alloy-works/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppError } from './errors.js';
import { createHttp, type HttpOptions } from './http.js';
import { SignInFailed, type OidcClient, type ProviderSettings } from './oidc.js';
import type { SecretStore } from './secrets.js';
import { createSession, hashToken, SESSION_POLICY, type SessionPrincipal } from './sessions.js';
import { cachedResolver } from './tenants.js';
import type { ZodTypeProvider } from './type-provider.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set before a tenant-scoped handler runs; null on routes that are not tenant-scoped. */
    tenant: Tenant | null;
    /** Set before an authenticated handler runs; null on routes that need no session. */
    principal: SessionPrincipal | null;
  }
}

export interface AppOptions extends HttpOptions {
  readonly db: TenantDatabase;
  readonly oidc: OidcClient;
  readonly secrets: SecretStore;
  readonly tenantCacheMs?: number;
}

/** Holds a sign-in's state for the browser that started it, so no other browser can finish it. */
export const SIGN_IN_COOKIE = '__Host-aw_signin';
const SIGN_IN_ATTEMPT_MS = 10 * 60 * 1000;
const CALLBACK_PATH = '/v1/sign-in/organisation/callback';
const COOKIE = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' } as const;

type Success<R extends RouteContract> = R['responses'] extends {
  200: { schema: infer S extends z.ZodType };
}
  ? z.input<S>
  : never;

type Handlers = {
  [K in keyof typeof routes]: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<Success<(typeof routes)[K]> | FastifyReply>;
};

function tenantOf(request: FastifyRequest): Tenant {
  if (!request.tenant) throw new Error('A tenant-scoped handler ran without a tenant');
  return request.tenant;
}

function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const signInFailed = () =>
  new AppError(401, 'sign_in_failed', 'The sign-in could not be completed. Please start again.');

/**
 * The service: the contract's routes and nothing else. Every route in `routes` must have a handler
 * here - the Handlers type refuses to compile otherwise - and each is registered with the schemas its
 * contract declares, so the document, the validation and the serialisation cannot disagree.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const { db, oidc, secrets } = options;
  const app = createHttp(options);
  void app.register(cookie);
  const tenants = cachedResolver((hostname) => db.resolveHostname(hostname), {
    ttlMs: options.tenantCacheMs ?? 30_000,
  });
  app.decorateRequest('tenant', null);
  app.decorateRequest('principal', null);

  async function organisationProvider(tenant: Tenant): Promise<ProviderSettings | undefined> {
    const row = await db.withTenant(tenant, async (trx) => {
      const permitted = await trx
        .selectFrom('sign_in_route')
        .select('route')
        .where('route', '=', 'organisation')
        .executeTakeFirst();
      return permitted && trx.selectFrom('identity_provider').selectAll().executeTakeFirst();
    });
    if (!row) return undefined;
    const clientSecret = secrets.get(row.secret_name);
    if (clientSecret === undefined) {
      throw new Error(`The secret ${row.secret_name} is not in the secret store`);
    }
    return { issuer: row.issuer, clientId: row.client_id, clientSecret };
  }

  const handlers: Handlers = {
    getHealth: async () => ({ status: 'ok' }),

    getTenant: async (request) => {
      const profile = await db.withTenant(tenantOf(request), (trx) =>
        trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow(),
      );
      return { name: profile.display_name };
    },

    startOrganisationSignIn: async (request, reply) => {
      const tenant = tenantOf(request);
      const provider = await organisationProvider(tenant);
      if (!provider) {
        throw new AppError(
          404,
          'sign_in_route_closed',
          'This environment does not permit signing in this way.',
          'IAM-043',
        );
      }
      const start = await oidc.start(
        provider,
        `${request.protocol}://${request.host}${CALLBACK_PATH}`,
      );
      await db.withTenant(tenant, (trx) =>
        trx
          .insertInto('sign_in_attempt')
          .values({
            state_hash: hashToken(start.state),
            nonce: start.nonce,
            code_verifier: start.codeVerifier,
            route: 'organisation',
            expires_at: new Date(Date.now() + SIGN_IN_ATTEMPT_MS),
          })
          .execute(),
      );
      reply.setCookie(SIGN_IN_COOKIE, start.state, {
        ...COOKIE,
        maxAge: SIGN_IN_ATTEMPT_MS / 1000,
      });
      return reply.redirect(start.url, 302);
    },

    finishOrganisationSignIn: async (request, reply) => {
      const tenant = tenantOf(request);
      const query = request.query as SignInCallback;
      const bound = request.cookies[SIGN_IN_COOKIE];
      reply.clearCookie(SIGN_IN_COOKIE, COOKIE);
      if (query.error || !query.code || !query.state || !bound || !sameValue(bound, query.state)) {
        throw signInFailed();
      }
      const state = query.state;
      // Deleted as it is read: an attempt is used once, whatever happens next.
      const attempt = await db.withTenant(tenant, (trx) =>
        trx
          .deleteFrom('sign_in_attempt')
          .where('state_hash', '=', hashToken(state))
          .where('route', '=', 'organisation')
          .returningAll()
          .executeTakeFirst(),
      );
      const provider = await organisationProvider(tenant);
      if (!attempt || attempt.expires_at <= new Date() || !provider) throw signInFailed();
      let identity;
      try {
        identity = await oidc.finish(
          provider,
          new URL(`${request.protocol}://${request.host}${request.url}`),
          { state, nonce: attempt.nonce, codeVerifier: attempt.code_verifier },
        );
      } catch (error) {
        if (error instanceof SignInFailed) {
          // Only the kind of refusal: openid-client's error chain can carry the callback's
          // parameters, the authorisation code among them, and the logger walks the whole chain.
          const cause = error.cause as { code?: unknown; name?: unknown } | undefined;
          request.log.warn(
            { reason: String(cause?.code ?? cause?.name ?? 'refused') },
            'sign-in refused',
          );
          throw signInFailed();
        }
        throw error;
      }
      const found = identity;
      const token = await db.withTenant(tenant, async (trx) => {
        // Found by issuer and subject, never by email address, which can be reassigned.
        const principal = await trx
          .insertInto('principal')
          .values({
            issuer: found.issuer,
            subject: found.subject,
            email: found.email,
            display_name: found.name,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['issuer', 'subject'])
              .doUpdateSet({ email: found.email, display_name: found.name }),
          )
          .returning('id')
          .executeTakeFirstOrThrow();
        return createSession(trx, principal.id, 'organisation');
      });
      reply.setCookie(SESSION_COOKIE, token, {
        ...COOKIE,
        maxAge: SESSION_POLICY.absoluteMs / 1000,
      });
      return reply.redirect('/', 302);
    },

    signOut: async () => {
      throw new Error('signOut arrives in Task 8');
    },

    getMe: async () => {
      throw new Error('getMe arrives in Task 8');
    },
  };

  const http = app.withTypeProvider<ZodTypeProvider>();
  for (const [name, route] of Object.entries(routes) as [keyof Handlers, RouteContract][]) {
    const response = Object.fromEntries(
      Object.entries(route.responses).flatMap(([status, declared]) =>
        declared.schema ? [[status, declared.schema]] : [],
      ),
    );
    http.route({
      method: route.method,
      url: route.path,
      schema: { response, ...(route.query ? { querystring: route.query } : {}) },
      ...(route.tenantScoped
        ? {
            onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
              const tenant = await tenants.resolve(request.hostname);
              if (!tenant) {
                throw new AppError(
                  404,
                  'tenant_not_found',
                  'No environment is served at this address.',
                );
              }
              request.tenant = tenant;
              // Both loggers: the reply's was captured before this hook ran, and it writes the
              // "request completed" line.
              request.log = request.log.child({ tenant: tenant.id });
              reply.log = request.log;
            },
          }
        : {}),
      handler: handlers[name],
    });
  }
  return app;
}
