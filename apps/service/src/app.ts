import { randomBytes, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import {
  routes,
  SESSION_COOKIE,
  type GoogleHandoff,
  type RouteContract,
  type SignInCallback,
} from '@alloy-works/api-contract';
import type { SignInRoute, Tenant, TenantDatabase } from '@alloy-works/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { GoogleSettings } from './config.js';
import { AppError } from './errors.js';
import { admitGoogleAccount } from './google.js';
import { createHttp, type HttpOptions } from './http.js';
import {
  SignInFailed,
  type Identity,
  type OidcClient,
  type ProviderSettings,
  type SignInStart,
} from './oidc.js';
import type { SecretStore } from './secrets.js';
import {
  createSession,
  endSession,
  findSession,
  hashToken,
  SESSION_POLICY,
  type SessionPrincipal,
} from './sessions.js';
import { signState, verifyState } from './sign-in-state.js';
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
  /** The product's one Google client and the sign-in address it returns to; without, no Google route. */
  readonly google?: GoogleSettings;
  readonly tenantCacheMs?: number;
}

/** Holds a sign-in's state for the browser that started it, so no other browser can finish it. */
export const SIGN_IN_COOKIE = '__Host-aw_signin';
const SIGN_IN_ATTEMPT_MS = 10 * 60 * 1000;
const CALLBACK_PATH = '/v1/sign-in/organisation/callback';
const GOOGLE_CALLBACK_PATH = '/v1/sign-in/google/callback';
const GOOGLE_COMPLETE_PATH = '/v1/sign-in/google/complete';
/** How long a hand-off code lives: one redirect's worth. */
const HANDOFF_MS = 60 * 1000;
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

function principalOf(request: FastifyRequest): SessionPrincipal {
  if (!request.principal) throw new Error('An authenticated handler ran without a principal');
  return request.principal;
}

function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const signInFailed = () =>
  new AppError(401, 'sign_in_failed', 'The sign-in could not be completed. Please start again.');

const routeClosed = () =>
  new AppError(
    404,
    'sign_in_route_closed',
    'This environment does not permit signing in this way.',
    'IAM-043',
  );

