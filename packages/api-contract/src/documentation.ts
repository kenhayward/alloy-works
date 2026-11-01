import type { RouteContract } from './contract.js';

/** Stable, human-facing navigation; a route may appear in only one leaf. */
export const documentationGroups = [
  {
    name: 'Start here',
    tags: [
      { name: 'Environments', description: 'Find the environment served by this hostname.' },
      { name: 'Identity', description: 'Sign in and identify the current caller.' },
    ],
  },
  {
    name: 'Content',
    tags: [
      {
        name: 'Spaces',
        description: 'Find, make, rename and archive spaces, and create content in them.',
      },
      { name: 'Components', description: 'Read, edit and version reusable components.' },
      {
        name: 'Documents',
        description: 'Create documents and work with their outlines and values.',
      },
      { name: 'Definitions', description: 'Manage fields, metadata schemas and component types.' },
      { name: 'Templates', description: 'Create and version document templates.' },
      {
        name: 'Bibliography',
        description:
          "Keep a space's bibliography entries, import and export them, see where each is cited, search Crossref and PubMed for a source to cite, and keep the environment's citation styles.",
      },
      {
        name: 'Terms',
        description:
          "Keep a space's governed terms, their labels per language, definitions and relations, see where each is used, and import and export them as SKOS.",
      },
      {
        name: 'Vocabularies',
        description:
          "Read the environment's vocabularies, the values a field or an axis may take with their labels per language, and import and export them as SKOS.",
      },
      {
        name: 'Licences',
        description:
          "Read the environment's licences: what an image held under each may be used for, and the credit it needs.",
      },
      {
        name: 'Translations',
        description:
          "Translate a component into another language as a variant of its own, see each variant's status against its source, and declare which source changes need retranslating.",
      },
      { name: 'Assets', description: 'Upload and retrieve image assets.' },
      {
        name: 'Imports',
        description:
          'Import a Word, Markdown or HTML file into a space as a proposed outline of sections and components, and accept or abandon it.',
      },
      {
        name: 'Threads',
        description:
          'Discuss a span, a cell, a component or a section beside the content, and resolve it.',
      },
      {
        name: 'Inbox',
        description:
          'Read and clear your notifications, choose how often you are told, and see what waits on you.',
      },
      {
        name: 'Suggestions',
        description:
          'Suggest a change to a component beside it, and accept, reject or withdraw one.',
      },
      {
        name: 'Review rounds',
        description:
          'Ask named people to review a document by a date, and see who has reviewed it.',
      },
      {
        name: 'Workflow',
        description:
          "Declare each kind's workflow states and transitions, and move components and documents along them.",
      },
    ],
  },
  {
    name: 'Data',
    tags: [
      {
        name: 'Connections',
        description:
          'Make connections to your own data sources, set their credentials, and test them.',
      },
      {
        name: 'Query definitions',
        description:
          'Write the queries a document will bind to, and run them against sample values first.',
      },
      {
        name: 'Bindings and datasets',
        description:
          "Resolve, check and accept the results a document's bindings hold, read them, and name the datasets they are versions of.",
      },
    ],
  },
  {
    name: 'Publishing',
    tags: [
      {
        name: 'Comparison',
        description: 'Compare two versions of a component, or two baselines of a document.',
      },
      {
        name: 'Baselines',
        description: 'Pin a document and everything it uses under a name, and supersede one.',
      },
      { name: 'Previews', description: 'Request a short-lived PDF preview.' },
      { name: 'Publication requests', description: 'Submit and follow publishing work.' },
      { name: 'Publications', description: 'List and retrieve completed publications.' },
      {
        name: 'Range previews',
        description:
          'The pages of the occurrence being edited and one either side, drawn from its author’s saves as pictures within a second, untagged by design and saying so: the tagged PDF a preview makes is the accessible path.',
      },
      {
        name: 'Assistant',
        description:
          'Ask the assistant about the open document: it reads what you may read of it, shows each call it makes and what came back, cites what it read, and proposes edits that change nothing until you accept one, keep it as a suggestion or discard it.',
      },
      {
        name: 'Conversations',
        description:
          'Hold a conversation with a model, on a document or on none: your own words, on an endpoint you choose, each turn governed as the assistant is and kept with its run.',
      },
      {
        name: 'Personal prompts',
        description:
          'Your own saved prompts, which nobody else reads or runs and no template binds, and promoting one into a space as a shared prompt.',
      },
      {
        name: 'Guardrails',
        description:
          'Phrases your environment forbids in what a model is sent and what it returns, each with the reason a refusal says. A phrase, never a pattern; nothing here changes what the assistant may do.',
      },
      {
        name: 'Model limits',
        description:
          'How many model runs each person may start an hour: the environment’s limit, and a person’s own in place of it. A run over it is refused, saying when one is free again.',
      },
      {
        name: 'Model budget',
        description:
          'The environment’s monthly limit on what models cost, the percents of it that alert, and who is told, through the inbox. Nothing stops when it is spent: every capability continues, declared here in advance.',
      },
      {
        name: 'Embedding',
        description:
          'The model meaning is searched by, and one embedding is routed to that waits: what embedding the corpus would cost, and confirming it, before anything is embedded. The serving model answers until the new one has every text.',
      },
      {
        name: 'Prompts',
        description:
          'Named, versioned prompts: the instructions, the context each declares and nothing beyond it, the text it writes and the models it accepts; and the libraries that list them, one bound by each template.',
      },
      {
        name: 'Model endpoints',
        description:
          'The model endpoints the environment calls, on its own provider accounts: their keys, which the connector seals and no route answers, whether each sits outside the data boundary, which purpose goes to which, and a test recorded as a run.',
      },
      {
        name: 'Tenant export',
        description:
          'The whole environment exported as a job: its content, versions, relationships, baselines and publication records as JSON Lines, the bytes they name by hash, and a manifest of what it leaves out. Kept seven days.',
      },
      {
        name: 'Stored results as sources',
        description:
          'A query result kept by the environment, queried as a source of its own through the query builder, never touching the source it came from.',
      },
      {
        name: 'Query usage',
        description:
          'What the environment’s query runs cost, by query and by document, and every run as CSV.',
      },
      {
        name: 'Publication shares',
        description:
          'Share a publication with a named person outside the organisation, revoke it, and read every access.',
      },
      {
        name: 'Presentation and numbering',
        description: 'Read layout, theme and document numbering.',
      },
    ],
  },
  {
    name: 'Identity and access',
    tags: [
      {
        name: 'Tokens',
        description: 'Issue, list and revoke personal API tokens with a signed-in session.',
      },
      {
        name: 'Extensions',
        description:
          'Install a source type from its manifest, read what it declares, update and remove it.',
      },
      {
        name: 'Webhooks',
        description:
          'Subscribe a service identity’s endpoint to events, signed, and manage its secret.',
      },
      {
        name: 'CT Studio bridge',
        description:
          'Set up a space to take deliveries from CT Studio: the component type and template it uses, which template field each property fills, and whether data tables are delivered to it.',
      },
      {
        name: 'Service identities',
        description:
          'Make and disable service identities for integrations and agents, and issue them tokens.',
      },
      { name: 'People and principals', description: 'Find people that access grants may name.' },
      { name: 'Groups', description: 'Manage group membership and provider-backed groups.' },
      { name: 'Sessions', description: 'See and end your own sessions.' },
      { name: 'Invitations', description: 'Invite people before their first sign-in.' },
      { name: 'Roles and grants', description: 'Inspect permissions and manage grants.' },
    ],
  },
  {
    name: 'Discovery and administration',
    tags: [
      { name: 'Search', description: 'Search content the caller may read.' },
      {
        name: 'Impact',
        description: 'What a change to an artifact reaches, and what an artifact uses.',
      },
      {
        name: 'Relationships',
        description:
          'Declared relationships between artifacts, each of a type a definition declares, read from both ends.',
      },
      {
        name: 'Cohorts',
        description:
          'Documents made in bulk from one template, one for each row of parameters, found again as a set.',
      },
      {
        name: 'Jobs',
        description:
          "Follow, cancel and download work that outlives a request: each job is its submitter's alone.",
      },
      { name: 'Settings', description: 'Read and change environment settings.' },
      {
        name: 'Legal holds',
        description: 'Place a legal hold on an artifact or a space, list holds and release one.',
      },
      {
        name: 'Deletion and retention',
        description:
          'List deleted components and documents, and set how long content is kept before it may be deleted.',
      },
      { name: 'Audit log', description: 'Read and export the environment’s audit log.' },
    ],
  },
  {
    name: 'Realtime and service',
    tags: [
      {
        name: 'Event stream',
        description:
          'Receive environment events. The event protocol is specified separately from OpenAPI.',
      },
      { name: 'Health', description: 'Check service availability and development scaffolding.' },
    ],
  },
] as const;

