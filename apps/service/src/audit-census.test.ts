import { readdirSync, readFileSync } from 'node:fs';
import { allRoutes } from '@alloy-works/api-contract';
import { auditKinds, auditKindSpecs, isAuditKind, type AuditKind } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

/**
 * The census of the audit log's writers (the AU1 plan, AU1-M): every route the contract declares,
 * GETs included, with the kinds it writes or why it writes none, and every writer that is not a route
 * - the worker's jobs and sweeps, the vendor's functions, development's setup - with theirs. A route
 * or a writer added without an entry fails here, so none is left off the log by forgetting.
 *
 * The census names what each writes; each emitter's own test shows that it does (audit-data.test.ts,
 * audit-content.test.ts, audit-identity.test.ts and the rest).
 */

/** Why a route or writer records nothing. */
const REASONS = {
  read: 'A read, which is not itself an event (audit.md, "Reading and export")',
  conversation:
    "A person's own conversation begun: each turn of it is a run, recorded as generation.run",
  personal:
    "A person's own saved words, read by them alone: no artifact, and none of the tenant's content",
  tray: "A person's own conversation's tray: identities alone, read again as them each turn, no content changed",
  attempt: 'Starts a sign-in: it names nobody, and the sign-in that finishes it is recorded',
  derived:
    "A write derived from what is already recorded, which changes none of the tenant's content",
  preview: 'A preview, kept for an hour and published nowhere',
  lock: "A lock claimed or released: COL's lock-taking design records lock.taken (COL-009)",
  iteration: 'An iteration, which is never a version (VER-005)',
  upload: 'An upload waiting for its bytes: its asset is ingested, or the upload refused, later',
  importing:
    "An import's proposal, held apart from the space (IM-A): its acceptance and its abandonment are recorded",
  source: "Reads the source through the connector: nothing of the tenant's changes",
  checked:
    "An entry checked against its source through the connector: its status, the system's word beside it and never a version (XR-F), and its document owners told",
  platform: "The platform's own provisioning, outside the tenant's acts",
  presence: 'Where a window is, which is presence, not an act: unlogged, and gone in a minute',
  inbox:
    "A person's own inbox: what they were told, read, cleared or chose, none of the tenant's content",
  metering:
    "A query run's slot and its record, which meter the tenant's runs (the R18 plan) and change none of its content",
  returning:
    "A translation job's file kept for the worker to read (XL-F), which writes translation.job_returned as it applies it; nothing of the content changes here",
  started:
    "A reviewer saying they have started (RR-A): kept on the round's own rows, which its readers read, and no change to the tenant's content",
} as const;

type Entry = { readonly writes: readonly AuditKind[] } | { readonly none: keyof typeof REASONS };

const read: Entry = { none: 'read' };
const writes = (...kinds: AuditKind[]): Entry => ({ writes: kinds });

/**
 * Written wherever they happen, so on no route's entry: a refusal of anybody identified, by the
 * error handlers (AU1-E), and a token's use, once a minute, wherever one is presented (AU1-G).
 */
const ON_ANY_ROUTE: readonly AuditKind[] = ['access.refused', 'token.used'];

