// apps/service/src/cross-tenant.test.ts
import { randomUUID } from 'node:crypto';
import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createArtifact,
  createAssetUpload,
  createDocument,
  createDefinition,
  createGroup,
  createConnection,
  createLibrary,
  createStyle,
  createPrompt,
  createEntry,
  createTerm,
  createImport,
  startConversation,
  setGuardrail,
  savePersonalPrompt,
  createQueryDefinition,
  readPrompt,
  createTemplate,
  readConnection,
  readQueryDefinition,
  recordDatasetVersion,
  createTenant,
  DEFAULT_LAYOUT_ID,
  DEFAULT_THEME_ID,
  duplicateTheme,
  findRole,
  grant,
  invite,
  migrate,
  pendingResult,
  receiveAssetBytes,
  recordAsset,
  makeBaseline,
  makeSuggestion,
  latestVersion,
  openRound,
  startThread,
  recordPublication,
  requestPublication,
  setGroupMembers,
  placeHold,
  uploadForDatasetImage,
  type Tenant,
  type TenantDatabase,
  requestAuditExport,
  requestTenantExport,
  makeModelEndpoint,
  makeProposal,
  startRun,
  submitImpactReport,
  makeRelationship,
  createServiceIdentity,
  createWebhookSubscription,
  installExtension,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import {
  DEFINITION_SCHEMA_VERSION,
  SEED_WORKFLOW,
  TEMPLATE_SCHEMA_VERSION,
  definitionsFor,
  tokenScopes,
  type ComponentTypeDefinition,
  type ContentDocument,
} from '@alloy-works/domain';
import { SEEDED_STYLE_FILES } from '@alloy-works/domain/citations';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const A = 'acme.alloy.test';
const B = 'dev.acme.alloy.test';

const authenticated = allRoutes.filter((route) => route.access.check !== 'none');

/** An editing session and a version id, well formed: what the request's shape needs, and no more. */
const SESSION = '11111111-1111-4111-8111-111111111111';

/** A month from when the suite loads: an expiry any token route accepts. */
const IN_A_MONTH = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

/** A query definition's shape, naming a connection by id: what a route's shape needs. */
const aTerm = {
  schemaVersion: 1,
  base: 'en',
  labels: [{ language: 'en', preferred: 'Probe', alternatives: [] }],
  definition: [],
  broader: [],
  narrower: [],
  related: [],
};

const aPrompt = {
  schemaVersion: 1,
  title: 'Probe',
  description: '',
  instructions: 'Summarise.',
  context: [{ source: 'outline', scope: 'part' }],
  output: { componentType: null },
  models: { purpose: 'drafting', accepts: ['m'] },
};

/** A citation style, Harvard's file under another name. */
const aStyle = {
  schemaVersion: 1,
  name: 'Probe',
  csl: SEEDED_STYLE_FILES['harvard-cite-them-right'],
  requires: {},
};

const aQueryDefinition = (connection: string) => ({
  schemaVersion: 1,
  title: 'Elsewhere',
  description: '',
  connection,
  parameters: [],
  fetch: { kind: 'sql', text: 'select 1 as one' },
  columns: [{ name: 'one', from: { column: 'one' }, type: { base: 'integer' } }],
  key: ['one'],
  order: [{ column: 'one', direction: 'ascending' }],
  empty: 'valid',
  limits: { rows: 10, bytes: 1024, seconds: 5 },
  retired: false,
});

/** A connection's settings any environment takes. */
const aConnection = () => ({
  schemaVersion: 1,
  name: 'Readings',
  description: '',
  type: 'postgres',
  source: {
    host: 'source-postgres',
    port: 5432,
    database: 'readings',
    account: 'reader',
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
});
/** A template definition any environment resolves: the default theme and layout, one section. */
const aTemplate = () => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  name: 'Report',
  theme: DEFAULT_THEME_ID,
  layout: DEFAULT_LAYOUT_ID,
  schemas: [],
  outline: {
    sections: [
      {
        key: 'introduction',
        title: [{ type: 'text', value: 'Introduction', marks: [] }],
        required: false,
        numbered: true,
        matter: 'body',
        pageBreak: 'none',
        children: [],
      },
    ],
  },
  changes: { add: true, remove: true, reorder: true },
});

/**
 * For each route with path parameters: how to name, in its path, something belonging to environment
 * B. A route with parameters must have an entry here, or the harness fails - the case this table
 * exists for is the one a filter would forget (IAM-004).
 */
const OTHER_TENANT_IDS: Readonly<
  Record<string, (tenant: Tenant, db: TenantDatabase) => Promise<Record<string, string>>>