const operationTags = {
  Health: ['getHealth', 'requestSample', 'getSample'],
  Environments: ['getTenant', 'getAbout'],
  Identity: [
    'getMe',
    'getMyPreferences',
    'setMyPreferences',
    'startOrganisationSignIn',
    'finishOrganisationSignIn',
    'startGoogleSignIn',
    'finishGoogleSignIn',
    'completeGoogleSignIn',
    'signOut',
  ],
  Spaces: ['listSpaces', 'createSpace', 'updateSpace', 'listComponentTypes'],
  Components: [
    'listComponents',
    'getComponent',
    'createComponent',
    'listIterations',
    'getIteration',
    'discardUnsaved',
    'saveIteration',
    'claimLock',
    'takeLock',
    'releaseLock',
    'listComponentVersions',
    'getComponentVersion',
    'cutVersion',
    'previewRestore',
    'restoreVersion',
    'archiveComponent',
    'unarchiveComponent',
    'getComponentDeletion',
    'deleteComponent',
    'undeleteComponent',
    'getComponentUses',
    'getStyleUses',
  ],
  Documents: [
    'listDocuments',
    'listDocumentVersions',
    'getDocumentVersion',
    'previewDocumentRestore',
    'restoreDocumentVersion',
    'archiveDocument',
    'unarchiveDocument',
    'getDocumentDeletion',
    'deleteDocument',
    'undeleteDocument',
    'getDocument',
    'createDocument',
    'editOutline',
    'previewPlacement',
    'placeSection',
    'getDocumentTexts',
    'recordDocumentValues',
    'getDocumentParameters',
    'recordDocumentParameters',
    'recordDocumentProfile',
    'recordDocumentFallback',
    'getContributions',
  ],
  Definitions: ['listDefinitions', 'createDefinition', 'getDefinition', 'recordDefinitionVersion'],
  Templates: [
    'listTemplates',
    'createTemplate',
    'getTemplate',
    'recordTemplateVersion',
    'previewTemplateMove',
    'moveDocumentTemplate',
  ],
  Connections: [
    'listConnections',
    'createConnection',
    'getConnection',
    'recordConnectionVersion',
    'setConnectionCredential',
    'testConnection',
    'describeConnection',
    'sampleConnection',
    'getConnectionUses',
  ],
  'Query definitions': [
    'listQueryDefinitions',
    'createQueryDefinition',
    'getQueryDefinition',
    'recordQueryDefinitionVersion',
    'getQueryDefinitionUses',
  ],
  'Bindings and datasets': [
    'getDocumentBindings',
    'resolveBindings',
    'checkBindings',
    'acceptBinding',
    'confirmBinding',
    'reviseBinding',
    'getBindingHolders',
    'getDocumentDataset',
    'getBoundTableRows',
    'nameDataset',
    'getPendingResult',
  ],
  Assets: [
    'listSpaceAssets',
    'getAssetUses',
    'createAssetUpload',
    'createAssetReplacement',
    'getAssetUpload',
    'putAssetUploadBytes',
    'getAssetVersion',
    'getAssetVersionContent',
    'getAssetVersionDerivative',
    'discardAssetDerivatives',
    'getAssetRights',
    'setAssetRights',
  ],
  Threads: [
    'startComponentThread',
    'startDocumentThread',
    'listComponentThreads',
    'listDocumentThreads',
    'getThread',
    'addComment',
    'editComment',
    'markThreadInternal',
    'resolveThread',
  ],
  Inbox: [
    'getAttention',
    'listInbox',
    'markNotificationRead',
    'deleteNotification',
    'getInboxPreferences',
    'setInboxPreferences',
  ],
  Suggestions: [
    'makeSuggestion',
    'listComponentSuggestions',
    'listDocumentSuggestions',
    'getSuggestion',
    'acceptSuggestion',
    'rejectSuggestion',
    'withdrawSuggestion',
    'resolveSuggestions',
  ],
  'Review rounds': [
    'listBaselineThreads',
    'openRound',
    'listRounds',
    'getRound',
    'closeRound',
    'startReview',
    'completeReview',
    'reopenReview',
  ],
  Previews: ['requestPreview'],
  Comparison: [
    'compareComponentVersions',
    'compareBaseline',
    'compareBaselineResolved',
    'listChangesSince',
  ],
  Baselines: [
    'makeBaseline',
    'listBaselines',
    'getBaseline',
    'getBaselineView',
    'publishBaseline',
    'supersedeBaseline',
  ],
  'Publication requests': ['requestPublication', 'getPublicationRequest'],
  Publications: [
    'listPublications',
    'listPublicationsEverywhere',
    'getPublication',
    'getPublicationBindings',
  ],
  'Query usage': ['getQueryUsage', 'getQueryRunsCsv'],
  'Stored results as sources': ['listDatasetSources', 'sampleDataset'],
  'Range previews': [
    'requestRangePreview',
    'getRangePreview',
    'refreshRangePreview',
    'getRangePage',
  ],
  Assistant: [
    'getDocumentGenerated',
    'getPublicationGenerated',
    'startAssistantRun',
    'getAssistantRun',
    'getAssistantUsage',
    'acceptProposal',
    'keepProposal',
    'discardProposal',
  ],
  Guardrails: ['listGuardrails', 'setGuardrail', 'retireGuardrail'],
  'Model limits': ['getModelLimits', 'setModelLimit', 'setPersonLimit'],
  'Model budget': ['getModelBudget', 'setModelBudget', 'setBudgetRecipients', 'getModelUsage'],
  Embedding: ['getEmbedding', 'confirmEmbedding', 'getMeaningFreshness'],
  'Personal prompts': [
    'listPersonalPrompts',
    'savePersonalPrompt',
    'changePersonalPrompt',
    'removePersonalPrompt',
    'promotePersonalPrompt',
  ],
  Conversations: [
    'listConversationEndpoints',
    'startConversation',
    'listConversations',
    'getConversation',
    'updateConversation',
    'getConversationContext',
    'addConversationContext',
    'removeConversationContext',
    'takeTurn',
  ],
  Bibliography: [
    'listBibliographyEntries',
    'createBibliographyEntry',
    'importBibliographyEntries',
    'exportBibliographyEntries',
    'getBibliographyEntry',
    'recordBibliographyEntryVersion',
    'getBibliographyEntryUses',
    'archiveBibliographyEntry',
    'unarchiveBibliographyEntry',
    'previewComponentCitations',
    'listCitationStyles',
    'createCitationStyle',
    'previewCitationStyle',
    'getCitationStyle',
    'recordCitationStyleVersion',
    'listReferenceSources',
    'setReferenceSource',
    'searchReferenceSource',
    'createBibliographyEntryFromSource',
    'checkBibliographyEntry',
    'getDocumentFlaggedSources',
  ],
  Terms: [
    'listTerms',
    'createTerm',
    'importTerms',
    'exportTerms',
    'getTerm',
    'recordTermVersion',
    'getTermUses',
    'archiveTerm',
    'unarchiveTerm',
    'previewComponentTerms',
  ],
  Vocabularies: [
    'listVocabularies',
    'importVocabulary',
    'refreshVocabulary',
    'getVocabulary',
    'getVocabularyUses',
    'exportVocabulary',
  ],
  Licences: ['listLicences', 'getLicence'],
  Translations: [
    'getSpaceTranslations',
    'listComponentTranslations',
    'beginComponentTranslation',
    'markComponentTranslationCurrent',
    'getComponentTranslationChanges',
    'declareComponentSourceChange',
    'listDocumentTranslationJobs',
    'makeDocumentTranslationJob',
    'downloadDocumentTranslationJob',
    'closeDocumentTranslationJob',
    'returnDocumentTranslationJob',
    'getDocumentTranslationJobHeld',
    'decideDocumentTranslationJobItem',
    'draftComponentTranslation',
    'acceptComponentMachineDraft',
  ],
  Prompts: [
    'listPrompts',
    'createPrompt',
    'getPrompt',
    'recordPromptVersion',
    'listPromptLibraries',
    'createPromptLibrary',
    'getPromptLibrary',
    'recordPromptLibraryVersion',
    'listDocumentPrompts',
    'startPromptRun',
    'startPromptTrial',
  ],
  'Model endpoints': [
    'listModelEndpoints',
    'makeModelEndpoint',
    'getModelEndpoint',
    'changeModelEndpoint',
    'retireModelEndpoint',
    'setModelEndpointKey',
    'testModelEndpoint',
    'listModelRoutes',
    'setModelRoute',
  ],
  'Tenant export': [
    'requestTenantExport',
    'listTenantExports',
    'getTenantExport',
    'downloadTenantExport',
  ],
  'Publication shares': [
    'listPublicationShares',
    'sharePublication',
    'revokePublicationShare',
    'getSharedOutput',
  ],
  'Presentation and numbering': ['getNumbering', 'getDocumentPresentation', 'getPresentation'],
  Tokens: [
    'listTokens',
    'createToken',
    'revokeToken',
    'listPrincipalTokens',
    'revokePrincipalToken',
  ],
  Extensions: [
    'listExtensions',
    'previewExtension',
    'installExtension',
    'getExtension',
    'previewExtensionUpdate',
    'updateExtension',
    'listExtensionUses',
    'removeExtension',
    'setExtensionSecret',
  ],
  Webhooks: [
    'listWebhooks',
    'createWebhook',
    'getWebhook',
    'changeWebhook',
    'rotateWebhookSecret',
    'removeWebhook',
    'listWebhookDeliveries',
    'getWebhookDelivery',
  ],
  'CT Studio bridge': [
    'getBridgeSettings',
    'putBridgeSettings',
    'getCtStudio',
    'connectCtStudio',
    'issueCtStudioToken',
    'disconnectCtStudio',
  ],
  'Service identities': [
    'listServiceIdentities',
    'createServiceIdentity',
    'changeServiceIdentity',
    'disableServiceIdentity',
    'issueServiceIdentityToken',
  ],
  Sessions: ['listSessions', 'endSession', 'endOtherSessions'],
  'Event stream': ['openStream', 'beatPresence', 'leavePresence'],
  'People and principals': ['listPeople', 'listPrincipals', 'getErasure', 'erasePrincipal'],
  Groups: ['listGroups', 'createGroup', 'deleteGroup', 'setGroupMembers'],
  Invitations: ['listInvitations', 'invite', 'withdrawInvitation'],
  'Roles and grants': [
    'getAccess',
    'explainAccess',
    'listRoles',
    'listGrants',
    'makeGrant',
    'extendGrant',
    'listExternalAccess',
    'removeGrant',
  ],
  Search: ['search'],
  Impact: ['getArtifactImpact', 'getArtifactReferences', 'submitImpactReport'],
  Jobs: ['getJob', 'cancelJob', 'downloadJob'],
  Cohorts: ['submitCohort', 'listCohorts', 'getCohort', 'rerunCohort'],
  Relationships: [
    'makeRelationship',
    'getRelationship',
    'changeRelationship',
    'removeRelationship',
    'getArtifactRelationships',
    'getArtifactPath',
  ],
  Settings: [
    'getEditingSettings',
    'setEditingSettings',
    'getDataSettings',
    'setDataSettings',
    'getImportSettings',
    'setImportSettings',
    'getImagesSettings',
    'setImagesSettings',
    'getTranslationSettings',
    'setTranslationSettings',
    'getTranslationSettingsHistory',
  ],
  'Legal holds': ['placeHold', 'releaseHold', 'listHolds'],
  'Deletion and retention': ['listDeleted', 'getRetention', 'setRetention'],
  Workflow: [
    'listWorkflows',
    'getWorkflowVersion',
    'defineWorkflow',
    'transitionComponent',
    'transitionDocument',
    'decideComponentGate',
    'decideDocumentGate',
    'listComponentApprovals',
    'listDocumentApprovals',
    'transitionQueryDefinition',
    'decideQueryDefinitionGate',
    'listQueryDefinitionApprovals',
    'transitionPrompt',
    'decidePromptGate',
    'listPromptApprovals',
    'transitionTerm',
    'decideTermGate',
    'listTermApprovals',
    'setComponentDates',
    'setDocumentDates',
    'setComponentScope',
    'setDocumentScope',
    'acceptComponentRevision',
    'acceptDocumentRevision',
    'readComponentEffective',
    'readDocumentEffective',
    'divergeComponent',
    'listComponentLines',
    'compareComponentLine',
    'bringComponentLineBack',
  ],
  Imports: [
    'createImport',
    'putImportFile',
    'listImports',
    'getImport',
    'setImportLevels',
    'getImportPart',
    'searchImportParts',
    'editImport',
    'setImportPlace',
    'setImportKind',
    'acceptImport',
    'abandonImport',
  ],
  'Audit log': ['listAuditEvents', 'requestAuditExport', 'getAuditExport', 'downloadAuditExport'],
} as const;

const byOperation = new Map<string, string>(
  Object.entries(operationTags).flatMap(([tag, operations]) =>
    operations.map((operation) => [operation, tag] as const),
  ),
);

