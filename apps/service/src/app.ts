import { randomBytes, timingSafeEqual } from 'node:crypto';
import { templateMoveHandlers } from './template-moves.js';
import { datesHandlers } from './dates.js';
import { scopeHandlers } from './scopes.js';
import { lineHandlers } from './lines.js';
import { translationHandlers } from './translations.js';
import { shareHandlers } from './shares.js';
import { queryUsageHandlers } from './query-usage.js';
import { IDEMPOTENT_REPLAYED, keyedRequest, once } from './idempotency.js';
import { Accepted, AfterCommit, Revalidated, Streamed } from './after-commit.js';
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
  type ReauthenticationBody,
  type SignInCallback,
  type SignInStartQuery,
  SIGN_IN_RETURN,
  type StreamQuery,
  type MyPreferences,
} from '@alloy-works/api-contract';
import {
  claimInvitation,
  collationVersions,
  enqueueJob,
  findApiToken,
  groupNames,
  holdPrincipal,
  sessionSettings,
  identifyKnown,
  loadFacts,
  notifyTenant,
  openSecret,
  streamScope,
  SealedSecretRefused,
  readsOnlyShares,
  syncProviderGroups,
  type SignInRoute,
  type Tenant,
  type TenantDatabase,
  type TenantListener,
  interfaceLanguageOf,
  setInterfaceLanguage,
} from '@alloy-works/db';
import {
  CONTENT_LANGUAGES_CLDR,
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
import { sendStreamed } from './streamed.js';
import { groupHandlers } from './groups.js';
import { auditHandlers, tenantExportHandlers } from './audit-log.js';
import { assistantHandlers } from './generation/assistant.js';
import { generatedHandlers } from './generation/generated.js';
import { modelEndpointHandlers } from './generation/models.js';
import { serviceIdentityHandlers } from './service-identities.js';
import { webhookHandlers } from './webhooks.js';
import { extensionHandlers } from './extensions.js';
import { registerMcp } from './mcp/route.js';
import { registerBridge } from './bridge/plugin.js';
import { ctStudioHandlers } from './bridge/ct-studio.js';
import { bridgeSettingsHandlers } from './bridge/settings.js';
import { promptHandlers, promptLibraryHandlers } from './generation/prompts.js';
import { bibliographyHandlers } from './bibliography/routes.js';
import { termHandlers } from './terms/routes.js';
import { vocabularyHandlers } from './vocabularies.js';
import { licenceHandlers } from './licences.js';
import { themeHandlers } from './themes.js';
import { importHandlers } from './imports.js';
import { termEditingHandlers } from './terms/editing.js';
import { referenceSourceHandlers } from './bibliography/sources.js';
import { citationStyleHandlers } from './bibliography/styles.js';
import { citingHandlers } from './bibliography/citing.js';
import { machineDraftHandlers } from './generation/machine-drafts.js';
import { promptRunHandlers } from './generation/prompt-runs.js';
import { guardrailHandlers } from './generation/guardrails.js';
import { modelLimitHandlers } from './generation/limits.js';
import { modelBudgetHandlers } from './generation/budget.js';
import { modelUsageHandlers } from './generation/usage.js';
import { embeddingHandlers } from './generation/embedding.js';
import { personalPromptHandlers } from './generation/personal-prompts.js';
import { rangePreviewHandlers } from './range-previews.js';
import { ownSessionHandlers } from './own-sessions.js';
import { presenceHandlers } from './presence.js';
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
import { baselineHandlers } from './baselines.js';
import { threadHandlers } from './threads.js';
import { attentionHandlers } from './attention.js';
import { inboxHandlers } from './inbox.js';
import { roundHandlers } from './rounds.js';
import { restoreHandlers } from './restore.js';
import { versionHandlers } from './versions.js';
import { archivalHandlers } from './archival.js';
import { deletedListingHandlers, deletionHandlers } from './deletion.js';
import { usesHandlers } from './uses.js';
import { impactHandlers } from './impact.js';
import { relationshipHandlers } from './relationships.js';
import { cohortHandlers } from './cohorts.js';
import { jobHandlers } from './jobs.js';
import { holdHandlers } from './holds.js';
import { retentionHandlers } from './retention.js';
import { workflowHandlers } from './workflows.js';
import { erasureHandlers } from './erasure.js';
import { suggestionHandlers } from './suggestions.js';
import { changesHandlers } from './changes.js';
import { comparisonHandlers } from './comparison.js';
import { DOWNLOAD_SECONDS, publishingHandlers } from './publishing.js';
import { rendererFallback, serveRenderer } from './renderer.js';
import type { SecretStore } from './secrets.js';
import {
  createSession,
  endSession,
  hashToken,
  sessionHeld,
  markReauthenticated,
  type SessionPrincipal,
} from './sessions.js';
import { refuseUnlessRecent, signInSettingsHandlers } from './sign-in-settings.js';
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
  | {
      readonly kind: 'session';
      readonly id: string;
      readonly route: SignInRoute;
      readonly providerId: string | null;
      readonly authenticatedAt: Date;
    }
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
  /** How long a stream lives before it ends and is read afresh; five minutes but in tests. */
  readonly streamLifetimeMs?: number;
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
/** The page a sign-in comes back to, as `SIGN_IN_RETURN` holds it (the R17 plan, R17-A). */
export const RETURN_COOKIE = '__Host-aw_return';
const SIGN_IN_ATTEMPT_MS = 10 * 60 * 1000;
/** How far apart the provider's clock and ours may be, as openid-client allows of an ID token. */
const PROVIDER_CLOCK_TOLERANCE_S = 30;
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
    : R['responses'] extends { 200: { stream: true } }
      ? Streamed
      : never;

/** The routes answering a secret once, never kept by a cache on the way (G8-H, WB-G). */
const ANSWERS_A_SECRET: ReadonlySet<string> = new Set([
  'issueServiceIdentityToken',
  'connectCtStudio',
  'issueCtStudioToken',
  'createWebhook',
  'changeWebhook',
  'rotateWebhookSecret',
]);

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

/** Thrown inside a sign-in's transaction, so it commits nothing, where its principal is not held. */
class SignInUnheld extends Error {}

/** A disabled person signing in (identity.md, "Disabled people"): refused until enabled. */
const principalDisabled = () =>
  new AppError(
    403,
    'principal_disabled',
    'This account has been disabled in this environment. An administrator can enable it.',
    'IAM-008',
  );

/** An erased person signing in again (the ER plan, ER-D): their identity is refused for good. */
const principalErased = () =>
  new AppError(
    403,
    'principal_erased',
    'This account was erased from this environment, and cannot sign in to it.',
  );

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
  registerMcp(app, db, (hostname) => tenants.resolve(hostname));
  // CT Studio's delivery bridge (ADR-0071), served only where its signing keys are set.
  const bridgeKeys = (secrets.get('bridge_keys') ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '');
  if (bridgeKeys.length > 0) {
    if (!options.objects) throw new Error('The bridge needs an object store for its packages');
    registerBridge(app, {
      db,
      objects: options.objects,
      keys: bridgeKeys,
      resolve: (hostname) => tenants.resolve(hostname),
    });
  }
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

  /** The open providers of the organisation's route, by name, as the sign-in page offers them. */
  async function openProviders(tenant: Tenant) {
    if (!(await permits(tenant, 'organisation'))) return [];
    return db.withTenant(tenant, (trx) =>
      trx
        .selectFrom('identity_provider')
        .select(['id', 'name'])
        .where('closed_at', 'is', null)
        .orderBy('name')
        .execute(),
    );
  }

  /**
   * One of the organisation's providers (IAM-011), open, with the client secret this environment
   * holds, sealed in its own schema and opened for this tenant alone: nothing names a secret another
   * environment could hold.
   * An environment configured before secrets were sealed names its secret instead, and one whose
   * sealed secret does not open for it holds somebody else's; neither signs anybody in, and the log
   * says which, never with the secret.
   */
  async function organisationProvider(
    request: FastifyRequest,
    tenant: Tenant,
    providerId: string,
  ): Promise<(ProviderSettings & { readonly id: string }) | undefined> {
    if (!(await permits(tenant, 'organisation'))) return undefined;
    const row = await db.withTenant(tenant, (trx) =>
      trx
        .selectFrom('identity_provider')
        .selectAll()
        .where('id', '=', providerId)
        .where('closed_at', 'is', null)
        .executeTakeFirst(),
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
      id: row.id,
      issuer: row.issuer,
      clientId: row.client_id,
      clientSecret,
      groupsClaim: row.groups_claim,
    };
  }

  /**
   * Starts at one of the organisation's providers. One that cannot be reached, or whose address is
   * refused, is logged by the fact alone and answered as a way in that is closed, since nobody signing
   * in can do anything about it.
   */
  async function startAt(
    request: FastifyRequest,
    tenant: Tenant,
    provider: ProviderSettings,
    redirectUri: string,
    asked?: { readonly reauthenticate: boolean },
  ): Promise<SignInStart> {
    try {
      return await oidc.start(provider, redirectUri, asked);
    } catch {
      warnOnce(request, tenant, "one of the organisation's identity providers cannot be reached");
      throw routeClosed();
    }
  }

  function googleProvider(google: GoogleSettings): ProviderSettings {
    return { issuer: google.issuer, clientId: google.clientId, clientSecret: secret('google') };
  }

  async function recordAttempt(
    tenant: Tenant,
    route: SignInRoute,
    stateHash: string,
    start: SignInStart,
    providerId: string | null = null,
    /** The session asking, where this re-authenticates it rather than signs somebody in. */
    sessionId: string | null = null,
  ): Promise<void> {
    await db.withTenant(tenant, (trx) =>
      trx
        .insertInto('sign_in_attempt')
        .values({
          state_hash: stateHash,
          nonce: start.nonce,
          code_verifier: start.codeVerifier,
          route,
          provider_id: providerId,
          session_id: sessionId,
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
    /** The provider an organisation's sign-in came through, and the group values it asserted. */
    asserted?: { readonly providerId: string; readonly groups: readonly string[] },
  ): Promise<FastifyReply> {
    let held = 'held' as Awaited<ReturnType<typeof holdPrincipal>>;
    const started = await db
      .withTenant(tenant, async (trx) => {
        // The sign-in, and the memberships it settles, are the principal's own acts (AU1-F).
        await actAs(trx, principalId, request.id);
        // Their row held after any epoch and before anything changes, as an erasure takes them: a
        // session and its memberships are made before an erasure ends them, or not at all (ER-D).
        const hold = async () => {
          held = await holdPrincipal(trx, principalId);
          if (held !== 'held') throw new SignInUnheld();
        };
        if (asserted === undefined) await hold();
        else await syncProviderGroups(trx, principalId, asserted.groups, hold, asserted.providerId);
        return {
          token: await createSession(
            trx,
            principalId,
            route,
            undefined,
            asserted?.providerId ?? null,
          ),
          lifetimes: await sessionSettings(trx),
        };
      })
      .catch((error: unknown) => {
        if (error instanceof SignInUnheld) return undefined;
        throw error;
      });
    if (started === undefined) {
      if (held === 'missing') throw signInFailed();
      if (held === 'disabled') {
        await recordSignInFailure(db, request, tenant, route, 'principal_disabled', principalId);
        throw principalDisabled();
      }
      await recordSignInFailure(db, request, tenant, route, 'principal_erased');
      throw principalErased();
    }
    reply.setCookie(SESSION_COOKIE, started.token, {
      ...COOKIE,
      maxAge: started.lifetimes.absoluteHours * 60 * 60,
    });
    return backToThePage(request, reply);
  }

  /** Back to the page a sign-in started from, held to a page of this app again as it is read. */
  function backToThePage(request: FastifyRequest, reply: FastifyReply): FastifyReply {
    const to = request.cookies[RETURN_COOKIE];
    reply.clearCookie(RETURN_COOKIE, COOKIE);
    return reply.redirect(to !== undefined && SIGN_IN_RETURN.test(to) ? `/#/${to}` : '/', 302);
  }

  /**
   * Whether an authentication answers the session asking (identity.md, "Re-authentication"; IAM-012):
   * this browser's own session, of the same issuer and subject, authenticated since the attempt began.
   * What it refuses is recorded and said as any failed sign-in; the session stays as it was.
   */
  async function asking(
    request: FastifyRequest,
    tenant: Tenant,
    route: SignInRoute,
    attempt: { readonly session_id: string | null; readonly created_at: Date },
    identity: Identity,
  ): Promise<{ readonly id: string; readonly principalId: string }> {
    const session = await db.withTenant(tenant, (trx) =>
      trx
        .selectFrom('session as s')
        .innerJoin('principal as p', 'p.id', 's.principal_id')
        .select(['s.id', 'p.id as principal_id', 'p.issuer', 'p.subject'])
        .where('s.id', '=', attempt.session_id!)
        .executeTakeFirst(),
    );
    if (!session) throw signInFailed();
    const since = attempt.created_at.getTime() / 1000 - PROVIDER_CLOCK_TOLERANCE_S;
    if (
      session.issuer !== identity.issuer ||
      session.subject !== identity.subject ||
      identity.authTime === null ||
      identity.authTime < since
    ) {
      await recordSignInFailure(
        db,
        request,
        tenant,
        route,
        'reauthentication_refused',
        session.principal_id,
      );
      throw signInFailed();
    }
    return { id: session.id, principalId: session.principal_id };
  }

  /**
   * Marks the session authenticated afresh and returns to the page that asked, the provider's groups
   * read again as a sign-in reads them. Only in this browser's own session.
   */
  async function reauthenticated(
    request: FastifyRequest,
    reply: FastifyReply,
    tenant: Tenant,
    session: { readonly id: string; readonly principalId: string },
    route: SignInRoute,
    asserted?: { readonly providerId: string; readonly groups: readonly string[] },
  ): Promise<FastifyReply> {
    const token = request.cookies[SESSION_COOKIE];
    await db
      .withTenant(tenant, async (trx) => {
        const held = token ? await sessionHeld(trx, token) : undefined;
        if (held?.id !== session.id) throw new SignInUnheld();
        await actAs(trx, session.principalId, request.id);
        const hold = async () => {
          if ((await holdPrincipal(trx, session.principalId)) !== 'held') throw new SignInUnheld();
        };
        if (asserted === undefined) await hold();
        else {
          await syncProviderGroups(
            trx,
            session.principalId,
            asserted.groups,
            hold,
            asserted.providerId,
          );
        }
        await markReauthenticated(trx, { ...session, route });
      })
      .catch((error: unknown) => {
        if (error instanceof SignInUnheld) throw signInFailed();
        throw error;
      });
    return backToThePage(request, reply);
  }

  /** Remembers the page to come back to, for the browser starting this sign-in. */
  function returnTo(request: FastifyRequest, reply: FastifyReply): void {
    const { to } = request.query as SignInStartQuery;
    if (to === undefined) reply.clearCookie(RETURN_COOKIE, COOKIE);
    else reply.setCookie(RETURN_COOKIE, to, { ...COOKIE, maxAge: SIGN_IN_ATTEMPT_MS / 1000 });
  }

  const { boundCreation, vocabularySource, ...connectionRoutes } = connectionHandlers(
    db,
    tenantOf,
    principalOf,
    options.connector,
    options.objects,
    options.events,
  );
  // A space's CT Studio settings, and the delivery store data delivery is turned on against.
  const bridgeSettings = bridgeSettingsHandlers({
    tenantOf,
    connector: options.connector,
    deliveredUrl: secrets.get('delivered_url'),
  });
  app.addHook('onClose', bridgeSettings.close);
  // Administration's CT Studio section: what is connected, and connecting a space.
  const ctStudio = ctStudioHandlers({
    db,
    tenantOf,
    bridgeOn: bridgeKeys.length > 0,
    saveSettings: bridgeSettings.save,
  });
  const handlers: Handlers = {
    ...componentHandlers(db, tenantOf, principalOf),
    ...documentHandlers(db, tenantOf, principalOf, boundCreation),
    ...templateHandlers(db, tenantOf, principalOf),
    ...connectionRoutes,
    ...bridgeSettings.handlers,
    ...ctStudio.handlers,
    ...queryDefinitionHandlers(db, tenantOf, principalOf),
    ...bindingHandlers(tenantOf, options.objects),
    ...pendingHandlers(db, tenantOf, options.objects),
    ...definitionHandlers(db, tenantOf, principalOf),
    ...searchHandlers(db, tenantOf, principalOf, options.connector),
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
    ...serviceIdentityHandlers(),
    ...webhookHandlers(tenantOf, options.connector),
    ...extensionHandlers(tenantOf, options.connector),
    ...auditHandlers(tenantOf, options.objects),
    ...tenantExportHandlers(tenantOf, options.objects),
    ...rangePreviewHandlers(),
    ...modelEndpointHandlers(db, tenantOf, options.connector),
    ...promptHandlers(db, tenantOf, principalOf),
    ...promptLibraryHandlers(),
    ...bibliographyHandlers(),
    ...termHandlers(),
    ...vocabularyHandlers(db, tenantOf, principalOf, vocabularySource),
    ...licenceHandlers(db, tenantOf, principalOf),
    ...themeHandlers(db, tenantOf, principalOf),
    ...importHandlers(db, tenantOf, options.objects),
    ...termEditingHandlers(),
    ...referenceSourceHandlers(db, tenantOf, options.connector),
    ...citationStyleHandlers(),
    ...citingHandlers(),
    ...guardrailHandlers(),
    ...modelLimitHandlers(),
    ...modelBudgetHandlers(),
    ...modelUsageHandlers(),
    ...embeddingHandlers(db, tenantOf, options.connector),
    ...personalPromptHandlers(db, tenantOf, principalOf),
    ...promptRunHandlers(db, tenantOf, options.connector, options.events),
    ...machineDraftHandlers(db, tenantOf, options.connector, options.events),
    ...generatedHandlers(),
    ...assistantHandlers(
      db,
      tenantOf,
      principalOf,
      options.connector,
      options.objects,
      options.events,
    ),
    ...ownSessionHandlers(db, tenantOf, principalOf, { name: SESSION_COOKIE, options: COOKIE }),
    ...presenceHandlers(db, tenantOf, principalOf),
    ...baselineHandlers(tenantOf, options.objects),
    ...comparisonHandlers(tenantOf, options.objects),
    ...changesHandlers(db, tenantOf),
    ...threadHandlers(),
    ...inboxHandlers(db, tenantOf, principalOf),
    ...attentionHandlers(db, tenantOf, principalOf),
    ...suggestionHandlers(),
    ...roundHandlers(),
    ...restoreHandlers(),
    ...versionHandlers(),
    ...archivalHandlers(),
    ...deletionHandlers(),
    ...usesHandlers(db, tenantOf, principalOf),
    ...impactHandlers(),
    ...jobHandlers(db, tenantOf, principalOf, options.objects),
    ...cohortHandlers(db, tenantOf, options.objects),
    ...relationshipHandlers(db, tenantOf),
    ...deletedListingHandlers(db, tenantOf, principalOf),
    ...holdHandlers(),
    ...retentionHandlers(),
    ...workflowHandlers(),
    ...datesHandlers(),
    ...scopeHandlers(),
    ...lineHandlers(),
    ...translationHandlers(tenantOf, options.objects),
    ...shareHandlers(tenantOf, options.objects),
    ...queryUsageHandlers(),
    ...templateMoveHandlers(),
    ...erasureHandlers(),

    getHealth: async () => ({ status: 'ok' }),

    ...signInSettingsHandlers({
      tenantOf,
      sealingKey: options.sealingKey,
      googleAvailable: options.google !== undefined,
      callbackPath: CALLBACK_PATH,
    }),

    getTenant: async (request) => {
      const tenant = tenantOf(request);
      const profile = await db.withTenant(tenant, (trx) =>
        trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow(),
      );
      // The ways in, so a sign-in page offers Google to somebody from outside where it may.
      const signIn: ('organisation' | 'google')[] = [];
      const providers = await openProviders(tenant);
      if (providers.length > 0) signIn.push('organisation');
      if (options.google && (await permits(tenant, 'google'))) signIn.push('google');
      return { name: profile.display_name, signIn, providers };
    },

    // The locale data it sorts and formats with (TE-F; LOC-044), the database's collations beside:
    // behind sign-in, so the versions never fingerprint the service to anybody.
    getAbout: async (request) => {
      const collations = await db.withTenant(tenantOf(request), (trx) => collationVersions(trx));
      return {
        localeData: {
          icu: process.versions.icu ?? 'none',
          unicode: process.versions.unicode ?? 'none',
          cldr: process.versions.cldr ?? 'none',
          // The CLDR the domain's plural rules were compiled from (the MF plan, MF-H).
          plurals: CONTENT_LANGUAGES_CLDR,
          collations: collations.map((each) => ({ ...each })),
        },
      };
    },

    startOrganisationSignIn: async (request, reply) => {
      const tenant = tenantOf(request);
      // The provider asked for, or the only one open: with several, the sign-in page names one.
      const asked = (request.query as SignInStartQuery).provider;
      const open = await openProviders(tenant);
      // Named by nobody among several: back to the page that offers them, which a plain link reaches.
      if (asked === undefined && open.length > 1) return reply.redirect('/', 302);
      const chosen = asked ?? open[0]?.id;
      const provider = chosen && (await organisationProvider(request, tenant, chosen));
      if (!provider) throw routeClosed();
      const start = await startAt(
        request,
        tenant,
        provider,
        `${request.protocol}://${request.host}${CALLBACK_PATH}`,
      );
      await recordAttempt(tenant, 'organisation', hashToken(start.state), start, provider.id);
      reply.setCookie(SIGN_IN_COOKIE, start.state, {
        ...COOKIE,
        maxAge: SIGN_IN_ATTEMPT_MS / 1000,
      });
      returnTo(request, reply);
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
      // The provider the attempt went to, so a code is exchanged where it was issued.
      const provider =
        attempt?.provider_id && (await organisationProvider(request, tenant, attempt.provider_id));
      if (!attempt || !provider) throw signInFailed();
      const identity = await finishAt(request, tenant, 'organisation', provider, {
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.code_verifier,
      });
      if (attempt.session_id !== null) {
        const session = await asking(request, tenant, 'organisation', attempt, identity);
        return reauthenticated(request, reply, tenant, session, 'organisation', {
          providerId: provider.id,
          groups: identity.groups,
        });
      }
      // Found by issuer and subject, never by email address, which can be reassigned. Only somebody
      // this environment has never seen can become an invitation's principal, and only for an
      // address the provider verifies; anybody else the provider authenticates is made a principal
      // holding nothing, as before.
      // An erased person is refused before anything of theirs is written (ER-D).
      const principal = await db.withTenant(tenant, async (trx) => {
        const known = await identifyKnown(trx, identity);
        if (known) return known;
        const invited = await claimInvitation(
          trx,
          identity,
          { route: 'organisation', providerId: provider.id },
          request.id,
        );
        if (invited) return { id: invited };
        // An upsert still: the same identity's first sign-in in another window may land between the
        // lookup above and this insert. An erased one is never renamed, and answers nothing.
        const made = await trx
          .insertInto('principal')
          .values({
            issuer: identity.issuer,
            subject: identity.subject,
            email: identity.email,
            email_verified: identity.emailVerified,
            display_name: identity.name,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['issuer', 'subject'])
              .doUpdateSet({
                email: identity.email,
                email_verified: identity.emailVerified,
                display_name: identity.name,
              })
              .where('principal.erased_at', 'is', null),
          )
          .returning('id')
          .executeTakeFirst();
        return made ?? 'erased';
      });
      if (principal === 'erased') {
        await recordSignInFailure(db, request, tenant, 'organisation', 'principal_erased');
        throw principalErased();
      }
      return signInAs(request, reply, tenant, principal.id, 'organisation', {
        providerId: provider.id,
        groups: identity.groups,
      });
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
      returnTo(request, reply);
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
      // A re-authentication marks the session asking, at the environment, rather than admitting anyone.
      const again =
        attempt.session_id === null
          ? undefined
          : await asking(request, tenant, 'google', attempt, identity);
      const admitted = await db.withTenant(tenant, async (trx) => {
        const principalId =
          again?.principalId ?? (await admitGoogleAccount(trx, identity, request.id));
        if (principalId === undefined || principalId === 'erased') return principalId ?? false;
        // The hand-off names the attempt, so only the browser holding that attempt's cookie can
        // redeem it at the environment.
        await trx
          .insertInto('sign_in_handoff')
          .values({
            code_hash: hashToken(code),
            principal_id: principalId,
            attempt_hash: attempt.state_hash,
            session_id: again?.id ?? null,
            expires_at: new Date(Date.now() + HANDOFF_MS),
          })
          .execute();
        return true;
      });
      if (admitted === 'erased') {
        await recordSignInFailure(db, request, tenant, 'google', 'principal_erased');
        throw principalErased();
      }
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
      if (handoff.session_id !== null) {
        const session = { id: handoff.session_id, principalId: handoff.principal_id };
        return reauthenticated(request, reply, tenant, session, 'google');
      }
      return signInAs(request, reply, tenant, handoff.principal_id, 'google');
    },

    // Through the way in the session came by, returning to the callbacks a sign-in returns to (IAM-012).
    startReauthentication: async (request, reply) => {
      const tenant = tenantOf(request);
      const credential = request.credential;
      if (credential?.kind !== 'session') throw tokenNotAllowed();
      const { to } = request.body as ReauthenticationBody;
      const providerId = credential.providerId;
      let url: string;
      let cookie: string;
      if (credential.route === 'organisation') {
        const provider = providerId && (await organisationProvider(request, tenant, providerId));
        if (!provider) throw routeClosed();
        const start = await startAt(
          request,
          tenant,
          provider,
          `${request.protocol}://${request.host}${CALLBACK_PATH}`,
          { reauthenticate: true },
        );
        await recordAttempt(
          tenant,
          'organisation',
          hashToken(start.state),
          start,
          provider.id,
          credential.id,
        );
        url = start.url;
        cookie = start.state;
      } else {
        const { google } = options;
        if (!google || !(await permits(tenant, 'google'))) throw routeClosed();
        const attempt = randomBytes(32).toString('base64url');
        const start = await oidc.start(
          googleProvider(google),
          `${request.protocol}://${google.signInHost}${GOOGLE_CALLBACK_PATH}`,
          {
            reauthenticate: true,
            state: signState(secret('sign_in_state'), {
              tenant: tenant.id,
              host: request.host,
              attempt,
            }),
          },
        );
        await recordAttempt(tenant, 'google', hashToken(attempt), start, null, credential.id);
        url = start.url;
        cookie = attempt;
      }
      reply.setCookie(SIGN_IN_COOKIE, cookie, { ...COOKIE, maxAge: SIGN_IN_ATTEMPT_MS / 1000 });
      if (to === undefined) reply.clearCookie(RETURN_COOKIE, COOKIE);
      else reply.setCookie(RETURN_COOKIE, to, { ...COOKIE, maxAge: SIGN_IN_ATTEMPT_MS / 1000 });
      return { url };
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
      const { profile, kind, sharesOnly, interfaceLanguage } = await db.withTenant(
        tenantOf(request),
        async (trx) => ({
          profile: await trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow(),
          kind: await trx
            .selectFrom('principal')
            .select('kind')
            .where('id', '=', principal.principalId)
            .executeTakeFirst(),
          sharesOnly: await readsOnlyShares(trx, principal.principalId),
          interfaceLanguage: await interfaceLanguageOf(trx, principal.principalId),
        }),
      );
      return {
        id: principal.principalId,
        displayName: principal.displayName,
        email: principal.email,
        environment: profile.display_name,
        outside: kind?.kind === 'external',
        sharesOnly,
        interfaceLanguage,
      };
    },

    // A person's interface language (the UI plan, UI-E; LOC-005): theirs alone, never content's.
    getMyPreferences: async (request: FastifyRequest) =>
      db.withTenant(tenantOf(request), async (trx) => ({
        interfaceLanguage: await interfaceLanguageOf(trx, principalOf(request).principalId),
      })),

    setMyPreferences: async (request: FastifyRequest) => {
      const { interfaceLanguage } = request.body as MyPreferences;
      const principal = principalOf(request).principalId;
      return db.withTenant(tenantOf(request), async (trx) => {
        await setInterfaceLanguage(trx, principal, interfaceLanguage);
        return { interfaceLanguage: await interfaceLanguageOf(trx, principal) };
      });
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
      const query = request.query as StreamQuery;
      const scope =
        query.document !== undefined
          ? { document: query.document }
          : query.component !== undefined
            ? { component: query.component }
            : undefined;
      // Decided before the stream opens: a scope the viewer may not read is not there (PL-A).
      const principalId = principalOf(request).principalId;
      const components =
        scope === undefined
          ? undefined
          : await db.withTenant(tenant, (trx) => streamScope(trx, principalId, scope));
      if (scope !== undefined && components === undefined) throw notFound();
      await streamToViewer({
        request,
        reply,
        db,
        events,
        tenant,
        credential: request.credential,
        principalId,
        ...(scope === undefined || components === undefined
          ? {}
          : {
              scoped: {
                scope,
                principalId,
                components,
                ...(query.viewer === undefined ? {} : { viewer: query.viewer }),
              },
            }),
        ...(options.streamLifetimeMs === undefined ? {} : { lifetimeMs: options.streamLifetimeMs }),
      });
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
      // A session's route may stream too (a conversation's turn; the G5 plan), sent once its work
      // has committed, as a permission's is.
      return async (request, reply) => {
        const body = await run(request, reply);
        return body instanceof Streamed ? sendStreamed(request, reply, body) : body;
      };
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
          if (access.recentSignIn !== undefined) {
            refuseUnlessRecent(request.credential, access.recentSignIn);
          }
          const done = await once(trx, principal, keyed, () => run(request, authorised));
          // A keyed answer is recorded here, in the deciding transaction, so work that runs after it
          // commits would go unrecorded: such a route declares `idempotencyKey: false`.
          if (done.body instanceof AfterCommit && !done.body.remembers && keyed !== undefined) {
            throw new Error(
              `${operation} works after its commit and cannot take an idempotency key`,
            );
          }
          return done;
        },
        contextOf(request),
      );
      if (replayed) void reply.header(IDEMPOTENT_REPLAYED, 'true');
      // A token's secret, answered once, is never kept by a cache on the way (the G8 plan, G8-H).
      if (ANSWERS_A_SECRET.has(operation)) void reply.header('Cache-Control', 'no-store');
      if (body instanceof Streamed) return sendStreamed(request, reply, body);
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
      void reply.header('Content-Security-Policy', bytes.shownUnder ?? 'sandbox');
      if (bytes.shownUnder !== undefined || bytes.unkept === true) {
        void reply.header('Cache-Control', 'private, no-store');
      }
      if (bytes.immutable)
        void reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      if (bytes.attachment !== undefined) {
        void reply.header('Cache-Control', 'private, no-store');
        void reply.header('Content-Disposition', `attachment; filename="${bytes.attachment}"`);
      }
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
        request.credential = {
          kind: 'session',
          id: held.id,
          route: held.route,
          providerId: held.providerId,
          authenticatedAt: held.authenticatedAt,
        };
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
      ...(route.bodyMaxBytes === undefined ? {} : { bodyLimit: route.bodyMaxBytes }),
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