const notFound = () => new AppError(404, 'not_found', 'There is nothing at this address.');

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

  function secret(name: string): string {
    const value = secrets.get(name);
    if (value === undefined) throw new Error(`The secret ${name} is not in the secret store`);
    return value;
  }

  async function permits(tenant: Tenant, route: SignInRoute): Promise<boolean> {
    const row = await db.withTenant(tenant, (trx) =>
      trx.selectFrom('sign_in_route').select('route').where('route', '=', route).executeTakeFirst(),
    );
    return row !== undefined;
  }

  async function organisationProvider(tenant: Tenant): Promise<ProviderSettings | undefined> {
    if (!(await permits(tenant, 'organisation'))) return undefined;
    const row = await db.withTenant(tenant, (trx) =>
      trx.selectFrom('identity_provider').selectAll().executeTakeFirst(),
    );
    return (
      row && { issuer: row.issuer, clientId: row.client_id, clientSecret: secret(row.secret_name) }
    );
  }

  function googleProvider(google: GoogleSettings): ProviderSettings {
    return { issuer: google.issuer, clientId: google.clientId, clientSecret: secret('google') };
  }

  async function recordAttempt(
    tenant: Tenant,
    route: SignInRoute,
    stateHash: string,
    start: SignInStart,
  ): Promise<void> {
    await db.withTenant(tenant, (trx) =>
      trx
        .insertInto('sign_in_attempt')
        .values({
          state_hash: stateHash,
          nonce: start.nonce,
          code_verifier: start.codeVerifier,
          route,
          expires_at: new Date(Date.now() + SIGN_IN_ATTEMPT_MS),
        })
        .execute(),
    );
  }

  /** Deleted as it is read: an attempt is used once, whatever happens next, and never once expired. */
  async function takeAttempt(tenant: Tenant, route: SignInRoute, stateHash: string) {
    const attempt = await db.withTenant(tenant, (trx) =>
      trx
        .deleteFrom('sign_in_attempt')
        .where('state_hash', '=', stateHash)
        .where('route', '=', route)
        .returningAll()
        .executeTakeFirst(),
    );
    return attempt && attempt.expires_at > new Date() ? attempt : undefined;
  }

  /** The exchange at the provider. A refusal becomes sign_in_failed, logged by its kind alone. */
  async function finishAt(
    request: FastifyRequest,
    provider: ProviderSettings,
    expected: { readonly state: string; readonly nonce: string; readonly codeVerifier: string },
  ): Promise<Identity> {
    try {
      return await oidc.finish(
        provider,
        new URL(`${request.protocol}://${request.host}${request.url}`),
        expected,
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
  }

  /** Starts a session for the principal, and sends the browser on into the application. */
  async function signInAs(
    reply: FastifyReply,
    tenant: Tenant,
    principalId: string,
    route: SignInRoute,
  ): Promise<FastifyReply> {
    const token = await db.withTenant(tenant, (trx) => createSession(trx, principalId, route));
    reply.setCookie(SESSION_COOKIE, token, { ...COOKIE, maxAge: SESSION_POLICY.absoluteMs / 1000 });
    return reply.redirect('/', 302);
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
      if (!provider) throw routeClosed();
      const start = await oidc.start(
        provider,
        `${request.protocol}://${request.host}${CALLBACK_PATH}`,
      );
      await recordAttempt(tenant, 'organisation', hashToken(start.state), start);
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
      const attempt = await takeAttempt(tenant, 'organisation', hashToken(state));
      const provider = await organisationProvider(tenant);
      if (!attempt || !provider) throw signInFailed();
      const identity = await finishAt(request, provider, {
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.code_verifier,
      });
      // Found by issuer and subject, never by email address, which can be reassigned.
      const principal = await db.withTenant(tenant, (trx) =>
        trx
          .insertInto('principal')
          .values({
            issuer: identity.issuer,
            subject: identity.subject,
            email: identity.email,
            display_name: identity.name,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['issuer', 'subject'])
              .doUpdateSet({ email: identity.email, display_name: identity.name }),
          )
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      return signInAs(reply, tenant, principal.id, 'organisation');
    },

    startGoogleSignIn: async (request, reply) => {
      const tenant = tenantOf(request);
      const { google } = options;
      if (!google || !(await permits(tenant, 'google'))) throw routeClosed();
      // The attempt is bound to this browser by the cookie, and named in the state Google carries
      // to the sign-in address - signed, so nobody can point it at another environment.
      const attempt = randomBytes(32).toString('base64url');
      const start = await oidc.start(
        googleProvider(google),
        `${request.protocol}://${google.signInHost}${GOOGLE_CALLBACK_PATH}`,
        {
          state: signState(secret('sign_in_state'), {
            tenant: tenant.id,
            host: request.host,
            attempt,
          }),
        },
      );
      await recordAttempt(tenant, 'google', hashToken(attempt), start);
      reply.setCookie(SIGN_IN_COOKIE, attempt, { ...COOKIE, maxAge: SIGN_IN_ATTEMPT_MS / 1000 });
      return reply.redirect(start.url, 302);
    },

    finishGoogleSignIn: async (request, reply) => {
      const { google } = options;
      // The same service answers here, at the one address Google returns to, and only here.
      if (!google || request.host.toLowerCase() !== google.signInHost) throw notFound();
      const query = request.query as SignInCallback;
      const claimed = query.state ? verifyState(secret('sign_in_state'), query.state) : undefined;
      if (query.error || !query.code || !query.state || !claimed) throw signInFailed();
      const state = query.state;
      // Signed or not, the state's address must belong to the state's environment: that is what
      // keeps the sign-in address from sending anyone anywhere else.
      const tenant = await tenants.resolve(new URL(`http://${claimed.host}`).hostname);
      if (!tenant || tenant.id !== claimed.tenant) throw signInFailed();
      request.log = request.log.child({ tenant: tenant.id });
      reply.log = request.log;
      const attempt = await takeAttempt(tenant, 'google', hashToken(claimed.attempt));
      if (!attempt || !(await permits(tenant, 'google'))) throw signInFailed();
      const identity = await finishAt(request, googleProvider(google), {
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.code_verifier,
      });
      const code = randomBytes(32).toString('base64url');
      const admitted = await db.withTenant(tenant, async (trx) => {
        const principalId = await admitGoogleAccount(trx, identity);
        if (principalId === undefined) return false;
        // The hand-off names the attempt, so only the browser holding that attempt's cookie can
        // redeem it at the environment.
        await trx
          .insertInto('sign_in_handoff')
          .values({
            code_hash: hashToken(code),
            principal_id: principalId,
            attempt_hash: attempt.state_hash,
            expires_at: new Date(Date.now() + HANDOFF_MS),
          })
          .execute();
        return true;
      });
      if (!admitted) {
        throw new AppError(
          403,
          'not_invited',
          'This account is not invited to that environment.',
          'IAM-054',
        );
      }
      return reply.redirect(
        `${request.protocol}://${claimed.host}${GOOGLE_COMPLETE_PATH}?code=${code}`,
        302,
      );
    },

    completeGoogleSignIn: async (request, reply) => {
      const tenant = tenantOf(request);
      const { code } = request.query as GoogleHandoff;
      const bound = request.cookies[SIGN_IN_COOKIE];
      reply.clearCookie(SIGN_IN_COOKIE, COOKIE);
      // Deleted as it is read, like an attempt: a hand-off code is used once.
      const handoff = await db.withTenant(tenant, (trx) =>
        trx
          .deleteFrom('sign_in_handoff')
          .where('code_hash', '=', hashToken(code))
          .returningAll()
          .executeTakeFirst(),
      );
      // Only in the browser that started: its cookie is the attempt the hand-off was written for.
      if (
        !handoff ||
        handoff.expires_at <= new Date() ||
        !bound ||
        !sameValue(hashToken(bound), handoff.attempt_hash)
      ) {
        throw signInFailed();
      }
      return signInAs(reply, tenant, handoff.principal_id, 'google');
    },

    signOut: async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) await db.withTenant(tenantOf(request), (trx) => endSession(trx, token));
      reply.clearCookie(SESSION_COOKIE, COOKIE);
      return reply.status(204).send();
    },

    getMe: async (request) => {
      const principal = principalOf(request);
      const profile = await db.withTenant(tenantOf(request), (trx) =>
        trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow(),
      );
      return {
        id: principal.principalId,
        displayName: principal.displayName,
        email: principal.email,
        environment: profile.display_name,
      };
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
      ...(route.authenticated
        ? {
            // After onRequest has found the tenant: a session is looked up only in the tenant whose
            // hostname this is, so another environment's token is simply not found (IAM-003).
            preHandler: async (request: FastifyRequest) => {
              const token = request.cookies[SESSION_COOKIE];
              const principal = token
                ? await db.withTenant(tenantOf(request), (trx) => findSession(trx, token))
                : undefined;
              if (!principal) throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
              request.principal = principal;
            },
          }
        : {}),
      handler: handlers[name],
    });
  }
  return app;
}