const descriptions: Readonly<Record<string, string>> = {
  getHealth:
    'Use this check to see whether the service process answers requests. It does not test an environment or its dependencies.',
  getTenant:
    'Returns the environment selected by the request hostname. Check this before using a token or making a change, especially when you have both production and sandbox environments.',
  getAbout:
    'Returns the ICU, Unicode and CLDR versions the service sorts and formats with, and the version of the database collation each interface language sorts listings by, so a change in them is visible. A publication records its own. It needs a signed-in session.',
  getMe:
    'Returns the person represented by the supplied personal token or signed-in session and the environment in which that credential was issued.',
  getMyPreferences:
    'Returns the caller’s own preferences: the language the interface is in, independent of the language of any content they work on, or null where it follows their browser. It needs a signed-in session.',
  setMyPreferences:
    'Chooses the caller’s own interface language, one of the declared languages, or null to follow their browser’s first declared language, else English. It changes nothing of any content’s language. It needs a signed-in session.',
  getAccess:
    'Ask whether the caller may perform each permission on a tenant, space or artifact target. The answer includes token scope restrictions when called with a token.',
  explainAccess:
    'For an administrator, explain each permission a named principal has on a target and the grants and levels behind the answer.',
  listComponents:
    'Lists only components the caller can read, in stable cursor pages. Send the returned next cursor to continue the same listing. Archived components are left out unless archived=only asks for them alone. Each says its translations, by language, with each one’s status.',
  getComponent:
    'Opens the latest component version with the caller’s editing permissions and current lock. Use its version when submitting a change.',
  listIterations:
    'Lists the caller’s retained editing iterations while their session holds the component lock. Iterations are working saves, not released versions.',
  discardUnsaved:
    'Stops offering the caller’s unversioned work on the component for recovery, up to the time given. Nothing is deleted: the iterations stay listed until they expire, and work saved later is offered again.',
  getIteration:
    'Reads one retained editing iteration, including its content and values. The caller must still hold the editing lock.',
  saveIteration:
    'Saves the complete component content for the named editing session and sequence. An editing lock and the version precondition still apply.',
  makeBaseline:
    'Pins the latest version of the document, as a publish would read it: each occurrence’s version, each image’s, each binding’s dataset version, and the layout, theme and template versions in force. Refused on anything a publish would refuse, or a place the caller may not read, each by its node. The name is unique in the document whatever its case, and never changes.',
  listBaselines:
    'Lists the document’s baselines newest first, each with who made it, when, its digest and whether it is superseded. Filter by state with `state`.',
  getBaseline:
    'Reads a baseline and everything it pins that the caller may read, with each version’s digest. An occurrence the caller may not read is named by its node alone, and images by their count.',
  compareComponentVersions:
    'Compares two versions of a component: each block, list item, table cell and footnote matched by identity or by similar wording, saying which, then placed, its text compared word by word. Both versions’ content comes with the changes, for a redline.',
  listChangesSince:
    'Lists what changed since an instant in one scope - a document and the components it places, a space, or up to 200 artifacts a caller already holds - as the caller may read it: each artifact with versions cut since, or deleted or undeleted since, and each value a document resolved or accepted since. Versions are never deleted, so the record begins at the first; a question reaching back before it is answered from there, and says so.',
  compareBaselineResolved:
    'Compares what a publish of a baseline and of another baseline, or of the document now, would print: each component the caller may read whose values differ, or would for a cause, with why - somebody edited it, its data changed, or a definition did - and what differs for the whole document. A difference nobody typed is named as the data’s or the definitions’.',
  compareBaseline:
    'Compares a baseline with a later one of the same document, or with the document as it resolves now: its outline’s changes, and each component whose version differs, compared. A component the caller may not read appears in the outline where it stands and is never compared.',
  getBaselineView:
    'Reads the document as a baseline holds it: its outline at the pinned version, numbered by the pinned layout, each component’s text at its pinned version, and each value from the dataset version it pinned. A component the caller may not read is withheld, as in the document itself.',
  publishBaseline:
    'Publishes a baseline from what it pins, never from the document as it is now: the same version of every component, image and value, under the same layout and theme, compiled at the baseline’s own time, so it is the same publication whenever it is asked for on the same engine. The caller must read everything it pins.',
  startComponentThread:
    'Starts a thread on a component, anchored to a span of a block’s text, a table’s cell, or the whole component, as it stands in the version named, with its first comment. The thread is beside the content, never in it: no version is made.',
  startDocumentThread:
    'Starts a thread on a document, anchored to a node of its outline as it stands in the version named, with its first comment. A thread on a component placed in it is started on the component.',
  listComponentThreads:
    'Lists the threads on a component, newest first, each saying whether its anchor still stands on the latest version. Filter by state, by who started it, or by whether anything was said since an instant.',
  listDocumentThreads:
    'Lists the threads on a document and on every component it places that the caller may read, newest first. A component’s thread says, for each occurrence, whether its anchor stands on the version that occurrence resolves to.',
  getThread:
    'Reads a thread: where it stands, who started and resolved it, and every comment with every text each has had, the latest last.',
  addComment:
    'Replies to an open thread. A resolved thread takes nothing more; start a new one instead.',
  editComment:
    'Gives the caller’s own comment a new text. Every earlier text is kept and read with the thread.',
  markThreadInternal:
    'Makes an open thread internal: from then on nobody from outside the organisation is shown it, its comments or its notifications, or finds it in search. A thread is made internal once and is never made public again, so what was written for colleagues is never shown to a client. Somebody from outside may not make one internal, and a resolved thread is not changed.',
  resolveThread:
    'Resolves an open thread, recording who and when. A thread is resolved once and never reopened.',
  getAttention:
    'Lists what waits on the caller that they may resolve, one item per document, component or connection: a document whose latest publish the caller asked for failed, with its first failure’s code; a component holding changes of theirs not in a version; a document last published from an earlier version than its latest; a connection not tested since its credential was set. Each is listed only where the caller may read it and do what resolves it, and goes once that is done. Computed when asked; at most 20, with the total.',
  listInbox:
    'Lists the caller’s notifications, newest first, and how many are unread. A notification names what happened, who did it, and the thread and what it is on by identifier, never the text; a title is shown only where the caller may read it now. A digest counts a day’s events.',
  markNotificationRead: 'Marks one of the caller’s notifications read.',
  deleteNotification:
    'Deletes one of the caller’s notifications. Notifications are otherwise kept 90 days.',
  getInboxPreferences:
    'Reads how often the caller is told of mentions, replies and resolutions: at once, in a daily digest, or never.',
  setInboxPreferences:
    'Chooses how often the caller is told of each kind named. A daily digest is made after 07:00 UTC.',
  makeSuggestion:
    'Suggests a change to a component: a draft of it, made from one of its versions, kept beside it and never in its content. It needs no lock, so it can be made while the component is being edited. Sending the same draft again answers the suggestion it made.',
  listComponentSuggestions:
    'Lists the suggestions on a component, newest first, each pending one saying where, if anywhere, it no longer fits the component as it is now.',
  listDocumentSuggestions:
    'Lists the suggestions on every component a document places that the caller may read, newest first, as the component’s own list does.',
  getSuggestion:
    'Reads a suggestion and what its redline is drawn from: for a pending one that applies, the component as it is now and what accepting would make; otherwise the version it was made against and the draft.',
  acceptSuggestion:
    'Accepts a suggestion: applies it to the component as it is now, block by block, and records the result as a version by the caller. Refused while somebody else holds the component, or while the caller holds it with saved work, and where it no longer fits, saying where.',
  rejectSuggestion: 'Rejects a suggestion. Refused while somebody else holds the component.',
  listBaselineThreads:
    'Lists the threads on a baseline’s document and on each component it pins that the caller may read, newest first, each judged standing or orphaned against the pinned version rather than the document as it is now: what a review round on a baseline reads (COL-031).',
  openRound:
    'Opens a review round on a document: a title, the people who are to review it, its scope - the whole document or sections of it - and when the reviews are due; on the document as it is, or on one of its baselines, which its reviewers then read as a fixed text. Each reviewer must be a person who may comment on or suggest to the document and read all it covers, or the round is refused, saying how many may not. Each reviewer is told. Needs edit on the document.',
  listRounds:
    'Lists a document’s review rounds, newest first, each with its reviewers by state and whether everybody has reviewed.',
  getRound:
    'Reads a review round: its reviewers, each not started, in progress or complete and how, with the threads and suggestions they made on the document since it opened, and whether everybody has reviewed. Answered from what each reviewer said alone, never from silence.',
  closeRound:
    'Closes a review round for good: nobody may then start, complete or reopen a review in it. Closing applies and approves nothing. Needs edit on the document.',
  startReview:
    'Says the caller has started their review in a round they are reviewing. Saying it again changes nothing.',
  completeReview:
    'Says the caller has finished their review, with comments or with nothing to say. Refused where they have completed already: reopen first to change how.',
  reopenReview:
    'Takes back the caller’s completion while the round is open, recording who and when; they are then in progress.',
  withdrawSuggestion:
    'Withdraws the caller’s own pending suggestion. It is kept, saying who withdrew it and when.',
  resolveSuggestions:
    'Accepts or rejects every pending suggestion on a component or across a document, or one person’s, oldest first: each accepted is its own version. One that no longer fits, is on a component somebody else holds, or that the caller may not edit, is left pending and said so.',
  supersedeBaseline:
    'Marks a baseline superseded by a later baseline of the same document, once. The baseline is kept, read, listed and published as before.',
  takeLock:
    'Asks for a component an idle holder has: refused until they have been idle the environment’s take period. Asked, the holder is told at once on their stream and keeps it if they save anything within a minute; asked again by the same session once that minute has passed, the lock is the asker’s, and the taking is on the audit log.',
  claimLock:
    'Claims or moves the editing lock to the caller’s session. Another holder’s live lock is not overridden.',
  releaseLock:
    'Finishes an editing session, cutting a version if its content changed, then releases the lock.',
  listComponentVersions:
    'Lists released component versions newest first using an opaque cursor. It does not include working iterations. Named, `line` lists that line’s own versions, divergent or a language’s; absent, the main line’s.',
  listDocumentVersions:
    'Lists a document’s versions newest first using an opaque cursor, each with the version it was restored from, if any.',
  getComponentVersion:
    'Reads one version of a component, read only: its content and values as that version holds them, its number, who cut it and when, and which version is the latest. Where a search result from an earlier version links.',
  getDocumentVersion:
    'Reads one version of a document, read only: its outline and values as that version holds them, each reference to a component the caller may not read withheld, its number, who cut it and when, and which version is the latest. Its components’ text is not read.',
  previewDocumentRestore:
    'Answers what restoring an earlier version of a document would make, inserting nothing: its outline compared with the latest’s, a component the caller may not read withheld on both sides, and anything that would refuse it. The outline, its references and their modes and its values come back as they stood; its parameters stay as they are now. Refused by the outline’s own guards: a reference the caller may not read, a section change the template does not allow, or a value its field no longer takes.',
  restoreDocumentVersion:
    'Restores an earlier version of a document as a new version, numbered after the latest and naming the version it was restored from; the earlier version is unchanged. The request names the latest version the restore was previewed against. Each reference whose version it changes is audited as re-pointed, from and to.',
  previewRestore:
    'Answers what restoring an earlier version of a component would make, inserting nothing: the version restored from, the latest it would follow, the earlier values its fields no longer take, and anything that would refuse it. Its content is the earlier version’s as read now; compare it with the latest to see the changes. Named, `line` previews restoring one of that line’s versions after the line’s newest.',
  restoreVersion:
    'Restores an earlier version of a component as a new version, numbered after the latest and naming the version it was restored from; the earlier version is unchanged. The request names the latest version the restore was previewed against. Refused while anybody holds the lock, and where it would change nothing. Named in the body, `line` restores one of that line’s own versions as the line’s next, under the line’s lock, the main line untouched; a language line’s new version translates what the restored one did.',
  cutVersion:
    'Cuts a released version from the editing session’s latest saved iteration. The component lock and version precondition apply.',
  createComponent:
    'Creates a component in the named space at its first version. The caller needs permission to create there.',
  listDocuments:
    'Lists documents the caller can read with stable cursor paging, filters and facets. Archived documents are left out unless archived=only asks for them alone.',
  archiveComponent:
    'Archives a component: it leaves ordinary listings, their counts and search, and still opens by its id, resolves where a document references it and can be edited. Needs retire on the component. Archiving one already archived changes nothing. Audited.',
  unarchiveComponent:
    'Unarchives a component, so it is listed and found again. Needs retire on the component. Unarchiving one not archived changes nothing. Audited.',
  archiveDocument:
    'Archives a document: it leaves ordinary listings, their counts and search, and still opens by its id and publishes. Its publications are not archived with it. Needs retire on the document. Archiving one already archived changes nothing. Audited.',
  unarchiveDocument:
    'Unarchives a document, so it is listed and found again. Needs retire on the document. Unarchiving one not archived changes nothing. Audited.',
  getComponentDeletion:
    'States what deleting a component leaves - its versions, iterations, threads, suggestions and audit events, all kept - and everything that refuses deleting it now: a baseline or a publication that placed any version, a queued publish or preview, a document whose latest version references it, a legal hold on it or its space, a retention keep yet to pass, saying until when, or a lock held. A dependant the caller may not read is never named or counted: the refusal says only that one exists. Needs retire on the component, and answers a deleted one too.',
  deleteComponent:
    'Deletes a component: it leaves every listing, search and reference and answers 410 by its id, and nothing is removed. Refused while anything depends on it, every reason listed as the deletion view lists them. Needs retire on the component. Audited.',
  submitImpactReport:
    'Asks for the complete report of what a change to an artifact reaches, to the depth asked, from 1 to 10, as a job: answered at once with the job, accepted, to follow with getJob. The report has no cap: it is bounded by its depth, and walks as the caller, so nothing they may not read is in it or walked past. Retried with the same Idempotency-Key, it answers the same job. Needs read on the artifact.',
  makeRelationship:
    "Relates two artifacts by a relationship type, each end pinned to a version or floating at its latest, with the values its type's fields take. Refused where the type does not permit an end's kind, an artifact related to itself, a deprecated type, an end already holding the one relationship of the type it may, or, for an acyclic type, a cycle. Needs read on both ends and the permission the type declares at each. Audited.",
  getRelationship:
    'Reads a relationship: its type, its two ends and the versions they pin, and its values. Anybody who may read both ends reads it.',
  changeRelationship:
    'Changes a relationship: an end re-targeted or re-pinned, or its values given whole, each checked as making it is. Needs read on both ends and the permission the type declares at each. Audited.',
  getArtifactRelationships:
    'Lists the relationships of an artifact, one hop, oldest first: each with which end the artifact is, and the artifact at the other end. Filtered by type, by direction, and by the value one field holds, given as text and compared as JSON. A relationship whose other end the caller may not read, or is deleted, is left out, and the answer says only that there were such. Needs read on the artifact.',
  getArtifactPath:
    'Finds one shortest path from an artifact to another, to the depth asked, from 1 to 10, stepping either way along relationships and references; along named relationship types alone, and no reference, where `types` names any. An artifact the caller may not read, or a deleted one, is never stepped onto, and the answer says only that the search met one. Null where no path is within the depth. Needs read on both.',
  removeRelationship:
    'Removes a relationship and records the removal, answering it as it was. Needs read on both ends and the permission the type declares at each.',
  submitCohort:
    "Makes a document in this space for each row of parameters, from one template, as a job: answered at once with the cohort, every row pending, and its job, to follow with getJob. The template and what it names are resolved now, once, and every row is made from that, rerun or not. Rows are given inline, at most 1,000, or taken from a query result's version the caller may read, a parameter for each column. Each document takes the title given, {name} standing for the row's value of that parameter. Each row is made in a transaction of its own: one that is refused leaves nothing and is reported, and the rest are made. Needs create in the space.",
  listCohorts:
    'Lists the cohorts in spaces the caller may read, newest first or by title, a page at a time by an opaque cursor: each with its title, template, space, when it was asked for and how many of its rows were made, failed or wait. Filtered by template, and by state: complete, failed where a row failed, or pending where a row waits and none failed.',
  getCohort:
    "Reads a cohort: its template version, its title, where its rows came from, and every row in order, its parameters, its document once made, or why it failed, and how many times it was tried. Anybody who may read the cohort's space reads it.",
  rerunCohort:
    "Runs a cohort's failed rows again, from the same template version, with any corrected parameters given by row number: answered with the cohort and a new job. A row that was made is never touched. Refused cohort_complete where no row has failed, and rows_invalid where a correction names a row that has not. Needs create in the cohort's space.",
  getJob:
    "Reads a job: its state (accepted, running, succeeded, failed or cancelled), when it was asked for, when it started and finished, how far it has got, whether a cancel was asked for, and how it ended: a failed job's error in an error's shape, or what a finished or cancelled report walked. Only whoever submitted it reads it; anybody else is answered 404.",
  cancelJob:
    'Cancels a job. One not yet started is cancelled at once, having done nothing; a running one is asked to stop, which it does at its next step, keeping nothing and saying how far it got. A finished one is refused, job_finished. Only whoever submitted it may cancel it.',
  downloadJob:
    "Hands out a link, good for five minutes, to a succeeded job's result: an impact report's is JSON Lines, one artifact a line, nearest first, with its kind, title, depth and the artifact it was reached through. Refused, job_not_ready, until it has succeeded. Only whoever submitted it may download it.",
  getArtifactImpact:
    'Says what a change to an artifact reaches: the artifacts whose latest versions reference it, then those referencing them, to the depth asked, from 1 to 10. There is no default depth. Each is listed once, at the fewest hops it is reached in, with the artifact it references one hop nearer, so the walk ends on a cycle. Something the caller may not read is neither listed nor walked past, and the answer says only that the walk was cut there. It stops at the nearest 1,000 and says whether there were more. It walks declared relationships too, an undirected one from either end: each says whether references alone reach it, `hard`, so a change would break or change it, or a relationship does, which is informational. Needs read on the artifact.',
  getArtifactReferences:
    'Says what an artifact uses: what its latest version references, one hop forwards. A document references its components and its template version; a component its images and query definitions; a query definition its connection. Those the caller may read are named, and the answer says whether there is more. Needs read on the artifact.',
  getStyleUses:
    'Lists the components whose latest version uses a style, by what it styles - a paragraph, a table or an image - and its key: a paragraph style wherever a paragraph is, a table cell among them. Those the caller may read are named by title; whether others use it too is said, never which.',
  getComponentUses:
    'Says where a component is used. Lists each document whose latest version places it, with each reference there: `latest` takes every new version of the component, `approved` every approved revision, and `pinned` one version, which no change reaches. Each document carries its workflow state and whether that state is approved, so a change reaching approved documents can be told apart from one reaching drafts. Lists the baselines and publications pinning a version of it apart, since no change reaches them. What the caller may not read, or is deleted, is never named or counted: each list says only whether there is more. Needs read on the component.',
  undeleteComponent:
    'Undeletes a component, everything it kept with it. Never refused by a legal hold or a retention keep. Undeleting one not deleted changes nothing. Needs retire on the component. Audited.',
  getDocumentDeletion:
    'States what deleting a document leaves - its versions, threads, review rounds and audit events, all kept - and everything that refuses deleting it now: its baselines and publications, a queued publish or preview, a legal hold on it or its space, a retention keep yet to pass, saying until when, or an open review round. A dependant the caller may not read is never named or counted: the refusal says only that one exists. Needs retire on the document, and answers a deleted one too.',
  deleteDocument:
    'Deletes a document: it leaves every listing and search and answers 410 by its id, and nothing is removed. Refused while anything depends on it, every reason listed. Needs retire on the document. Audited.',
  undeleteDocument:
    'Undeletes a document, everything it kept with it. Never refused by a legal hold or a retention keep. Undeleting one not deleted changes nothing. Needs retire on the document. Audited.',
  getDocument:
    'Returns the latest document version, including its outline and whether the caller can restructure it.',
  createDocument:
    'Creates a document at version 0.1 in the named space, either empty or from a template’s starting outline.',
  previewPlacement:
    "Reports what placing another document's section here would pull in, placing nothing: how many references it makes, one per occurrence of a component in the section and its subsections, each component the caller may read once with its blocks and characters at its latest version and whether it has an approved revision, and how many the caller may not read. Send the source version it names back to place. Needs edit on this document and read on the other.",
  placeSection:
    "Places another document's section here as one act: a new section, titled as the caller says, holding one reference per occurrence the report counted, in order, each in the mode asked; pinned takes each component's latest version now. Nothing is shared with the found section and no value is copied. Refused where the section's document has moved since the report, where it places a component the caller may not reference, or where this document's template allows no section to be added. One version. Needs edit on this document and read on the other.",
  editOutline:
    'Applies one outline operation and records one new document version. Supply the version that was read to avoid overwriting concurrent work.',
  getDocumentTexts:
    'Reads the text of components placed by the latest document version, filtered by what the caller may read.',
  recordDocumentValues:
    'Replaces the document’s own values as one version while leaving its outline unchanged. Supply the version previously read.',
  getDocumentParameters:
    'Returns the parameters the document’s template declares, their current values, and each change with who made it and when, newest first.',
  recordDocumentParameters:
    'Replaces the document’s parameter values as one version while leaving its outline and values unchanged. A parameter its template does not declare changeable keeps its value. Supply the version previously read.',
  recordDocumentFallback:
    "Replaces the document's own translation fallback, as one version with its outline, values and parameters unchanged: where a component it places has no translation into the language a publish is made in, `source` publishes it in its own language, marked as untranslated, and `refuse` fails the publish. Null leaves the environment's translation policy to decide. Supply the version previously read.",
  recordDocumentProfile:
    'Replaces the profile the document declares, the values it takes on each condition axis, as one version with its outline, values and parameters unchanged. A publish keeps the text its profile selects. Supply the version previously read.',
  getContributions:
    'Shows what each occurrence contributes to the current document, subject to the caller’s readable set.',
  getNumbering:
    'Returns current section, figure, table and equation numbering using the document’s publishing layout.',
  getDocumentPresentation:
    'Returns the theme and layout used to publish this document so a reader can present its text consistently.',
  getPresentation:
    'Returns the environment’s default presentation used for a component outside a document.',
  listDefinitions:
    'Lists current field, metadata schema, component type and variable definitions, each variable with the key text names it by. A later version can change the current shape.',
  createDefinition:
    'Creates one definition at version 0.1. Its kind determines which field, schema or component type structure is required.',
  getDefinition:
    'Returns the current version of a definition so it can be read or used as a precondition for an update.',
  recordDefinitionVersion:
    'Records the next definition version based on the version the caller opened.',
  listTemplates: 'Lists readable templates with their name, space and latest version.',
  createTemplate: 'Creates a template in the named space at its first version.',
  getTemplate: 'Opens the current template version and its starting document structure.',
  recordTemplateVersion: 'Records a new template version based on the version the caller opened.',
  previewTemplateMove:
    "Answers what moving a document to its template's newest version would change, recording nothing: the theme and the layout, each field assigned or no longer assigned and each made required or not, each value that would not be carried forward, and each section the newer version requires that the document lacks. Needs edit on the document and read on the template.",
  moveDocumentTemplate:
    "Moves a document to its template's newest version, against the document version the preview was against: records a version with its values carried forward and binds it to the newer version. Never done but when asked. Needs edit on the document and read on the template. Audited.",
  listConnections:
    'Lists the connections the caller may read, with whether each has a credential and how its last test went.',
  createConnection:
    'Creates a connection to a PostgreSQL source in the named space. It holds no credential until one is set.',
  getConnection:
    'Returns the latest connection version, whether a credential is set and by whom and when, and its last test. The credential itself is never returned.',
  recordConnectionVersion:
    'Records the next connection version from the version the caller opened. Retiring and reinstating a connection are versions too.',
  setConnectionCredential:
    'Sets or replaces the connection credential, then tests the connection with it: a secret for a PostgreSQL or an HTTP connection, or an access key id and a secret access key for an S3 connection. The credential is sealed at once and never returned; this route takes no idempotency key.',
  testConnection:
    'Tests whether the connection reaches its source and signs in. A failure gives one reason, the same whatever went wrong, and every test is recorded.',
  describeConnection:
    "Lists the tables and views the connection account may read, with each column and the type proposed for it. Sent a SQL statement instead, it answers the columns the statement would return, each with the type proposed for it, without running it; that needs write SQL on the connection as well, and a connection whose latest test found its account read-only. Sent a built query instead - its tree and its parameters - it answers the columns the query would return in the same way, from SQL the service generates from the tree; that needs use connection alone, on any connection. A source's refusal of a built query is worded by its SQLSTATE, and what the source said is shown only to a caller who may write SQL on the connection. An HTTP or S3 connection lists no tables: sent its request, or its file's key and format, it reads the first rows and proposes a column for each.",
  sampleConnection:
    'Runs a draft query definition against the sample values given, exactly as a document would run it, and stores nothing. Each value is checked against its declaration before the source is asked. A draft of SQL needs use connection and write SQL on the connection, and a connection whose latest test found its account read-only; a built query needs use connection alone, on any connection. A failure is an answer, named and laid at the connector, the query or the product; what the source said of a statement it refused is shown only to a caller who may write SQL on the connection.',
  getConnectionUses:
    'Lists the query definitions whose latest versions name the connection, and the documents where a binding holds a result run on it: those the caller may read by title, and a count of the rest.',
  getQueryDefinitionUses:
    'Lists the components whose latest versions hold a binding naming the query definition, and the documents where a binding holds a result of it: those the caller may read by title, and a count of the rest. Ask before changing a definition, to see what the change will affect.',
  getDocumentBindings:
    "Lists every binding in the components the document's latest version places that the caller may read, in the outline's order: the binding as its component holds it, the dataset version it holds in this document with that result's provenance and name, whether the binding has changed since, and any newer result a check recorded and nobody has accepted. Beside each result is what the binding takes from it, as every reader of the document sees it: the value in its column's canonical form with the column's name and type, or why there is none - no rows, more than one with the count, no row the key names, a null, an empty text, or a column the result does not have. It is null for a result the binding has changed since, and unavailable, recording nothing, where the stored result cannot be read now. Each binding also carries its query definition's title and version, null unless the caller may read the definition, and the name of the connection its result ran on, null unless the caller may read both the definition and the connection; and who resolved or accepted it, by name, and whether Keep may hold it under the binding as it now stands. Named, `session` reads each component the caller's own editing session holds the lock on from that session's latest save, as a resolve's session item does. Reading needs only read on the document, never use of a connection; a provenance shows the SQL that ran, the connection and the source's column each declared column reads only to a caller who may read its query definition.",
  resolveBindings:
    "Runs the named bindings' query definitions through the connector now, as the service account of each connection, and holds each result in this document: the definition version the binding pins, or its latest. Each result is stored once under its checksum and recorded as a version of its dataset, reusing the latest where nothing differs. It needs edit on the document, read on each definition, and use connection on each connection, decided again once the source has answered; SQL runs only on a connection found read-only, and a built query on any; a binding that changed meanwhile, or a permission lost, records nothing. An item may say `session`, reading the binding from the latest save of the caller's own editing session, named in the body, where the node floats at the component's latest version, the session holds its lock and it opened from that version, so a value just placed shows before a version is cut. Each failed run is answered by name with its definition, binding and document, and records nothing. This route takes no idempotency key.",
  checkBindings:
    "Runs the document's checked bindings again, each distinct query once, two at a time and at most 50 a check, and records any different result as a new dataset version waiting to be accepted: nothing the document holds changes. A binding whose connection the caller may not use is left unchecked, as are those holding nothing; pinned bindings are never checked. This route takes no idempotency key.",
  acceptBinding:
    'Holds a waiting result for one binding in this document alone, naming the version it replaces, and queries nothing. Every other document holding the same dataset keeps its version. It needs edit on the document, and what running the query would: read on the query definition the accepted result ran and use of the connection it ran on. A definition the caller may not read is refused as a binding naming none, and a connection they may not use as forbidden; either records nothing. An acceptance from a version the binding no longer holds is refused with the binding as it stands.',
  confirmBinding:
    "Keeps the result a binding already holds in this document after the binding changed, where its question is unchanged - the same query definition, parameters and version - so only the value it takes or its mode changed. It queries nothing, and records a resolution naming the version it keeps as the one it replaces. It needs edit on the document and read on the query definition. The binding is read from its component version, or from the caller's own editing session as a resolve's session item is; a changed question is refused, and the binding must be resolved instead. A confirmation from a version the binding no longer holds is refused with the binding as it stands.",
  reviseBinding:
    "Revises a bound value by hand in this document, or a cell of a bound table by its row's key and its column, with a reason: the value stands in front of the result the binding holds, which is kept, and is shown and printed in its place; or withdraws a revision, so the result's own value is shown again. It queries nothing, and needs edit on the document alone. The value must be canonical in its column's type and never blank; a cell must be a value column the table shows - never its key, a group's column or subtotal, or the column it is turned by - in a row the result has. `resolution` names what the binding holds and `replaces` the revision standing, or null, as the caller saw them; anything else is refused with the binding as it stands. Every act that later replaces what the binding holds - resolve, accept, Keep - must say whether to withdraw or keep the revisions standing.",
  getBindingHolders:
    'Lists the documents whose latest outline places the component at a node holding a value for the named binding, whatever the binding was when it was resolved: those the caller may read by title, and a count of the rest. Ask before changing a binding, to see which documents will hold no value until they resolve it again. It needs read on the component.',
  getDocumentDataset:
    "Returns a stored result whole - its columns, every row in canonical form, and its provenance - but only a version the document's bindings show the caller: one a binding in a component they may read holds, or has waiting while that binding has not changed. A version held only in a component they may not read, at a node the outline no longer has, or waiting for a binding that has changed since, is not found. Reading needs only read on the document; the provenance shows the SQL that ran, the connection and the source's column each declared column reads only to a caller who may read its query definition.",
  getBoundTableRows:
    "Returns the rows of the result a bound table holds in this document, for the page to lay out: every row in the result's stored order, each value in its canonical form, and only the columns the table shows or sorts by, so a column its author left out never reaches a reader of the document. Only the version the binding holds is answered, named as the bindings view names it, never one waiting, and only for a bound table whose binding has not changed since and whose result has no more rows than a table prints. Named, `session` reads the table from the caller's own editing session where it holds the component's lock, so a column just added is sent. It needs only read on the document. Each answer carries an `ETag` over the version and the columns sent and is cached privately and revalidated: asked again with `If-None-Match`, an unchanged answer is 304 with no body.",
  getPendingResult:
    "Follows a pending result, which a resolve or a check answers with status 202 for a binding whose run holds an image no asset in the definition's space holds yet. Each such image is stored and admitted as an asset, as an upload is. Asked while any image is still being admitted, it answers pending. Once every one is admitted, it records the dataset version, and for a resolve the binding's resolution, exactly as the act would have, deciding again the act's permissions, that the binding has not changed (`binding_changed`), and that it still holds what it held when the act ran (`resolution_precondition`, so an older result never replaces a newer one), and answers the act's own result for the binding; the pending result is then gone. Where an image is refused, nothing is recorded and the result is refused `image_refused`, naming its row and column. Only the person whose act ran it may follow it; anybody else is told there is no such pending result.",
  nameDataset:
    'Names a dataset. The name is kept beside every earlier one, and the latest is the name. It needs edit on the dataset, which sits in the space of its query definition.',
  listQueryDefinitions:
    'Lists the query definitions the caller may read, with the space and connection of each, filtered by space or connection.',
  createQueryDefinition:
    'Creates a query definition in the named space from a whole definition: its query - SQL with named parameters, or a built query, a tree the service generates SQL from at every run - the columns it returns, a key, an order, whether no rows is valid, and its limits. It needs edit in the space and use connection on the connection it names; SQL needs write SQL there too, and a connection whose latest test found its account read-only.',
  getQueryDefinition:
    'Returns the latest query definition version, the connection it names, and whether the caller may change it or run it.',
  recordQueryDefinitionVersion:
    "Records the next query definition version from the version the caller opened. What it needs is decided by the version's own query: use connection on its connection, and for SQL write SQL there as well, so somebody who may not write SQL can turn SQL into a built query but not back. Retiring and reinstating a definition are versions too; a retiring version is accepted whatever the connection last found.",
  listPrompts:
    'Lists the prompts the caller may read, with the space and purpose of each, filtered by space.',
  createPrompt:
    'Creates a prompt in the named space from a whole prompt: its instructions, which may place the document’s parameters as `{{name}}`, the context it declares (the part it runs on, its section or the whole document, components related to it, parts whose field holds a value, and named parameters), the component type whose text it writes, and the purpose it is routed by with the models it accepts. Nothing it does not declare reaches a model. It needs edit in the space.',
  listPromptLibraries:
    "Lists the environment's prompt libraries: the default first, which a template naming none binds and which lists nothing, then the rest by name.",
  createPromptLibrary:
    'Creates a prompt library: a name and the prompts it lists, by identity, each once. Each runs at its latest approved revision, so a library follows its prompts as they are approved. It needs design here.',
  getPromptLibrary:
    'Returns a library at its latest version, with each prompt it lists at the revision a run of it runs: its latest approved one, or none where it was never approved. A prompt the caller may not read is counted, never named.',
  recordPromptLibraryVersion:
    'Records the next library version from the version the caller opened, checked as a new library is. It needs design here.',
  listDocumentPrompts:
    "Returns the prompts a document may run: its template's library, or the environment's empty default where it names none or the document was made blank, each prompt at the revision a run of it runs. A prompt the caller may not read is counted, never named. Given a part's `node`, only the approved prompts that write its component type, or any type, are listed.",
  startPromptRun:
    "Runs a prompt of the document's library on one of its parts, with a signed-in session alone, at the prompt's latest approved revision. Its context is resolved first, as the caller may read it, and recorded on the run; nothing it does not declare is sent. It calls the endpoint its purpose goes to, through the connector, once, with no tools, refused first where the endpoint's model is not one it accepts, the part is of another component type than the prompt writes, or the context resolved to nothing or is more than the endpoint takes. The reply, Markdown, is proposed as the part's whole text, a proposal that changes nothing until the caller accepts it. Answered as Server-Sent Events. Recorded as a run naming the prompt version. Your own identical run of the last 24 hours, the same prompt version, context, parameters and endpoint, is reused: its words checked again and proposed anew, calling nothing and costing nothing, the run naming what it reused. Nobody else's is ever reused; `fresh` calls the model regardless.",
  startPromptTrial:
    'Tries a version of a prompt, approved or not, on a part of a document the caller may read, with a signed-in session alone: the same run, recorded as a trial of that version, its output kept on the run and proposed nowhere. Approving a prompt version needs a finished trial of it.',
  listPersonalPrompts:
    'Lists your own saved prompts, the latest changed first, with a signed-in session alone. Nobody else is told they exist.',
  savePersonalPrompt:
    'Saves a prompt of your own: a title and the words you would say in a conversation. It is no artifact: nobody else reads or runs it, and no template binds it.',
  changePersonalPrompt: 'Changes a prompt of your own. Anybody else is told there is none.',
  removePersonalPrompt: 'Deletes a prompt of your own. Anybody else is told there is none.',
  promotePersonalPrompt:
    'Promotes a prompt of your own into a space you may edit, as a new prompt at 0.1 and draft: its title and words yours, its context, output and models declared now. From then on it is reviewed and tried like any other, and goes its own way; your own stays as it is, recording what it became.',
  listGuardrails:
    'Lists the environment’s guardrails, those in force first, the retired too where asked. Needs administer.',
  setGuardrail:
    'Forbids a phrase in what a model is sent, what it returns, or both, matched in any case and spacing, with the reason a refusal gives. A turn, a run or a trial meeting it is refused, naming the rule and its reason; a reply is held until checked wherever a rule watches replies. Needs administer, and is audited.',
  retireGuardrail:
    'Retires a guardrail in force, kept as the reason any run it refused was. Needs administer, and is audited.',
  getModelLimits:
    'Returns how many model runs each person may start an hour: the environment’s limit, or none, and each person with a limit of their own. Needs administer.',
  setModelLimit:
    'Sets how many model runs each person may start an hour, counted over the last hour; null lifts it. A run over it is refused with model_rate_limited and when one is free again; testing an endpoint is never counted. Needs administer, and is audited.',
  setPersonLimit:
    'Sets one person’s runs an hour in place of the environment’s, higher or lower; null removes it. Needs administer, and is audited.',
  getModelBudget:
    'Returns the monthly model budget, or none; what runs in its currency cost this month, UTC, whatever their purpose or outcome; how many runs cost something in another currency; who is told; and what stops when it is spent, which is nothing. Needs administer.',
  setModelBudget:
    'Sets the monthly model budget: a currency, a limit and up to five rising percents of it, at least one below 100, each alerting once a month as the spend crosses it; null lifts it. A changed limit may alert again. Nothing stops when it is spent. Needs administer, and is audited.',
  setBudgetRecipients:
    'Names who is told, through the inbox, as the month’s spend crosses a threshold, in place of who was: each from inside the organisation and administering the environment, decided again when told. Needs administer, and is audited.',
  getModelUsage:
    'Returns what models and queries were used, month by month, UTC, the oldest first, twelve months where none is said and at most thirteen: model runs ended by purpose, with their tokens, those read from the provider cache, and their cost by currency; and query runs with the rows and bytes they returned. Needs administer.',
  getEmbedding:
    'Returns the embedding model meaning is searched by, and the one embedding is routed to that does not serve yet: how many of the latest texts it lacks and what embedding them would cost, approximately, at about four characters a token and its endpoint’s input price. Needs administer.',
  confirmEmbedding:
    'Confirms the waiting embedding model, its cost seen: one sample is embedded to learn its dimensions, a run of yours, and every latest text it lacks is queued. The serving model answers searches until the new one has every text, then the new one serves at once. Needs administer, and is audited.',
  getMeaningFreshness:
    'Returns how long the versions of the last seven days took to become findable by meaning: from each version’s cut until no block of it lacked a passage for the serving model, at the 95th percentile, nearest-rank, and the most, in seconds, with how many were measured. Nothing is measured while no model serves or one waits to. Needs administer.',
  listConversationEndpoints:
    'Lists the endpoints a conversation may run on, with a signed-in session alone: every one in use with its key set, its model and whether it sits outside the data boundary, the one a turn naming none runs on marked.',
  startConversation:
    'Starts a conversation of your own, with a signed-in session alone: on a document you may read, or on none. Nobody else reads it.',
  listConversations:
    'Lists your own conversations, the newest first, on one document where it is named, at most 200.',
  getConversation:
    'Returns a conversation of yours with each turn: what you said, what the model wrote, how it ended and the endpoint it ran on. Anybody else is told there is none.',
  updateConversation:
    'Names a conversation of yours, or keeps it or lets it go. Only one you keep is listed again; one you do not stays with its runs, which are never deleted. Naming one keeps it unless you say otherwise. Anybody else is told there is none.',
  getConversationContext:
    'Returns what a conversation of yours reads: each part in its tray, read again as you now, at the version its document places or else its latest; one you may no longer read is said so, and not sent.',
  addConversationContext:
    'Adds a part to what a conversation of yours reads: a component you may read, placed in its document where it has one, at most 50. A part a turn’s tool read is added on its own.',
  removeConversationContext:
    'Removes a part from what a conversation of yours reads, so the next turn does not send it.',
  takeTurn:
    "Says something in a conversation of yours, with a signed-in session alone, on the endpoint named or the default. The earlier turns' words are sent with it, never their tool results. On a document, it reads what you may read of it and proposes edits as the assistant does; nothing is refused for being off the subject. One turn at a time, at most 20. Answered as Server-Sent Events, and recorded as a run of the conversation.",
  getPrompt: 'Returns the latest prompt version and whether the caller may change it.',
  listBibliographyEntries:
    "Lists a space's bibliography entries the caller may read, by key or the newest changed, each with its key and its CSL. Archived entries are left out, or listed alone when asked.",
  createBibliographyEntry:
    'Makes a bibliography entry in the space from its CSL-JSON, without an id, and where it was obtained and when last checked. It is first matched against the entries already there: by DOI, PubMed identifier, ISBN or ISSN where it has one, else by its title, year and first author. A match is offered and nothing made, unless the request says to make it despite the match. Its key is made from its first author and year, suffixed a, b and on where the space holds it, and never changes. It needs edit in the space.',
  importBibliographyEntries:
    'Imports CSL-JSON, BibTeX or RIS text as entries of the space. Each record is matched as making one by hand is: a match is given the fields it lacked, in a new version, and the answer names them; otherwise an entry is made. Fields an entry cannot hold are left out and named. At most 500 records are taken at a time. It needs edit in the space.',
  exportBibliographyEntries:
    "Exports the space's entries the caller may read, or those named, as CSL-JSON, BibTeX or RIS, each named by its key. The answer names each entry the format did not carry whole, with the CSL variables it lost, found by reading the text back; CSL-JSON loses none.",
  getBibliographyEntry:
    'Returns an entry at its latest version, whether it is archived, and whether the caller may change or archive it.',
  recordBibliographyEntryVersion:
    'Records the next entry version from the version the caller opened, checked as a new entry is. Its key is kept.',
  getBibliographyEntryUses:
    'Returns where an entry is cited: the components whose latest version cites it, and the baselines pinning a component version that does. One the caller may not read is said to exist, never named.',
  archiveBibliographyEntry:
    "Archives an entry, leaving it out of the space's listing. Refused while a component's latest version, or a version a baseline pins, cites it. It needs retire on the entry.",
  previewComponentCitations:
    "Renders a component's citations, in order, in the in-text form of the citation style its document's theme names, or the environment's theme's where no document is named, as its editor shows them. A citation naming no entry of the component's space the caller may read is answered null. Nothing is kept.",
  listCitationStyles:
    "Lists the environment's citation styles by name: CSE, Vancouver and Harvard, which every environment is given, and any uploaded.",
  createCitationStyle:
    'Uploads a citation style: a CSL 1.0.2 file, a name, and what an entry of each CSL type must hold to be cited in it, since CSL itself declares none. A file that is not a CSL style with both an in-text and a bibliography form, or that does not render, is refused. A theme names a style at a version. It needs design here.',
  previewCitationStyle:
    'Renders a set of invented sample entries in a CSL file, before or after it is uploaded, and proposes what it requires: for each type, the variables a reader needs that the style always prints. A file that would be refused answers why, and no sample. Nothing is kept. It needs design here.',
  getCitationStyle:
    'Returns a citation style at its latest version: its CSL, its name, what it requires, and whether it is one every environment is given.',
  recordCitationStyleVersion:
    'Records the next citation style version from the version the caller opened, checked as an upload is. A theme naming an earlier version goes on rendering in it. It needs design here.',
  listReferenceSources:
    'Lists the reference sources the product declares, Crossref and PubMed, and the reference extensions installed here, keyed `ext:` and the extension’s id, each with the one host it is reached at, what a record is fetched by, and whether this environment searches it. Each is on until an administrator switches it off.',
  setReferenceSource:
    'Switches a reference source, or a reference extension installed here, on or off for the environment. Off, it is neither searched, made an entry from nor re-checked; a reference extension is removed only once off. It needs administer on the environment.',
  searchReferenceSource:
    "Searches a reference source for the terms given, which are sent to the source, and answers at most 20 results as CSL-JSON, each matched against the space's entries by DOI, PubMed identifier, ISBN or ISSN, else by title, year and first author. It says whether the caller may make an entry in the space. It needs read in the space. A source that cannot be reached, or answers out of shape, is `reference_unavailable`.",
  createBibliographyEntryFromSource:
    'Fetches a record from a reference source by its DOI or PubMed identifier and makes it an entry of the space, recording where and when it was obtained. It is first matched against the entries already there, as making an entry by hand is: a match is offered and nothing made, unless the request says to make it despite the match. It needs edit in the space.',
  checkBibliographyEntry:
    "Checks an entry against the reference source its latest version was obtained from, sending the source its DOI or PubMed identifier alone, and records the entry's status beside it, never as a version: `current`, `changed` (naming the CSL variables the source now holds otherwise), `gone`, `retracted`, `superseded` (a newer version or edition, or a record replacing it) or `corrected`, with the notice where the source names one. A retraction, supersession or correction tells the owner of each document citing it who may read it, at most once in thirty days. It needs edit on the entry; an entry made by hand is `entry_not_obtained`, and one checked or tried within the minute `entry_checked_recently`.",
  getDocumentFlaggedSources:
    "Lists the sources cited by the components a document's latest version places, at the version each is placed, that their source last said are retracted, superseded or corrected. Each names the entry to a reader of it, and only its flag to anybody else, with the components citing it the caller may read. It needs read on the document.",
  listTerms:
    "Lists a space's terms the caller may read, by their preferred label in their base language or the newest changed, each with its abbreviation and its workflow state. Archived terms are left out, or listed alone when asked.",
  createTerm:
    'Makes a term in the space, in draft: its base language, a preferred label, alternative labels and an abbreviation per language, the base language among them, a definition per language, and the broader, narrower and related terms it states, each a term of the same space, with a replacement where it has one. Nothing is inferred: a broader term says nothing of its narrower ones unless it states them. A replacement never closes a cycle, and a chain of them is at most five long. It needs edit in the space.',
  importTerms:
    "Imports SKOS concepts as terms of the space, from JSON-LD in the compact form `exportTerms` writes or from Turtle. A concept whose preferred label in its base language is a term's of the space, case aside, is merged into it: the answer names the labels, definitions and relations it was given. Each other concept is made, in draft. What no term can hold is reported rather than dropped: another predicate, a subject that is not a concept, a language tag the product does not read, an alternative label in a language with no preferred one, and a relation to a concept outside the file. Nothing a file names is fetched. At most 2,000 concepts and 200,000 statements are taken at a time, in a body of at most 5 MiB. It needs edit in the space.",
  exportTerms:
    "Exports the space's terms the caller may read, archived or not, as SKOS in JSON-LD: each a `skos:Concept` identified `urn:uuid:` and its id, with `prefLabel`, `altLabel` and `definition` by language, an abbreviation as a `notation` in its label's language, `broader`, `narrower` and `related`, and a replacement as `dct:isReplacedBy`.",
  listLicences:
    "Lists the environment's licences by name, each at its latest version: its key, its names per language, what it permits (`internal` use, `publication`, `redistribution`, `modification`), whether it requires attribution and what that must say, and the address of its terms. Anyone signed in may read them, since whoever uploads an image declares the licence it is held under; they are made and changed through `/v1/definitions`, as kind `licence`, by whoever manages definitions.",
  getLicence:
    'Returns a licence at its latest version, as `listLicences` lists it. Anyone signed in may read it.',
  listVocabularies:
    "Lists the environment's vocabularies by name, each with its key, its latest version and how many values it holds. Anyone signed in may read them, since authors choose their values; they are made and changed through `/v1/definitions`, as kind `vocabulary`, by whoever manages definitions.",
  getVocabulary:
    "Returns a vocabulary at its latest version: its key, its base language, its order (`declared`, as listed, or `label`, by each reader's language), and each value with its id, labels and descriptions per language, and its state: `active`, `deprecated` with the value replacing it, or `retired`, kept so that what holds it still reads. Anyone signed in may read it.",
  getVocabularyUses:
    'Returns where a vocabulary is used, so a value is not deprecated or retired blind: the fields and condition axes whose latest definition draws on it, and for each value held the components, not deleted, whose latest version holds it in one of those fields. Each value says how many components hold it and names those the caller may read, by title; the rest are counted, never named. Anyone signed in may read it.',
  exportVocabulary:
    "Exports a vocabulary as a SKOS concept scheme in JSON-LD. The scheme, identified `urn:alloy-works:vocabulary:` and its key, has the key as its `notation` and its name as its `prefLabel` in the base language. Each value is a `skos:Concept` `inScheme` it, with its id as its `notation`, its labels as `prefLabel` and its descriptions as `definition` by language, and a deprecated or retired value `owl:deprecated`, its replacement as `dct:isReplacedBy`. What SKOS has no word for is in the namespace `urn:alloy-works:skos:` (prefix `aw`): `aw:retired` true for a retired value, `aw:order` on the scheme, and `aw:position`, a value's place in the declared order. Anyone signed in may export it.",
  importVocabulary:
    "Imports one SKOS concept scheme, from JSON-LD in the compact form `exportVocabulary` writes or from Turtle, as a vocabulary. The scheme's `notation` is its key: a vocabulary with that key gets a new version, else one is made, named by the scheme's `prefLabel`. Each concept is a value, its `notation` its id, in `aw:position` order. A value is never removed: one the vocabulary holds and the import does not is kept, and listed. What no value can hold is reported rather than dropped: a concept with no notation, or one not in an id's form, or another concept's; a label in a language tag the product does not read, or too long; a replacement outside the import; any other predicate, and any subject that is not a concept. Nothing a file names is fetched. At most 5,000 concepts and 200,000 statements are taken, in a body of at most 5 MiB. It needs manage_definitions at the tenant, and is refused as `/v1/definitions` refuses a definition.",
  refreshVocabulary:
    "Refreshes a vocabulary's values from its source and records the next version. A query definition's source is run as the caller, who needs use connection on its connection as a sample does, and recorded as the act `vocabulary`; its `id`, `label` and optional `description` columns give each value's identifier and its words in the base language. A SKOS address is fetched by the connector: one `GET`, no redirect followed, at most 5 MB in 20 seconds, never a private address; each concept gives its identity, its `notation` as the suggested id, and its `prefLabel` and `definition` by language. A value is kept by its identifier: one new to the source is added active, one gone from it retired, never removed, and one whose words changed takes the source's. What no value can hold is reported by its identifier. A sourced vocabulary's values are otherwise changed only in their state. It needs manage_definitions at the tenant.",
  getTerm:
    'Returns a term at its latest version, its workflow state and the transitions and gates the caller may take, whether it is deprecated or archived, and whether the caller may change or archive it.',
  recordTermVersion:
    'Records the next term version from the version the caller opened, checked as a new term is.',
  getTermUses:
    'Returns where a term is used: the components whose latest version marks words as it. One the caller may not read is said to exist, never named.',
  archiveTerm:
    "Archives a term, leaving it out of the space's listing. Refused while a component's latest version uses it. It needs retire on the term.",
  unarchiveTerm:
    "Unarchives a term, returning it to the space's listing. It needs retire on the term.",
  previewComponentTerms:
    "Answers the standing and preferred label of each term a component's editor uses, in order, so it can flag a deprecated one with its replacement. A term that is not one of the component's space the caller may read is answered unavailable, and nothing more is said of it. Nothing is kept.",
  getSpaceTranslations:
    'Reports the components of a space that have translations, a page at a time by title in the language the request accepts, each translation with its status: untranslated, machine drafted, in translation, translated, or out of date with its source, saying whether any change since needs retranslating. Narrow it to one language, one status or both with `language` and `status`; only the translations they leave are given. Only components the caller may read are named. Send the returned next cursor, with the same language, to continue. It needs read on the space.',
  listComponentTranslations:
    "Lists a component's translations, one per language, each with its newest version recorded against a source, the source version that translates, and its status: untranslated until its first cut, translated, or out of date the moment a source version follows the one it translates, saying whether any change since needs retranslating. Open a translation as any other line of the component. It needs read on the component.",
  beginComponentTranslation:
    "Begins a component's translation into a language, as a line of its own begun from the source's latest designated revision, its blocks and their identifiers kept. Nothing is cut: it is untranslated until a version is cut on its line, which names the source version the translator was shown. A source never designated, a tag that is not BCP 47, the source's own language, or one begun already is refused. It needs edit on the component.",
  markComponentTranslationCurrent:
    "Records a translation's newest version as translating the source's latest, cutting nothing, for a source change that needed no new words. The source version named must be the latest, or it is refused so nothing is recorded against a source the translator never saw. It needs edit on the component.",
  getComponentTranslationChanges:
    "Says which of the source's blocks changed since the version a translation translates: added, changed or removed, by block identifier, so a translator starts from the earlier translation. It needs read on the component.",
  declareComponentSourceChange:
    "Declares whether a version of a component's main line needs retranslating, revising what its author declared at its cut. A version declaring nothing needs it. A translation goes out of date at any later source version either way; the declaration says whether that needs new words. It needs edit on the component.",
  listDocumentTranslationJobs:
    "Lists a document's translation jobs, newest first, at most 50: each its language and vendor, who made it and when, whether it is closed, and each component it lists that the caller may read, with the source version sent, why one was not sent, and what has come back. It needs read on the document.",
  makeDocumentTranslationJob:
    "Makes a translation job of a document's components into one language: each component it places, in another language, that needs translating into it, having no translation yet, an untranslated one, or one out of date by a change declared to need retranslating, and that no open job holds out. Each is sent from the source version a translator is shown, its latest designated revision, and a translation is begun where none is. One the caller may not edit, or one never designated, is listed and not sent. Refused where nothing would be sent. Nothing is sent to the vendor: download the job's file and send it. It needs edit on the document.",
  downloadDocumentTranslationJob:
    "Downloads a translation job's XLIFF 2.1 file, written from the source versions sent: one file element a component, its title and type as notes, and one unit a translatable text, with the text either side as context and the space's terms it uses in a glossary. References, footnotes, variables, equations, images, code and words in another language are placeholders, and marks are paired codes, none of which a translator may copy or delete. Only components the caller may read now are in it. Each download is audited. It needs edit on the document.",
  closeDocumentTranslationJob:
    'Closes a translation job, so nothing of it is held out and its translations show their own status again. It needs edit on the document.',
  returnDocumentTranslationJob:
    "Returns a translation job's file, translated, as its bytes: XLIFF 2, UTF-8 or UTF-16, at most 25 MB, kept as it came. The worker reads it and, acting for the caller, makes each component it translates a version of its translation, translating the source version sent. A component whose source or translation moved since it was sent, or that somebody is editing, is held for a person to decide; one that does not read back, with a code or placeholder missing, repeated or invented, or that the caller may no longer edit, is refused, and a later file may return it again. A file in another language, or naming a component the job did not send, is refused whole. Read the job to see what came back. It needs edit on the document.",
  getDocumentTranslationJobHeld:
    "Shows a held translation: the source version sent and the one a translation is made against now, each source block changed between them, and the words returned, block by block, with the decision the environment's policy offers first. It needs edit on the document.",
  decideDocumentTranslationJobItem:
    'Decides a held translation: accepted, its words cut as a translation of the source version sent, so out of date at once where the source moved since; or rejected, its words dropped. Refused while somebody is editing the translation. It needs edit on the document and on the component.',
  draftComponentTranslation:
    "Drafts a component's translation by machine: its source, as a translator is shown it, sent in pieces as XLIFF 2.1 to the endpoint the environment routes translation to, each piece a run, with the space's terms it uses and their translations, and each reply read back as strictly as a vendor's file, so a code missing, repeated or invented refuses the whole draft. The draft is cut on the translation's line, marked as drafted by machine, and a publish refuses it until a person with approve accepts it. Each term it did not translate by one of its labels is named. Nothing is sent while the environment's translation policy is off, or outside the data boundary where it says inside. Guardrails, the hourly limit and the endpoint's size are held as a prompt run's are. It needs edit on the component, and a session.",
  acceptComponentMachineDraft:
    "Accepts a translation's machine drafts, every one not yet accepted, so its versions are no longer marked and may be published. An edit after a draft does not accept it. It needs approve on the component.",
  unarchiveBibliographyEntry:
    "Unarchives an entry, returning it to the space's listing. It needs retire on the entry.",
  recordPromptVersion:
    'Records the next prompt version from the version the caller opened, checked as a new prompt is.',
  createAssetUpload:
    'Starts an image upload in a space and records its description or decorative status. Upload bytes separately to finish it.',
  createAssetReplacement:
    "Starts an upload replacing an image. Upload its bytes separately, as for any upload; once they pass the check, they become the image's next version, and every earlier version is kept as it was. Its description and name are the latest version's unless given; its rights stay the image's. A figure following the image's latest version shows the replacement from then on; a figure pinned to a version keeps it. Needs edit on the image.",
  getAssetUpload:
    'Reads the state of an upload the caller created and, once ingestion completes, the resulting asset version.',
  putAssetUploadBytes:
    'Sends the image bytes for an existing upload. Only PNG and JPEG images admitted by the ingest worker become assets.',
  getAssetVersion:
    'Reads the recorded properties of an asset version that the caller may access. An image a dataset holds is read only by a caller who may also read a document holding it, and is otherwise not found.',
  getAssetVersionContent:
    'Returns the stored image bytes of a readable asset version. Use the response media type as supplied. An image a dataset holds is read only by a caller who may also read a document holding it, and is otherwise not found.',
  getAssetVersionDerivative:
    "Returns a readable asset version's thumbnail or preview: WebP, turned upright, never enlarged and carrying none of the original's metadata, made when the image was ingested and kept for a year. Until it is made, or after it was discarded, answers the original image, never kept, and asks for it to be made. An image a dataset holds is read only by a caller who may also read a document holding it.",
  discardAssetDerivatives:
    "Discards every thumbnail and preview of a space's images, recorded on the audit log. Each is made again from its original, which is never touched, when it is next read. Needs administer on the space.",
  listSpaceAssets:
    "Lists a space's images the caller may read, each at its latest version with its rights now, whether its licence has expired and whether anything uses it, in stable cursor pages. Search their names, descriptions, formats, licences and sources with `q`; filter by format, licence, undeclared or expired rights, orientation and whether unused; and find an upload's duplicate by the SHA-256 of its bytes. Images a dataset holds, and deleted or archived ones, are left out. Needs read on the space.",
  getAssetUses:
    'Returns where an image is used: the components whose latest version places it, the documents placing those, and the baselines and publications pinning it. Anything the caller may not read is never named; only whether there is any is said. Needs read on the image.',
  getAssetRights:
    "Returns an image's rights now and every change to them, newest first, each with who recorded it and when: `declared`, with where it came from, the licence of this environment it is held under, the last day the grant holds and the credit it needs; `undeclared`, recorded so that undeclared images can be listed; or `dataset`, for an image a dataset holds, which is the environment's own data. Rights are the image's, not a version's, so a figure pinning an older version answers to them as they are now. Needs read on the image.",
  setAssetRights:
    "Records an image's rights as a change of its own, the earlier ones kept: `declared` with its source and a licence of this environment, or `undeclared`. A dataset's image takes its rights from its dataset and is refused. Needs edit on the image.",
  requestPreview:
    'Queues a short-lived PDF preview of the latest document version for the caller. Follow the returned request to completion.',
  requestPublication:
    'Queues publication of a named document version in the requested output formats. A worker produces the outputs asynchronously.',
  getPublicationRequest:
    'Polls a publish or preview request for its state, failure and completed result. A preview PDF expires after its retention period.',
  listPublications: 'Lists the readable publications of one document in stable cursor pages.',
  listPublicationsEverywhere:
    'Lists all publications the caller may read across documents and spaces.',
  getPublication: 'Returns a completed publication’s immutable record and links to its outputs.',
  getPublicationBindings:
    'Returns each value a publication printed, by node and binding, with the dataset version and stored result it was taken from. Needs read on the publication. The SQL that ran, the connection and each column’s source column are included only where the caller may read the query definition; provenance.json, the publication’s own output, never holds them.',
  listDatasetSources:
    'Lists the stored results the caller may read, a page at a time, each by its name or its query definition’s title, with its latest version’s columns: what a query over it may select.',
  sampleDataset:
    'Runs a draft query definition over a stored result, as the query builder builds it - its columns, condition, grouping and aggregates - against sample values, storing nothing. The service evaluates it over the result’s kept rows; the source the result came from is never asked. Needs read on the stored result.',
  requestRangePreview:
    'Asks for a range preview of the occurrence being edited in the latest version of a document: its pages and one either side, drawn by a job from the editing session’s latest save as PNG images. Each image is untagged by design, and its alternative text says so and names the tagged PDF that Preview makes. Needs read on the document.',
  getRangePreview:
    'Returns a range preview: waiting until its latest refresh is drawn, then ready, with each page’s number and alternative text, and the save it shows. The asker’s alone. Needs read on the document.',
  refreshRangePreview:
    'Asks for the range to be drawn again from the latest save its editing session recorded: call it after each save. The asker’s alone. Needs read on the document.',
  getRangePage:
    'Returns one page of a range preview as PNG, drawn again at each refresh. The asker’s alone. Needs read on the document.',
  getDocumentGenerated:
    'Returns, for a document you may read at its latest version, each placed component with content a model made: every suggestion a run of the assistant made on it, accepted, open, rejected or withdrawn, and every proposal discarded before it was suggested, with who asked, who acted and when, and the run\u2019s model, endpoint, instructions and digest. An accepted one names the version it went into and whether that version is in the one placed. Components you may not read are counted, never named.',
  getPublicationGenerated:
    'Returns the same for what a publication printed, as it recorded it: the versions it printed, and the generated content in them, never anything newer. Not answered to somebody the publication was shared with alone.',
  startAssistantRun:
    'Asks the assistant about a document you may read, with a signed-in session alone. It calls the model endpoint drafting is sent to, through the connector, and answers as Server-Sent Events: the run, the model’s text as it comes, each tool call and what came back, each proposal, and how it ended, with its tokens and cost. Its tools read only what you may read of this document; a proposal changes nothing. Closing the request ends the run. Recorded as a run.',
  getAssistantRun:
    'Returns a run of the assistant you made: the endpoint and model, each tool call with its arguments and what came back, what it read, its digest, its tokens and cost, and its proposals. Anybody else is told there is none.',
  getAssistantUsage:
    'Returns how many runs of the assistant you made this calendar month, UTC, and what they cost, by currency.',
  acceptProposal:
    'Accepts a proposal from your run: a suggestion is made from it, marked generated, and accepted at once, as you, so the lock, a change since and the save’s checks refuse it as they refuse any acceptance. Needs edit on the component. Recorded as a generation accepted.',
  keepProposal:
    'Keeps a proposal from your run as a suggestion, marked generated, for review beside the component, where it is accepted or rejected as any suggestion is. Needs suggest on the component.',
  discardProposal:
    'Discards a proposal from your run. It is kept, and recorded as discarded by you; nothing about the component changes.',
  listModelEndpoints:
    'Lists the environment’s model endpoints, those in use first: each with its protocol, base URL, model, context window, prices per million tokens, whether it sits outside the data boundary, and whether its key is set, never the key. Needs administer at the environment.',
  makeModelEndpoint:
    'Makes a model endpoint on one of two protocols, Anthropic’s Messages API or OpenAI’s chat completions, which self-hosted servers speak too. Whether it sits outside the data boundary is stated here, never inferred. Recorded as an endpoint made. Needs administer at the environment.',
  getModelEndpoint:
    'Returns a model endpoint, and whether its key is set and still for where it points. Needs administer at the environment.',
  changeModelEndpoint:
    'Replaces a model endpoint’s settings; its protocol never changes. Moving its base URL to another host leaves its key needing to be set again. Recorded as an endpoint changed, naming the settings that changed and none of their values. Needs administer at the environment.',
  retireModelEndpoint:
    'Retires a model endpoint: every purpose routed to it goes nowhere, and it takes no key or test. Kept, so the runs it made still name it. Needs administer at the environment.',
  setModelEndpointKey:
    'Sets or replaces a model endpoint’s key, the tenant’s own provider account. The connector seals it to the endpoint and its host; no route, log or error ever answers it. Recorded as a key set. Needs administer at the environment.',
  testModelEndpoint:
    'Calls a model endpoint once, through the connector, with a short fixed message, and answers its reply, the model it named, its tokens, cost and time, or how it failed. Never tries another endpoint. Recorded as a run, and as an endpoint tested. Needs administer at the environment.',
  listModelRoutes:
    'Lists each purpose - drafting, chat, summarising and embedding - and the endpoint it goes to, or none, which turns that capability off. Needs administer at the environment.',
  setModelRoute:
    'Sends a purpose to an endpoint in use with a key set for where it points, or to none. Recorded as a route set. Needs administer at the environment.',
  createImport:
    'Makes an import in a space, awaiting its file: its name and whether it is a Word document, Markdown or HTML. Send the bytes next. An import is seen only by whoever made it and the space’s administrators. Needs create in the space.',
  putImportFile:
    'Fills an import with its file, up to 25 MB, checked from its bytes: a Word document must be a zip holding word/document.xml. The worker then reads it into a proposal; nothing is made in the space until the import is accepted. Only its importer may send it.',
  listImports:
    'Lists the caller’s imports in a space, the newest first, or every import there for the space’s administrator: each with its state, and when a proposal left alone is abandoned. Needs read in the space.',
  getImport:
    'Returns an import: its state, the outline it proposes, each part with the reason it starts where it does and its text as the file had it, and the report of what was left out, kept differently or not read yet; each cross-reference whose target is not in the file, with the text it showed; and every name the file carries, with the member it matches under the environment’s policy. Only its importer and the space’s administrators may read it.',
  setImportLevels:
    'Changes the heading levels a proposal breaks out at: which level starts a section and which a component. The file is read again. Only its importer may change them. It is made against the revision of the import its importer read, and refused as `import_changed` once the import is past it.',
  getImportPart:
    'Returns one part of a proposal, so it can be reviewed alone: its title, kind, the reason it starts where it does, what it is flagged for, its blocks as text beside the text of the file it came from, the suggestions and threads its tracked changes and comments will become, each by its Word author, and the parts before and after it. Only its importer and the space’s administrators may read it.',
  searchImportParts:
    'Lists the parts of a proposal whose title or text holds the words asked, ignoring case, or that carry a flag: empty, refused, or something the report said was not read yet, left out or kept differently. Only its importer and the space’s administrators may search it.',
  editImport:
    'Edits a proposal before it is accepted: moves blocks across the split between two components, splits a component at a block, merges a part with the one after it, renames a part, or makes a part a section or a component. Imported again, it matches a part to another component the earlier import made, or marks it new. It also points a cross-reference whose target is not in the file at a block of the import or of a component in the space, or makes it the text it showed, said in the report; and confirms the member a name in the file matches by name. Each edit is checked as it is made and refused, saying why, if what it makes could not be accepted. It is made against the revision last read, and refused if the proposal changed since. The proposal as the file was read is kept unchanged beside it. Only its importer may edit it.',
  setImportPlace:
    'Keeps the part of a proposal its importer is at, so that returning to the import, from any session, opens that part. Only its importer may set it.',
  setImportKind:
    'Chooses whether a file is imported as new or as an update of what an earlier accepted import of the same file made: the import names that earlier one once its name or its bytes are in, before they are read. Imported again, each component part is matched to a component that import made: by the heading it was read from, then by the component’s title now, then by its place between two parts matched so; each is then unchanged, changed against the component as it is now, or new, and what no part matches is gone. Its importer may change a match, or mark a part new, through the edits. Only its importer may choose, and they need read on the earlier document. It is made against the revision of the import its importer read, and refused as `import_changed` once the import is past it.',
  acceptImport:
    'Accepts a proposal: its document, sections and components are made in one act, by the person accepting, each at 0.1 and each recording the file it came from. Blank, or from the template named. Each Word author’s tracked changes become one suggestion on each component, and each comment a thread with its replies, all made by the person accepting and attributed to the Word author as the environment’s policy says, with the member it matched; the policy applied is recorded on the import and on each. Refused while a cross-reference outside the file is unresolved. How many parts were accepted unchanged, edited, merged, split or renamed is recorded on the import. Imported again, no document is made: each changed part becomes one suggestion against its component as it is now, by the person accepting, so an edit made in the space is never overwritten, its tracked changes and comments on top; each new part a new component placed in the earlier document after the part before it; and each component no part matched is kept and flagged on the document by a thread. A component the person accepting may not suggest on, or one deleted or archived since it was matched, is skipped and said, unless none can be suggested on. Only its importer may accept it, and they need create in the space. It is made against the revision of the import its importer read, and refused as `import_changed` once the import is past it.',
  abandonImport:
    'Abandons an import before it is accepted: its proposal and its file are removed and nothing of it is left in the space. Recorded as an import abandoned. Only its importer and the space’s administrators may abandon it.',
  requestTenantExport:
    'Asks for an export of the whole environment as it stands now, written by a job into one ZIP archive: a JSON Lines file each for its artifacts, versions, relationships, baselines and publications, the bytes its assets and publications hold under objects/ by their SHA-256, and manifest.json saying what it holds and what it leaves out. Recorded as an export produced. Needs administer at the environment.',
  listTenantExports:
    'Lists the environment’s exports, the newest first, a page at a time: each queued, done, failed or expired, with its size and when its archive is removed. Needs administer at the environment.',
  getTenantExport:
    'Returns an export of the environment: whether its job has written it, how many of each part it holds, and when its archive is removed, seven days after it was written. Needs administer at the environment.',
  downloadTenantExport:
    'Returns a link to an export’s archive, signed for five minutes; each one handed out is recorded as an export downloaded. Refused export_not_ready until it is written, and once it has failed or expired. Needs administer at the environment.',
  getQueryUsage:
    'Totals the environment’s query runs in a period - samples, resolves, checks and document creations - by query definition and by document: how many ran, failed or were throttled, their time, rows and bytes. Most time first. The last 30 days unless named, never more than 13 months. Needs administer at the environment.',
  getQueryRunsCsv:
    'Every query run in a period as CSV, one to a row, oldest first: when, which act, its outcome and failure code, who ran it, the connection, the query definition and the document, its milliseconds, rows and bytes. Needs administer at the environment.',
  listPublicationShares:
    'Lists a publication’s shares with people outside the organisation, expired ones too, each with its recipient, its expiry, who shared it and every access, newest first. Needs publish on its document and read on the publication.',
  sharePublication:
    'Shares one publication with a named person from outside the organisation, by address: somebody from outside who signed in with it, verified, or else the address invited as such, the invitation lasting as long as the share. The share is a read-only grant of that publication alone, expiring at the environment’s default for outside access or the time given, within its cap. The person reads it only once they sign in. Refused for anybody in the organisation and for an address an administrator’s invitation already waits for.',
  revokePublicationShare:
    'Revokes a share at once: the recipient’s next request for the publication or any of its outputs finds nothing.',
  getSharedOutput:
    'Returns one of a publication’s outputs, or its PDF’s veraPDF report, through the service, saved as the publication’s id and never kept by the browser. Decided at each request, so a revoked share fetches nothing more; somebody from outside fetching it is recorded. With `disposition=inline`, an HTML output is shown in place to a reader inside the organisation, under a policy that sandboxes it and lets it fetch nothing; somebody from outside is given it to save, and any other format is refused.',
  listTokens:
    'Lists the caller’s own personal tokens and their expiry and last use. Token secrets are never returned by a listing.',
  createToken:
    'Issues a personal token with explicit permission scopes and an expiry. The secret appears once in this response and cannot be recovered later.',
  revokeToken:
    'Revokes one of the caller’s personal tokens. The next request presenting it is refused.',
  listPrincipalTokens:
    'For an environment administrator, lists another person’s tokens without revealing their secrets.',
  revokePrincipalToken:
    'For an environment administrator, revokes a person’s token. The next request with it is refused.',
  listServiceIdentities:
    'Lists the environment’s service identities: what each is for, who made it, whether it is disabled, and how many tokens it holds. Needs administer at the environment, with a signed-in session.',
  createServiceIdentity:
    'Makes a service identity, a principal of its own kind for an integration or agent: never a person, never signed in as, and no invitation claims it. It has no roles until granted some, as a person is. Recorded as made. Needs administer at the environment, with a signed-in session.',
  changeServiceIdentity:
    'Renames a service identity or changes what it says it is for. Recorded as renamed when anything changed. Needs administer at the environment, with a signed-in session.',
  disableServiceIdentity:
    'Disables a service identity: every token it holds is revoked at once, each recorded, and no more are issued. Kept, so what it did still names it. Needs administer at the environment, with a signed-in session.',
  issueServiceIdentityToken:
    'Issues a service identity a token that acts as it, masked to its scopes and lasting at most 365 days; its secret is answered this once. A token acts only as the service identity it was issued to, never as the administrator who issued it. Recorded as a token issued. Needs administer at the environment, with a signed-in session.',
  listExtensions:
    'Lists the extensions installed, removed ones too: each one’s manifest as it was installed or last updated, and its digest. Needs administer at the environment, with a signed-in session.',
  previewExtension:
    'Has the connector fetch an extension’s manifest by its HTTPS URL, and answers it read strictly with its digest, so an administrator reads what it declares - what it is, the settings and credential a connection takes, its capabilities, and the hosts it says it sends data to - before installing it. A manifest that does not read is refused naming where, never what it said. Needs administer at the environment, with a signed-in session.',
  installExtension:
    'Installs an extension at the manifest its preview showed, by that digest; refused where the manifest has changed since. Recorded as an extension changed. Needs administer at the environment, with a signed-in session.',
  getExtension:
    'Returns an extension and the manifest it has now. Needs administer at the environment, with a signed-in session.',
  previewExtensionUpdate:
    'Fetches an extension’s manifest again and says what an update would change: its endpoint, settings, credential, capabilities, outbound hosts or description. Needs administer at the environment, with a signed-in session.',
  updateExtension:
    'Moves an extension to the manifest its update preview showed, every earlier one kept; a connection keeps the manifest it was saved against until it is saved again. Recorded as an extension changed. Needs administer at the environment, with a signed-in session.',
  listExtensionUses:
    'Lists the connections using an extension, retired ones too, each with the manifest it was saved against. Needs administer at the environment, with a signed-in session.',
  removeExtension:
    'Removes an extension once no connection uses it but a retired one, and a reference extension once it is switched off as a reference source; kept, so what used it still names it, and the bibliography entries obtained from it untouched, though no longer re-checked. Recorded as an extension changed. Needs administer at the environment, with a signed-in session.',
  setExtensionSecret:
    'Sets the secret a reference extension is sent as a bearer, where its manifest declares one: sealed by the connector for the extension and its endpoint, so it opens nowhere else, and never answered again; an endpoint changed by an update needs it set again. Recorded as an extension changed. Needs administer at the environment, with a signed-in session.',
  listWebhooks:
    'Lists the environment’s webhook subscriptions: each one’s service identity, URL, event types and whether it is disabled, never its secret. Needs administer at the environment, with a signed-in session.',
  createWebhook:
    'Subscribes a service identity’s HTTPS endpoint to event types. Each event of those types is posted to it, signed as Standard Webhooks specifies, carrying identifiers and versions and never content, and only where the service identity may read what it is about. Answers the signing secret this once. Delivery is at least once and in no promised order: a receiver deduplicates by the payload’s `id` and orders what matters to it by the artifact’s version, or by the number in `sequence`, which is its source’s order and not the order acts committed in. Recorded as a webhook changed. Needs administer at the environment, with a signed-in session.',
  getWebhook:
    'Returns a webhook subscription, never its secret. Needs administer at the environment, with a signed-in session.',
  changeWebhook:
    'Changes a subscription’s URL, description or event types, or turns it on again after it was turned off. A new URL ends the old secret at once and answers a new one; a type no longer wanted is not sent, though it was waiting. Recorded as a webhook changed. Needs administer at the environment, with a signed-in session.',
  rotateWebhookSecret:
    'Rotates a subscription’s signing secret and answers the new one this once; the old one signs beside it for 24 hours, so a receiver can move without losing an event. Recorded as a webhook changed. Needs administer at the environment, with a signed-in session.',
  removeWebhook:
    'Removes a subscription and every delivery waiting for it. Recorded as a webhook changed. Needs administer at the environment, with a signed-in session.',
  listWebhookDeliveries:
    'Lists a subscription’s deliveries, newest first: each one’s event type, sequence, state and how many attempts it has had. Kept 30 days. Needs administer at the environment, with a signed-in session.',
  getWebhookDelivery:
    'Returns one delivery: exactly what was sent, identifiers and versions and never content, and at each attempt what the receiver answered, its status, how long it took and at most 2 KiB of its reply, or why there was no answer. Needs administer at the environment, with a signed-in session.',
  getBridgeSettings:
    'Returns a space’s settings for CT Studio deliveries: its component type and template, the template field each property fills, whether data delivery is on, and the connection data delivery made, never its credential. A space never set up answers the empty settings. Needs administer on the space.',
  putBridgeSettings:
    'Sets a space’s settings for CT Studio deliveries, whole. Every property must map to a document field of the template, and the component type and template must exist. Turning data delivery on makes the environment’s delivery schema and a read-only account for it, makes or reuses this space’s connection to it and sets that connection’s credential, sealed by the connector; no response, event or log holds the password. Turning it on again makes a new password for the account and seals it onto every delivery connection of the environment; turning it off keeps the connection and the tables and stops new data deliveries. Recorded as a bridge settings change, with the connection made and its credential set. Needs administer on the space.',
  getCtStudio:
    'Returns the environment’s CT Studio as Administration shows it: whether the service has a signing key (never the key), the service identity CT Studio’s deliveries act as and whether it is disabled, the token CT Studio holds and when it expires, every space with CT Studio settings and whether the identity may still deliver there, the environment’s hostnames, and the address and sink id last handed to CT Studio. Needs administer at the environment, with a signed-in session.',
  connectCtStudio:
    'Connects a space to CT Studio in one transaction: the first time it makes the service identity CT Studio’s deliveries act as (or adopts one made by hand, with the token CT Studio already holds), and afterwards reuses it; grants it Author at the space unless it holds that already; issues its token the first time, with scopes create and edit for 365 days; and sets the space’s bridge settings as PUT bridge-settings does. Anything refused leaves nothing made. The token’s secret is answered this once and never kept. Needs administer at the environment, with a signed-in session.',
  disconnectCtStudio:
    'Disconnects a space from CT Studio: the Author grant its identity holds there is removed and the space’s CT Studio settings and unlisted properties go, so CT Studio can no longer deliver to it. What CT Studio delivered stays, and so does the space’s data connection. The identity, its token and every other space are kept, so connecting the space again issues nothing. Needs administer at the environment, with a signed-in session.',
  issueCtStudioToken:
    'Issues CT Studio’s identity a new token, scopes create and edit for 365 days, and records it as the one CT Studio holds; the old token stays until it expires or is revoked. Asked to replace the identity, it makes a new one in place of a disabled one, records it, and grants it Author at every space with CT Studio settings. The secret is answered this once. Needs administer at the environment, with a signed-in session.',
  listPeople: 'Lists people in the environment by name for a user selection field.',
  listPrincipals: 'Lists people already signed in or invited who may be named by an access grant.',
  getErasure:
    'States what erasing a person takes - their sessions, API tokens, group memberships, the invitation holding their address, and every audit log label naming them - what stays - their id and the identifier their provider gives them, every event against the id, and what they wrote - and everything refusing it now: a grant naming them, the caller themselves, or a service. Needs administer at the environment.',
  erasePrincipal:
    'Erases a person: their name becomes "Erased person", their address goes, every audit log label naming them takes a fixed word, and their sessions, API tokens, group memberships and invitation go with it. Somebody invited who never signed in is withdrawn. A later sign-in by the same account is refused. Refused while a grant names them, for the caller themselves and for a service. Erasing somebody erased changes nothing. Needs administer at the environment. Audited, naming the administrator and nobody erased.',
  listGroups: 'Lists the environment’s groups and their members in cursor pages.',
  requestAuditExport:
    'Asks for an export of every event matching the filters, as the log stands at the request: a job writes it as JSON Lines, one event a line in the read’s shape. Asking is itself an event.',
  getAuditExport:
    'Reads an export of the audit log: whether its job has written it, and how many events it holds.',
  downloadAuditExport:
    'Hands out a link to a written export, signed for five minutes. Each link handed out is recorded on the log.',
  placeHold:
    'Places a legal hold on a component, document, publication or asset, or on a space, which holds everything in it, with why. Several may stand on one thing. Needs administer at the environment. The reason is shown only by the holds listing and never written to the audit log; the act is audited.',
  releaseHold:
    'Releases a legal hold, with why: once, and recorded with who and when. Needs administer at the environment. Audited, without the reason.',
  listDeleted:
    'Lists the deleted components and documents the caller may read but for their deletion, the latest deleted first in cursor pages, each with who deleted it, when, and whether the caller may undelete it (retire on it). Archived ones deleted are listed here, not among the archived.',
  getRetention:
    'Returns the retention keeps in force: each a minimum in days, for a kind, a space, or a kind in a space. Every keep reaching a component or a document applies, the longest winning, and refuses deleting it until that many days have passed since its latest version. Needs administer at the environment.',
  listWorkflows:
    "Returns each kind's workflow in force - one for components, one for documents - its states and transitions, and how many of the kind are in each state now. Needs administer at the environment.",
  getWorkflowVersion:
    "Returns one version of a kind's workflow. Every version is kept, so the rules a component or a document moved under can be read again. Needs administer at the environment.",
  defineWorkflow:
    "Saves a kind's workflow as its next version, in force at once: each state a key, a name, whether it is initial and whether it counts as approved; each transition a key, a name, the states it moves from and to, the permission it needs, edit or approve, and whether it needs a reason. Keys are unique, one state is initial, and every state is reachable from it. An artifact in a state the new version drops keeps it, and moves under the version it moved under. Saving the version in force changes nothing. Needs administer at the environment. Audited.",
  transitionComponent:
    "Moves a component along a transition from its state, named as the caller saw it, needing the transition's permission on the component and a reason where the transition asks for one, recorded with the move. Refused where it has moved since, is archived, or the transition is not one from its state. Saving an approved component moves it back to the initial state on its own. Audited.",
  transitionDocument:
    "Moves a document along a transition from its state, named as the caller saw it, needing the transition's permission on the document and a reason where the transition asks for one, recorded with the move. Refused where it has moved since, is archived, or the transition is not one from its state. Saving an approved document moves it back to the initial state on its own. Audited.",
  decideComponentGate:
    "Approves or rejects a component at a gate from its state, against the version the approver saw, needing approve on the component. The gate passes once enough distinct approvers approve the current version this round, none of them an author where the gate says so, and then designates a revision. A rejection needs a reason and returns the component to the gate's declared state. Refused where it is not at the gate, the version was replaced, it is archived, or the caller approved it already. Audited.",
  decideDocumentGate:
    "Approves or rejects a document at a gate from its state, against the version the approver saw, needing approve on the document. The gate passes once enough distinct approvers approve the current version this round, none of them an author where the gate says so, and then designates a revision. A rejection needs a reason and returns the document to the gate's declared state. Refused where it is not at the gate, the version was replaced, it is archived, or the caller approved it already. Audited.",
  listComponentApprovals:
    'Lists every approval and rejection of a component at its gates, newest first: the gate, the decision, who, when, the version decided and a rejection’s reason. Needs read on the component.',
  listDocumentApprovals:
    'Lists every approval and rejection of a document at its gates, newest first: the gate, the decision, who, when, the version decided and a rejection’s reason. Needs read on the document.',
  compareComponentLine:
    "Compares a component's open divergent line with its main line, block by block: each block that differs, whether changed, held by the line alone or by the main line alone, with both sides, and the two versions compared, which bringing it back names. Needs read on the component.",
  bringComponentLineBack:
    "Brings a component's divergent line back into its main line, needing edit, after a comparison: a new main-line version taking the line's side of each differing block carried and the main line's of every other, the main line's scope taking the line's values; the line is closed, and what was carried across and what was left behind are recorded. Refused where either line moved since the comparison. Audited.",
  listComponentLines:
    "Lists a component's divergent lines, in the order they were begun: each line's name, the revision it diverged from and when, and whether it was brought back. Needs read on the component.",
  divergeComponent:
    "Begins a divergent line of a component from one of its designated revisions, needing edit: a second line of revisions beside the main one, such as a market's wording, numbered apart, with its own workflow and scope, its revisions served wherever their scope applies. Each line's name is the component's once. Audited.",
  readComponentEffective:
    'Says which one revision of a component was effective in a scope, a condition axis value, at an instant, now where none is asked: the newest effective for that scope then, else the newest effective everywhere, as it stood then, and which of the two it is. Needs read on the component.',
  readDocumentEffective:
    'Says which one revision of a document was effective in a scope, a condition axis value, at an instant, now where none is asked: the newest effective for that scope then, else the newest effective everywhere, as it stood then, and which of the two it is. Needs read on the document.',
  acceptComponentRevision:
    "Accepts a component's revision in one scope, by the person, or a member of the group, its scope names there, who may read it. Until then the revision before stays effective in that scope; once, it takes effect there. Audited.",
  acceptDocumentRevision:
    "Accepts a document's revision in one scope, by the person, or a member of the group, its scope names there, who may read it. Until then the revision before stays effective in that scope; once, it takes effect there. Audited.",
  setComponentScope:
    "Sets, as an act and needing edit, the condition axis values a component's next revision is effective for, such as a market or a site, fixed to that revision as a gate designates it; each value declared, and each perhaps naming a person or group who must accept the revision before it takes effect there, somebody who may read it. None is everywhere. A reference following approved revisions in a document serves the one effective in the document's profile. Audited.",
  setDocumentScope:
    "Sets, as an act and needing edit, the condition axis values a document's next revision is effective for, such as a market or a site, fixed to that revision as a gate designates it; each value declared, and each perhaps naming a person or group who must accept the revision before it takes effect there, somebody who may read it. None is everywhere. Audited.",
  setComponentDates:
    "Sets a component's dates as an act, needing edit: when a revision approved from now takes effect, which fixes it to that revision until then, the day it is to be reviewed by, and who is prompted to review it, somebody who may read it. Audited.",
  setDocumentDates:
    "Sets a document's dates as an act, needing edit: when a revision approved from now takes effect, which fixes it to that revision until then, the day it is to be reviewed by, and who is prompted to review it, somebody who may read it. Audited.",
  transitionQueryDefinition:
    "Moves a query definition along a transition from its state, named as the caller saw it, needing the transition's permission on the definition and a reason where the transition asks for one. Saving an approved definition moves it back to the initial state on its own. Audited.",
  decideQueryDefinitionGate:
    'Approves or rejects a query definition at a gate from its state, against the version the approver saw, needing approve on the definition, so that a change to a query is reviewed as content is. The gate passes once enough distinct approvers approve, none of them an author where the gate says so, and designates a revision; a rejection needs a reason. Audited.',
  listQueryDefinitionApprovals:
    'Lists every approval and rejection of a query definition at its gates, newest first: the gate, the decision, who, when, the version decided and a rejection’s reason. Needs read on the definition.',
  transitionPrompt:
    "Moves a prompt along a transition from its state, named as the caller saw it, needing the transition's permission on the prompt and a reason where the transition asks for one. Saving an approved prompt moves it back to the initial state on its own. Audited.",
  decidePromptGate:
    'Approves or rejects a prompt at a gate from its state, against the version the approver saw, needing approve on the prompt. The gate passes once enough distinct approvers approve, none of them an author where the gate says so, and designates a revision, the version a library runs; a rejection needs a reason. Audited.',
  listPromptApprovals:
    'Lists every approval and rejection of a prompt at its gates, newest first: the gate, the decision, who, when, the version decided and a rejection’s reason. Needs read on the prompt.',
  transitionTerm:
    "Moves a term along a transition from its state, named as the caller saw it, needing the transition's permission on the term and a reason where the transition asks for one: as seeded, deprecating an approved term, reinstating a deprecated one, or reopening one to draft. Saving an approved term moves it back to draft on its own. Audited.",
  decideTermGate:
    'Approves or rejects a term at a gate from its state, against the version the approver saw, needing approve on the term. The gate passes once enough distinct approvers approve, none of them an author where the gate says so, and designates a revision, the version documents print; a rejection needs a reason. Audited.',
  listTermApprovals:
    'Lists every approval and rejection of a term at its gates, newest first: the gate, the decision, who, when, the version decided and a rejection’s reason. Needs read on the term.',
  setRetention:
    'Sets or clears one retention keep, for a kind, a space, or a kind in a space; null days clears it. Setting what is in force changes nothing. Undeleting is never refused by a keep. Needs administer at the environment. Audited.',
  listHolds:
    'Lists every legal hold, in force or released, newest first in cursor pages, each with what it holds, who placed it, when and why, and its release. Needs administer at the environment.',
  listAuditEvents:
    'Lists the environment’s audit events, newest first, filtered by who acted, the kind or its family, when, what about and the space, in cursor pages. Each event carries the names and titles it was recorded with. Reading is not itself an event.',
  listSessions:
    'Lists the caller’s own sessions that have not ended: how each signed in, when it began, when it was last used and when it ends of itself, and which is this one. No device or address is kept.',
  endSession:
    'Ends one of the caller’s own sessions: its next request is refused and its event stream closes. Ending this one signs out.',
  beatPresence:
    'Says this window is in a document: in which component, if any, and doing what. A window beats every 20 seconds and on each change; the document’s other viewers hear it on their streams, without the component and mode where they may not read it, and stop showing it a minute after its last beat.',
  leavePresence: 'Says this window has left its document. Its stream closing says so too.',
  endOtherSessions: 'Ends every session of the caller’s but the one making the request.',
  createGroup:
    'Creates a local group or a group representing a value asserted by the identity provider.',
  deleteGroup:
    'Deletes a group together with its memberships and grants. This changes access immediately.',
  setGroupMembers:
    'Replaces the members of a local group with the given set. Provider-backed membership is managed at sign-in instead.',
  listInvitations: 'Lists waiting and accepted invitations in stable cursor pages.',
  invite: 'Invites an address so access can be granted before the person first signs in.',
  withdrawInvitation:
    'Withdraws an unaccepted invitation and removes the principal and grants created for it.',
  listRoles: 'Lists roles available to grants and the permissions each role holds.',
  listGrants: 'Lists access grants at one level using an opaque cursor.',
  makeGrant:
    'Grants or denies a role to a person or group at the selected level. The resulting access decision takes effect on the next request.',
  removeGrant: 'Removes a grant unless it is needed to keep the environment administered.',
  extendGrant:
    'Extends a grant to somebody from outside the organisation: a new grant with a later expiry, no later than the tenant cap from now, which names and replaces the one it extends in the same change. A positive act by an administrator of where it stands, audited with both expiries; a grant to somebody inside the organisation is not extended this way.',
  listExternalAccess:
    'Lists everybody from outside the organisation: each grant reaching them, directly or through a group, with its level and expiry, and what those grants let them read. The report an administrator runs to see who from outside can reach what.',
  search:
    'Searches only content the caller may read, with facets and stable cursor paging: the latest version of each by default, every version on request, or what one baseline pins. Each result names the version it matched in, and a component its translations, each with its status.',
  getEditingSettings:
    'Reads the environment’s editing settings, including how long saved changes are retained.',
  setEditingSettings:
    'Changes the environment’s editing settings. Existing saved changes follow the new policy.',
  getDataSettings:
    'Reads the limits the environment sets on a query run, each lowered or not, and the ceilings no definition may pass.',
  setDataSettings:
    'Lowers, or stops lowering, the environment limits on the rows, bytes and seconds of a query run. A run takes the least of its definition limits and these.',
  getImportSettings:
    'Reads the environment’s identity policy for imports: whether the names a file carries are kept with the member each matches, kept as text, or discarded when an import is accepted.',
  setImportSettings:
    'Changes the environment’s identity policy for imports. It applies to each import accepted from then on, once, at acceptance. Needs administer at the environment.',
  getImagesSettings:
    "Returns the environment's policy for an image whose source and licence were never declared, or whose grant is past its last day, at publish: `warn`, the default, or `refuse`. An image whose licence does not permit publication is always refused. Anyone signed in may read it, since a publisher is told what an undeclared image does.",
  setImagesSettings:
    "Changes the environment's policy for undeclared and lapsed images. It applies to each publish asked for from then on, and to republishing a baseline. Needs administer at the environment.",
  getTranslationSettings:
    'Reads the environment’s policy for publishing in a language: whether a component with no translation into it is published in its own language, marked as untranslated, or fails the publish; whether a translation out of date with a change that needs retranslating publishes or fails it; and the words the mark says, by language.',
  setTranslationSettings:
    'Changes the environment’s policy for publishing in a language, whole. A document’s own fallback, where it states one, stands over it. It applies to each publish asked for from then on. Needs administer at the environment.',
  getTranslationSettingsHistory:
    'Lists every change to the environment’s policy for publishing in a language, the newest first: each change’s values whole, who made it and when. The first is the policy as it stood when the history began, by nobody. A publish or preview in a language names the change it was decided under. Needs administer at the environment.',
  startOrganisationSignIn:
    'Browser sign-in route. Redirects to the organisation’s identity provider; an API token cannot complete this flow.',
  finishOrganisationSignIn:
    'Browser callback for the organisation’s identity provider. The browser’s sign-in attempt and returned state must match.',
  startGoogleSignIn:
    'Browser sign-in route. Redirects through the product’s shared Google sign-in address.',
  finishGoogleSignIn:
    'Google callback at the shared sign-in address. It hands a one-time code to the environment that started the flow.',
  completeGoogleSignIn:
    'Redeems a one-time code at the environment hostname and creates a signed-in browser session.',
  signOut:
    'Ends the current browser session wherever it is in use. A personal API token cannot sign out a session.',
  listSpaces:
    'Lists spaces the caller can read, marking those archived, and whether they may create a component in each; never in an archived one. Pass archived=false to leave archived spaces out.',
  createSpace:
    'Makes a space. Needs administer on the environment. The name is normalised to NFC and trimmed, and must be unique in the environment, archived spaces included.',
  updateSpace:
    'Renames a space, archives it or restores it. Needs administer on the environment. Nothing new can be made in an archived space, and nothing already in it changes; the last space not archived cannot be archived.',
  listComponentTypes:
    'Lists component types usable for a new component in this space, marking the default.',
  openStream:
    'Opens a browser-session-only event stream with a snapshot and subsequent changes. See the separate realtime protocol for event meanings and delivery guarantees.',
  requestSample:
    'Development scaffolding: queues a sample PDF for the signed-in session. Personal API tokens cannot submit this job.',
  getSample: 'Development scaffolding: polls a sample PDF request until a download is ready.',
};

/** Every operation given a tag and every one given a description, for the test that no entry is stale. */
export function documentedOperations(): { tagged: string[]; described: string[] } {
  return {
    tagged: Object.values(operationTags).flat(),
    described: Object.keys(descriptions),
  };
}

export function documentationFor(route: RouteContract): { tag: string; description: string } {
  const tag = byOperation.get(route.operationId);
  const description = descriptions[route.operationId];
  if (!tag || !description) throw new Error(`No API documentation for ${route.operationId}`);
  return { tag, description };
}
