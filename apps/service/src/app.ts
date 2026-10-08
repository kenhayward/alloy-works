import { randomBytes, timingSafeEqual } from 'node:crypto';
import { IDEMPOTENT_REPLAYED, keyedRequest, once } from './idempotency.js';
import { Accepted, AfterCommit, Revalidated } from './after-commit.js';
import cookie from '@fastify/cookie';
import {
  routes,
  SESSION_COOKIE,
  type AccessExplanation,
  type ExplainQuery,
  type GoogleHandoff,
  type RouteAccess,
  type RouteContract,
  type Sample,
  type SampleParams,
  type SignInCallback,
} from '@alloy-works/api-contract';
import {
  claimInvitation,
  enqueueJob,
  findApiToken,
  groupNames,
  loadFacts,
  notifyTenant,
  openSecret,
  SealedSecretRefused,
  syncProviderGroups,
  type SignInRoute,
  type Tenant,
  type TenantDatabase,
  type TenantListener,
} from '@alloy-works/db';
import {
  decide,
  formatLevel,
  permissions,
  type Decision,
  type Permission,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  administerOrAbove,
  authorise,
  beforeDeciding,
  notFound,
  type Authorised,
} from './access.js';
import { assetHandlers, type BinaryBody } from './assets.js';
import { actAs, contextOf, recordRefusal, recordSignInFailure } from './audit.js';
import { componentHandlers } from './components.js';
import { bindingHandlers, pendingHandlers } from './data/bindings.js';
import { connectionHandlers, type ConnectorOptions } from './data/connections.js';
import { queryDefinitionHandlers } from './data/query-definitions.js';
import type { GoogleSettings } from './config.js';
import { documentHandlers } from './documents.js';
import { registerDocs } from './docs.js';
import { templateHandlers } from './templates.js';
import { definitionHandlers } from './definitions.js';
import { presentationHandlers } from './presentation.js';
import { searchHandlers } from './search.js';
import { settingsHandlers } from './settings.js';
import { editingHandlers } from './editing.js';
import { AppError, storageUnavailable, toErrorBody } from './errors.js';
import { admitGoogleAccount } from './google.js';
import { createHttp, logFailure, type HttpOptions } from './http.js';
import { groupHandlers } from './groups.js';
import { spaceHandlers } from './spaces.js';
import { invitationHandlers } from './invitations.js';
import { managingAccessHandlers } from './managing-access.js';
import {
  SignInFailed,
  type Identity,
  type OidcClient,
  type ProviderSettings,
  type SignInStart,
} from './oidc.js';
import { DOWNLOAD_SECONDS, publishingHandlers } from './publishing.js';
import { rendererFallback, serveRenderer } from './renderer.js';
import type { SecretStore } from './secrets.js';
import {
  createSession,
  endSession,
  hashToken,
  sessionHeld,
  SESSION_POLICY,
  type SessionPrincipal,
} from './sessions.js';
import { signState, verifyState } from './sign-in-state.js';
import { streamToViewer } from './stream.js';
import { cachedResolver } from './tenants.js';
import {
  administeredTokenHandlers,
  bearerSecret,
  isBearer,
  tokenHandlers,
  tokenNotAllowed,
  unauthenticated,
} from './tokens.js';
import type { ZodTypeProvider } from './type-provider.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set before a tenant-scoped handler runs; null on routes that are not tenant-scoped. */
    tenant: Tenant | null;
    /** Set before an authenticated handler runs; null on routes that need no session. */
    principal: SessionPrincipal | null;
    /**
     * How the principal was found, set with it: a session, or a personal token and the scopes that
     * mask every decision taken for the request (service-foundations.md, TK-A).
     */
    credential: Credential | null;
  }
}

/**
 * How the principal was found: a session, by its row and the route it was signed in by, or a personal
 * token, by its row and its scopes. Each row is what a sign-out or a revocation names to every
 * replica, so an act still running as it stops (IAM-082, the D7 plan's D7-I).
 */
export type Credential =
  | { readonly kind: 'session'; readonly id: string; readonly route: SignInRoute }
  | { readonly kind: 'token'; readonly id: string; readonly scopes: readonly Permission[] };

