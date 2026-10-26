import { archivalRoutes } from './archival.js';
import { deletionRoutes } from './deletion.js';
import { usesRoutes } from './uses.js';
import { impactRoutes } from './impact.js';
import { jobRoutes } from './jobs.js';
import { cohortRoutes } from './cohorts.js';
import { relationshipRoutes } from './relationships.js';
import { holdRoutes } from './holds.js';
import { shareRoutes } from './shares.js';
import { queryUsageRoutes } from './query-usage.js';
import { datasetSourceRoutes } from './dataset-sources.js';
import { exportRoutes } from './exports.js';
import { modelEndpointRoutes } from './model-endpoints.js';
import { serviceIdentityRoutes } from './service-identities.js';
import { webhookDeliveryRoutes, webhookRoutes } from './webhooks.js';
import { extensionRoutes } from './extensions.js';
import { assistantRoutes } from './assistant.js';
import { generatedRoutes } from './generated.js';
import { promptRoutes } from './prompts.js';
import { bibliographyRoutes } from './bibliography.js';
import { termRoutes } from './terms.js';
import { preferenceRoutes } from './preferences.js';
import { translationRoutes } from './translations.js';
import { importRoutes } from './imports.js';
import { promptLibraryRoutes } from './prompt-libraries.js';
import { citationStyleRoutes } from './citation-styles.js';
import { referenceSourceRoutes } from './reference-sources.js';
import { promptRunRoutes } from './prompt-runs.js';
import { conversationRoutes } from './conversations.js';
import { guardrailRoutes } from './guardrails.js';
import { modelLimitRoutes } from './model-limits.js';
import { modelBudgetRoutes } from './model-budget.js';
import { modelUsageRoutes } from './model-usage.js';
import { embeddingRoutes } from './model-embedding.js';
import { personalPromptRoutes } from './personal-prompts.js';
import { rangePreviewRoutes } from './range-previews.js';
import { erasureRoutes } from './erasure.js';
import { retentionRoutes } from './retention.js';
import { workflowRoutes } from './workflows.js';
import { assetRoutes } from './assets.js';
import { auditRoutes } from './audit.js';
import { bindingRoutes } from './bindings.js';
import { componentRoutes } from './components.js';
import { connectionRoutes } from './connections.js';
import { definitionRoutes } from './definitions.js';
import { peopleRoutes } from './people.js';
import { baselineRoutes } from './baselines.js';
import { changesRoutes } from './changes.js';
import { comparisonRoutes } from './comparison.js';
import { restoreRoutes } from './restore.js';
import { templateMoveRoutes } from './template-moves.js';
import { presenceRoutes } from './presence.js';
import { presentationRoutes } from './presentation.js';
import { queryDefinitionRoutes } from './query-definitions.js';
import { searchRoutes } from './search.js';
import { versionRoutes } from './versions.js';
import { sessionRoutes } from './sessions.js';
import { settingsRoutes } from './settings.js';
import type { RouteContract } from './contract.js';
import { documentRoutes } from './documents.js';
import { editingRoutes } from './editing.js';
import { groupRoutes } from './groups.js';
import { invitationRoutes } from './invitations.js';
import { managingAccessRoutes } from './managing-access.js';
import { publishingRoutes } from './publishing.js';
import { templateRoutes } from './templates.js';
import { threadRoutes } from './threads.js';
import { inboxRoutes } from './inbox.js';
import { roundRoutes } from './rounds.js';
import { suggestionRoutes } from './suggestions.js';
import { administeredTokenRoutes, tokenRoutes } from './tokens.js';
import {
  AccessAnswers,
  AccessExplanation,
  AccessQuery,
  ErrorBody,
  ExplainQuery,
  GoogleHandoff,
  Health,
  StreamQuery,
  Me,
  Sample,
  SampleParams,
  SignInCallback,
  SignInStartQuery,
  TenantProfile,
} from './schemas.js';

/** The API's major version, as in `/v1`. It changes only with a breaking change (API-010). */
export const API_VERSION = '1';