> = {
  getSample: async (tenant, db) => ({
    sampleId: await db.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'grace',
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sample = await trx
        .insertInto('sample')
        .values({ requested_by: principal.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      return sample.id;
    }),
  }),
  listComponentTypes: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  createComponent: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  getComponent: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  listComponentVersions: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  createDocument: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  getDocument: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  editOutline: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  recordDocumentValues: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getDocumentParameters: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  recordDocumentParameters: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  recordDocumentProfile: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  recordDocumentFallback: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getNumbering: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getDocumentPresentation: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getContributions: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getDocumentTexts: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  requestPublication: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  requestPreview: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  requestRangePreview: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  startAssistantRun: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getConversation: async (tenant, db) => ({ id: await conversationIdIn(tenant, db) }),
  updateConversation: async (tenant, db) => ({ id: await conversationIdIn(tenant, db) }),
  getConversationContext: async (tenant, db) => ({ id: await conversationIdIn(tenant, db) }),
  changePersonalPrompt: async (tenant, db) => ({ id: await personalPromptIdIn(tenant, db) }),
  removePersonalPrompt: async (tenant, db) => ({ id: await personalPromptIdIn(tenant, db) }),
  promotePersonalPrompt: async (tenant, db) => ({ id: await personalPromptIdIn(tenant, db) }),
  addConversationContext: async (tenant, db) => ({ id: await conversationIdIn(tenant, db) }),
  removeConversationContext: async (tenant, db) => ({
    id: await conversationIdIn(tenant, db),
    component: await componentIdIn(tenant, db),
  }),
  retireGuardrail: async (tenant, db) =>
    db.withTenant(tenant, async (trx) => {
      const owner = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: `ivy-${randomUUID()}`,
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        id: (
          await setGuardrail(trx, { phrase: 'Theirs', applies: 'sent', reason: 'Theirs' }, owner.id)
        ).id,
      };
    }),
  takeTurn: async (tenant, db) => ({ id: await conversationIdIn(tenant, db) }),
  setPersonLimit: async (tenant, db) =>
    db.withTenant(tenant, async (trx) => ({
      principal: (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: `ivy-${randomUUID()}`,
            email: null,
            display_name: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id,
    })),
  listDocumentPrompts: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  startPromptRun: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  startPromptTrial: async (tenant, db) => {
    const id = await promptIdIn(tenant, db);
    const version = await db.withTenant(
      tenant,
      async (trx) => (await readPrompt(trx, id))!.version.id,
    );
    return { id, version };
  },
  getDocumentGenerated: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getPublicationGenerated: async (tenant, db) => ({
    id: (await publicationIn(tenant, db)).publication,
  }),
  getAssistantRun: async (tenant, db) => ({ id: (await assistantIn(tenant, db)).run }),
  acceptProposal: async (tenant, db) => ({ id: (await assistantIn(tenant, db)).proposal }),
  keepProposal: async (tenant, db) => ({ id: (await assistantIn(tenant, db)).proposal }),
  discardProposal: async (tenant, db) => ({ id: (await assistantIn(tenant, db)).proposal }),
  getRangePreview: async (tenant, db) => ({ id: await documentIdIn(tenant, db), range: SESSION }),
  refreshRangePreview: async (tenant, db) => ({
    id: await documentIdIn(tenant, db),
    range: SESSION,
  }),
  getRangePage: async (tenant, db) => ({
    id: await documentIdIn(tenant, db),
    range: SESSION,
    page: '1',
  }),
  getPublicationRequest: async (tenant, db) => ({ id: (await publicationIn(tenant, db)).request }),
  listPublications: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getPublication: async (tenant, db) => ({ id: (await publicationIn(tenant, db)).publication }),
  getPublicationBindings: async (tenant, db) => ({
    id: (await publicationIn(tenant, db)).publication,
  }),
  listPublicationShares: async (tenant, db) => ({
    id: (await publicationIn(tenant, db)).publication,
  }),
  sharePublication: async (tenant, db) => ({ id: (await publicationIn(tenant, db)).publication }),
  revokePublicationShare: async (tenant, db) => ({
    id: (await publicationIn(tenant, db)).publication,
    share: '00000000-0000-4000-8000-000000000001',
  }),
  getSharedOutput: async (tenant, db) => ({
    id: (await publicationIn(tenant, db)).publication,
    format: 'pdf',
  }),
  makeBaseline: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  listBaselines: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getBaseline: async (tenant, db) => ({ id: await baselineIn(tenant, db) }),
  getBaselineView: async (tenant, db) => ({ id: await baselineIn(tenant, db) }),
  listBaselineThreads: async (tenant, db) => ({ id: await baselineIn(tenant, db) }),
  compareComponentVersions: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  compareBaseline: async (tenant, db) => ({ id: await baselineIn(tenant, db) }),
  compareBaselineResolved: async (tenant, db) => ({ id: await baselineIn(tenant, db) }),
  publishBaseline: async (tenant, db) => ({ id: await baselineIn(tenant, db) }),
  supersedeBaseline: async (tenant, db) => ({ id: await baselineIn(tenant, db) }),
  startComponentThread: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  listComponentThreads: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  startDocumentThread: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  listDocumentThreads: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getThread: async (tenant, db) => ({ id: await threadIn(tenant, db) }),
  addComment: async (tenant, db) => ({ id: await threadIn(tenant, db) }),
  editComment: async (tenant, db) => ({ id: await threadIn(tenant, db), comment: SESSION }),
  resolveThread: async (tenant, db) => ({ id: await threadIn(tenant, db) }),
  markThreadInternal: async (tenant, db) => ({ id: await threadIn(tenant, db) }),
  makeSuggestion: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  listComponentSuggestions: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  listDocumentSuggestions: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getSuggestion: async (tenant, db) => ({ id: await suggestionIn(tenant, db) }),
  acceptSuggestion: async (tenant, db) => ({ id: await suggestionIn(tenant, db) }),
  rejectSuggestion: async (tenant, db) => ({ id: await suggestionIn(tenant, db) }),
  withdrawSuggestion: async (tenant, db) => ({ id: await suggestionIn(tenant, db) }),
  openRound: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  listRounds: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getRound: async (tenant, db) => ({ id: await roundIn(tenant, db) }),
  closeRound: async (tenant, db) => ({ id: await roundIn(tenant, db) }),
  startReview: async (tenant, db) => ({ id: await roundIn(tenant, db) }),
  completeReview: async (tenant, db) => ({ id: await roundIn(tenant, db) }),
  reopenReview: async (tenant, db) => ({ id: await roundIn(tenant, db) }),
  markNotificationRead: async (tenant, db) => ({ id: await notificationIn(tenant, db) }),
  deleteNotification: async (tenant, db) => ({ id: await notificationIn(tenant, db) }),
  claimLock: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  takeLock: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  releaseLock: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  cutVersion: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  discardUnsaved: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  saveIteration: async (tenant, db) => ({
    id: await componentIdIn(tenant, db),
    session: SESSION,
    sequence: '1',
  }),
  listIterations: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  getIteration: async (tenant, db) => ({ id: await componentIdIn(tenant, db), iteration: SESSION }),
  previewRestore: async (tenant, db) => componentVersionIn(tenant, db),
  getComponentVersion: async (tenant, db) => componentVersionIn(tenant, db),
  getDocumentVersion: async (tenant, db) => documentVersionIn(tenant, db),
  // A version environment B has made and this one has not.
  getWorkflowVersion: async (tenant, db) => {
    await db.withTenant(tenant, (trx) =>
      trx
        .insertInto('workflow_definition')
        .values({ kind: 'component', version_no: 3, body: JSON.stringify(SEED_WORKFLOW), by: null })
        .execute(),
    );
    return { kind: 'component', version: '3' };
  },
  transitionComponent: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  transitionDocument: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  decideComponentGate: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  decideDocumentGate: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  setComponentDates: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  previewTemplateMove: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  moveDocumentTemplate: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  setDocumentDates: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  setComponentScope: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  setDocumentScope: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  acceptComponentRevision: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  acceptDocumentRevision: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  listComponentApprovals: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  listDocumentApprovals: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  readComponentEffective: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  previewComponentCitations: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  previewComponentTerms: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  divergeComponent: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  listComponentTranslations: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  getSpaceTranslations: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  beginComponentTranslation: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  markComponentTranslationCurrent: async (tenant, db) => ({
    id: await componentIdIn(tenant, db),
    line: '00000000-0000-4000-8000-000000000001',
  }),
  getComponentTranslationChanges: async (tenant, db) => ({
    id: await componentIdIn(tenant, db),
    line: '00000000-0000-4000-8000-000000000001',
  }),
  draftComponentTranslation: async (tenant, db) => ({
    id: await componentIdIn(tenant, db),
    line: '00000000-0000-4000-8000-000000000001',
  }),
  acceptComponentMachineDraft: async (tenant, db) => ({
    id: await componentIdIn(tenant, db),
    line: '00000000-0000-4000-8000-000000000001',
  }),
  declareComponentSourceChange: async (tenant, db) => ({
    id: await componentIdIn(tenant, db),
    version: '00000000-0000-4000-8000-000000000001',
  }),
  listDocumentTranslationJobs: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  makeDocumentTranslationJob: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  downloadDocumentTranslationJob: async (tenant, db) => ({
    id: await documentIdIn(tenant, db),
    job: '00000000-0000-4000-8000-000000000001',
  }),
  closeDocumentTranslationJob: async (tenant, db) => ({
    id: await documentIdIn(tenant, db),
    job: '00000000-0000-4000-8000-000000000001',
  }),
  returnDocumentTranslationJob: async (tenant, db) => ({
    id: await documentIdIn(tenant, db),
    job: '00000000-0000-4000-8000-000000000001',
  }),
  getDocumentTranslationJobHeld: async (tenant, db) => ({
    id: await documentIdIn(tenant, db),
    job: '00000000-0000-4000-8000-000000000001',
    component: '00000000-0000-4000-8000-000000000001',
  }),
  decideDocumentTranslationJobItem: async (tenant, db) => ({
    id: await documentIdIn(tenant, db),
    job: '00000000-0000-4000-8000-000000000001',
    component: '00000000-0000-4000-8000-000000000001',
  }),
  listComponentLines: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  compareComponentLine: async (tenant, db) => ({
    id: await componentIdIn(tenant, db),
    line: '00000000-0000-4000-8000-000000000001',
  }),
  bringComponentLineBack: async (tenant, db) => ({
    id: await componentIdIn(tenant, db),
    line: '00000000-0000-4000-8000-000000000001',
  }),
  readDocumentEffective: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  archiveComponent: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  unarchiveComponent: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  archiveDocument: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  unarchiveDocument: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getComponentDeletion: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  getComponentUses: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  getArtifactImpact: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  getArtifactReferences: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  getArtifactRelationships: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  getArtifactPath: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  previewPlacement: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  submitImpactReport: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  getJob: async (tenant, db) => ({ id: await jobIn(tenant, db) }),
  submitCohort: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  getCohort: async (tenant, db) => ({ id: await cohortIn(tenant, db) }),
  getRelationship: async (tenant, db) => ({ id: await relationshipIn(tenant, db) }),
  changeRelationship: async (tenant, db) => ({ id: await relationshipIn(tenant, db) }),
  removeRelationship: async (tenant, db) => ({ id: await relationshipIn(tenant, db) }),
  rerunCohort: async (tenant, db) => ({ id: await cohortIn(tenant, db) }),
  cancelJob: async (tenant, db) => ({ id: await jobIn(tenant, db) }),
  downloadJob: async (tenant, db) => ({ id: await jobIn(tenant, db) }),
  placeSection: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  deleteComponent: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  undeleteComponent: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  getDocumentDeletion: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  deleteDocument: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  undeleteDocument: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  listDocumentVersions: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  previewDocumentRestore: async (tenant, db) => documentVersionIn(tenant, db),
  restoreDocumentVersion: async (tenant, db) => documentVersionIn(tenant, db),
  restoreVersion: async (tenant, db) => componentVersionIn(tenant, db),
  removeGrant: async (tenant, db) => ({ id: await grantIdIn(tenant, db) }),
  extendGrant: async (tenant, db) => ({ id: await grantIdIn(tenant, db) }),
  createAssetUpload: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  putAssetUploadBytes: async (tenant, db) => ({ id: (await assetIn(tenant, db)).upload }),
  getAssetUpload: async (tenant, db) => ({ id: (await assetIn(tenant, db)).upload }),
  getAssetVersion: async (tenant, db) => ({ id: (await assetIn(tenant, db)).version }),
  getAssetVersionContent: async (tenant, db) => ({ id: (await assetIn(tenant, db)).version }),
  getAssetRights: async (tenant, db) => ({ id: (await assetIn(tenant, db)).asset }),
  getAssetUses: async (tenant, db) => ({ id: (await assetIn(tenant, db)).asset }),
  listSpaceAssets: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  setAssetRights: async (tenant, db) => ({ id: (await assetIn(tenant, db)).asset }),
  createAssetReplacement: async (tenant, db) => ({ id: (await assetIn(tenant, db)).asset }),
  getAssetVersionDerivative: async (tenant, db) => ({
    id: (await assetIn(tenant, db)).version,
    kind: 'thumbnail',
  }),
  discardAssetDerivatives: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  withdrawInvitation: async (tenant, db) => ({ id: await invitationIdIn(tenant, db) }),
  setGroupMembers: async (tenant, db) => ({ id: await groupIdIn(tenant, db) }),
  deleteGroup: async (tenant, db) => ({ id: await groupIdIn(tenant, db) }),
  releaseHold: async (tenant, db) => ({ id: await holdIdIn(tenant, db) }),
  getAuditExport: async (tenant, db) => ({ id: await auditExportIdIn(tenant, db) }),
  downloadAuditExport: async (tenant, db) => ({ id: await auditExportIdIn(tenant, db) }),
  getTenantExport: async (tenant, db) => ({ id: await tenantExportIdIn(tenant, db) }),
  downloadTenantExport: async (tenant, db) => ({ id: await tenantExportIdIn(tenant, db) }),
  getModelEndpoint: async (tenant, db) => ({ id: await modelEndpointIdIn(tenant, db) }),
  changeModelEndpoint: async (tenant, db) => ({ id: await modelEndpointIdIn(tenant, db) }),
  retireModelEndpoint: async (tenant, db) => ({ id: await modelEndpointIdIn(tenant, db) }),
  setModelEndpointKey: async (tenant, db) => ({ id: await modelEndpointIdIn(tenant, db) }),
  testModelEndpoint: async (tenant, db) => ({ id: await modelEndpointIdIn(tenant, db) }),
  // A purpose is no artifact of either environment: the target is the endpoint its body names, B's.
  setModelRoute: async () => ({ purpose: 'drafting' }),
  updateSpace: async (tenant, db) => ({ id: await spaceIdIn(tenant, db) }),
  createTemplate: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  getTemplate: async (tenant, db) => ({ id: await templateIdIn(tenant, db) }),
  recordTemplateVersion: async (tenant, db) => ({ id: await templateIdIn(tenant, db) }),
  getBridgeSettings: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  disconnectCtStudio: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  putBridgeSettings: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  createConnection: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  getConnection: async (tenant, db) => ({ id: await connectionIdIn(tenant, db) }),
  recordConnectionVersion: async (tenant, db) => ({ id: await connectionIdIn(tenant, db) }),
  setConnectionCredential: async (tenant, db) => ({ id: await connectionIdIn(tenant, db) }),
  testConnection: async (tenant, db) => ({ id: await connectionIdIn(tenant, db) }),
  describeConnection: async (tenant, db) => ({ id: await connectionIdIn(tenant, db) }),
  sampleConnection: async (tenant, db) => ({ id: await connectionIdIn(tenant, db) }),
  getConnectionUses: async (tenant, db) => ({ id: await connectionIdIn(tenant, db) }),
  getQueryDefinitionUses: async (tenant, db) => ({ id: await queryDefinitionIdIn(tenant, db) }),
  getDocumentBindings: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  resolveBindings: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  checkBindings: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  acceptBinding: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  confirmBinding: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  reviseBinding: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getBindingHolders: async (tenant, db) => ({ id: await componentIdIn(tenant, db), binding: 'b1' }),
  getDocumentDataset: async (tenant, db) => ({
    id: await documentIdIn(tenant, db),
    version: (await datasetIn(tenant, db)).version,
  }),
  getBoundTableRows: async (tenant, db) => ({
    id: await documentIdIn(tenant, db),
    node: 'a'.repeat(26),
    binding: 'b1',
  }),
  nameDataset: async (tenant, db) => ({ id: (await datasetIn(tenant, db)).dataset }),
  sampleDataset: async (tenant, db) => ({ id: (await datasetIn(tenant, db)).dataset }),
  getPendingResult: async (tenant, db) => ({ id: await pendingIn(tenant, db) }),
  createQueryDefinition: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  createPrompt: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  listBibliographyEntries: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  createBibliographyEntry: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  importBibliographyEntries: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  exportBibliographyEntries: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  getBibliographyEntry: async (tenant, db) => ({ id: await entryIdIn(tenant, db) }),
  recordBibliographyEntryVersion: async (tenant, db) => ({ id: await entryIdIn(tenant, db) }),
  getBibliographyEntryUses: async (tenant, db) => ({ id: await entryIdIn(tenant, db) }),
  archiveBibliographyEntry: async (tenant, db) => ({ id: await entryIdIn(tenant, db) }),
  unarchiveBibliographyEntry: async (tenant, db) => ({ id: await entryIdIn(tenant, db) }),
  listTerms: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  createTerm: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  createImport: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  listImports: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  putImportFile: async (tenant, db) => ({ id: await importIdIn(tenant, db) }),
  getImport: async (tenant, db) => ({ id: await importIdIn(tenant, db) }),
  setImportLevels: async (tenant, db) => ({ id: await importIdIn(tenant, db) }),
  setImportKind: async (tenant, db) => ({ id: await importIdIn(tenant, db) }),
  getImportPart: async (tenant, db) => ({ id: await importIdIn(tenant, db), part: randomUUID() }),
  searchImportParts: async (tenant, db) => ({ id: await importIdIn(tenant, db) }),
  editImport: async (tenant, db) => ({ id: await importIdIn(tenant, db) }),
  setImportPlace: async (tenant, db) => ({ id: await importIdIn(tenant, db) }),
  acceptImport: async (tenant, db) => ({ id: await importIdIn(tenant, db) }),
  abandonImport: async (tenant, db) => ({ id: await importIdIn(tenant, db) }),
  importTerms: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  exportTerms: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  getTerm: async (tenant, db) => ({ id: await termIdIn(tenant, db) }),
  recordTermVersion: async (tenant, db) => ({ id: await termIdIn(tenant, db) }),
  getTermUses: async (tenant, db) => ({ id: await termIdIn(tenant, db) }),
  archiveTerm: async (tenant, db) => ({ id: await termIdIn(tenant, db) }),
  unarchiveTerm: async (tenant, db) => ({ id: await termIdIn(tenant, db) }),
  transitionTerm: async (tenant, db) => ({ id: await termIdIn(tenant, db) }),
  decideTermGate: async (tenant, db) => ({ id: await termIdIn(tenant, db) }),
  listTermApprovals: async (tenant, db) => ({ id: await termIdIn(tenant, db) }),
  getPrompt: async (tenant, db) => ({ id: await promptIdIn(tenant, db) }),
  recordPromptVersion: async (tenant, db) => ({ id: await promptIdIn(tenant, db) }),
  getPromptLibrary: async (tenant, db) => ({ id: await libraryIdIn(tenant, db) }),
  recordPromptLibraryVersion: async (tenant, db) => ({ id: await libraryIdIn(tenant, db) }),
  getCitationStyle: async (tenant, db) => ({ id: await styleIdIn(tenant, db) }),
  recordCitationStyleVersion: async (tenant, db) => ({ id: await styleIdIn(tenant, db) }),
  // A source is the product's, the same in every environment; what is asked of it is the tenant's.
  searchReferenceSource: () => Promise.resolve({ source: 'crossref' }),
  createBibliographyEntryFromSource: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  checkBibliographyEntry: async (tenant, db) => ({ id: await entryIdIn(tenant, db) }),
  getDocumentFlaggedSources: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getQueryDefinition: async (tenant, db) => ({ id: await queryDefinitionIdIn(tenant, db) }),
  transitionQueryDefinition: async (tenant, db) => ({ id: await queryDefinitionIdIn(tenant, db) }),
  decideQueryDefinitionGate: async (tenant, db) => ({ id: await queryDefinitionIdIn(tenant, db) }),
  listQueryDefinitionApprovals: async (tenant, db) => ({
    id: await queryDefinitionIdIn(tenant, db),
  }),
  transitionPrompt: async (tenant, db) => ({ id: await promptIdIn(tenant, db) }),
  decidePromptGate: async (tenant, db) => ({ id: await promptIdIn(tenant, db) }),
  listPromptApprovals: async (tenant, db) => ({ id: await promptIdIn(tenant, db) }),
  recordQueryDefinitionVersion: async (tenant, db) => ({
    id: await queryDefinitionIdIn(tenant, db),
  }),
  getDefinition: async (tenant, db) => ({ id: await definitionIdIn(tenant, db) }),
  recordDefinitionVersion: async (tenant, db) => ({ id: await definitionIdIn(tenant, db) }),
  getVocabulary: async (tenant, db) => ({ id: await definitionIdIn(tenant, db) }),
  exportVocabulary: async (tenant, db) => ({ id: await definitionIdIn(tenant, db) }),
  getVocabularyUses: async (tenant, db) => ({ id: await definitionIdIn(tenant, db) }),
  refreshVocabulary: async (tenant, db) => ({ id: await definitionIdIn(tenant, db) }),
  getLicence: async (tenant, db) => ({ id: await definitionIdIn(tenant, db) }),
  // A theme of the other environment's own: its default's id is every environment's (0024).
  getTheme: async (tenant, db) => ({ id: await themeIdIn(tenant, db) }),
  saveThemeStyle: async (tenant, db) => ({
    id: await themeIdIn(tenant, db),
    kind: 'paragraph',
    style: 'body',
  }),
  deleteThemeStyle: async (tenant, db) => ({
    id: await themeIdIn(tenant, db),
    kind: 'paragraph',
    style: 'body',
  }),
  getStyleImpact: async (tenant, db) => ({ id: await themeIdIn(tenant, db) }),
  revokeToken: async (tenant, db) => ({ id: (await tokenIn(tenant, db)).token }),
  endSession: async (tenant, db) => ({ id: await sessionIn(tenant, db) }),
  leavePresence: async () => ({ viewer: '55555555-5555-4555-8555-555555555555' }),
  listPrincipalTokens: async (tenant, db) => ({ id: (await tokenIn(tenant, db)).principal }),
  getErasure: async (tenant, db) => ({ id: (await tokenIn(tenant, db)).principal }),
  erasePrincipal: async (tenant, db) => ({ id: (await tokenIn(tenant, db)).principal }),
  revokePrincipalToken: async (tenant, db) => {
    const { principal, token } = await tokenIn(tenant, db);
    return { id: principal, token };
  },
  getExtension: async (tenant, db) => ({ id: await extensionIn(tenant, db) }),
  previewExtensionUpdate: async (tenant, db) => ({ id: await extensionIn(tenant, db) }),
  updateExtension: async (tenant, db) => ({ id: await extensionIn(tenant, db) }),
  listExtensionUses: async (tenant, db) => ({ id: await extensionIn(tenant, db) }),
  removeExtension: async (tenant, db) => ({ id: await extensionIn(tenant, db) }),
  setExtensionSecret: async (tenant, db) => ({ id: await extensionIn(tenant, db) }),
  getWebhook: async (tenant, db) => ({ id: await webhookIn(tenant, db) }),
  changeWebhook: async (tenant, db) => ({ id: await webhookIn(tenant, db) }),
  rotateWebhookSecret: async (tenant, db) => ({ id: await webhookIn(tenant, db) }),
  removeWebhook: async (tenant, db) => ({ id: await webhookIn(tenant, db) }),
  listWebhookDeliveries: async (tenant, db) => ({ id: await webhookIn(tenant, db) }),
  getWebhookDelivery: async (tenant, db) => ({
    id: await webhookIn(tenant, db),
    delivery: '55555555-5555-4555-8555-555555555555',
  }),
  changeServiceIdentity: async (tenant, db) => ({ id: await serviceIdentityIn(tenant, db) }),
  disableServiceIdentity: async (tenant, db) => ({ id: await serviceIdentityIn(tenant, db) }),
  issueServiceIdentityToken: async (tenant, db) => ({ id: await serviceIdentityIn(tenant, db) }),
};