const ROUTES: Readonly<Record<string, Entry>> = {
  getHealth: read,
  listAuditEvents: read,
  requestAuditExport: writes('export.produced'),
  getAuditExport: read,
  downloadAuditExport: writes('export.downloaded'),
  requestTenantExport: writes('export.produced'),
  listTenantExports: read,
  getTenantExport: read,
  downloadTenantExport: writes('export.downloaded'),
  listModelEndpoints: read,
  makeModelEndpoint: writes('model_endpoint.made'),
  getModelEndpoint: read,
  changeModelEndpoint: writes('model_endpoint.changed'),
  retireModelEndpoint: writes('model_endpoint.retired', 'model_route.set'),
  setModelEndpointKey: writes('model_endpoint.credential_set'),
  testModelEndpoint: writes('model_endpoint.tested'),
  listModelRoutes: read,
  setModelRoute: writes('model_route.set'),
  startAssistantRun: writes('generation.run'),
  listConversationEndpoints: read,
  listGuardrails: read,
  setGuardrail: writes('guardrail.set'),
  retireGuardrail: writes('guardrail.retired'),
  getModelLimits: read,
  setModelLimit: writes('generation.limit_set'),
  setPersonLimit: writes('generation.limit_set'),
  getModelBudget: read,
  getModelUsage: read,
  getEmbedding: read,
  getMeaningFreshness: read,
  confirmEmbedding: writes('generation.embedding_confirmed'),
  setModelBudget: writes('generation.budget_set'),
  setBudgetRecipients: writes('generation.budget_set'),
  startConversation: { none: 'conversation' },
  listConversations: read,
  getConversation: read,
  getConversationContext: read,
  listPersonalPrompts: read,
  savePersonalPrompt: { none: 'personal' },
  changePersonalPrompt: { none: 'personal' },
  removePersonalPrompt: { none: 'personal' },
  promotePersonalPrompt: writes('content.version_cut'),
  addConversationContext: { none: 'tray' },
  removeConversationContext: { none: 'tray' },
  takeTurn: writes('generation.run'),
  listDocumentPrompts: read,
  startPromptRun: writes('generation.run'),
  startPromptTrial: writes('generation.run'),
  getAssistantRun: read,
  getDocumentGenerated: read,
  getPublicationGenerated: read,
  getAssistantUsage: read,
  acceptProposal: writes(
    'suggestion.made',
    'suggestion.accepted',
    'content.version_cut',
    'workflow.transitioned',
    'generation.accepted',
  ),
  keepProposal: writes('suggestion.made'),
  discardProposal: writes('generation.discarded'),
  getTenant: read,
  startOrganisationSignIn: { none: 'attempt' },
  finishOrganisationSignIn: writes(
    'authentication.signed_in',
    'authentication.sign_in_failed',
    'invitation.accepted',
    'tenant.administrator_claimed',
    'group.member_added',
    'group.member_removed',
  ),
  startGoogleSignIn: { none: 'attempt' },
  // The callback admits the account, claiming its invitation; completing makes the session.
  finishGoogleSignIn: writes(
    'authentication.sign_in_failed',
    'invitation.accepted',
    'tenant.administrator_claimed',
  ),
  completeGoogleSignIn: writes('authentication.signed_in', 'authentication.sign_in_failed'),
  openStream: read,
  signOut: writes('authentication.signed_out'),
  getMe: read,
  requestSample: { none: 'derived' },
  getSample: read,
  getAccess: read,
  explainAccess: read,
  listComponents: read,
  listSpaces: read,
  createSpace: writes('space.made'),
  updateSpace: writes('space.renamed', 'space.archived', 'space.restored'),
  listComponentTypes: read,
  createComponent: writes('content.version_cut'),
  getComponent: read,
  listComponentVersions: read,
  listDocuments: read,
  createDocument: writes('content.version_cut'),
  getDocument: read,
  getNumbering: read,
  getContributions: read,
  getDocumentTexts: read,
  recordDocumentValues: writes('content.version_cut', 'workflow.transitioned'),
  getDocumentParameters: read,
  recordDocumentParameters: writes('content.version_cut', 'workflow.transitioned'),
  recordDocumentProfile: writes('content.version_cut', 'workflow.transitioned'),
  recordDocumentFallback: writes('content.version_cut', 'workflow.transitioned'),
  editOutline: writes(
    'content.version_cut',
    'reference.repointed',
    'workflow.transitioned',
    'section.waived',
  ),
  listDocumentVersions: read,
  previewDocumentRestore: read,
  getDocumentVersion: read,
  getComponentVersion: read,
  restoreDocumentVersion: writes(
    'content.restored',
    'content.version_cut',
    'reference.repointed',
    'workflow.transitioned',
  ),
  requestPublication: writes('publication.requested'),
  requestPreview: { none: 'preview' },
  requestRangePreview: { none: 'preview' },
  getRangePreview: read,
  refreshRangePreview: { none: 'preview' },
  getRangePage: read,
  getPublicationRequest: read,
  listPublications: read,
  listPublicationsEverywhere: read,
  // Somebody from outside opening a shared publication, or fetching its bytes (PUB-060).
  getPublication: writes('publication.shared_accessed'),
  getPublicationBindings: read,
  listPublicationShares: read,
  getQueryUsage: read,
  getStyleUses: read,
  getQueryRunsCsv: read,
  sharePublication: writes('access.granted', 'invitation.sent'),
  revokePublicationShare: writes('access.revoked'),
  getSharedOutput: writes('publication.shared_accessed'),
  makeBaseline: writes('baseline.made'),
  listBaselines: read,
  getBaseline: read,
  getBaselineView: read,
  listBaselineThreads: read,
  compareComponentVersions: read,
  compareBaseline: read,
  compareBaselineResolved: read,
  listChangesSince: read,
  publishBaseline: writes('publication.requested'),
  supersedeBaseline: writes('baseline.superseded'),
  startComponentThread: writes('thread.started'),
  startDocumentThread: writes('thread.started'),
  listComponentThreads: read,
  listDocumentThreads: read,
  getThread: read,
  addComment: writes('comment.added'),
  editComment: writes('comment.edited'),
  resolveThread: writes('thread.resolved'),
  markThreadInternal: writes('thread.made_internal'),
  makeSuggestion: writes('suggestion.made'),
  listComponentSuggestions: read,
  listDocumentSuggestions: read,
  getSuggestion: read,
  // A suggestion a run proposed and its requester kept is resolved as a generation too (G2-E).
  acceptSuggestion: writes(
    'suggestion.accepted',
    'content.version_cut',
    'workflow.transitioned',
    'generation.accepted',
  ),
  rejectSuggestion: writes('suggestion.rejected', 'generation.discarded'),
  withdrawSuggestion: writes('suggestion.withdrawn', 'generation.discarded'),
  resolveSuggestions: writes(
    'suggestion.accepted',
    'suggestion.rejected',
    'content.version_cut',
    'workflow.transitioned',
  ),
  openRound: writes('round.opened'),
  listRounds: read,
  getRound: read,
  closeRound: writes('round.closed'),
  startReview: { none: 'started' },
  completeReview: writes('review.completed'),
  reopenReview: writes('review.reopened'),
  getAttention: read,
  listInbox: read,
  markNotificationRead: { none: 'inbox' },
  deleteNotification: { none: 'inbox' },
  getInboxPreferences: read,
  setInboxPreferences: { none: 'inbox' },
  claimLock: { none: 'lock' },
  takeLock: writes('lock.taken'),
  releaseLock: { none: 'lock' },
  saveIteration: { none: 'iteration' },
  cutVersion: writes('content.version_cut', 'workflow.transitioned', 'translation.declared'),
  previewRestore: read,
  restoreVersion: writes('content.restored', 'content.version_cut', 'workflow.transitioned'),
  archiveComponent: writes('artifact.archived'),
  unarchiveComponent: writes('artifact.unarchived'),
  archiveDocument: writes('artifact.archived'),
  unarchiveDocument: writes('artifact.unarchived'),
  getComponentDeletion: read,
  getComponentUses: read,
  getArtifactImpact: read,
  getArtifactReferences: read,
  getArtifactRelationships: read,
  getArtifactPath: read,
  previewPlacement: read,
  // A job about what is recorded, its rows its requester's alone: no change to the tenant's content.
  submitImpactReport: { none: 'derived' },
  // Asking is recorded on the cohort; each document its run makes is the event (the R7 plan, R7-E).
  submitCohort: { none: 'derived' },
  getCohort: read,
  makeRelationship: writes('relationship.made'),
  getRelationship: read,
  changeRelationship: writes('relationship.changed'),
  removeRelationship: writes('relationship.removed'),
  rerunCohort: { none: 'derived' },
  getJob: read,
  cancelJob: { none: 'derived' },
  downloadJob: read,
  placeSection: writes('content.version_cut', 'workflow.transitioned'),
  deleteComponent: writes('artifact.deleted'),
  undeleteComponent: writes('artifact.undeleted'),
  getDocumentDeletion: read,
  deleteDocument: writes('artifact.deleted'),
  undeleteDocument: writes('artifact.undeleted'),
  listIterations: read,
  getIteration: read,
  // What is offered to the caller to recover, about their own iterations: no act of record (the R2 plan).
  discardUnsaved: { none: 'iteration' },
  listGrants: read,
  listCohorts: read,
  listRoles: read,
  listPrincipals: read,
  makeGrant: writes('access.granted'),
  removeGrant: writes('access.revoked'),
  extendGrant: writes('access.revoked', 'access.granted'),
  listExternalAccess: read,
  listInvitations: read,
  invite: writes('invitation.sent'),
  withdrawInvitation: writes('invitation.withdrawn', 'access.revoked', 'group.member_removed'),
  listGroups: read,
  createGroup: writes('group.made'),
  setGroupMembers: writes('group.member_added', 'group.member_removed'),
  deleteGroup: writes('group.deleted', 'access.revoked', 'group.member_removed'),
  listHolds: read,
  listDeleted: read,
  getRetention: read,
  setRetention: writes('retention.changed'),
  listWorkflows: read,
  getWorkflowVersion: read,
  defineWorkflow: writes('workflow.defined'),
  // A move along a transition (WF-F); a save of an approved one, above, writes it too.
  transitionComponent: writes('workflow.transitioned'),
  transitionDocument: writes('workflow.transitioned'),
  // A decision at a gate (WF2-C to WF2-G): an approval, the gate passing and its revision, or a
  // rejection returning it.
  decideComponentGate: writes(
    'approval.given',
    'gate.rejected',
    'revision.designated',
    'workflow.transitioned',
  ),
  decideDocumentGate: writes(
    'approval.given',
    'gate.rejected',
    'revision.designated',
    'workflow.transitioned',
  ),
  // A document moved to its template's newest version, and what that move would change (WF6-C).
  previewTemplateMove: read,
  moveDocumentTemplate: writes('template.moved', 'content.version_cut'),
  // Dates set (WF5-A).
  setComponentDates: writes('dates.set'),
  setDocumentDates: writes('dates.set'),
  setComponentScope: writes('scope.set'),
  setDocumentScope: writes('scope.set'),
  acceptComponentRevision: writes('revision.accepted'),
  acceptDocumentRevision: writes('revision.accepted'),
  listComponentApprovals: read,
  listDocumentApprovals: read,
  readComponentEffective: read,
  divergeComponent: writes('line.diverged'),
  listComponentTranslations: read,
  getSpaceTranslations: read,
  beginComponentTranslation: writes('line.diverged'),
  markComponentTranslationCurrent: writes('translation.marked_current'),
  getComponentTranslationChanges: read,
  declareComponentSourceChange: writes('translation.declared'),
  listDocumentTranslationJobs: read,
  makeDocumentTranslationJob: writes('translation.job_sent', 'line.diverged'),
  downloadDocumentTranslationJob: writes('export.downloaded'),
  closeDocumentTranslationJob: writes('translation.job_closed'),
  returnDocumentTranslationJob: { none: 'returning' },
  getDocumentTranslationJobHeld: read,
  decideDocumentTranslationJobItem: writes('translation.job_decided', 'content.version_cut'),
  listComponentLines: read,
  compareComponentLine: read,
  bringComponentLineBack: writes('line.returned'),
  readDocumentEffective: read,
  transitionQueryDefinition: writes('workflow.transitioned'),
  decideQueryDefinitionGate: writes(
    'approval.given',
    'gate.rejected',
    'revision.designated',
    'workflow.transitioned',
  ),
  listQueryDefinitionApprovals: read,
  transitionPrompt: writes('workflow.transitioned'),
  decidePromptGate: writes(
    'approval.given',
    'gate.rejected',
    'revision.designated',
    'workflow.transitioned',
  ),
  listPromptApprovals: read,
  transitionTerm: writes('workflow.transitioned'),
  decideTermGate: writes(
    'approval.given',
    'gate.rejected',
    'revision.designated',
    'workflow.transitioned',
  ),
  listTermApprovals: read,
  placeHold: writes('hold.applied'),
  releaseHold: writes('hold.removed'),
  createAssetUpload: { none: 'upload' },
  putAssetUploadBytes: writes('asset.refused'),
  getAssetUpload: read,
  getAssetVersion: read,
  getAssetVersionContent: read,
  listTemplates: read,
  createTemplate: writes('content.version_cut'),
  getTemplate: read,
  recordTemplateVersion: writes('content.version_cut'),
  listConnections: read,
  createConnection: writes('content.version_cut', 'connection.made'),
  getConnection: read,
  recordConnectionVersion: writes(
    'content.version_cut',
    'connection.changed',
    'connection.retired',
  ),
  setConnectionCredential: writes('connection.credential_set', 'connection.tested'),
  testConnection: writes('connection.tested'),
  describeConnection: { none: 'source' },
  sampleConnection: { none: 'source' },
  getConnectionUses: read,
  listQueryDefinitions: read,
  createQueryDefinition: writes('content.version_cut'),
  getQueryDefinition: read,
  recordQueryDefinitionVersion: writes('content.version_cut'),
  getQueryDefinitionUses: read,
  listPrompts: read,
  createPrompt: writes('content.version_cut'),
  getPrompt: read,
  recordPromptVersion: writes('content.version_cut'),
  listBibliographyEntries: read,
  createBibliographyEntry: writes('content.version_cut'),
  // Each record made or merged is a version, made or cut.
  importBibliographyEntries: writes('content.version_cut'),
  exportBibliographyEntries: read,
  getBibliographyEntry: read,
  recordBibliographyEntryVersion: writes('content.version_cut'),
  getBibliographyEntryUses: read,
  archiveBibliographyEntry: writes('artifact.archived'),
  unarchiveBibliographyEntry: writes('artifact.unarchived'),
  listTerms: read,
  createTerm: writes('content.version_cut'),
  // An import held apart until accepted or abandoned (the IM plan, IM-A, IM-F).
  createImport: { none: 'importing' },
  putImportFile: { none: 'importing' },
  listImports: read,
  getImport: read,
  setImportLevels: { none: 'importing' },
  setImportKind: { none: 'importing' },
  // Review: a part read, the parts searched, an edit or the importer's place (IMb).
  getImportPart: read,
  searchImportParts: read,
  editImport: { none: 'importing' },
  setImportPlace: { none: 'importing' },
  acceptImport: writes('import.accepted', 'content.version_cut'),
  abandonImport: writes('import.abandoned'),
  // Each concept made or merged is a version, made or cut.
  importTerms: writes('content.version_cut'),
  exportTerms: read,
  getTerm: read,
  recordTermVersion: writes('content.version_cut'),
  getTermUses: read,
  archiveTerm: writes('artifact.archived'),
  unarchiveTerm: writes('artifact.unarchived'),
  listCitationStyles: read,
  createCitationStyle: writes('content.version_cut'),
  // Renders the sample entries, keeping nothing.
  previewCitationStyle: read,
  previewComponentCitations: read,
  previewComponentTerms: read,
  getCitationStyle: read,
  recordCitationStyleVersion: writes('content.version_cut'),
  listReferenceSources: read,
  setReferenceSource: writes('settings.changed'),
  searchReferenceSource: { none: 'source' },
  createBibliographyEntryFromSource: writes('content.version_cut'),
  checkBibliographyEntry: { none: 'checked' },
  getDocumentFlaggedSources: read,
  listPromptLibraries: read,
  createPromptLibrary: writes('content.version_cut'),
  getPromptLibrary: read,
  recordPromptLibraryVersion: writes('content.version_cut'),
  getDocumentBindings: read,
  // A dataset version, and what each binding takes from it (dataset_take, derived), and its event.
  // Each also decides the values revised by hand standing on what it replaces (the RV plan, RV-D).
  resolveBindings: writes('content.version_cut', 'binding.resolved', 'binding.revised'),
  checkBindings: writes('content.version_cut', 'binding.checked'),
  acceptBinding: writes('binding.accepted', 'binding.revised'),
  confirmBinding: writes('binding.confirmed', 'binding.revised'),
  reviseBinding: writes('binding.revised'),
  getBindingHolders: read,
  getDocumentDataset: read,
  getBoundTableRows: read,
  nameDataset: writes('dataset.named'),
  listDatasetSources: read,
  // A stored result queried as a source: nothing kept, the run metered (R21-A).
  sampleDataset: { none: 'metering' },
  // A GET that writes: it finishes a pending result as the act that ran it would have.
  getPendingResult: writes(
    'content.version_cut',
    'binding.resolved',
    'binding.checked',
    'binding.revised',
  ),
  listDefinitions: read,
  createDefinition: writes('content.version_cut'),
  getDefinition: read,
  recordDefinitionVersion: writes('content.version_cut'),
  listPeople: read,
  search: read,
  getPresentation: read,
  getDocumentPresentation: read,
  getEditingSettings: read,
  setEditingSettings: writes('settings.changed'),
  getDataSettings: read,
  setDataSettings: writes('settings.changed'),
  getImportSettings: read,
  setImportSettings: writes('settings.changed'),
  getTranslationSettings: read,
  setTranslationSettings: writes('settings.changed'),
  listTokens: read,
  createToken: writes('token.issued'),
  revokeToken: writes('token.revoked'),
  listSessions: read,
  beatPresence: { none: 'presence' },
  leavePresence: { none: 'presence' },
  endSession: writes('authentication.signed_out'),
  endOtherSessions: writes('authentication.signed_out'),
  listPrincipalTokens: read,
  revokePrincipalToken: writes('token.revoked'),
  listExtensions: read,
  previewExtension: read,
  installExtension: writes('extension.changed'),
  getExtension: read,
  previewExtensionUpdate: read,
  updateExtension: writes('extension.changed'),
  listExtensionUses: read,
  removeExtension: writes('extension.changed'),
  setExtensionSecret: writes('extension.changed'),
  listWebhooks: read,
  createWebhook: writes('webhook.changed'),
  getWebhook: read,
  changeWebhook: writes('webhook.changed'),
  rotateWebhookSecret: writes('webhook.changed'),
  removeWebhook: writes('webhook.changed'),
  listWebhookDeliveries: read,
  getWebhookDelivery: read,
  listServiceIdentities: read,
  createServiceIdentity: writes('service_identity.created'),
  changeServiceIdentity: writes('service_identity.renamed'),
  disableServiceIdentity: writes('service_identity.disabled', 'token.revoked', 'webhook.changed'),
  issueServiceIdentityToken: writes('token.issued'),
  getErasure: read,
  erasePrincipal: writes(
    'authentication.signed_out',
    'token.revoked',
    'group.member_removed',
    'invitation.withdrawn',
    'audit.label_erased',
  ),
};

