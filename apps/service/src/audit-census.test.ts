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
  attempt: 'Starts a sign-in: it names nobody, and the sign-in that finishes it is recorded',
  derived:
    "A write derived from what is already recorded, which changes none of the tenant's content",
  preview: 'A preview, kept for an hour and published nowhere',
  lock: "A lock claimed or released: COL's lock-taking design records lock.taken (COL-009)",
  iteration: 'An iteration, which is never a version (VER-005)',
  upload: 'An upload waiting for its bytes: its asset is ingested, or the upload refused, later',
  source: "Reads the source through the connector: nothing of the tenant's changes",
  platform: "The platform's own provisioning, outside the tenant's acts",
  presence: 'Where a window is, which is presence, not an act: unlogged, and gone in a minute',
  inbox:
    "A person's own inbox: what they were told, read, cleared or chose, none of the tenant's content",
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
  getPublicationRequest: read,
  listPublications: read,
  listPublicationsEverywhere: read,
  getPublication: read,
  getPublicationBindings: read,
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
  makeSuggestion: writes('suggestion.made'),
  listComponentSuggestions: read,
  listDocumentSuggestions: read,
  getSuggestion: read,
  acceptSuggestion: writes('suggestion.accepted', 'content.version_cut', 'workflow.transitioned'),
  rejectSuggestion: writes('suggestion.rejected'),
  withdrawSuggestion: writes('suggestion.withdrawn'),
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
  cutVersion: writes('content.version_cut', 'workflow.transitioned'),
  previewRestore: read,
  restoreVersion: writes('content.restored', 'content.version_cut', 'workflow.transitioned'),
  archiveComponent: writes('artifact.archived'),
  unarchiveComponent: writes('artifact.unarchived'),
  archiveDocument: writes('artifact.archived'),
  unarchiveDocument: writes('artifact.unarchived'),
  getComponentDeletion: read,
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
  listRoles: read,
  listPrincipals: read,
  makeGrant: writes('access.granted'),
  removeGrant: writes('access.revoked'),
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
  // Dates set (WF5-A).
  setComponentDates: writes('dates.set'),
  setDocumentDates: writes('dates.set'),
  listComponentApprovals: read,
  listDocumentApprovals: read,
  transitionQueryDefinition: writes('workflow.transitioned'),
  decideQueryDefinitionGate: writes(
    'approval.given',
    'gate.rejected',
    'revision.designated',
    'workflow.transitioned',
  ),
  listQueryDefinitionApprovals: read,
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
  },
  /** The worker's sweeps (apps/worker/src/sweep.ts). */
  sweeps: {
    sweepExpiredSignIns: writes('authentication.signed_out'),
    sweepExpiredIterations: { none: 'iteration' },
    sweepUncheckedPublications: { none: 'derived' },
    sweepExpiredPreviews: { none: 'preview' },
    sweepStalePresence: { none: 'presence' },
    foldNotificationDigests: { none: 'inbox' },
    sweepOldNotifications: { none: 'inbox' },
    sweepDates: writes('revision.effective', 'review.lapsed', 'workflow.transitioned'),
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