/**
 * For each route taking a body, or a query that is not its target: a valid one, so that what the harness
 * sees is the environment's refusal and never the request's shape. A route with a body missing here
 * fails the harness.
 */
const VALID_INPUT: Readonly<
  Record<string, { readonly query?: string; readonly payload?: Record<string, unknown> }>
> = {
  createComponent: {
    payload: { title: 'Elsewhere', language: 'en-GB', direction: 'ltr' },
  },
  createDocument: { payload: { title: 'Elsewhere', language: 'en-GB', direction: 'ltr' } },
  createTemplate: { payload: { definition: aTemplate() } },
  recordTemplateVersion: { payload: { openedFrom: SESSION, definition: aTemplate() } },
  createConnection: { payload: { settings: aConnection() } },
  recordConnectionVersion: { payload: { openedFrom: SESSION, settings: aConnection() } },
  setConnectionCredential: { payload: { secret: 'an-invented-password' } },
  testConnection: { payload: {} },
  describeConnection: { payload: {} },
  sampleConnection: {
    payload: {
      definition: (({ title: _t, description: _d, retired: _r, ...draft }) => draft)(
        aQueryDefinition(SESSION),
      ),
      values: {},
    },
  },
  createQueryDefinition: { payload: { definition: aQueryDefinition(SESSION) } },
  resolveBindings: { payload: { bindings: [{ node: 'a'.repeat(26), binding: 'b1' }] } },
  checkBindings: { payload: {} },
  acceptBinding: {
    payload: { node: 'a'.repeat(26), binding: 'b1', version: SESSION, replaces: SESSION },
  },
  confirmBinding: { payload: { node: 'a'.repeat(26), binding: 'b1', replaces: SESSION } },
  reviseBinding: {
    payload: {
      node: 'a'.repeat(26),
      binding: 'b1',
      act: 'revise',
      value: '1',
      reason: 'Elsewhere',
      resolution: '1',
      replaces: null,
    },
  },
  nameDataset: { payload: { name: 'Elsewhere' } },
  sampleDataset: {
    payload: {
      definition: {
        schemaVersion: 1,
        parameters: [],
        fetch: {
          kind: 'dataset',
          format: 1,
          dataset: '00000000-0000-4000-8000-000000000001',
          query: {
            sources: [{ alias: 'd', table: { schema: 'dataset', name: 'rows' } }],
            joins: [],
            select: [{ name: 'id', of: { source: 'd', column: 'id' } }],
            groupBy: [],
          },
        },
        columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
        key: [],
        order: 'multiset',
        empty: 'valid',
        limits: { rows: 10, bytes: 1000, seconds: 5 },
      },
      values: {},
    },
  },
  recordQueryDefinitionVersion: {
    payload: { openedFrom: SESSION, definition: aQueryDefinition(SESSION) },
  },
  createPrompt: { payload: { prompt: aPrompt } },
  createBibliographyEntry: { payload: { entry: { csl: { type: 'book', title: 'Probe' } } } },
  importBibliographyEntries: { payload: { format: 'csl-json', text: '[]' } },
  exportBibliographyEntries: { query: 'format=bibtex' },
  createTerm: { payload: { term: aTerm } },
  createImport: { payload: { fileName: 'Elsewhere.docx', fileType: 'docx' } },
  setImportLevels: { payload: { revision: 0, section: 1, component: 2 } },
  setImportKind: { payload: { revision: 0, kind: 'first' } },
  editImport: { payload: { revision: 0, edit: { edit: 'merge', part: SESSION } } },
  setImportPlace: { payload: { part: SESSION } },
  acceptImport: { payload: { revision: 0 } },
  importTerms: { payload: { format: 'json-ld', text: '{"@graph": []}' } },
  importVocabulary: { payload: { format: 'json-ld', text: '{"@graph": []}' } },
  saveThemeStyle: { payload: { openedFrom: SESSION, style: { id: 'body' } } },
  deleteThemeStyle: { query: `openedFrom=${SESSION}` },
  getStyleImpact: { payload: { kind: 'paragraph', style: 'body' } },
  recordTermVersion: { payload: { openedFrom: SESSION, term: aTerm } },
  transitionTerm: { payload: { transition: 'deprecate', from: 'approved', reason: 'Probe' } },
  decideTermGate: {
    payload: { transition: 'approve', version: SESSION, decision: 'approved' },
  },
  recordBibliographyEntryVersion: {
    payload: { openedFrom: SESSION, entry: { csl: { type: 'book', title: 'Probe' } } },
  },
  recordPromptVersion: { payload: { openedFrom: SESSION, prompt: aPrompt } },
  createPromptLibrary: { payload: { library: { schemaVersion: 1, name: 'Probe', prompts: [] } } },
  createCitationStyle: { payload: { style: aStyle } },
  previewCitationStyle: { payload: { csl: aStyle.csl } },
  previewComponentCitations: { payload: { citations: [] } },
  previewComponentTerms: { payload: { terms: [] } },
  recordCitationStyleVersion: { payload: { openedFrom: SESSION, style: aStyle } },
  setReferenceSource: { payload: { source: 'crossref', enabled: false } },
  searchReferenceSource: { payload: { space: `space:${SESSION}`, terms: 'Probe' } },
  createBibliographyEntryFromSource: {
    payload: { source: 'crossref', identifier: '10.5555/probe' },
  },
  recordPromptLibraryVersion: {
    payload: { openedFrom: SESSION, library: { schemaVersion: 1, name: 'Probe', prompts: [] } },
  },
  setDataSettings: { payload: { rows: 10 } },
  createDefinition: {
    payload: {
      kind: 'field',
      definition: {
        schemaVersion: 1,
        name: 'Probe',
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      },
    },
  },
  recordDefinitionVersion: {
    payload: {
      openedFrom: SESSION,
      definition: {
        schemaVersion: 1,
        name: 'Probe',
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      },
    },
  },
  createAssetUpload: { payload: { alternative: null } },
  editOutline: {
    payload: {
      openedFrom: SESSION,
      operation: { operation: 'remove', node: 'a'.repeat(26) },
    },
  },
  placeSection: {
    payload: {
      openedFrom: SESSION,
      from: SESSION,
      fromVersion: SESSION,
      section: 'x',
      parent: null,
      position: 0,
      title: [{ type: 'text', value: 'Upkeep', marks: [] }],
      mode: 'latest',
    },
  },
  recordDocumentValues: { payload: { openedFrom: SESSION, values: {} } },
  recordDocumentParameters: { payload: { openedFrom: SESSION, parameters: {} } },
  recordDocumentProfile: { payload: { openedFrom: SESSION, profile: null } },
  recordDocumentFallback: { payload: { openedFrom: SESSION, fallback: null } },
  claimLock: { payload: { session: SESSION } },
  takeLock: { payload: { session: SESSION } },
  requestPublication: { payload: { version: SESSION, formats: ['pdf'] } },
  requestPreview: { payload: { version: SESSION } },
  requestRangePreview: {
    payload: { version: SESSION, node: 'aaaaaaaaaaaaaaaaaaaaaaaaaa', session: SESSION },
  },
  makeBaseline: { payload: { version: SESSION, name: 'Elsewhere' } },
  supersedeBaseline: { payload: { by: SESSION } },
  startComponentThread: {
    payload: { version: SESSION, anchor: { kind: 'component' }, parts: [{ text: 'Hm' }] },
  },
  startDocumentThread: {
    payload: { version: SESSION, anchor: { kind: 'component' }, parts: [{ text: 'Hm' }] },
  },
  addComment: { payload: { parts: [{ text: 'Hm' }] } },
  makeSuggestion: { payload: { version: SESSION, content: { title: 'Elsewhere' } } },
  resolveSuggestions: { payload: { act: 'reject', scope: `artifact:${SESSION}` } },
  openRound: {
    payload: {
      title: 'Elsewhere',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      reviewers: [SESSION],
    },
  },
  completeReview: { payload: { outcome: 'commented' } },
  editComment: { payload: { parts: [{ text: 'Hm' }] } },
  setInboxPreferences: { payload: { mention: 'daily' } },
  setMyPreferences: { payload: { interfaceLanguage: null } },
  publishBaseline: { payload: { formats: ['pdf'] } },
  compareComponentVersions: { query: `from=${SESSION}&to=${SESSION}` },
  compareBaseline: { query: 'with=now' },
  compareBaselineResolved: { query: 'with=now' },
  previewTemplateMove: { query: `to=${SESSION}` },
  getArtifactImpact: { query: 'depth=1' },
  getArtifactPath: { query: `to=${SESSION}&depth=1` },
  submitImpactReport: { payload: { depth: 1 } },
  submitCohort: {
    payload: {
      template: SESSION,
      title: 'Report',
      language: 'en-GB',
      direction: 'ltr',
      rows: [{}],
    },
  },
  rerunCohort: { payload: {} },
  makeRelationship: {
    payload: { type: SESSION, from: { artifact: SESSION }, to: { artifact: SESSION } },
  },
  changeRelationship: { payload: { values: {} } },
  previewPlacement: { query: `from=${SESSION}&section=x` },
  listChangesSince: { query: `since=2000-01-01T00:00:00Z&space=${SESSION}` },
  releaseLock: { query: `session=${SESSION}&openedFrom=${SESSION}` },
  listIterations: { query: `session=${SESSION}` },
  getIteration: { query: `session=${SESSION}` },
  getBoundTableRows: { query: `version=${SESSION}` },
  cutVersion: { payload: { session: SESSION, openedFrom: SESSION } },
  restoreVersion: { payload: { latest: SESSION } },
  restoreDocumentVersion: { payload: { latest: SESSION } },
  discardUnsaved: { payload: { upTo: '2026-10-10T17:18:43.000Z' } },
  invite: { payload: { email: 'ivy@example.com' } },
  createGroup: { payload: { name: 'Elsewhere' } },
  placeHold: { payload: { target: { space: SESSION }, reason: 'Elsewhere' } },
  releaseHold: { payload: { reason: 'Elsewhere' } },
  setRetention: { payload: { kind: null, space: SESSION, days: 5 } },
  defineWorkflow: {
    payload: {
      kind: 'component',
      states: [{ key: 'draft', name: 'Draft', initial: true }],
      transitions: [],
    },
  },
  transitionComponent: { payload: { transition: 'submit', from: 'draft' } },
  transitionDocument: { payload: { transition: 'submit', from: 'draft' } },
  decideComponentGate: {
    payload: { transition: 'approve', version: SESSION, decision: 'approved' },
  },
  decideDocumentGate: {
    payload: { transition: 'approve', version: SESSION, decision: 'approved' },
  },
  transitionQueryDefinition: { payload: { transition: 'submit', from: 'draft' } },
  transitionPrompt: { payload: { transition: 'submit', from: 'draft' } },
  setComponentDates: { payload: { effectiveAt: null, reviewBy: '2030-01-01', owner: null } },
  moveDocumentTemplate: { payload: { latest: SESSION, to: SESSION } },
  setDocumentDates: { payload: { effectiveAt: null, reviewBy: '2030-01-01', owner: null } },
  setComponentScope: { payload: { scope: [] } },
  setDocumentScope: { payload: { scope: [] } },
  acceptComponentRevision: { payload: { revision: 1, axis: 'market', value: 'us' } },
  divergeComponent: { payload: { revision: 1, name: 'US' } },
  beginComponentTranslation: { payload: { language: 'fr-FR' } },
  markComponentTranslationCurrent: {
    payload: { translates: '00000000-0000-4000-8000-000000000001' },
  },
  declareComponentSourceChange: { payload: { retranslate: false } },
  makeDocumentTranslationJob: { payload: { language: 'fr-FR' } },
  decideDocumentTranslationJobItem: { payload: { decision: 'reject' } },
  sharePublication: { payload: { email: 'iris@example.net' } },
  bringComponentLineBack: {
    payload: {
      openedFrom: '00000000-0000-4000-8000-000000000001',
      lineHead: '00000000-0000-4000-8000-000000000001',
      carry: [],
    },
  },
  acceptDocumentRevision: { payload: { revision: 1, axis: 'market', value: 'us' } },
  decideQueryDefinitionGate: {
    payload: { transition: 'approve', version: SESSION, decision: 'approved' },
  },
  decidePromptGate: {
    payload: { transition: 'approve', version: SESSION, decision: 'approved' },
  },
  requestAuditExport: { payload: {} },
  requestTenantExport: { payload: {} },
  startAssistantRun: { payload: { ask: 'Hello' } },
  startConversation: { payload: { title: 'Hello' } },
  updateConversation: { payload: { kept: true } },
  setGuardrail: { payload: { phrase: 'Probe', applies: 'sent', reason: 'Probe' } },
  setModelLimit: { payload: { perHour: 10 } },
  setPersonLimit: { payload: { perHour: 10 } },
  setModelBudget: { payload: { budget: null } },
  setBudgetRecipients: { payload: { principals: [] } },
  confirmEmbedding: { payload: { model: 'm' } },
  takeTurn: { payload: { ask: 'Hello' } },
  addConversationContext: { payload: { component: SESSION } },
  savePersonalPrompt: { payload: { title: 'Mine', instructions: 'Mine.' } },
  changePersonalPrompt: { payload: { title: 'Mine', instructions: 'Mine.' } },
  promotePersonalPrompt: {
    payload: {
      space: SESSION,
      context: [{ source: 'outline', scope: 'part' }],
      output: { componentType: null },
      models: { purpose: 'drafting', accepts: ['m'] },
    },
  },
  startPromptRun: { payload: { prompt: SESSION, node: 'n1' } },
  startPromptTrial: { payload: { document: SESSION, node: 'n1' } },
  makeModelEndpoint: {
    payload: {
      name: 'Elsewhere',
      protocol: 'anthropic',
      baseUrl: 'https://models.example.test',
      model: 'claude-test',
      contextWindow: 200000,
      priceIn: 0,
      priceOut: 0,
      currency: 'USD',
      boundary: 'outside',
    },
  },
  changeModelEndpoint: {
    payload: {
      name: 'Elsewhere',
      protocol: 'anthropic',
      baseUrl: 'https://models.example.test',
      model: 'claude-test',
      contextWindow: 200000,
      priceIn: 0,
      priceOut: 0,
      currency: 'USD',
      boundary: 'outside',
    },
  },
  setModelEndpointKey: { payload: { key: 'an-invented-key' } },
  // The endpoint a route's body names is looked for in this environment alone: one not there, as
  // another environment's is not, is not found.
  setModelRoute: { payload: { endpoint: '7e1d0c5a-3b2f-4a6e-9d8c-1f0e2d3c4b5a' } },
  beatPresence: {
    payload: { viewer: SESSION, document: SESSION, component: null, mode: 'read' },
  },
  createSpace: { payload: { name: 'Elsewhere' } },
  updateSpace: { payload: { name: 'Elsewhere' } },
  putBridgeSettings: {
    payload: { componentType: null, template: null, propertyMap: {}, data: false },
  },
  setGroupMembers: { payload: { principals: [] } },
  extendGrant: { payload: {} },
  createToken: { payload: { name: 'Elsewhere', scopes: [], expiresAt: IN_A_MONTH } },
  createServiceIdentity: { payload: { name: 'Elsewhere' } },
  connectCtStudio: {
    payload: {
      space: '55555555-5555-4555-8555-555555555555',
      identity: { make: true },
      settings: { componentType: null, template: null, propertyMap: {}, data: false },
      address: 'https://elsewhere.example.test',
      sinkId: 'alloy-elsewhere',
    },
  },
  issueCtStudioToken: { payload: { replaceIdentity: false } },
  createWebhook: {
    payload: {
      serviceIdentity: '55555555-5555-4555-8555-555555555555',
      url: 'https://receiver.example.test',
      eventTypes: ['content.version_cut'],
    },
  },
  changeWebhook: { payload: { description: 'Elsewhere' } },
  previewExtension: { payload: { url: 'https://elsewhere.example.test/manifest.json' } },
  installExtension: {
    payload: { url: 'https://elsewhere.example.test/manifest.json', digest: 'a'.repeat(64) },
  },
  updateExtension: { payload: { digest: 'a'.repeat(64) } },
  setExtensionSecret: { payload: { secret: 'herbarium-token' } },
  changeServiceIdentity: { payload: { name: 'Elsewhere' } },
  issueServiceIdentityToken: { payload: { name: 'Elsewhere', scopes: [], expiresAt: IN_A_MONTH } },
  setEditingSettings: { payload: { iterationRetentionDays: 7 } },
  setImportSettings: { payload: { policy: 'keep' } },
  setImagesSettings: { payload: { undeclared: 'refuse' } },
  setAssetRights: { payload: { rights: { kind: 'undeclared' } } },
  createAssetReplacement: { payload: {} },
  setTranslationSettings: { payload: { fallback: 'refuse', outOfDate: 'publish', note: {} } },
  makeGrant: {
    payload: { role: SESSION, subject: { principal: SESSION }, level: 'tenant', effect: 'allow' },
  },
  saveIteration: {
    payload: {
      openedFrom: SESSION,
      content: {
        schemaVersion: 1,
        title: 'Elsewhere',
        language: 'en-GB',
        direction: 'ltr',
        content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
      },
    },
  },
};