/** The writers that are not routes, by where they are found and their name. */
const WRITERS: Readonly<Record<string, Readonly<Record<string, Entry>>>> = {
  /** The worker's jobs, by the kind each handles (apps/worker/src/main.ts). */
  jobs: {
    sample_pdf: { none: 'derived' },
    publish: writes('publication.produced', 'publication.failed'),
    preview: { none: 'preview' },
    ingest: writes('content.version_cut', 'asset.ingested', 'asset.refused'),
    check_pdf: { none: 'derived' },
    // Asking for it was the event, and each download is (the AU2 plan, AU-N).
    audit_export: { none: 'derived' },
    // A report of what is recorded, kept for its requester alone (the R3 plan, R3-F).
    impact_report: { none: 'derived' },
    tenant_export: { none: 'derived' },
    range: { none: 'preview' },
    // Each row's document cut at 0.1, as a document made by hand is (the R7 plan, R7-E).
    cohort: writes('content.version_cut'),
    // Each batch a run, recorded as every run is (the G7 plan, G7-F).
    embed: writes('generation.run'),
    // A proposal written, or the import failed with nothing left (the IM plan, IM-C).
    import: { none: 'importing' },
    // Each component it applies cut, and what came back recorded (the XL plan, XL-F).
    translation_return: writes('translation.job_returned', 'content.version_cut'),
  },
  /** The worker's sweeps (apps/worker/src/sweep.ts). */
  sweeps: {
    sweepExpiredSignIns: writes('authentication.signed_out'),
    sweepExpiredIterations: { none: 'iteration' },
    sweepExpiredQueryRuns: { none: 'metering' },
    sweepUncheckedPublications: { none: 'derived' },
    sweepExpiredPreviews: { none: 'preview' },
    sweepExpiredTenantExports: { none: 'derived' },
    sweepExpiredRangePreviews: { none: 'preview' },
    sweepAbandonedGenerationRuns: { none: 'derived' },
    sweepQueryEmbeddingsEverywhere: { none: 'derived' },
    sweepEmbeddingLagEverywhere: { none: 'derived' },
    sweepStalePresence: { none: 'presence' },
    foldNotificationDigests: { none: 'inbox' },
    sweepOldNotifications: { none: 'inbox' },
    sweepDates: writes('revision.effective', 'review.lapsed', 'workflow.transitioned'),
    // Deliveries done with past 30 days, which the attempts they held go with (the WB plan, WB-I).
    sweepWebhookDeliveriesEverywhere: { none: 'derived' },
    // A proposal left 30 days abandoned as the system, its importer told seven days before (IM-F).
    sweepImportsEverywhere: writes('import.abandoned'),
  },
  /** The worker's webhook delivery loop (apps/worker/src/webhooks.ts; the WB plan, WB-I). */
  delivery: {
    // A subscription failing three days disabled, as the system (WB-E).
    deliverWebhooks: writes('webhook.changed'),
  },
  /** The vendor's functions: everything in packages/db that runs through `asAdministrator`. */
  vendor: {
    closeSignInRoute: writes('sign_in_route.closed', 'authentication.signed_out'),
    configureOrganisationSignIn: writes('sign_in_route.configured'),
    inviteToTenant: writes('tenant.invited'),
    permitGoogleSignIn: writes('sign_in_route.configured'),
    inviteFirstAdministrator: writes(
      'tenant.administrator_named',
      'access.granted',
      'access.revoked',
      'group.member_removed',
      'invitation.withdrawn',
    ),
    recordStoreCredential: { none: 'platform' },
  },
  /** Development's setup (packages/db/src/dev-content.ts), as the vendor. */
  development: {
    seedDevelopmentContent: writes('content.version_cut', 'access.granted'),
    seedDevelopmentConnectionUse: writes('access.granted'),
  },
  /** Erasure of labels (packages/db/src/audit.ts), which erasing a person ends with. */
  erasure: {
    eraseLabels: writes('audit.label_erased'),
  },
  /**
   * The MCP surface (apps/service/src/mcp/route.ts), a route outside the contract: each tool call is
   * recorded there, and what the route it wraps records is that route's own (ADR-0065).
   */
  mcp: {
    'tools/call': writes('tool.used'),
  },
};

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The exported functions of a module whose body holds `call`. */
function exportedCalling(text: string, call: string): string[] {
  return text
    .split(/^export /m)
    .slice(1)
    .flatMap((chunk) => {
      const name = /^(?:async )?function (\w+)/.exec(chunk)?.[1];
      return name !== undefined && chunk.includes(call) ? [name] : [];
    });
}

