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
      { name: 'Spaces', description: 'Find spaces and create content in them.' },
      { name: 'Components', description: 'Read, edit and version reusable components.' },
      {
        name: 'Documents',
        description: 'Create documents and work with their outlines and values.',
      },
      { name: 'Definitions', description: 'Manage fields, metadata schemas and component types.' },
      { name: 'Templates', description: 'Create and version document templates.' },
      { name: 'Assets', description: 'Upload and retrieve image assets.' },
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
      { name: 'Invitations', description: 'Invite people before their first sign-in.' },
      { name: 'Roles and grants', description: 'Inspect permissions and manage grants.' },
    ],
  },
  {
    name: 'Discovery and administration',
    tags: [
      { name: 'Search', description: 'Search content the caller may read.' },
      { name: 'Settings', description: 'Read and change environment settings.' },
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
  Spaces: ['listSpaces', 'listComponentTypes'],
  Components: [
    'listComponents',
    'getComponent',
    'createComponent',
    'listIterations',
    'getIteration',
    'saveIteration',
    'claimLock',
    'releaseLock',
    'listComponentVersions',
    'cutVersion',
  ],
  Documents: [
    'listDocuments',
    'getDocument',
    'createDocument',
    'editOutline',
    'getDocumentTexts',
    'recordDocumentValues',
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
    'getDocumentDataset',
    'nameDataset',
  ],
  Assets: [
    'createAssetUpload',
    'getAssetUpload',
    'putAssetUploadBytes',
    'getAssetVersion',
    'getAssetVersionContent',
  ],
  Previews: ['requestPreview'],
  'Publication requests': ['requestPublication', 'getPublicationRequest'],
  Publications: ['listPublications', 'listPublicationsEverywhere', 'getPublication'],
  'Presentation and numbering': ['getNumbering', 'getDocumentPresentation', 'getPresentation'],
  Tokens: [
    'listTokens',
    'createToken',
    'revokeToken',
    'listPrincipalTokens',
    'revokePrincipalToken',
  ],
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
  'Event stream': ['openStream'],
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
    'Lists only components the caller can read, in stable cursor pages. Send the returned next cursor to continue the same listing.',
  getComponent:
    'Opens the latest component version with the caller’s editing permissions and current lock. Use its version when submitting a change.',
  listIterations:
    'Lists the caller’s retained editing iterations while their session holds the component lock. Iterations are working saves, not released versions.',
  getIteration:
    'Reads one retained editing iteration, including its content and values. The caller must still hold the editing lock.',
  saveIteration:
    'Saves the complete component content for the named editing session and sequence. An editing lock and the version precondition still apply.',
  claimLock:
    'Claims or moves the editing lock to the caller’s session. Another holder’s live lock is not overridden.',
  releaseLock:
    'Finishes an editing session, cutting a version if its content changed, then releases the lock.',
  listComponentVersions:
    'Lists released component versions newest first using an opaque cursor. It does not include working iterations.',
  cutVersion:
    'Cuts a released version from the editing session’s latest saved iteration. The component lock and version precondition apply.',
  createComponent:
    'Creates a component in the named space at its first version. The caller needs permission to create there.',
  listDocuments:
    'Lists documents the caller can read with stable cursor paging, filters and facets.',
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
    'Sets or replaces the connection credential, then tests the connection with it. The credential is sealed at once and never returned; this route takes no idempotency key.',
  testConnection:
    'Tests whether the connection reaches its source and signs in. A failure gives one reason, the same whatever went wrong, and every test is recorded.',
  describeConnection:
    'Lists the tables and views the connection account may read, with each column and the type proposed for it. Sent a SQL statement instead, it answers the columns the statement would return, each with the type proposed for it, without running it; that needs write SQL on the connection as well, and a connection whose latest test found its account read-only.',
  sampleConnection:
    'Runs a draft query definition against the sample values given, exactly as a document would run it, and stores nothing. Each value is checked against its declaration before the source is asked. It needs use connection and write SQL on the connection, and a connection whose latest test found its account read-only. A failure is an answer, named and laid at the connector, the query or the product.',
  getConnectionUses:
    'Lists the query definitions whose latest versions name the connection, and the documents where a binding holds a result run on it: those the caller may read by title, and a count of the rest.',
  getQueryDefinitionUses:
    'Lists the components whose latest versions hold a binding naming the query definition, and the documents where a binding holds a result of it: those the caller may read by title, and a count of the rest. Ask before changing a definition, to see what the change will affect.',
  getDocumentBindings:
    "Lists every binding in the components the document's latest version places that the caller may read, in the outline's order: the binding as its component holds it, the dataset version it holds in this document with that result's provenance and name, whether the binding has changed since, and any newer result a check recorded and nobody has accepted. Reading needs only read on the document, never use of a connection; a provenance shows the SQL that ran and the connection only to a caller who may read its query definition.",
  resolveBindings:
    "Runs the named bindings' query definitions through the connector now, as the service account of each connection, and holds each result in this document: the definition version the binding pins, or its latest. Each result is stored once under its checksum and recorded as a version of its dataset, reusing the latest where nothing differs. It needs edit on the document, read on each definition, and use connection on each connection, decided again once the source has answered; a binding that changed meanwhile, or a permission lost, records nothing. Each failed run is answered by name with its definition, binding and document, and records nothing. This route takes no idempotency key.",
  checkBindings:
    "Runs the document's checked bindings again, each distinct query once, two at a time and at most 50 a check, and records any different result as a new dataset version waiting to be accepted: nothing the document holds changes. A binding whose connection the caller may not use is left unchecked, as are those holding nothing; pinned bindings are never checked. This route takes no idempotency key.",
  acceptBinding:
    'Holds a waiting result for one binding in this document alone, naming the version it replaces, and queries nothing. Every other document holding the same dataset keeps its version. It needs edit on the document; an acceptance from a version the binding no longer holds is refused with the binding as it stands.',
  getDocumentDataset:
    'Returns a stored result whole - its columns, every row in canonical form, and its provenance - where the document holds it or has it waiting. Reading needs only read on the document; the provenance shows the SQL that ran and the connection only to a caller who may read its query definition.',
  nameDataset:
    'Names a dataset. The name is kept beside every earlier one, and the latest is the name. It needs edit on the dataset, which sits in the space of its query definition.',
  listQueryDefinitions:
    'Lists the query definitions the caller may read, with the space and connection of each, filtered by space or connection.',
  createQueryDefinition:
    'Creates a query definition in the named space from a whole definition: SQL with named parameters, the columns it returns, a key, an order, whether no rows is valid, and its limits. It needs edit in the space and use connection and write SQL on the connection it names.',
  getQueryDefinition:
    'Returns the latest query definition version, the connection it names, and whether the caller may change it or run it.',
  recordQueryDefinitionVersion:
    'Records the next query definition version from the version the caller opened. Retiring and reinstating a definition are versions too; a retiring version is accepted whatever the connection last found.',
  createAssetUpload:
    'Starts an image upload in a space and records its description or decorative status. Upload bytes separately to finish it.',
  getAssetUpload:
    'Reads the state of an upload the caller created and, once ingestion completes, the resulting asset version.',
  putAssetUploadBytes:
    'Sends the image bytes for an existing upload. Only PNG and JPEG images admitted by the ingest worker become assets.',
  getAssetVersion: 'Reads the recorded properties of an asset version that the caller may access.',
  getAssetVersionContent:
    'Returns the stored image bytes of a readable asset version. Use the response media type as supplied.',
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
  listSpaces: 'Lists spaces the caller can read and whether they may create a component in each.',
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