export interface AppOptions extends HttpOptions {
  readonly db: TenantDatabase;
  readonly oidc: OidcClient;
  readonly secrets: SecretStore;
  /**
   * The key each environment's sealed sign-in client secret opens with, the one its object store
   * credential is sealed with (`serviceSealingKey`).
   */
  readonly sealingKey: Buffer;
  /** The product's one Google client and the sign-in address it returns to; without, no Google route. */
  readonly google?: GoogleSettings;
  /** Where this environment's documents are kept; without it, samples are refused. */
  readonly objects?: ObjectStores;
  /** Where this environment's events come from; without it, no stream. */
  readonly events?: TenantListener;
  /** Where the built renderer is; without it the service answers the API and nothing else. */
  readonly rendererRoot?: string;
  readonly tenantCacheMs?: number;
  /**
   * Where the connector answers and the key it is asked with (the D1 plan, D1-F); without it every
   * data act is refused `connector_unavailable`.
   */
  readonly connector?: ConnectorOptions;
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
  : R['responses'] extends { 200: { binary: object } }
    ? BinaryBody
    : never;

/**
 * A route that checks a permission is handed what was decided, and runs in the transaction it was
 * decided in. Its handler receives no `FastifyReply` at all - `permissionChecked` never passes one -
 * so it cannot send early: nothing is sent before that transaction commits, and it must return its
 * body instead. A return-type restriction alone would not hold this: `FastifyReply` has its own
 * `then` (`fastify/types/reply.d.ts`, `then(fulfilled: () => void, ...)`), so an un-annotated async
 * handler that returns `reply` or `reply.send(...)` has that value unwrapped as a thenable - and
 * because `then`'s callback takes no value parameter to infer from, TypeScript resolves
 * `Awaited<FastifyReply>` to something assignable to anything, silently. Withholding the parameter,
 * rather than trying to out-type its return, is what actually closes that. The serializer that turns
 * the returned body into bytes still runs only after the commit, so a body that fails its own
 * response schema on some future write route would surface as a 500 after the act has already
 * committed, not before it - this is about ordering, not the body's own shape.
 */
export type Handlers = {
  [K in keyof typeof routes]: (typeof routes)[K]['access'] extends { check: 'permission' }
    ? (
        request: FastifyRequest,
        authorised: Authorised,
      ) => Promise<
        | Success<(typeof routes)[K]>
        | Revalidated<Success<(typeof routes)[K]>>
        | AfterCommit<Success<(typeof routes)[K]> | Accepted<Success<(typeof routes)[K]>>>
      >
    : (
        request: FastifyRequest,
        reply: FastifyReply,
      ) => Promise<Success<(typeof routes)[K]> | FastifyReply>;
};

/**
 * A decision as the explanation publishes it: each grant with the name of the group it came through,
 * from `names`, so a view names the group rather than an identifier (IAM-030).
 */
function explained(
  decision: Decision,
  names: ReadonlyMap<string, string>,
): AccessExplanation['permissions'][number] {
  return {
    permission: decision.permission,
    allowed: decision.allowed,
    reason: decision.reason,
    level: decision.level && formatLevel(decision.level),
    checked: decision.checked.map(formatLevel),
    grants: decision.grants.map((reached) => ({
      id: reached.id,
      role: reached.role.name,
      effect: reached.effect,
      subject: reached.subject,
      through: reached.through,
      groupName: reached.through === null ? null : (names.get(reached.through) ?? null),
      expiresAt: reached.expiresAt && reached.expiresAt.toISOString(),
    })),
  };
}

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

/**
 * The service: the contract's routes and nothing else. Every route in `routes` must have a handler
 * here - the Handlers type refuses to compile otherwise - and each is registered with the schemas its
 * contract declares, so the document, the validation and the serialisation cannot disagree.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const { db, oidc, secrets } = options;
  // Both error handlers - the app's and the raw-body routes' - note a refused authorisation, and it is
  // written once the reply has gone, so a hidden 404 is no slower than a true one (the AU1 review, M5).
  // A failure to write it is logged at error by `recordRefusal`.
  const refusals = new WeakMap<FastifyRequest, unknown>();
  const failed = async (request: FastifyRequest, error: unknown) => {
    refusals.set(request, error);
  };
  const app = createHttp(options, options.rendererRoot ? rendererFallback : undefined, failed);
  app.addHook('onResponse', async (request) => {
    const error = refusals.get(request);
    if (error === undefined) return;
    refusals.delete(request);
    await recordRefusal(db, request, error);
  });
  void app.register(cookie);
  if (options.rendererRoot) serveRenderer(app, options.rendererRoot);
  const tenants = cachedResolver((hostname) => db.resolveHostname(hostname), {
    ttlMs: options.tenantCacheMs ?? 30_000,
  });
  registerDocs(app, (hostname) => tenants.resolve(hostname));
  app.decorateRequest('tenant', null);
  app.decorateRequest('principal', null);
  app.decorateRequest('credential', null);

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

  /**
   * What an environment's configuration is missing is logged once for each environment while the
   * process runs: anybody may start a sign-in without signing in, so a warning for every request
   * would let them flood the log.
   */
  const warned = new Set<string>();
  function warnOnce(request: FastifyRequest, tenant: Tenant, message: string): void {
    const key = `${tenant.id} ${message}`;
    if (warned.has(key)) return;
    warned.add(key);
    request.log.warn(message);
  }