const kindsOf = (entry: Entry) => ('writes' in entry ? entry.writes : []);
const everyEntry = [
  ...Object.values(ROUTES),
  ...Object.values(WRITERS).flatMap((group) => Object.values(group)),
];

/**
 * A requirement whose statement says an act of it is audited (LIF-063). Read from the compiled corpus,
 * `packages/trace/trace.json`, so a requirement added saying so fails here until a kind names it.
 */
const SAYS_AUDITED =
  /\b(be|been|is|are)\s+(\w+\s+)?audited\b|\baudited\s+(act|event)\b|\brecorded in the audit log\b|\baudited into\b|\band audited\b|\baudited with\b|, audited\b/i;

/** Matched by the words, and stating no act the log records. */
const NOT_AN_ACT: Readonly<Record<string, string>> = {
  'CNT-177': 'A person audits a release against WCAG; nothing is logged',
  'ADM-044': 'Schedules re-verifying audit exports, an act on exports and not one of its own',
  'LIF-063': 'This rule itself',
};

describe('the census of the audit log', () => {
  it('LIF-063 names, in some kind, every requirement that says an act of it is audited', () => {
    const corpus = JSON.parse(source('../../../packages/trace/trace.json')) as {
      requirements: { id: string; statement: string; status: string }[];
    };
    const named = new Set(auditKinds.flatMap((kind) => auditKindSpecs[kind].requirements));
    const audited = corpus.requirements
      .filter((requirement) => !requirement.status.startsWith('Superseded'))
      .filter((requirement) => SAYS_AUDITED.test(requirement.statement))
      .map((requirement) => requirement.id);
    expect(audited).toEqual(expect.arrayContaining(['AST-037', 'DAT-007', 'IAM-060']));
    expect(audited.filter((id) => !named.has(id) && !(id in NOT_AN_ACT))).toEqual([]);
  });

  it('LIF-067 writes a kind for every act its list names, each from a route or writer the census holds', () => {
    // LIF-067's list, each act by the kinds that record it; each emitter's own test shows it lands.
    const acts: Readonly<Record<string, readonly AuditKind[]>> = {
      authentication: [
        'authentication.signed_in',
        'authentication.sign_in_failed',
        'authentication.signed_out',
      ],
      'refused authorisation': ['access.refused'],
      'content change': ['content.version_cut', 'content.restored'],
      'binding resolution and refresh': [
        'binding.resolved',
        'binding.checked',
        'binding.accepted',
        'binding.confirmed',
      ],
      publication: ['publication.requested', 'publication.produced', 'publication.failed'],
      export: ['export.produced', 'export.downloaded'],
      'permission change': ['access.granted', 'access.revoked'],
      'administrative action': [
        'space.made',
        'group.made',
        'group.member_added',
        'invitation.sent',
        'settings.changed',
        'retention.changed',
      ],
    };
    const written = new Set([...ON_ANY_ROUTE, ...everyEntry.flatMap(kindsOf)]);
    for (const [act, kinds] of Object.entries(acts)) {
      for (const kind of kinds) {
        expect(auditKindSpecs[kind].requirements, `${act}: ${kind}`).toContain('LIF-067');
        expect(auditKindSpecs[kind].emittedBy, `${act}: ${kind}`).not.toBeNull();
        expect(written.has(kind), `${act}: ${kind}`).toBe(true);
      }
    }
  });

  it('lists every operation the contract declares, GETs included, and nothing else', () => {
    expect(Object.keys(ROUTES).sort()).toEqual(allRoutes.map((route) => route.operationId).sort());
  });

  it('names only kinds the domain lists, each with a module that writes it', () => {
    for (const entry of everyEntry) {
      for (const kind of kindsOf(entry)) {
        expect(isAuditKind(kind), kind).toBe(true);
        expect(auditKindSpecs[kind].emittedBy, kind).not.toBeNull();
      }
      if ('none' in entry) expect(REASONS[entry.none]).toBeDefined();
    }
  });

  it('finds a writer for every kind AU1 emits', () => {
    const written = new Set([...ON_ANY_ROUTE, ...everyEntry.flatMap(kindsOf)]);
    const emitted = auditKinds.filter((kind) => auditKindSpecs[kind].emittedBy !== null);
    expect(emitted.filter((kind) => !written.has(kind))).toEqual([]);
  });

  it("pins the worker's jobs to the handlers it registers", () => {
    const main = source('../../worker/src/main.ts');
    const block = /const handlers: Record<string, JobHandler> = \{([\s\S]*?)^\};/m.exec(main)?.[1];
    expect(block).toBeDefined();
    const registered = [...block!.matchAll(/^\s+(\w+)[:,]/gm)].map((match) => match[1]);
    expect(Object.keys(WRITERS.jobs!).sort()).toEqual(registered.sort());
  });

  it("pins the worker's sweeps to those it exports", () => {
    const sweeps = [
      ...source('../../worker/src/sweep.ts').matchAll(/^export async function (\w+)/gm),
    ]
      .map((match) => match[1])
      .sort();
    expect(Object.keys(WRITERS.sweeps!).sort()).toEqual(sweeps);
  });

  it('pins the vendor functions to everything that runs as an administrator', () => {
    const folder = new URL('../../../packages/db/src/', import.meta.url);
    const found = readdirSync(folder)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'admin.ts')
      .flatMap((name) =>
        exportedCalling(source(`../../../packages/db/src/${name}`), 'asAdministrator('),
      )
      .sort();
    expect(Object.keys(WRITERS.vendor!).sort()).toEqual(found);
  });

  it("pins development's setup and erasure to the functions that write them", () => {
    const seeds = [
      ...source('../../../packages/db/src/dev-content.ts').matchAll(
        /^export async function (seed\w+)/gm,
      ),
    ].map((match) => match[1]);
    expect(Object.keys(WRITERS.development!).sort()).toEqual(seeds.sort());
    expect(exportedCalling(source('../../../packages/db/src/audit.ts'), 'erase_labels(')).toEqual(
      Object.keys(WRITERS.erasure!),
    );
  });
});