const CONTENT = {
  schemaVersion: 1,
  title: 'Audit the fleet',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'Audit the fleet.', marks: [] }],
    },
  ],
};

/** The General space of environment B, so a route naming a space names one that is not ours. */
const spaceIdIn = async (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const space = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    return space.id;
  });

/** A document of environment B's and its version, by id. */
const documentVersionIn = async (tenant: Tenant, db: TenantDatabase) => {
  const id = await documentIdIn(tenant, db);
  const version = await db.withTenant(tenant, (trx) => latestVersion(trx, id));
  return { id, version: version!.id };
};

/** A component of environment B's and its version, by id. */
const componentVersionIn = async (tenant: Tenant, db: TenantDatabase) => {
  const id = await componentIdIn(tenant, db);
  const version = await db.withTenant(tenant, (trx) => latestVersion(trx, id));
  return { id, version: version!.id };
};

/** A component in environment B's General space, complete with a version, so a route that opens
 * one has something to actually find - never a bare artifact row a missing-version 404 would
 * satisfy whether or not the tenant boundary held. */
const componentIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const author = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const type: ComponentTypeDefinition = {
      schemaVersion: DEFINITION_SCHEMA_VERSION,
      id: randomUUID(),
      // Named apart from the starter Topic, and from every other made here (MET-031).
      name: `Probe type ${randomUUID()}`,
      assignments: [],
    };
    const madeType = await createArtifact(trx, {
      author: author.id,
      substance: { kind: 'componentType', content: type },
    });
    const made = await createArtifact(trx, {
      author: author.id,
      spaceId: general.id,
      substance: {
        kind: 'component',
        content: CONTENT as never,
        values: {},
        notCarried: [],
        definitions: definitionsFor({ version: madeType.id, definition: type }, [], []),
      },
    });
    return made.artifactId;
  });