/** The session cookie: `__Host-` so only the exact hostname that set it can set or read it. */
export const SESSION_COOKIE = '__Host-aw_session';

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/** A token presented to a route that takes a session alone (service-foundations.md, TK-D). */
const tokenNotAllowed = {
  description: 'token_not_allowed: this takes a signed-in session, never a token',
  schema: ErrorBody,
} as const;

const routeClosed = {
  description: 'This environment does not permit signing in this way',
  schema: ErrorBody,
} as const;

const signInFailed = {
  description: 'The sign-in could not be completed',
  schema: ErrorBody,
} as const;
const erased = {
  description: 'principal_erased: this account was erased from this environment',
  schema: ErrorBody,
} as const;

/** access.md, "Refusing": an artifact the caller may not read is one that does not exist. */
const notFound = {
  description: 'No such target in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;

/**
 * The target answers - readable, or the tenant, which is never 404 - and the caller is refused what
 * they asked; the body names the permission.
 */
const forbidden = {
  description: 'The caller may address the target but lacks the permission this needs',
  schema: ErrorBody,
} as const;

/** The routes declared here; every other module's are spread beside them in `routes`. */
const ownRoutes = {
  getHealth: {
    operationId: 'getHealth',
    method: 'GET',
    path: '/health',
    summary: 'Whether the service is up. Answers on any hostname',
    tenantScoped: false,
    access: { check: 'none' },
    responses: { 200: { description: 'The service is up', schema: Health } },
  },
  getTenant: {
    operationId: 'getTenant',
    method: 'GET',
    path: '/v1/tenant',
    summary: 'The environment this address serves, as its sign-in page shows it',
    tenantScoped: true,
    access: { check: 'none' },
    responses: {
      200: { description: 'The environment', schema: TenantProfile },
      404: { description: 'No environment is served at this address', schema: ErrorBody },
    },
  },
  startOrganisationSignIn: {
    operationId: 'startOrganisationSignIn',
    method: 'GET',
    path: '/v1/sign-in/organisation',
    summary: "Begin signing in with the organisation's identity provider",
    tenantScoped: true,
    access: { check: 'none' },
    query: SignInStartQuery,
    responses: {
      400: { description: 'A page to come back to that is not one of this app', schema: ErrorBody },
      302: { description: 'On to the identity provider' },
      404: routeClosed,
    },
  },
  finishOrganisationSignIn: {
    operationId: 'finishOrganisationSignIn',
    method: 'GET',
    path: '/v1/sign-in/organisation/callback',
    summary: 'Where the identity provider returns; completes the sign-in',
    tenantScoped: true,
    access: { check: 'none' },
    query: SignInCallback,
    responses: {
      302: { description: 'Signed in, and on to the application' },
      401: signInFailed,
      403: erased,
    },
  },
  startGoogleSignIn: {
    operationId: 'startGoogleSignIn',
    method: 'GET',
    path: '/v1/sign-in/google',
    summary: 'Begin signing in with a Google account, by way of the one sign-in address',
    tenantScoped: true,
    access: { check: 'none' },
    query: SignInStartQuery,
    responses: {
      400: { description: 'A page to come back to that is not one of this app', schema: ErrorBody },
      302: { description: 'On to Google' },
      404: routeClosed,
    },
  },
  finishGoogleSignIn: {
    operationId: 'finishGoogleSignIn',
    method: 'GET',
    path: '/v1/sign-in/google/callback',
    summary:
      'Where Google returns, at the sign-in address only; hands the sign-in to its environment',
    tenantScoped: false,
    access: { check: 'none' },
    query: SignInCallback,
    responses: {
      302: { description: 'Admitted, and on to the environment that asked, with a one-time code' },
      401: signInFailed,
      403: {
        description:
          'not_invited: this account is not invited to that environment; or principal_erased: it was erased from it',
        schema: ErrorBody,
      },
      404: { description: 'This is not the sign-in address', schema: ErrorBody },
    },
  },
  completeGoogleSignIn: {
    operationId: 'completeGoogleSignIn',
    method: 'GET',
    path: '/v1/sign-in/google/complete',
    summary: 'Redeems the one-time code from the sign-in address, and signs in',
    tenantScoped: true,
    access: { check: 'none' },
    query: GoogleHandoff,
    responses: {
      302: { description: 'Signed in, and on to the application' },
      401: signInFailed,
      403: erased,
    },
  },
  openStream: {
    operationId: 'openStream',
    method: 'GET',
    path: '/v1/stream',
    summary:
      'What is happening in this environment, or in one document or component, as it happens',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    query: StreamQuery,
    responses: {
      200: { description: 'The stream: a snapshot, then what happens next', stream: true },
      400: {
        description: 'Both a document and a component, or an id malformed',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: tokenNotAllowed,
      404: {
        description: 'No such document or component, or none the caller may read',
        schema: ErrorBody,
      },
      503: { description: 'This environment cannot stream yet', schema: ErrorBody },
    },
  },
  signOut: {
    operationId: 'signOut',
    method: 'POST',
    path: '/v1/sign-out',
    summary: 'End this session, wherever it is in use',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    responses: {
      204: { description: 'Signed out, everywhere this session was in use' },
      401: unauthenticated,
      403: tokenNotAllowed,
    },
  },
  getMe: {
    operationId: 'getMe',
    method: 'GET',
    path: '/v1/me',
    summary: 'Who is signed in, and to which environment',
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'The signed-in principal', schema: Me },
      401: unauthenticated,
    },
  },
  requestSample: {
    operationId: 'requestSample',
    method: 'POST',
    path: '/v1/samples',
    summary: 'Ask for a sample PDF of this environment, which a worker makes',
    tenantScoped: true,
    // Development scaffolding that writes a row and queues a job: a session alone, so a token with no
    // scopes does nothing but read (service-foundations.md, TK-B).
    access: { check: 'session', credential: 'session' },
    responses: {
      202: { description: 'Asked for; a worker will make it', schema: Sample },
      401: unauthenticated,
      403: tokenNotAllowed,
      503: {
        description: 'This environment has nowhere to keep documents yet',
        schema: ErrorBody,
      },
    },
  },
  getSample: {
    operationId: 'getSample',
    method: 'GET',
    path: '/v1/samples/{sampleId}',
    summary: 'How a sample is coming along, and where to fetch it',
    tenantScoped: true,
    access: { check: 'session' },
    params: SampleParams,
    responses: {
      200: { description: 'The sample', schema: Sample },
      401: unauthenticated,
      404: { description: 'No such sample in this environment', schema: ErrorBody },
    },
  },
  getAccess: {
    operationId: 'getAccess',
    method: 'GET',
    path: '/v1/access',
    summary: "The caller's own answer for every permission on a target",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { query: 'target' } },
    query: AccessQuery,
    responses: {
      200: { description: 'Every permission, allowed or not', schema: AccessAnswers },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  },
  explainAccess: {
    operationId: 'explainAccess',
    method: 'GET',
    path: '/v1/access/explain',
    summary: 'Every permission a principal has on a target, and the grants and level behind each',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { query: 'target' } },
    query: ExplainQuery,
    responses: {
      200: { description: 'Every permission, with its explanation', schema: AccessExplanation },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  },
} as const satisfies Record<string, RouteContract>;

