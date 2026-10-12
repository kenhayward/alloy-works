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
      { name: 'Assets', description: 'Upload and retrieve image assets.' },
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
      { name: 'Settings', description: 'Read and change environment settings.' },
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
  Environments: ['getTenant'],
  Identity: [
    'getMe',
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
    'cutVersion',
    'previewRestore',
    'restoreVersion',
    'archiveComponent',
    'unarchiveComponent',
  ],
  Documents: [
    'listDocuments',
    'listDocumentVersions',
    'previewDocumentRestore',
    'restoreDocumentVersion',
    'archiveDocument',
    'unarchiveDocument',
    'getDocument',
    'createDocument',
    'editOutline',
    'getDocumentTexts',
    'recordDocumentValues',
    'getDocumentParameters',
    'recordDocumentParameters',
    'getContributions',
  ],
  Definitions: ['listDefinitions', 'createDefinition', 'getDefinition', 'recordDefinitionVersion'],
  Templates: ['listTemplates', 'createTemplate', 'getTemplate', 'recordTemplateVersion'],
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
    'createAssetUpload',
    'getAssetUpload',
    'putAssetUploadBytes',
    'getAssetVersion',
    'getAssetVersionContent',
  ],
  Threads: [
    'startComponentThread',
    'startDocumentThread',
    'listComponentThreads',
    'listDocumentThreads',
    'getThread',
    'addComment',
    'editComment',
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
  'Presentation and numbering': ['getNumbering', 'getDocumentPresentation', 'getPresentation'],
  Tokens: [
    'listTokens',
    'createToken',
    'revokeToken',
    'listPrincipalTokens',
    'revokePrincipalToken',
  ],
  Sessions: ['listSessions', 'endSession', 'endOtherSessions'],
  'Event stream': ['openStream', 'beatPresence', 'leavePresence'],
  'People and principals': ['listPeople', 'listPrincipals'],
  Groups: ['listGroups', 'createGroup', 'deleteGroup', 'setGroupMembers'],
  Invitations: ['listInvitations', 'invite', 'withdrawInvitation'],
  'Roles and grants': [
    'getAccess',
    'explainAccess',
    'listRoles',
    'listGrants',
    'makeGrant',
    'removeGrant',
  ],
  Search: ['search'],
  Settings: ['getEditingSettings', 'setEditingSettings', 'getDataSettings', 'setDataSettings'],
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
  getMe:
    'Returns the person represented by the supplied personal token or signed-in session and the environment in which that credential was issued.',
  getAccess:
    'Ask whether the caller may perform each permission on a tenant, space or artifact target. The answer includes token scope restrictions when called with a token.',
  explainAccess:
    'For an administrator, explain each permission a named principal has on a target and the grants and levels behind the answer.',
  listComponents:
    'Lists only components the caller can read, in stable cursor pages. Send the returned next cursor to continue the same listing. Archived components are left out unless archived=only asks for them alone.',
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
    'Lists what changed since an instant in one scope - a document and the components it places, a space, or up to 200 artifacts a caller already holds - as the caller may read it: each artifact with versions cut since, and each value a document resolved or accepted since. Versions are never deleted, so the record begins at the first; a question reaching back before it is answered from there, and says so.',
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
    'Lists released component versions newest first using an opaque cursor. It does not include working iterations.',
  listDocumentVersions:
    'Lists a document’s versions newest first using an opaque cursor, each with the version it was restored from, if any.',
  previewDocumentRestore:
    'Answers what restoring an earlier version of a document would make, inserting nothing: its outline compared with the latest’s, a component the caller may not read withheld on both sides, and anything that would refuse it. The outline, its references and their modes and its values come back as they stood; its parameters stay as they are now. Refused by the outline’s own guards: a reference the caller may not read, a section change the template does not allow, or a value its field no longer takes.',
  restoreDocumentVersion:
    'Restores an earlier version of a document as a new version, numbered after the latest and naming the version it was restored from; the earlier version is unchanged. The request names the latest version the restore was previewed against. Each reference whose version it changes is audited as re-pointed, from and to.',
  previewRestore:
    'Answers what restoring an earlier version of a component would make, inserting nothing: the version restored from, the latest it would follow, the earlier values its fields no longer take, and anything that would refuse it. Its content is the earlier version’s as read now; compare it with the latest to see the changes.',
  restoreVersion:
    'Restores an earlier version of a component as a new version, numbered after the latest and naming the version it was restored from; the earlier version is unchanged. The request names the latest version the restore was previewed against. Refused while anybody holds the lock, and where it would change nothing.',
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
  getDocument:
    'Returns the latest document version, including its outline and whether the caller can restructure it.',
  createDocument:
    'Creates a document at version 0.1 in the named space, either empty or from a template’s starting outline.',
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
  getContributions:
    'Shows what each occurrence contributes to the current document, subject to the caller’s readable set.',
  getNumbering:
    'Returns current section, figure, table and equation numbering using the document’s publishing layout.',
  getDocumentPresentation:
    'Returns the theme and layout used to publish this document so a reader can present its text consistently.',
  getPresentation:
    'Returns the environment’s default presentation used for a component outside a document.',
  listDefinitions:
    'Lists current field, metadata schema and component type definitions. A later version can change the current shape.',
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
  createAssetUpload:
    'Starts an image upload in a space and records its description or decorative status. Upload bytes separately to finish it.',
  getAssetUpload:
    'Reads the state of an upload the caller created and, once ingestion completes, the resulting asset version.',
  putAssetUploadBytes:
    'Sends the image bytes for an existing upload. Only PNG and JPEG images admitted by the ingest worker become assets.',
  getAssetVersion:
    'Reads the recorded properties of an asset version that the caller may access. An image a dataset holds is read only by a caller who may also read a document holding it, and is otherwise not found.',
  getAssetVersionContent:
    'Returns the stored image bytes of a readable asset version. Use the response media type as supplied. An image a dataset holds is read only by a caller who may also read a document holding it, and is otherwise not found.',
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
  listPeople: 'Lists people in the environment by name for a user selection field.',
  listPrincipals: 'Lists people already signed in or invited who may be named by an access grant.',
  listGroups: 'Lists the environment’s groups and their members in cursor pages.',
  requestAuditExport:
    'Asks for an export of every event matching the filters, as the log stands at the request: a job writes it as JSON Lines, one event a line in the read’s shape. Asking is itself an event.',
  getAuditExport:
    'Reads an export of the audit log: whether its job has written it, and how many events it holds.',
  downloadAuditExport:
    'Hands out a link to a written export, signed for five minutes. Each link handed out is recorded on the log.',
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
  search: 'Searches only content the caller may read, with facets and stable cursor paging.',
  getEditingSettings:
    'Reads the environment’s editing settings, including how long saved changes are retained.',
  setEditingSettings:
    'Changes the environment’s editing settings. Existing saved changes follow the new policy.',
  getDataSettings:
    'Reads the limits the environment sets on a query run, each lowered or not, and the ceilings no definition may pass.',
  setDataSettings:
    'Lowers, or stops lowering, the environment limits on the rows, bytes and seconds of a query run. A run takes the least of its definition limits and these.',
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