/** A document in environment B's General space, made through the store as the route makes one, so a
 * route that opens one has a real version to find. */
/** A field of this environment's own, named uniquely: every environment holds the starter type. */
const themeIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const manager = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await duplicateTheme(trx, {
      themeId: DEFAULT_THEME_ID,
      name: `Probe ${randomUUID()}`,
      author: manager.id,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.theme.artifactId;
  });

const definitionIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const manager = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createDefinition(trx, {
      kind: 'field',
      definition: {
        schemaVersion: 1,
        name: `Probe ${randomUUID()}`,
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      },
      author: manager.id,
    });
    if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
    return made.definition.id;
  });

const templateIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const designer = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createTemplate(trx, {
      spaceId: general.id,
      definition: aTemplate(),
      author: designer.id,
    });
    if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
    return made.template.id;
  });

/** A connection in environment B's General space, made as the route makes one. */
const connectionIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const administrator = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createConnection(trx, {
      spaceId: general.id,
      settings: aConnection(),
      author: administrator.id,
    });
    if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
    return made.connection.id;
  });

/** A query definition in environment B's General space, naming a connection made there. */
const queryDefinitionIdIn = async (tenant: Tenant, db: TenantDatabase) => {
  const connection = await connectionIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const author = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createQueryDefinition(trx, {
      spaceId: general.id,
      definition: aQueryDefinition(connection),
      author: author.id,
    });
    if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
    return made.definition.id;
  });
};

/** A bibliography entry in environment B's General. */
const termIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const author = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createTerm(trx, {
      spaceId: general.id,
      term: {
        ...aTerm,
        labels: [{ language: 'en', preferred: `Probe ${randomUUID()}`, alternatives: [] }],
      },
      author: author.id,
    });
    if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
    return made.term.id;
  });

const entryIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const author = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createEntry(trx, {
      spaceId: general.id,
      entry: { csl: { type: 'book', title: `Probe ${randomUUID()}` } },
      author: author.id,
    });
    if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
    return made.entry.id;
  });

/** A prompt in environment B's General. */
const promptIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const author = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createPrompt(trx, {
      spaceId: general.id,
      prompt: aPrompt,
      author: author.id,
    });
    if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
    return made.prompt.id;
  });

/** A conversation in environment B, of a person there. */
const conversationIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const owner = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return (await startConversation(trx, { owner: owner.id, documentId: null, title: 'Theirs' }))
      .id;
  });

/** A personal prompt in environment B, of a person there. */
const personalPromptIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const owner = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const saved = await savePersonalPrompt(trx, owner.id, {
      title: 'Theirs',
      instructions: 'Theirs.',
    });
    if (saved === 'full') throw new Error('full');
    return saved.id;
  });

/** A prompt library in environment B. */
const libraryIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const author = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createLibrary(trx, {
      library: { schemaVersion: 1, name: 'Probe', prompts: [] },
      author: author.id,
    });
    if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
    return made.library.id;
  });

/** An uploaded citation style in environment B: the seeded three share their ids across environments. */
const styleIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const author = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createStyle(trx, { style: aStyle, author: author.id });
    if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
    return made.style.id;
  });

/** A dataset in environment B, with one version: a result of a definition made there. */
const datasetIn = async (tenant: Tenant, db: TenantDatabase) => {
  const definition = await queryDefinitionIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const stored = (await readQueryDefinition(trx, definition))!;
    const connection = (await readConnection(trx, stored.definition.connection!))!;
    const recorded = await recordDatasetVersion(trx, {
      author: stored.version.author!,
      provenance: {
        schemaVersion: 1,
        queryDefinition: { artifact: stored.id, version: stored.version.id },
        connection: { artifact: connection.id, version: connection.version.id },
        parameters: {},
        ran: { sql: 'select 1' },
        identity: { kind: 'service' },
        at: '2026-10-03T09:00:00.000Z',
        durationMs: 1,
        rowCount: 0,
        columns: stored.definition.columns,
        canonical: 1,
        checksum: 'e'.repeat(64),
        images: {},
      },
    });
    return { dataset: recorded.dataset.id, version: recorded.version.id };
  });
};

/** A result in environment B waiting on an image, as a resolve there leaves one (D8-D). */
const pendingIn = async (tenant: Tenant, db: TenantDatabase) => {
  const definition = await queryDefinitionIdIn(tenant, db);
  const document = await documentIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const stored = (await readQueryDefinition(trx, definition))!;
    const connection = (await readConnection(trx, stored.definition.connection!))!;
    const { upload } = await uploadForDatasetImage(trx, {
      spaceId: stored.space.id,
      uploader: stored.version.author!,
      key: `${tenant.schema}/sha256/${'d'.repeat(64)}`,
      format: 'png',
      bytes: 10,
    });
    const pending = await pendingResult(trx, {
      act: 'resolve',
      document,
      node: 'a'.repeat(26),
      binding: 'b1',
      digest: 'c'.repeat(64),
      holding: null,
      session: null,
      provenance: {
        schemaVersion: 1,
        queryDefinition: { artifact: stored.id, version: stored.version.id },
        connection: { artifact: connection.id, version: connection.version.id },
        parameters: {},
        ran: { sql: 'select 1' },
        identity: { kind: 'service' },
        at: '2026-10-05T09:00:00.000Z',
        durationMs: 1,
        rowCount: 0,
        columns: stored.definition.columns,
        canonical: 1,
        checksum: 'e'.repeat(64),
        images: {},
      },
      uploads: [upload.id],
      by: stored.version.author!,
    });
    return pending.id;
  });
};

const documentIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const author = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createDocument(trx, {
      spaceId: general.id,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      author: author.id,
    });
    if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
    return made.version.artifactId;
  });

/**
 * A publication in environment B, and the request that made it: asked for through the store and
 * recorded as a worker records one, over an output that need not exist - nothing here fetches it.
 */
/**
 * An asset in the tenant's General space, made as the `ingest` job makes one, over an object that need
 * not exist: a route reaching it from another environment must refuse before it reads the store.
 */
const assetIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const space = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const uploader = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const upload = await createAssetUpload(trx, {
      spaceId: space.id,
      uploader: uploader.id,
      alternative: null,
    });
    await receiveAssetBytes(trx, upload.id, {
      key: `${tenant.role}/sha256/${'d'.repeat(64)}`,
      format: 'png',
      bytes: 1,
    });
    const version = await recordAsset(trx, upload.id, {
      format: 'png',
      width: 1,
      height: 1,
      orientation: 1,
      colour: 'rgb',
      alpha: false,
      depth: 8,
      resolution: null,
      end: 1,
    });
    return { upload: upload.id, version: version.id, asset: version.artifactId };
  });

const publicationIn = async (tenant: Tenant, db: TenantDatabase) => {
  const document = await documentIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const version = await trx
      .selectFrom('artifact_version')
      .select(['id', 'author_id'])
      .where('artifact_id', '=', document)
      .executeTakeFirstOrThrow();
    const asked = await requestPublication(trx, {
      documentId: document,
      version: version.id,
      formats: ['pdf'],
      requester: version.author_id!,
    });
    if (asked.answer !== 'requested') throw new Error(`refused: ${asked.answer}`);
    const publication = await recordPublication(trx, {
      requestId: asked.request.id,
      // Made under a layout, as every request since layouts is: template 2 and pipeline 2.
      pipelineVersion: '2',
      fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
      dataSha256: 'b'.repeat(64),
      numbering: { scheme: 'default/1', entries: [] },
      outputs: [
        {
          format: 'pdf' as const,
          engineVersion: '0.15.1',
          templateVersion: 2,
          key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
          sha256: 'c'.repeat(64),
          bytes: 1,
        },
      ],
    });
    return { request: asked.request.id, publication: publication! };
  });
};

/** A baseline in environment B, of its document, made by the document's author. */
const baselineIn = async (tenant: Tenant, db: TenantDatabase) => {
  const document = await documentIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const version = await trx
      .selectFrom('artifact_version')
      .select(['id', 'author_id'])
      .where('artifact_id', '=', document)
      .orderBy('version_no', 'desc')
      .executeTakeFirstOrThrow();
    const made = await makeBaseline(trx, {
      documentId: document,
      version: version.id,
      name: `Elsewhere ${randomUUID()}`,
      maker: version.author_id!,
    });
    if (made.answer !== 'made') throw new Error(`refused: ${made.answer}`);
    return made.baseline;
  });
};

/** A thread in environment B, on its component, started by the component's author. */
/** A suggestion in environment B, on its component, by the component's author. */
/** A round on a document of the tenant's, by that document's author. */
const roundIn = async (tenant: Tenant, db: TenantDatabase) => {
  const document = await documentIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const author = await trx
      .selectFrom('artifact_version')
      .select('author_id')
      .where('artifact_id', '=', document)
      .executeTakeFirstOrThrow();
    const opened = await openRound(trx, {
      document,
      title: `Elsewhere ${randomUUID()}`,
      scope: [],
      dueAt: new Date(Date.now() + 86_400_000),
      baseline: null,
      reviewers: [author.author_id!],
      by: author.author_id!,
    });
    if (opened.answer !== 'opened') throw new Error(`refused: ${opened.answer}`);
    return opened.round.id;
  });
};

const suggestionIn = async (tenant: Tenant, db: TenantDatabase) => {
  const component = await componentIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const version = await trx
      .selectFrom('artifact_version')
      .select(['id', 'author_id', 'content'])
      .where('artifact_id', '=', component)
      .orderBy('version_no', 'desc')
      .executeTakeFirstOrThrow();
    const made = await makeSuggestion(trx, {
      component,
      version: version.id,
      proposed: { ...(version.content as ContentDocument), title: `Elsewhere ${randomUUID()}` },
      by: version.author_id!,
    });
    if (made.answer !== 'made') throw new Error(`refused: ${made.answer}`);
    return made.suggestion;
  });
};

const threadIn = async (tenant: Tenant, db: TenantDatabase) => {
  const component = await componentIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const version = await trx
      .selectFrom('artifact_version')
      .select(['id', 'author_id'])
      .where('artifact_id', '=', component)
      .orderBy('version_no', 'desc')
      .executeTakeFirstOrThrow();
    const started = await startThread(trx, {
      on: component,
      version: version.id,
      anchor: { kind: 'component' },
      parts: [{ text: 'Elsewhere' }],
      author: version.author_id!,
    });
    if (started.answer !== 'done') throw new Error(`refused: ${started.answer}`);
    return started.thread;
  });
};

/** A notification in environment B, to the author of its thread's component, about it. */
const notificationIn = async (tenant: Tenant, db: TenantDatabase) => {
  const thread = await threadIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const on = await trx
      .selectFrom('thread')
      .select(['on_id', 'created_by'])
      .where('id', '=', thread)
      .executeTakeFirstOrThrow();
    const made = await trx
      .insertInto('notification')
      .values({
        recipient: on.created_by,
        kind: 'reply',
        actor: on.created_by,
        thread_id: thread,
        artifact_id: on.on_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return made.id;
  });
};

/** A job in environment B, an impact report a principal of its own asked for (the R3 plan). */
const jobIn = async (tenant: Tenant, db: TenantDatabase) => {
  const subject = await componentIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const by = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return (await submitImpactReport(trx, { by: by.id, subject, depth: 1 })).id;
  });
};