/**
 * Every route, its type named as the intersection of each module's rather than inferred whole: the
 * inferred object grew past what the compiler will write into a declaration (TS7056, TB2.1).
 */
type Routes = typeof ownRoutes &
  typeof componentRoutes &
  typeof documentRoutes &
  typeof publishingRoutes &
  typeof editingRoutes &
  typeof managingAccessRoutes &
  typeof invitationRoutes &
  typeof groupRoutes &
  typeof assetRoutes &
  typeof templateRoutes &
  typeof connectionRoutes &
  typeof queryDefinitionRoutes &
  typeof bindingRoutes &
  typeof definitionRoutes &
  typeof peopleRoutes &
  typeof searchRoutes &
  typeof presentationRoutes &
  typeof settingsRoutes &
  typeof tokenRoutes &
  typeof administeredTokenRoutes &
  typeof auditRoutes &
  typeof sessionRoutes &
  typeof presenceRoutes &
  typeof baselineRoutes &
  typeof comparisonRoutes &
  typeof changesRoutes &
  typeof threadRoutes &
  typeof inboxRoutes &
  typeof suggestionRoutes &
  typeof roundRoutes &
  typeof restoreRoutes &
  typeof templateMoveRoutes &
  typeof versionRoutes &
  typeof archivalRoutes &
  typeof holdRoutes &
  typeof deletionRoutes &
  typeof retentionRoutes &
  typeof workflowRoutes &
  typeof erasureRoutes &
  typeof usesRoutes &
  typeof impactRoutes &
  typeof jobRoutes &
  typeof cohortRoutes &
  typeof relationshipRoutes &
  typeof shareRoutes &
  typeof queryUsageRoutes &
  typeof datasetSourceRoutes &
  typeof exportRoutes &
  typeof modelEndpointRoutes &
  typeof serviceIdentityRoutes &
  typeof webhookRoutes &
  typeof webhookDeliveryRoutes &
  typeof extensionRoutes &
  typeof assistantRoutes &
  typeof generatedRoutes &
  typeof promptRoutes &
  typeof bibliographyRoutes &
  typeof termRoutes &
  typeof translationRoutes &
  typeof preferenceRoutes &
  typeof importRoutes &
  typeof promptLibraryRoutes &
  typeof citationStyleRoutes &
  typeof referenceSourceRoutes &
  typeof promptRunRoutes &
  typeof conversationRoutes &
  typeof guardrailRoutes &
  typeof modelLimitRoutes &
  typeof modelBudgetRoutes &
  typeof modelUsageRoutes &
  typeof embeddingRoutes &
  typeof personalPromptRoutes &
  typeof rangePreviewRoutes;