  /**
   * The organisation's provider, with the client secret this environment holds, sealed in its own
   * schema and opened for this tenant alone: nothing names a secret another environment could hold.
   * An environment configured before secrets were sealed names its secret instead, and one whose
   * sealed secret does not open for it holds somebody else's; neither signs anybody in, and the log
   * says which, never with the secret.
   */
  async function organisationProvider(
    request: FastifyRequest,
    tenant: Tenant,
  ): Promise<ProviderSettings | undefined> {
    if (!(await permits(tenant, 'organisation'))) return undefined;
    const row = await db.withTenant(tenant, (trx) =>
      trx.selectFrom('identity_provider').selectAll().executeTakeFirst(),
    );
    if (!row) return undefined;
    if (row.sealed_secret === null) {
      warnOnce(
        request,
        tenant,
        "the organisation's sign-in names its client secret, as it did before secrets were sealed, and must be configured again",
      );
      return undefined;
    }
    let clientSecret: string;
    try {
      clientSecret = openSecret(options.sealingKey, 'sign-in', tenant.id, row.sealed_secret);
    } catch (error) {
      if (!(error instanceof SealedSecretRefused)) throw error;
      warnOnce(
        request,
        tenant,
        "the organisation's sealed client secret does not open for this environment",
      );
      return undefined;
    }
    return {
      issuer: row.issuer,
      clientId: row.client_id,
      clientSecret,
      groupsClaim: row.groups_claim,
    };
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

  /**
   * The exchange at the provider. A refusal becomes sign_in_failed, logged by its kind alone, and
   * recorded as a failed sign-in naming nobody (IAM-013).
   */
  async function finishAt(
    request: FastifyRequest,
    tenant: Tenant,
    route: SignInRoute,
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
        await recordSignInFailure(db, request, tenant, route, 'provider_refused');
        throw signInFailed();
      }
      throw error;
    }
  }

  /**
   * Starts a session for the principal, and sends the browser on into the application. `groups` are
   * the values the organisation's provider asserted, which the principal's provider memberships are
   * brought into line with in the session's own transaction (IAM-009, GP-B): a session never begins
   * with memberships the sign-in has not settled. The Google route passes none, and changes none.
   *
   * Not in the transaction that found or claimed the principal: a claim holds an invitation's row,
   * which a withdrawal takes after the epoch, and bringing memberships into line may take the epoch,
   * so the two in one transaction could wait on each other in a cycle. Here the epoch is the first lock.
   */
  async function signInAs(
    request: FastifyRequest,
    reply: FastifyReply,
    tenant: Tenant,
    principalId: string,
    route: SignInRoute,
    groups?: readonly string[],
  ): Promise<FastifyReply> {
    const token = await db.withTenant(tenant, async (trx) => {
      // The sign-in, and the memberships it settles, are the principal's own acts (AU1-F).
      await actAs(trx, principalId, request.id);
      if (groups !== undefined) await syncProviderGroups(trx, principalId, groups);
      return createSession(trx, principalId, route);
    });
    reply.setCookie(SESSION_COOKIE, token, { ...COOKIE, maxAge: SESSION_POLICY.absoluteMs / 1000 });
    return reply.redirect('/', 302);
  }

  const handlers: Handlers = {
    ...componentHandlers(db, tenantOf, principalOf),
    ...documentHandlers(db, tenantOf, principalOf),
    ...templateHandlers(db, tenantOf, principalOf),
    ...connectionHandlers(
      db,
      tenantOf,
      principalOf,
      options.connector,
      options.objects,
      options.events,
    ),
    ...queryDefinitionHandlers(db, tenantOf, principalOf),
    ...bindingHandlers(tenantOf, options.objects),
    ...pendingHandlers(db, tenantOf, options.objects),
    ...definitionHandlers(db, tenantOf, principalOf),
    ...searchHandlers(db, tenantOf, principalOf),
    ...presentationHandlers(db, tenantOf),
    ...publishingHandlers(db, tenantOf, principalOf, options.objects),
    ...assetHandlers(db, tenantOf, principalOf, options.objects),
    ...editingHandlers(),
    ...managingAccessHandlers(),
    ...invitationHandlers(),
    ...groupHandlers(),
    ...spaceHandlers(),
    ...settingsHandlers(db, tenantOf),
    ...tokenHandlers(db, tenantOf, principalOf),
    ...administeredTokenHandlers(),

    getHealth: async () => ({ status: 'ok' }),

    getTenant: async (request) => {
      const profile = await db.withTenant(tenantOf(request), (trx) =>
        trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow(),
      );
      return { name: profile.display_name };
    },

    startOrganisationSignIn: async (request, reply) => {
      const tenant = tenantOf(request);
      const provider = await organisationProvider(request, tenant);
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
      if (!query.state || !bound || !sameValue(bound, query.state)) throw signInFailed();
      const state = query.state;
      if (query.error || !query.code) {
        // The provider's answer to an attempt this browser made: recorded by its kind, never its
        // words, and only where the attempt was there to take (IAM-013).
        if (await takeAttempt(tenant, 'organisation', hashToken(state))) {
          await recordSignInFailure(db, request, tenant, 'organisation', 'provider_error');
        }
        throw signInFailed();
      }
      const attempt = await takeAttempt(tenant, 'organisation', hashToken(state));
      const provider = await organisationProvider(request, tenant);
      if (!attempt || !provider) throw signInFailed();
      const identity = await finishAt(request, tenant, 'organisation', provider, {
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.code_verifier,
      });
      // Found by issuer and subject, never by email address, which can be reassigned. Only somebody
      // this environment has never seen can become an invitation's principal, and only for an
      // address the provider verifies; anybody else the provider authenticates is made a principal
      // holding nothing, as before.
      const principal = await db.withTenant(tenant, async (trx) => {
        const known = await trx
          .updateTable('principal')
          .set({
            email: identity.email,
            email_verified: identity.emailVerified,
            display_name: identity.name,
          })
          .where('issuer', '=', identity.issuer)
          .where('subject', '=', identity.subject)
          .returning('id')
          .executeTakeFirst();
        if (known) return known;
        const invited = await claimInvitation(trx, identity, 'organisation', request.id);
        if (invited) return { id: invited };
        // An upsert still: the same identity's first sign-in in another window may land between the
        // lookup above and this insert.
        return trx
          .insertInto('principal')
          .values({
            issuer: identity.issuer,
            subject: identity.subject,
            email: identity.email,
            email_verified: identity.emailVerified,
            display_name: identity.name,
          })
          .onConflict((conflict) =>
            conflict.columns(['issuer', 'subject']).doUpdateSet({
              email: identity.email,
              email_verified: identity.emailVerified,
              display_name: identity.name,
            }),
          )
          .returning('id')
          .executeTakeFirstOrThrow();
      });
      return signInAs(request, reply, tenant, principal.id, 'organisation', identity.groups);
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
      if (!query.state || !claimed) throw signInFailed();
      const state = query.state;
      // Signed or not, the state's address must belong to the state's environment: that is what
      // keeps the sign-in address from sending anyone anywhere else.
      const tenant = await tenants.resolve(new URL(`http://${claimed.host}`).hostname);
      if (!tenant || tenant.id !== claimed.tenant) throw signInFailed();
      request.log = request.log.child({ tenant: tenant.id });
      reply.log = request.log;
      const attempt = await takeAttempt(tenant, 'google', hashToken(claimed.attempt));
      if (attempt && (query.error || !query.code)) {
        // Google's answer to an attempt the state signed: recorded by its kind alone (IAM-013).
        await recordSignInFailure(db, request, tenant, 'google', 'provider_error');
      }
      if (query.error || !query.code) throw signInFailed();
      if (!attempt || !(await permits(tenant, 'google'))) throw signInFailed();
      const identity = await finishAt(request, tenant, 'google', googleProvider(google), {
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.code_verifier,
      });
      const code = randomBytes(32).toString('base64url');
      const admitted = await db.withTenant(tenant, async (trx) => {
        const principalId = await admitGoogleAccount(trx, identity, request.id);
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
        // An account nobody invited names nobody here, and is recorded as such (IAM-013).
        await recordSignInFailure(db, request, tenant, 'google', 'not_invited');
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
      if (!handoff) throw signInFailed();
      // Only in the browser that started: its cookie is the attempt the hand-off was written for. A
      // hand-off redeemed late or elsewhere names the principal it was for (IAM-013).
      const failure =
        handoff.expires_at <= new Date()
          ? 'handoff_expired'
          : !bound || !sameValue(hashToken(bound), handoff.attempt_hash)
            ? 'handoff_other_browser'
            : undefined;
      if (failure !== undefined) {
        await recordSignInFailure(db, request, tenant, 'google', failure, handoff.principal_id);
        throw signInFailed();
      }
      return signInAs(request, reply, tenant, handoff.principal_id, 'google');
    },

    signOut: async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      // Said in the transaction that ends it: every replica hears the session's row, and stops what
      // it was doing at the source within two seconds (IAM-082, the D7 plan's D7-I).
      if (token) {
        await db.withTenant(
          tenantOf(request),
          async (trx) => {
            const ended = await endSession(trx, token);
            if (ended) await notifyTenant(trx, { kind: 'credential_ended', session: ended });
          },
          contextOf(request),
        );
      }
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

    requestSample: async (request, reply) => {
      const tenant = tenantOf(request);
      const principal = principalOf(request);
      const { objects } = options;
      if (!objects) throw storageUnavailable();
      // It decides no permission, so it takes an idempotency key here, through the same helper as
      // the routes that do (service-foundations.md, "Idempotency"; ID-A).
      const keyed = keyedRequest(request, 'requestSample');
      const { body, replayed } = await db.withTenant(tenant, (trx) =>
        once(
          trx,
          principal.principalId,
          keyed,
          async () => {
            const stored = await trx
              .selectFrom('object_store_credential')
              .select('access_key_id')
              .executeTakeFirst();
            if (!stored) throw storageUnavailable();
            const row = await trx
              .insertInto('sample')
              .values({ requested_by: principal.principalId })
              .returning(['id', 'state'])
              .executeTakeFirstOrThrow();
            // In the same transaction as the row it is about: the job exists exactly when the sample
            // does, and the queue checks that a tenant enqueues only its own work.
            await enqueueJob(trx, 'sample_pdf', row.id);
            return { id: row.id, state: row.state, download: null };
          },
          202,
        ),
      );
      if (replayed) void reply.header(IDEMPOTENT_REPLAYED, 'true');
      return reply.status(202).send(body);
    },

    getSample: async (request) => {
      const tenant = tenantOf(request);
      const { sampleId } = request.params as SampleParams;
      const answer = await db.withTenant(tenant, async (trx): Promise<Sample | undefined> => {
        const sample = await trx
          .selectFrom('sample')
          .select(['id', 'state', 'object_key'])
          .where('id', '=', sampleId)
          .executeTakeFirst();
        if (!sample) return undefined;
        if (sample.state !== 'done' || !sample.object_key) {
          return { id: sample.id, state: sample.state, download: null };
        }
        if (!options.objects) throw storageUnavailable();
        const store = await options.objects.forTenant(trx, tenant);
        return {
          id: sample.id,
          state: sample.state,
          download: await store.signedLink(sample.object_key, DOWNLOAD_SECONDS),
        };
      });
      if (!answer) {
        throw new AppError(404, 'sample_not_found', 'There is no such sample in this environment.');
      }
      return answer;
    },

    openStream: async (request, reply) => {
      const tenant = tenantOf(request);
      const { events } = options;
      if (!events) {
        throw new AppError(
          503,
          'stream_unavailable',
          'This environment cannot stream yet. Try again later.',
        );
      }
      await streamToViewer({ request, reply, db, events, tenant, credential: request.credential });
      return reply;
    },

    getAccess: async (_request, { target, facts }) => ({
      target: formatLevel(target),
      permissions: permissions.map((permission) => ({
        permission,
        // administer by "at its level or above" (final review, item 3): the same rule a route
        // checking it would use, so this answers exactly what such a route would decide here.
        allowed: (permission === 'administer'
          ? administerOrAbove(facts)
          : decide(permission, facts)
        ).allowed,
      })),
    }),

    explainAccess: async (request, { trx, target }) => {
      const { principal } = request.query as ExplainQuery;
      const facts = await loadFacts(trx, principal, target);
      if (!facts) throw notFound();
      // administer by "at its level or above" (final review, item B): the same rule GET /v1/access
      // and the route helper use, so this explains the decision that actually governs the permission,
      // not a plain nearest-level walk that could show a denial "or above" already overrides.
      const decisions = permissions.map((permission) =>
        permission === 'administer' ? administerOrAbove(facts) : decide(permission, facts),
      );
      // Every group a deciding grant came through, named in one read under the same lock.
      const names = await groupNames(
        trx,
        decisions.flatMap((decision) =>
          decision.grants.flatMap((reached) => (reached.through === null ? [] : [reached.through])),
        ),
      );
      return {
        principal,
        target: formatLevel(target),
        permissions: decisions.map((decision) => explained(decision, names)),
      };
    },
  };

  /**
   * The handler as registered. A route declaring a permission is decided inside `withTenant` and its
   * handler runs only on an allow, in the same transaction (access.md, "Refusing") - and is never
   * handed this route's `reply`, so it has nothing to send with even if it tried.
   */
  function permissionChecked(
    operation: string,
    mutating: boolean,
    access: RouteAccess,
    handler: Handlers[keyof Handlers],
    binary: boolean,
  ): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
    if (access.check !== 'permission') {
      const run = handler as (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
      return (request, reply) => run(request, reply);
    }
    const run = handler as (request: FastifyRequest, authorised: Authorised) => Promise<unknown>;
    return async (request, reply) => {
      // A mutating request may carry an idempotency key, honoured in the one transaction its
      // decision and its work share (service-foundations.md, "Idempotency"; API-008).
      const keyed = mutating ? keyedRequest(request, operation) : undefined;
      // Every event the act records names who it acts for (the AU1 plan, AU1-D).
      const { body, replayed } = await db.withTenant(
        tenantOf(request),
        async (trx) => {
          await beforeDeciding(trx, access);
          const principal = principalOf(request).principalId;
          const authorised = await authorise(trx, principal, access, request);
          const done = await once(trx, principal, keyed, () => run(request, authorised));
          // A keyed answer is recorded here, in the deciding transaction, so work that runs after it
          // commits would go unrecorded: such a route declares `idempotencyKey: false`.
          if (done.body instanceof AfterCommit && keyed !== undefined) {
            throw new Error(
              `${operation} works after its commit and cannot take an idempotency key`,
            );
          }
          return done;
        },
        contextOf(request),
      );
      if (replayed) void reply.header(IDEMPOTENT_REPLAYED, 'true');
      // The deciding transaction has committed, and its lock on access with it: the rest of the work -
      // a connector's, say - holds back no grant or revocation (the D1 fix, C4).
      if (body instanceof AfterCommit) {
        const answer = await (body as AfterCommit<unknown>).run();
        // Accepted, not yet done: the caller follows it elsewhere (D8-D).
        if (answer instanceof Accepted) return reply.status(202).send(answer.body);
        return answer;
      }
      // Cached privately and revalidated (TB2-A): unchanged, nothing is sent but the tag.
      if (body instanceof Revalidated) {
        const tagged = body as Revalidated<unknown>;
        void reply.header('ETag', tagged.etag);
        void reply.header('Cache-Control', 'private, no-cache');
        if (tagged.body === undefined) return reply.status(304).send();
        return tagged.body;
      }
      if (!binary) return body;
      // Bytes, sent only now that the transaction has committed, as a body is (figures 1, R2): never
      // sniffed into something a browser would run, and never run as a document of this origin.
      const bytes = body as BinaryBody;
      void reply.header('X-Content-Type-Options', 'nosniff');
      void reply.header('Content-Security-Policy', 'sandbox');
      if (bytes.immutable)
        void reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      return reply.type(bytes.contentType).send(bytes.bytes);
    };
  }

  // A raw body is bytes, kept as they came: one content type, declared by the route that takes it.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  const http = app.withTypeProvider<ZodTypeProvider>();
  for (const [name, route] of Object.entries(routes) as [keyof Handlers, RouteContract][]) {
    // Bytes are sent only by the permission-checked path, after its transaction commits; a binary
    // answer declared anywhere else would be serialised as JSON with no error (final review, 11).
    if (route.responses[200]?.binary !== undefined && route.access.check !== 'permission') {
      throw new Error(`${route.operationId} answers bytes without deciding a permission`);
    }
    const response = Object.fromEntries(
      Object.entries(route.responses).flatMap(([status, declared]) =>
        declared.schema ? [[status, declared.schema]] : [],
      ),
    );
    const onRequest: ((request: FastifyRequest, reply: FastifyReply) => Promise<void>)[] = [];
    if (route.tenantScoped) {
      onRequest.push(async (request, reply) => {
        const tenant = await tenants.resolve(request.hostname);
        if (!tenant) {
          throw new AppError(404, 'tenant_not_found', 'No environment is served at this address.');
        }
        request.tenant = tenant;
        // Both loggers: the reply's was captured before this hook ran, and it writes the
        // "request completed" line.
        request.log = request.log.child({ tenant: tenant.id });
        reply.log = request.log;
      });
    }
    if (route.access.check !== 'none') {
      const sessionAlone = route.access.credential === 'session';
      // After the tenant is known, and before the request's own parameters are looked at: a session
      // or a token is found only in the tenant whose hostname this is, so another environment's is
      // simply not there (IAM-003).
      onRequest.push(async (request) => {
        // A bearer first, and alone: a request carrying one is decided by it whatever cookie it also
        // carries, and one that is not a token of ours is refused rather than passed over. Any other
        // scheme is not ours to read, and the cookie decides (W12.1's final review).
        const authorization = request.headers.authorization;
        if (authorization !== undefined && isBearer(authorization)) {
          const secret = bearerSecret(authorization);
          const holder =
            secret === undefined
              ? undefined
              : await db.withTenant(tenantOf(request), (trx) =>
                  findApiToken(trx, hashToken(secret), new Date(), request.id),
                );
          if (!holder) throw unauthenticated();
          request.principal = {
            principalId: holder.principalId,
            email: holder.email,
            displayName: holder.displayName,
          };
          request.credential = { kind: 'token', id: holder.tokenId, scopes: holder.scopes };
          // Found first, so a revoked or foreign token is unauthenticated wherever it is sent; and
          // named before it is refused here, so the refusal is recorded as its principal's (AU1-E).
          if (sessionAlone) throw tokenNotAllowed();
          return;
        }
        const token = request.cookies[SESSION_COOKIE];
        const held = token
          ? await db.withTenant(tenantOf(request), (trx) => sessionHeld(trx, token))
          : undefined;
        if (!held) throw unauthenticated();
        request.principal = held.principal;
        request.credential = { kind: 'session', id: held.id, route: held.route };
      });
    }
    http.route({
      method: route.method,
      // OpenAPI names a path parameter `{like this}`; Fastify names it `:like_this`.
      url: route.path.replace(/\{(\w+)\}/g, ':$1'),
      schema: {
        response,
        ...(route.query ? { querystring: route.query } : {}),
        ...(route.params ? { params: route.params } : {}),
        ...(route.body ? { body: route.body } : {}),
      },
      ...(onRequest.length > 0 ? { onRequest } : {}),
      ...(route.rawBody
        ? {
            bodyLimit: route.rawBody.maxBytes,
            // A body over the limit is refused before it is read whole, in the route's own words.
            errorHandler: async (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
              await failed(request, error);
              const tooLarge = (error as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE';
              const { status, body } = toErrorBody(
                tooLarge
                  ? new AppError(
                      413,
                      'asset_too_large',
                      'This file is larger than an image may be.',
                    )
                  : error,
                request.id,
              );
              logFailure(request, error, status);
              return reply.status(status).send(body);
            },
          }
        : {}),
      handler: permissionChecked(
        name,
        // A route that takes no idempotency key keeps no record of its request (D1-S).
        route.method !== 'GET' && route.idempotencyKey !== false,
        route.access,
        handlers[name],
        route.responses[200]?.binary !== undefined,
      ),
    });
  }
  return app;
}