/** A relationship in environment B between two of its documents, of a type of its own (the R8 plan). */
const relationshipIn = async (tenant: Tenant, db: TenantDatabase) => {
  const [from, to] = [await documentIdIn(tenant, db), await documentIdIn(tenant, db)];
  return db.withTenant(tenant, async (trx) => {
    const by = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const type = await createDefinition(trx, {
      kind: 'relationshipType',
      definition: {
        schemaVersion: 1,
        name: `Probe ${randomUUID()}`,
        inverseName: 'Probed by',
        directed: true,
        from: { kinds: ['document'], cardinality: 'many', permission: 'read' },
        to: { kinds: ['document'], cardinality: 'many', permission: 'read' },
        selfReference: false,
        acyclic: false,
        informational: true,
        schemas: [],
      },
      author: by.id,
    });
    if (type.answer !== 'created') throw new Error(`refused: ${type.answer}`);
    const made = await makeRelationship(trx, {
      by: by.id,
      type: type.definition.id,
      from: { artifact: from },
      to: { artifact: to },
    });
    if (made.answer !== 'made') throw new Error(`refused: ${made.answer}`);
    return made.relationship.id;
  });
};

/** A cohort in environment B, of one row, asked for by a principal of its own (the R7 plan). */
const cohortIn = async (tenant: Tenant, db: TenantDatabase) => {
  const space = await spaceIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const by = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await trx
      .insertInto('cohort')
      .values({
        space_id: space,
        template_id: randomUUID(),
        resolution: '{}',
        title: 'Report',
        language: 'en-GB',
        direction: 'ltr',
        source: '{"rows":1}',
        requested_by: by.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return made.id;
  });
};

/** A grant in environment B: Reader on its General space, to a principal of its own. */
const grantIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const holder = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const reader = await findRole(trx, 'Reader');
    const made = await grant(trx, {
      roleId: reader!.id,
      subject: { principal: holder.id },
      level: { kind: 'space', id: general.id },
      effect: 'allow',
      grantedBy: holder.id,
    });
    if (!('granted' in made)) throw new Error(`refused: ${made.refused}`);
    return made.granted.id;
  });

/** An invitation waiting in environment B, made by a principal of its own. */
const invitationIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const inviter = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await invite(trx, {
      email: `${randomUUID()}@example.com`,
      external: false,
      invitedBy: inviter.id,
    });
    if (!('invited' in made)) throw new Error(`refused: ${made.refused}`);
    return made.invited.id;
  });

/** One of environment B's own groups, holding one of its own principals. */
/** An export of the audit log the tenant holds, asked for by a principal of its own. */
const auditExportIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const asker = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return (await requestAuditExport(trx, asker.id, {})).id;
  });

/** An import in an environment, awaiting its file, made by somebody there. */
const importIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const space = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const importer = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return (
      await createImport(trx, {
        spaceId: space.id,
        importer: importer.id,
        fileName: 'Elsewhere.docx',
        fileType: 'docx',
      })
    ).id;
  });

const tenantExportIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const asker = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return (await requestTenantExport(trx, asker.id)).id;
  });

/** A run of the assistant in an environment, and a proposal it made, its requester somebody there. */
const assistantIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const asker = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await makeModelEndpoint(
      trx,
      {
        name: `Theirs ${randomUUID()}`,
        protocol: 'anthropic',
        baseUrl: 'https://models.example.test',
        model: 'claude-test',
        contextWindow: 200000,
        priceIn: 0,
        priceOut: 0,
        currency: 'USD',
        boundary: 'outside',
      },
      asker.id,
    );
    if (made.answer !== 'written') throw new Error(made.answer);
    const run = await startRun(trx, {
      purpose: 'drafting',
      endpoint: made.endpoint,
      parameters: {},
      contextDigest: '0'.repeat(64),
      by: asker.id,
    });
    const proposal = await makeProposal(trx, {
      run,
      component: randomUUID(),
      against: randomUUID(),
      proposed: {
        schemaVersion: 1,
        title: 'x',
        language: 'en',
        direction: 'ltr',
        content: [],
      } as never,
    });
    return { run, proposal: proposal.id };
  });

const modelEndpointIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const asker = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await makeModelEndpoint(
      trx,
      {
        ...{
          name: 'Elsewhere',
          protocol: 'anthropic',
          baseUrl: 'https://models.example.test',
          model: 'claude-test',
          contextWindow: 200000,
          priceIn: 0,
          priceOut: 0,
          currency: 'USD',
          boundary: 'outside',
        },
        name: `Theirs ${randomUUID()}`,
      },
      asker.id,
    );
    if (made.answer !== 'written') throw new Error(made.answer);
    return made.endpoint.id;
  });

const groupIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const member = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createGroup(trx, `Elsewhere ${randomUUID()}`);
    if (!('group' in made)) throw new Error(`refused: ${made.refused}`);
    const filled = await setGroupMembers(trx, made.group.id, [member.id]);
    if (!('set' in filled)) throw new Error(`refused: ${filled.refused}`);
    return made.group.id;
  });