export const routes: Routes = {
  ...ownRoutes,
  // Finding, opening and editing components and documents, each declared beside its schemas.
  ...componentRoutes,
  ...documentRoutes,
  ...publishingRoutes,
  ...editingRoutes,
  ...managingAccessRoutes,
  ...invitationRoutes,
  ...groupRoutes,
  ...assetRoutes,
  ...templateRoutes,
  ...connectionRoutes,
  ...queryDefinitionRoutes,
  ...bindingRoutes,
  ...definitionRoutes,
  ...peopleRoutes,
  ...searchRoutes,
  ...presentationRoutes,
  ...settingsRoutes,
  ...tokenRoutes,
  ...administeredTokenRoutes,
  ...auditRoutes,
  ...sessionRoutes,
  ...presenceRoutes,
  ...baselineRoutes,
  ...comparisonRoutes,
  ...changesRoutes,
  ...threadRoutes,
  ...inboxRoutes,
  ...suggestionRoutes,
  ...roundRoutes,
  ...restoreRoutes,
  ...templateMoveRoutes,
  ...versionRoutes,
  ...archivalRoutes,
  ...holdRoutes,
  ...deletionRoutes,
  ...retentionRoutes,
  ...workflowRoutes,
  ...erasureRoutes,
  ...usesRoutes,
  ...impactRoutes,
  ...jobRoutes,
  ...cohortRoutes,
  ...relationshipRoutes,
  ...shareRoutes,
  ...queryUsageRoutes,
  ...datasetSourceRoutes,
  ...exportRoutes,
  ...modelEndpointRoutes,
  ...serviceIdentityRoutes,
  ...webhookRoutes,
  ...webhookDeliveryRoutes,
  ...extensionRoutes,
  ...assistantRoutes,
  ...generatedRoutes,
  ...promptRoutes,
  ...bibliographyRoutes,
  ...termRoutes,
  ...translationRoutes,
  ...preferenceRoutes,
  ...importRoutes,
  ...promptLibraryRoutes,
  ...citationStyleRoutes,
  ...referenceSourceRoutes,
  ...promptRunRoutes,
  ...conversationRoutes,
  ...guardrailRoutes,
  ...modelLimitRoutes,
  ...modelBudgetRoutes,
  ...modelUsageRoutes,
  ...embeddingRoutes,
  ...personalPromptRoutes,
  ...rangePreviewRoutes,
} as const satisfies Record<string, RouteContract>;

export const allRoutes: readonly RouteContract[] = Object.values(routes);
