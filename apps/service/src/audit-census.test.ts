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
  finishGoogleSignIn: writes('authentication.sign_in_failed'),
  completeGoogleSignIn: writes(
    'authentication.signed_in',
    'authentication.sign_in_failed',
    'invitation.accepted',
    'tenant.administrator_claimed',
  ),
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
  recordDocumentValues: writes('content.version_cut'),
  getDocumentParameters: read,
  recordDocumentParameters: writes('content.version_cut'),
  editOutline: writes('content.version_cut'),
  requestPublication: writes('publication.requested'),
  requestPreview: { none: 'preview' },
  getPublicationRequest: read,
  listPublications: read,
  listPublicationsEverywhere: read,
  getPublication: read,
  getPublicationBindings: read,
  claimLock: { none: 'lock' },
  releaseLock: { none: 'lock' },
  saveIteration: { none: 'iteration' },
  cutVersion: writes('content.version_cut'),
  listIterations: read,
  getIteration: read,
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
  resolveBindings: writes('content.version_cut', 'binding.resolved'),
  checkBindings: writes('content.version_cut', 'binding.checked'),
  acceptBinding: writes('binding.accepted'),
  confirmBinding: writes('binding.confirmed'),
  getBindingHolders: read,
  getDocumentDataset: read,
  getBoundTableRows: read,
  nameDataset: writes('dataset.named'),
  // A GET that writes: it finishes a pending result as the act that ran it would have.
  getPendingResult: writes('content.version_cut', 'binding.resolved', 'binding.checked'),
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
  listPrincipalTokens: read,
  revokePrincipalToken: writes('token.revoked'),
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
  },
  /** The worker's sweeps (apps/worker/src/sweep.ts). */
  sweeps: {
    sweepExpiredSignIns: writes('authentication.signed_out'),
    sweepExpiredIterations: { none: 'iteration' },
    sweepUncheckedPublications: { none: 'derived' },
    sweepExpiredPreviews: { none: 'preview' },
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
  /** Erasure, which no route reaches yet (packages/db/src/audit.ts). */
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

describe('the census of the audit log', () => {
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