/** A legal hold in `tenant`, on a component of its own. */
const holdIdIn = async (tenant: Tenant, db: TenantDatabase) => {
  const component = await componentIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const by = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `kai-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const placed = await placeHold(trx, {
      target: { artifact: component },
      reason: 'Elsewhere',
      by: by.id,
    });
    if (placed.answer !== 'placed') throw new Error(placed.answer);
    return placed.id;
  });
};

/**
 * A personal token in `tenant`, of a principal of its own, kept as its hash as any token is: each call
 * a person and a token of their own, since a hash and a subject are each held once.
 */
/** A session of a principal the tenant holds, alive for an hour. */
async function sessionIn(tenant: Tenant, db: TenantDatabase): Promise<string> {
  return db.withTenant(tenant, async (trx) => {
    const principal = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const hour = new Date(Date.now() + 60 * 60 * 1000);
    const session = await trx
      .insertInto('session')
      .values({
        token_hash: randomUUID().replaceAll('-', '').padEnd(64, 'e'),
        principal_id: principal.id,
        route: 'organisation',
        last_seen_at: new Date(),
        idle_expires_at: hour,
        expires_at: hour,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return session.id;
  });
}

async function serviceIdentityIn(tenant: Tenant, db: TenantDatabase): Promise<string> {
  return db.withTenant(
    tenant,
    async (trx) =>
      (await createServiceIdentity(trx, { name: 'Elsewhere', description: '', by: null })).id,
    { actorKind: 'system' },
  );
}

async function extensionIn(tenant: Tenant, db: TenantDatabase): Promise<string> {
  return db.withTenant(
    tenant,
    async (trx) =>
      (
        await installExtension(trx, {
          url: 'https://elsewhere.example.test/manifest.json',
          digest: 'a'.repeat(64),
          manifest: {
            manifest: 1,
            name: 'Elsewhere',
            version: '1.0.0',
            publisher: 'Invented',
            description: 'Another environment’s.',
            kind: 'source',
            endpoint: 'https://elsewhere.example.test/x',
            settings: [],
            authentication: 'none',
            capabilities: { parameters: false, keyColumns: false, rowLimit: false },
            outbound: [],
          },
          by: null,
        })
      ).id,
    { actorKind: 'system' },
  );
}

async function webhookIn(tenant: Tenant, db: TenantDatabase): Promise<string> {
  const identity = await serviceIdentityIn(tenant, db);
  return db.withTenant(
    tenant,
    async (trx) =>
      (
        await createWebhookSubscription(trx, {
          id: randomUUID(),
          serviceIdentity: identity,
          url: 'https://receiver.example.test',
          description: 'Elsewhere',
          eventTypes: ['content.version_cut'],
          sealed: 'sealed-elsewhere',
          by: identity,
        })
      ).id,
    { actorKind: 'system' },
  );
}

async function tokenIn(
  tenant: Tenant,
  db: TenantDatabase,
): Promise<{ readonly principal: string; readonly token: string }> {
  return db.withTenant(tenant, async (trx) => {
    const principal = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const token = await trx
      .insertInto('api_token')
      .values({
        principal_id: principal.id,
        name: 'Elsewhere',
        token_hash: randomUUID().replaceAll('-', '').padEnd(64, 'f'),
        scopes: [],
        expires_at: new Date(IN_A_MONTH),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { principal: principal.id, token: token.id };
  });
}

/** The same, as a query's target names it. */
const componentIn = async (tenant: Tenant, db: TenantDatabase) =>
  `artifact:${await componentIdIn(tenant, db)}`;

/**
 * For each route whose permission's target is a query member: the query naming something belonging to
 * environment B. As with path parameters, a route missing here fails the harness.
 */
const OTHER_TENANT_QUERIES: Readonly<
  Record<string, (tenant: Tenant, db: TenantDatabase) => Promise<string>>
> = {
  getAccess: async (tenant, db) => `target=${await componentIn(tenant, db)}`,
  listGrants: async (tenant, db) => `level=${await componentIn(tenant, db)}`,
  listRoles: async (tenant, db) => `level=${await componentIn(tenant, db)}`,
  listPrincipals: async (tenant, db) => `level=${await componentIn(tenant, db)}`,
  explainAccess: async (tenant, db) => {
    const principal = await db.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'alice',
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    return `principal=${principal.id}&target=${await componentIn(tenant, db)}`;
  },
};

const withParameters = authenticated.filter((route) => route.path.includes('{'));
const withQueryTargets = allRoutes.filter(
  (route) => route.access.check === 'permission' && 'query' in route.access.target,
);
const fill = (path: string, ids: Record<string, string>) =>
  path.replace(/\{(\w+)\}/g, (_match, name: string) => ids[name] ?? '');
/** The route's address with its valid query, and its valid body, as `inject` takes them. */
const request = (name: string, url: string) => {
  const input = VALID_INPUT[name] ?? {};
  return {
    url: input.query ? `${url}?${input.query}` : url,
    ...(input.payload ? { payload: input.payload } : {}),
  };
};

describe("no environment accepts another environment's session (IAM-004)", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let fromA = '';
  /** A personal token issued in environment A, scoped to everything a token may be. */
  let tokenFromA = '';
  let a: Tenant;
  let b: Tenant;
  let foreignPrincipal = '';
  let ownTarget = '';
  const othersIds: Record<string, Record<string, string>> = {};
  const othersQueries: Record<string, string> = {};

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [A, B].map((host) => `http://${host}/v1/sign-in/organisation/callback`),
        },
      ],
    });
    for (const [host, name] of [
      [A, 'Production'],
      [B, 'Development'],
    ] as const) {
      const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id: db.newTenantId(), name },
        hostnames: [host],
      });
      if (host === A) a = tenant;
      if (host === B) b = tenant;
      await configureStandIn(db.adminUrl, tenant, {
        issuer: idp.issuer,
        clientId: 'alloy',
      });
    }
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    fromA = await signIn(app, A, 'ada', idp.issuer);
    for (const route of withParameters) {
      othersIds[route.operationId] = await OTHER_TENANT_IDS[route.operationId]!(b, tenantDb);
    }
    // Ada administers and designs environment A, so a refusal below is the other environment's, not
    // her own lack.
    const me = await app.inject({ url: '/v1/me', headers: { host: A, cookie: fromA } });
    const ada = me.json<{ id: string }>().id;
    await tenantDb.withTenant(a, async (trx) => {
      for (const name of ['Administrator', 'Designer']) {
        await grant(trx, {
          roleId: (await findRole(trx, name))!.id,
          subject: { principal: ada },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/tokens',
      headers: { host: A, cookie: fromA },
      payload: { name: 'Everything', scopes: [...tokenScopes], expiresAt: IN_A_MONTH },
    });
    if (issued.statusCode !== 200) throw new Error(`No token was issued: ${issued.body}`);
    tokenFromA = issued.json<{ secret: string }>().secret;
    for (const route of withQueryTargets) {
      const query = OTHER_TENANT_QUERIES[route.operationId];
      if (query) othersQueries[route.operationId] = await query(b, tenantDb);
    }
    // A principal belonging to B, and a target belonging to A: explainAccess takes both from its
    // query, so mixing environments across the two - not just naming both from the other one - is
    // its own escape to close.
    foreignPrincipal = await tenantDb
      .withTenant(b, (trx) =>
        trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'carol',
            email: null,
            display_name: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      )
      .then((row) => row.id);
    ownTarget = await componentIn(a, tenantDb);
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('has authenticated routes to test', () => {
    expect(authenticated.length).toBeGreaterThan(0);
  });

  it('knows how to address the other environment for every route with path parameters', () => {
    for (const route of withParameters) {
      expect(OTHER_TENANT_IDS[route.operationId], route.operationId).toBeDefined();
    }
  });

  it.each(authenticated.map((route) => [route.operationId, route] as const))(
    '%s refuses a session from another environment',
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        ...request(name, fill(route.path, othersIds[name] ?? {})),
        headers: { host: B, cookie: fromA },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'unauthenticated' });
    },
  );

  it.each(authenticated.map((route) => [route.operationId, route] as const))(
    '%s refuses a token from another environment, whatever the route takes',
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        ...request(name, fill(route.path, othersIds[name] ?? {})),
        headers: { host: B, authorization: `Bearer ${tokenFromA}` },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'unauthenticated' });
    },
  );

  it.each(withParameters.map((route) => [route.operationId, route] as const))(
    "%s will not reach another environment's data through this one's address",
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        ...request(name, fill(route.path, othersIds[name] ?? {})),
        headers: { host: A, cookie: fromA },
      });
      expect(response.statusCode).toBe(404);
    },
  );

  it('knows a valid body for every route that takes one', () => {
    for (const route of authenticated.filter((each) => each.body)) {
      expect(VALID_INPUT[route.operationId]?.payload, route.operationId).toBeDefined();
    }
  });

  it('opens a component in another environment exactly as one that does not exist, never its content', async () => {
    const route = withParameters.find((each) => each.operationId === 'getComponent')!;
    const response = await app.inject({
      method: route.method,
      url: fill(route.path, othersIds.getComponent ?? {}),
      headers: { host: A, cookie: fromA },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<Record<string, unknown>>();
    expect(body).toMatchObject({ code: 'not_found' });
    expect(body).not.toHaveProperty('content');
  });

  it('knows how to address the other environment for every route whose target is in its query', () => {
    expect(withQueryTargets.length).toBeGreaterThan(0);
    for (const route of withQueryTargets) {
      expect(OTHER_TENANT_QUERIES[route.operationId], route.operationId).toBeDefined();
    }
  });

  it.each(withQueryTargets.map((route) => [route.operationId, route] as const))(
    "%s will not reach another environment's target through this one's address",
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        url: `${route.path}?${othersQueries[name]}`,
        headers: { host: A, cookie: fromA },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'not_found' });
    },
  );

  it("explainAccess will not reach a target this environment holds through another environment's principal", async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/access/explain?principal=${foreignPrincipal}&target=${ownTarget}`,
      headers: { host: A, cookie: fromA },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'not_found' });
  });

  it("makeGrant will not grant at another environment's level, or name another environment's role or person", async () => {
    const reader = (tenant: Tenant) =>
      tenantDb.withTenant(tenant, async (trx) => ({
        role: (await findRole(trx, 'Reader'))!.id,
        space: (
          await trx
            .selectFrom('space')
            .select('id')
            .where('name', '=', 'General')
            .executeTakeFirstOrThrow()
        ).id,
        person: (await trx.selectFrom('principal').select('id').executeTakeFirstOrThrow()).id,
        grants: (
          await trx
            .selectFrom('access_grant')
            .select((eb) => eb.fn.countAll<string>().as('count'))
            .executeTakeFirstOrThrow()
        ).count,
      }));
    const ours = await reader(a);
    const theirs = await reader(b);
    const make = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/v1/grants',
        headers: { host: A, cookie: fromA },
        payload: { effect: 'allow', ...payload },
      });

    const elsewhere = await make({
      role: ours.role,
      subject: { principal: ours.person },
      level: `space:${theirs.space}`,
    });
    expect(elsewhere.statusCode).toBe(404);
    expect(elsewhere.json()).toMatchObject({ code: 'not_found' });
    const theirRole = await make({
      role: theirs.role,
      subject: { principal: ours.person },
      level: `space:${ours.space}`,
    });
    expect(theirRole.statusCode).toBe(409);
    expect(theirRole.json()).toMatchObject({ code: 'grant_role_missing' });
    const theirPerson = await make({
      role: ours.role,
      subject: { principal: theirs.person },
      level: `space:${ours.space}`,
    });
    expect(theirPerson.statusCode).toBe(409);
    expect(theirPerson.json()).toMatchObject({ code: 'grant_subject_missing' });

    expect((await reader(a)).grants).toBe(ours.grants);
    expect((await reader(b)).grants).toBe(theirs.grants);
  });

  it("placeHold will not hold another environment's component or space", async () => {
    const held = (tenant: Tenant) =>
      tenantDb.withTenant(tenant, async (trx) =>
        Number(
          (
            await trx
              .selectFrom('legal_hold')
              .select((eb) => eb.fn.countAll<string>().as('count'))
              .executeTakeFirstOrThrow()
          ).count,
        ),
      );
    const before = await held(b);
    for (const target of [
      { artifact: await componentIdIn(b, tenantDb) },
      { space: await spaceIdIn(b, tenantDb) },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/holds',
        headers: { host: A, cookie: fromA },
        payload: { target, reason: 'Elsewhere' },
      });
      expect(response.statusCode, JSON.stringify(target)).toBe(404);
      expect(response.json()).toMatchObject({ code: 'not_found' });
    }
    expect(await held(b)).toBe(before);
  });

  it("setRetention will not keep another environment's space", async () => {
    const kept = (tenant: Tenant) =>
      tenantDb.withTenant(tenant, async (trx) =>
        Number(
          (
            await trx
              .selectFrom('retention_keep')
              .select((eb) => eb.fn.countAll<string>().as('count'))
              .executeTakeFirstOrThrow()
          ).count,
        ),
      );
    const before = await kept(b);
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/retention',
      headers: { host: A, cookie: fromA },
      payload: { kind: null, space: await spaceIdIn(b, tenantDb), days: 5 },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'not_found' });
    expect(await kept(a)).toBe(0);
    expect(await kept(b)).toBe(before);
  });

  it("will not fill a group with another environment's person, nor grant to another environment's group", async () => {
    const theirs = await tenantDb.withTenant(b, async (trx) => ({
      person: (await trx.selectFrom('principal').select('id').executeTakeFirstOrThrow()).id,
      group: (await trx.selectFrom('access_group').select('id').executeTakeFirstOrThrow()).id,
    }));
    const ours = await app.inject({
      method: 'POST',
      url: '/v1/groups',
      headers: { host: A, cookie: fromA },
      payload: { name: 'Ours alone' },
    });
    expect(ours.statusCode, ours.body).toBe(200);
    const group = ours.json<{ group: { id: string } }>().group.id;

    const filled = await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group}/members`,
      headers: { host: A, cookie: fromA },
      payload: { principals: [theirs.person] },
    });
    expect(filled.statusCode).toBe(409);
    expect(filled.json()).toMatchObject({ code: 'group_member_missing' });

    const reader = await tenantDb.withTenant(a, async (trx) => (await findRole(trx, 'Reader'))!.id);
    const granted = await app.inject({
      method: 'POST',
      url: '/v1/grants',
      headers: { host: A, cookie: fromA },
      payload: { role: reader, subject: { group: theirs.group }, level: 'tenant', effect: 'allow' },
    });
    expect(granted.statusCode).toBe(409);
    expect(granted.json()).toMatchObject({ code: 'grant_subject_missing' });

    const listed = await app.inject({
      url: '/v1/groups?limit=100',
      headers: { host: A, cookie: fromA },
    });
    expect(listed.json<{ items: { id: string }[] }>().items.map((each) => each.id)).toEqual([
      group,
    ]);
  });

  it('leaves the session working where it was issued, whatever was tried elsewhere', async () => {
    const me = await app.inject({ url: '/v1/me', headers: { host: A, cookie: fromA } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ environment: 'Production' });
  });

  it('leaves the token working where it was issued, whatever was tried elsewhere', async () => {
    const me = await app.inject({
      url: '/v1/me',
      headers: { host: A, authorization: `Bearer ${tokenFromA}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ environment: 'Production' });
  });
});
