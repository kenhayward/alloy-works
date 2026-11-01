import { createHash, randomUUID } from 'node:crypto';
import type {
  AcceptBindingBody,
  BindingStateView,
  BoundTableRowsParams,
  BoundTableRowsQuery,
  CheckBindingsView,
  ComponentBindingParams,
  ConfirmBindingBody,
  CreateDocumentBody,
  DatasetNameBody,
  DatasetParams,
  DocumentBindingParams,
  DocumentBindingsQuery,
  DocumentDatasetParams,
  PendingResultParams,
  PendingResultView,
  QueryDefinitionParams,
  ResolveBindingsBody,
  ReviseBindingBody,
  ResolveBindingsView,
  SpaceParams,
  TakeOutcomeView,
} from '@alloy-works/api-contract';
import { SESSION_COOKIE, type ProvenanceView } from '@alloy-works/api-contract';
import {
  artifactPlace,
  assetHolding,
  bindingQuestion,
  componentsBinding,
  createFromResolution,
  dataPolicy,
  datasetName,
  documentParameterDeclarations,
  documentsHolding,
  documentsResolving,
  erasedIn,
  finishPending,
  holdObject,
  inSavepoint,
  latestRevisions,
  lockBindings,
  lockDatasetQuestions,
  newNodeIdentifier,
  nameDataset,
  pendingImages,
  pendingResult,
  readDocument,
  readPendingResult,
  readQueryDefinition,
  readVersion,
  recallAnswer,
  recordDatasetVersion,
  recordEvent,
  recordResolution,
  recordRevision,
  recordTake,
  refusePending,
  rememberAnswer,
  publishedBindings,
  resolutionsOf,
  resolvedFrom,
  resolveForDocument,
  resolveOccurrences,
  revisionsNamed,
  revisionsStanding,
  sessionContent,
  takeDigest,
  takesOf,
  uploadForDatasetImage,
  type CreateDocumentAnswer,
  type HeldResolution,
  type PendingAct,
  type StoredPending,
  type StoredRevision,
  type PinnedBinding,
  type StoredConnection,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  ADMITTED_FORMATS,
  argumentRefusal,
  bindingDigestInput,
  bindingsIn,
  canonicalResultBytes,
  canonicalResultSchema,
  checkParameterValues,
  checkTake,
  decide,
  effectiveLimits,
  identityKey,
  literalValues,
  canonicalKeyValue,
  cellRevisable,
  keyedRow,
  keyNamesTheKey,
  matchNoteRows,
  parametersDigestInput,
  parseQueryDefinition,
  questionUnchanged,
  readContent,
  readImageHeader,
  readOutline,
  revisionCellKey,
  walkOutline,
  takeOutcomeSchema,
  takes,
  takeValue,
  tableOrder,
  TABLE_ROWS_MAX,
  valueProblem,
  type AnyBinding,
  type AssetFormat,
  type Binding,
  type BoundTableNode,
  type BindingPlace,
  type CanonicalResult,
  type Column,
  type CanonicalValue,
  type ColumnType,
  type DocumentParameters,
  type DraftDefinition,
  type Limits,
  type ParameterValues,
  type RevisionCell,
  type Provenance,
  type QueryDefinition,
  type RevisionAnswer,
  type RevisionRequest,
  type RunAnswer,
  type RunRequest,
  type TakeOutcome,
  type ContentDocument,
  capabilitiesOf,
  capabilityProblems,
} from '@alloy-works/domain';
import { tenantPrefix, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  authoriseAt,
  callerOf,
  notFound,
  refusedBy,
  type Authorised,
  type Caller,
} from '../access.js';
import { contextOf, isRefusal, recordRefusalIn } from '../audit.js';
import { Accepted, AfterCommit, Revalidated } from '../after-commit.js';
import { createdView } from '../documents.js';
import { AppError, storageUnavailable } from '../errors.js';
import { keyedRequest, keyReused } from '../idempotency.js';
import { hashToken } from '../sessions.js';
import { bearerSecret, isBearer } from '../tokens.js';
import { refused } from '../wire-codes.js';
import { actingKey, ownViewOf, provenanceIdentity, runIdentity, type Acting } from './acting.js';
import { failureViewFor, type FailureIn } from './failure-words.js';
import { carryRevisions, keptProblem, recordRevisionEvent, revisionsDecided } from './revisions.js';
import { asWritten, connectionFacts, requireSqlPermitted } from './sql-access.js';
import { datasetOf, datasetProblems, type ReadSource } from './dataset-source.js';
import { languageOf } from '../listing.js';

/**
 * Bindings and datasets (data.md, "Acts, revisions and failures"; the D3 plan, task 3). Reading what a
 * document's bindings hold, accepting a waiting result, reading a stored result and naming a dataset
 * ask no source and are here whole. Resolving and checking do ask one: their routes are the connection
 * routes' (`connections.ts`, the one importer of the connector's client, DAT-089), which hand this
 * module the run and the connection's own refusals, and this module the rest - decided and read in the
 * deciding transaction, the source asked once it commits, and the result recorded in a second
 * transaction that decides again (D3-H).
 */

/**
 * A provenance record as the contract answers it, its values as JSON writes them: whole to a caller who
 * may read its query definition, and otherwise without what only the definition says - the SQL that
 * ran, the connection it ran on and the source's column each declared column reads - as D2 shows a
 * definition, the id of the connection it names among it, only to the definition's reader. (D2 hides
 * a connection's name, not its id, from a reader of the definition who may not read the connection.)
 * The stored record is unchanged; the rows, their checksum and count, each declared column's name and
 * type, and the parameter values the document itself supplied stay inspectable.
 */
const provenanceView = (provenance: Provenance, readsDefinition: boolean, erased = false) =>
  (readsDefinition
    ? withIdentity(provenance, erased)
    : {
        ...withIdentity(provenance, erased),
        connection: null,
        ran:
          'sql' in provenance.ran
            ? { sql: null }
            : 'request' in provenance.ran
              ? { request: null }
              : 'dataset' in provenance.ran
                ? { dataset: null }
                : { object: null },
        columns: provenance.columns.map((column) => ({ ...column, from: null })),
      }) as unknown as z.infer<typeof ProvenanceView>;

/**
 * The record with whose view it was, and, unless that person is since erased, the name the source saw
 * them by: kept in the dataset version, never shown once they are (the ER plan, ER-B).
 */
const withIdentity = (provenance: Provenance, erased: boolean): Provenance =>
  erased && provenance.identity.kind === 'endUser'
    ? ({
        ...provenance,
        identity: { ...provenance.identity, asSeen: null },
      } as unknown as Provenance)
    : provenance;

/** Whether the person whose own view a record is has been erased, each asked once a request. */
function erasedViewer(trx: TenantTransaction) {
  const known = new Map<string, Promise<boolean>>();
  return (provenance: Provenance) => {
    if (provenance.identity.kind !== 'endUser') return Promise.resolve(false);
    const principal = provenance.identity.principal;
    let erased = known.get(principal);
    if (!erased) {
      erased = trx
        .selectFrom('principal')
        .select(erasedIn().as('erased'))
        .where('id', '=', principal)
        .executeTakeFirst()
        .then((row) => row?.erased === true);
      known.set(principal, erased);
    }
    return erased;
  };
}

/** Whether the caller may read a query definition, each asked once a request. */
export function definitionReader(trx: TenantTransaction, caller: Caller) {
  const known = new Map<string, Promise<boolean>>();
  return (definition: string) => {
    let reads = known.get(definition);
    if (!reads) {
      reads = connectionFacts(trx, caller, definition).then(
        (facts) => facts !== undefined && decide('read', facts).allowed,
      );
      known.set(definition, reads);
    }
    return reads;
  };
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Each run a check makes at once, of the connector's four (D2's `MAX_RUNS`; D3-I). */
const AT_ONCE = 2;
/** The most distinct runs a check makes; the rest are left unchecked, `limit` (D3-I). */
const MOST_RUNS = 50;

/** What asking the connector for a run came to: its answer, or why there is none. */
export type RunAsked =
  | { readonly answer: RunAnswer }
  | {
      readonly refused: {
        readonly code: 'connector_busy' | 'connector_unavailable' | 'query_throttled';
      };
    };

/**
 * What the connection routes lend a resolve and a check: the run itself, the connection's own
 * refusals - a connection that cannot run, and the sealed credential it runs with - who the caller
 * runs as on a connection (D7-G), and the watch on their authority while the source answers (D7-I).
 */
export interface RunsThrough {
  /** A run, metered (the R18 plan): through the tenant's slots, and recorded with its query. */
  readonly run: (
    request: RunRequest,
    signal: AbortSignal,
    queryDefinition: string | null,
  ) => Promise<RunAsked>;
  /**
   * A stored result's query, run here and recorded as a run (DAT-094, DAT-053; R21-A): no connector,
   * so no slot of the tenant's runs at once.
   */
  readonly runDataset: (
    source: ReadSource,
    draft: DraftDefinition,
    values: ParameterValues,
    limits: Limits,
    queryDefinition: string,
  ) => Promise<RunAsked>;
  /**
   * Whether a source moved since a revision (DAT-073; the FR plan, FR-D): no run, so no slot of the
   * tenant's runs, and nothing recorded as one. Undefined where it could not be asked.
   */
  readonly revision: (
    request: RevisionRequest,
    signal: AbortSignal,
  ) => Promise<RevisionAnswer | undefined>;
  readonly runnable: (trx: TenantTransaction, id: string) => Promise<StoredConnection>;
  readonly usableSealed: (
    trx: TenantTransaction,
    id: string,
  ) => Promise<{ readonly sealed: string }>;
  readonly acting: (trx: TenantTransaction, connection: StoredConnection) => Promise<Acting>;
  /**
   * Does `work` while the caller's session or token holds; ended, its signal aborts and the act
   * answers `authority_ended`. `work` throws the signal's reason before it records anything.
   */
  readonly whileHeld: <T>(work: (signal: AbortSignal) => Promise<T>) => Promise<T>;
}

/**
 * A binding as a document places it: the node, the component version, and its digest (D3-R), taken
 * over the binding with its document arguments substituted by the document's latest parameters (the
 * TP2 plan, TP2-A), so a changed parameter changes exactly the digests of the bindings reading it.
 */
interface Placed {
  readonly node: string;
  readonly component: string;
  /**
   * A binding taking a value, or a bound table's, taking the whole result (the TB1 plan, TB1-C): as
   * the component holds it, its document arguments as written, which clients compare it by.
   */
  readonly binding: AnyBinding;
  /**
   * The question it asks: its document arguments substituted where the document's template feeds
   * them to arguments of their type (`bindingQuestion`; the TP2 final review), which `digest` is over.
   */
  readonly question: AnyBinding;
  readonly digest: string;
  /** The document's latest version's parameters, which its document arguments take (TP2-B). */
  readonly parameters: DocumentParameters;
  /**
   * In a line, in a footnote's line, or as a figure's image: where an image may stand (B6-D); or
   * `table`, a bound table's own binding, which takes nothing.
   */
  readonly place: BindingPlace | 'table';
  /** A figure's binding whose figure its author marked decorative (Ken, 2026-10-06). */
  readonly decorative?: true;
  /** A bound table's binding: the table holding it, as it is read (the TB2 plan, TB2-A). */
  readonly table?: BoundTableNode;
  /** Read from the caller's own editing session, not the version (the TB2 final review). */
  readonly fromSession?: true;
}

const key = (node: string, binding: string) => `${node} ${binding}`;

/** The binding with its document arguments substituted: the question it asks (TP2-A). */
const questionOf = (placed: Placed): AnyBinding => placed.question;

/**
 * Where bindings are read from beside the component versions (B2-C): the caller's own editing session,
 * for the nodes named - `strict`, a node it cannot be read for holds nothing, so its binding is
 * `binding_missing` - or for every node, falling back to the version where it cannot (the view's).
 */
interface SessionSource {
  readonly session: string;
  readonly nodes: ReadonlySet<string> | 'every';
  /** The nodes named fall back to the version where the session cannot answer, as `every` does. */
  readonly fallBack?: true;
}

/**
 * Every binding in the components the document's latest version places, read as `principalId`, in the
 * outline's order (D3-E): the version each node resolves to - its pin, or the component's latest - and
 * never one of a component they may not read. Undefined where the id is no document.
 *
 * With a session source (B2-C), a node it names is read from the latest save of the caller's own
 * session instead, only where the node floats at the latest, the session holds the component's lock
 * and it opened from the version the node resolves to: a node named for a resolve or a Keep that is
 * not so holds nothing, and the view's falls back to the version.
 */
async function bindingsPlaced(
  trx: TenantTransaction,
  documentId: string,
  principalId: string,
  source?: SessionSource,
): Promise<Placed[] | undefined> {
  const document = await readDocument(trx, documentId);
  if (!document) return undefined;
  const read = readOutline(document.version.content, {
    artifact: documentId,
    version: document.version.id,
  });
  if (!read.ok) throw new Error(`The document ${documentId} does not read`);
  const floating = new Set<string>();
  walkOutline(read.outline.nodes, (node) => {
    if (node.type === 'reference' && node.mode.kind === 'latest') floating.add(node.id);
  });
  const placed: Placed[] = [];
  for (const occurrence of await resolveOccurrences(trx, read.outline, principalId)) {
    if (occurrence.outcome !== 'resolved') continue;
    let substance: unknown;
    let fromSession = false;
    const named =
      source !== undefined && (source.nodes === 'every' || source.nodes.has(occurrence.node));
    if (named) {
      const saved = floating.has(occurrence.node)
        ? await sessionContent(trx, {
            artifactId: occurrence.component,
            principal: principalId,
            session: source.session,
          })
        : undefined;
      if (saved?.openedFrom === occurrence.version) {
        substance = saved.content;
        fromSession = true;
      } else if (source.nodes !== 'every' && source.fallBack !== true) continue;
    }
    if (substance === undefined) {
      const stored = await readVersion(trx, occurrence.version);
      if (!stored) throw new Error(`The component version ${occurrence.version} is gone`);
      substance = stored.content;
    }
    const content = readContent(substance, {
      artifact: occurrence.component,
      version: occurrence.version,
    });
    if (!content.ok) throw new Error(`The component version ${occurrence.version} does not read`);
    for (const { binding, place, decorative } of bindingsIn(content.document)) {
      const question = await bindingQuestion(trx, documentId, binding, document.version.parameters);
      placed.push({
        node: occurrence.node,
        component: occurrence.component,
        binding,
        question,
        digest: sha256(bindingDigestInput(question)),
        parameters: document.version.parameters,
        place,
        ...(decorative ? { decorative } : {}),
        ...(fromSession ? { fromSession: true as const } : {}),
        ...(place === 'table'
          ? { table: boundTableHolding(content.document.content, binding.id)! }
          : {}),
      });
    }
  }
  return placed;
}

/**
 * A document's bindings as its Data tab shows them now (D3-J): each binding its occurrences hold, as
 * the caller reads them, against its latest resolution - what a comparison with the document now
 * takes its values from (the CP plan, CP-D). Undefined where there is no such document.
 */
export async function liveBindingStates(
  trx: TenantTransaction,
  caller: Caller,
  objects: ObjectStores | undefined,
  tenant: Tenant,
  documentId: string,
): Promise<BindingStateView[] | undefined> {
  const placed = await bindingsPlaced(trx, documentId, caller.principalId);
  if (!placed) return undefined;
  const held = await heldBy(trx, documentId, placed);
  const views = viewer(trx, caller, objects, tenant, documentId);
  return views(
    placed.map((each) => ({ placed: each, held: held.get(key(each.node, each.binding.id)) })),
  );
}

/**
 * A baseline's bindings as its page shows them (the BL plan, BL-I): each binding its pinned
 * occurrences hold - those the caller may read, which the caller passes - against the resolution the
 * baseline pinned, never the document's latest, with nothing waiting; the dataset's name as pinned.
 */
export async function pinnedBindingStates(
  trx: TenantTransaction,
  caller: Caller,
  objects: ObjectStores | undefined,
  tenant: Tenant,
  input: {
    readonly documentId: string;
    readonly parameters: DocumentParameters;
    readonly occurrences: readonly {
      readonly node: string;
      readonly component: string;
      readonly content: ContentDocument;
    }[];
    readonly pinned: readonly PinnedBinding[];
  },
): Promise<BindingStateView[]> {
  const pinnedAt = new Map(input.pinned.map((each) => [key(each.node, each.binding), each]));
  const placed: Placed[] = [];
  for (const occurrence of input.occurrences) {
    for (const { binding, place, decorative } of bindingsIn(occurrence.content)) {
      const question = await bindingQuestion(trx, input.documentId, binding, input.parameters);
      placed.push({
        node: occurrence.node,
        component: occurrence.component,
        binding,
        question,
        // The digest it was pinned under, so what it held then is what it holds here.
        digest:
          pinnedAt.get(key(occurrence.node, binding.id))?.digest ??
          sha256(bindingDigestInput(question)),
        parameters: input.parameters,
        place,
        ...(decorative ? { decorative } : {}),
        ...(place === 'table'
          ? { table: boundTableHolding(occurrence.content.content, binding.id)! }
          : {}),
      });
    }
  }
  const views = viewer(trx, caller, objects, tenant, input.documentId);
  const states = await views(
    placed.map((each) => ({
      placed: each,
      held: pinnedAt.get(key(each.node, each.binding.id))?.held,
    })),
  );
  // The revisions it pinned, never the document's latest (RV-E).
  const named = new Map(
    (
      await revisionsNamed(
        trx,
        input.pinned.flatMap((each) => each.revisions),
      )
    ).map((each) => [each.id, each]),
  );
  // Nothing here is the document's now (the BL final review, finding 4): what has moved on since,
  // and what the caller may do now, are the live document's to say, never a baseline's.
  return states.map((state) => {
    const pin = pinnedAt.get(key(state.node, state.binding.id));
    return {
      ...state,
      revisions: (pin?.revisions ?? []).flatMap((id) => {
        const each = named.get(id);
        return each === undefined || each.value === null
          ? []
          : [
              {
                id,
                cell: each.cell,
                value: each.value,
                reason: each.reason,
                by: { id: each.by, displayName: each.byName },
                at: each.at.toISOString(),
                stands: true,
              },
            ];
      }),
      definitionChanged: false,
      sincePublished: null,
      mayCheck: false,
      mayResolve: false,
      held:
        state.held && pin ? { ...state.held, name: pin.datasetName, keepable: false } : state.held,
    };
  });
}

/**
 * Whether `If-None-Match` names `etag`: `*`, or a list of tags any of which matches it weakly - its
 * `W/` prefix aside, as RFC 9110 compares for a GET (the TB2 final review).
 */
export function tagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const asked = (Array.isArray(header) ? header.join(',') : header)
    .split(',')
    .map((each) => each.trim());
  return asked.some((each) => each === '*' || each.replace(/^W\//, '') === etag);
}

/** The key a query definition version declares (TB3-B): empty where it declares none or is gone. */
async function definitionKey(trx: TenantTransaction, version: string): Promise<readonly string[]> {
  const found = await readVersion(trx, version);
  return found?.kind === 'queryDefinition' ? parseQueryDefinition(found.content).key : [];
}

/** The bound table holding the binding `id`, wherever in the blocks it stands. */
function boundTableHolding(value: unknown, id: string): BoundTableNode | undefined {
  if (Array.isArray(value)) {
    for (const each of value) {
      const found = boundTableHolding(each, id);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const node = value as { type?: unknown; binding?: { id?: unknown } };
  if (node.type === 'boundTable' && node.binding?.id === id) return value as BoundTableNode;
  return boundTableHolding(Object.values(value), id);
}

/** What names a binding in a refusal or a failure (DAT-086). */
type Naming = {
  readonly definition?: string;
  readonly binding: string;
  readonly node: string;
  readonly document: string;
};

/** A refusal made again with the binding it is about named beside it. */
function named(error: unknown, naming: Naming): unknown {
  if (!(error instanceof AppError)) return error;
  const renamed = new AppError(error.status, error.code, error.message, error.rule, {
    ...error.members,
    ...naming,
  });
  // A refusal stays one, for the audit log (AU1-E).
  return error.refusal === undefined ? renamed : renamed.refusing(error.refusal);
}

const bindingMissing = (naming: Naming, why: string) =>
  refused(400, 'binding.missing', why, naming);

const accessChanged = () =>
  refused(
    409,
    'access.changed',
    'A permission this needs, or the session it was asked in, ended while the source was answering. Nothing was recorded.',
  );

/**
 * A person's own view, and somebody else is acting on it (the D7 plan, D7-H): only the person whose
 * view it is is offered it, accepts it or has it finished.
 */
const identityDiffers = (naming: Naming) =>
  refused(
    403,
    'identity.differs',
    `The result waiting for the binding ${naming.binding} is another person's own view: only they may accept it.`,
    naming,
  );

/** One's own view, held in a document without DAT-091's acknowledgement (the D7 plan, D7-H). */
const acknowledgementRequired = (naming: Naming) =>
  refused(
    409,
    'acknowledgement.required',
    `The binding ${naming.binding} runs as you, so what it holds is your own view, which everybody who may read the document will see. Acknowledge that to hold it.`,
    naming,
  );

const bindingChanged = (naming: Naming) =>
  refused(
    409,
    'binding.changed',
    `The binding ${naming.binding} changed while the source was answering. Nothing was recorded: resolve it again.`,
    naming,
  );

/**
 * What a run's source asks of whoever runs it: `use_connection` on its connection, or `read` on the
 * stored result a dataset query reads (DAT-094; the R21 plan, R21-A).
 */
function sourceOf(ran: Provenance): {
  readonly artifact: string;
  readonly permission: 'use_connection' | 'read';
} {
  if (ran.connection) return { artifact: ran.connection.artifact, permission: 'use_connection' };
  return {
    artifact: (ran.ran as { dataset: { artifact: string } }).dataset.artifact,
    permission: 'read',
  };
}
function definitionSource(definition: QueryDefinition): {
  readonly artifact: string;
  readonly permission: 'use_connection' | 'read';
} {
  return definition.fetch.kind === 'dataset'
    ? { artifact: definition.fetch.dataset, permission: 'read' }
    : { artifact: definition.connection!, permission: 'use_connection' };
}

/** A definition as a run takes it: the whole shape but its title, description and retired. */
function draftOf(definition: QueryDefinition): DraftDefinition {
  return {
    schemaVersion: definition.schemaVersion,
    connection: definition.connection,
    parameters: definition.parameters,
    fetch: definition.fetch,
    columns: definition.columns,
    key: definition.key,
    order: definition.order,
    empty: definition.empty,
    limits: definition.limits,
  };
}

/**
 * Each document argument whose document parameter cannot be it (the TP2 plan, TP2-C): one whose
 * declaration does not feed arguments, `feeds`, or whose base type or list is not the definition
 * parameter's, `type` - naming the document's parameter and nothing of its declaration, which the
 * caller may not read. A parameter the template does not declare is left for `required`.
 */
async function argumentProblems(
  trx: TenantTransaction,
  documentId: string,
  placed: Placed,
  definition: QueryDefinition,
): Promise<{ parameter: string; rule: 'feeds' | 'type'; value: string }[]> {
  const taken = Object.entries(placed.binding.parameters).flatMap(([name, parameter]) =>
    'document' in parameter ? [[name, parameter.document] as const] : [],
  );
  if (taken.length === 0) return [];
  const declared = new Map(
    (await documentParameterDeclarations(trx, documentId)).map((each) => [each.name, each]),
  );
  const asks = new Map(definition.parameters.map((each) => [each.name, each]));
  return taken.flatMap(([name, documentName]) => {
    const declaration = declared.get(documentName);
    const parameter = asks.get(name);
    const rule = declaration && parameter && argumentRefusal(declaration, parameter);
    return rule ? [{ parameter: documentName, rule, value: '' }] : [];
  });
}

/** Everything a binding's run needs, decided and read in the deciding transaction. */
interface Prepared {
  readonly placed: Placed;
  readonly definition: { readonly id: string; readonly version: string };
  /** The connection it runs on, and its sealed credential; none for a stored result's query (R21-A). */
  readonly connection: StoredConnection | null;
  readonly sealed: string | null;
  /** The stored result a dataset query reads (DAT-094; R21-A). */
  readonly source?: ReadSource;
  readonly draft: DraftDefinition;
  readonly values: ParameterValues;
  readonly limits: Limits;
  /** Who it runs as: the account, or the caller (D7-G). */
  readonly acting: Acting;
  /** The question it asks: one run answers every binding asking it (D3-I). */
  readonly question: string;
}

/**
 * Decides, for one binding, everything its run needs (D3-E, D3-L): `read` on the definition it names,
 * one the caller may not read refused as `binding_missing`, as one that is not there is; the version
 * it resolves to - its pin, or the latest - a definition not retired, what it takes checked against
 * that version, its values against its parameters, and at the connection that version names
 * `use_connection`, a connection that can run, for SQL a connection SQL is permitted on (DAT-103; a
 * built query is not refused there, D4-J) and a credential to run with. Each refusal names the binding, its node and the document.
 */
async function prepare(
  trx: TenantTransaction,
  caller: Caller,
  documentId: string,
  placed: Placed,
  through: RunsThrough,
): Promise<Prepared> {
  const { binding } = placed;
  const naming: Naming = {
    definition: binding.query,
    binding: binding.id,
    node: placed.node,
    document: documentId,
  };
  try {
    const stored = await readQueryDefinition(trx, binding.query);
    const facts = stored && (await connectionFacts(trx, caller, stored.id));
    // A definition the caller may not read is answered as one that is not there, so a binding's
    // refusal never tells them whether it exists.
    if (!stored || !facts) {
      throw bindingMissing(naming, `The binding ${binding.id} names no query definition here.`);
    }
    // One that exists and that the caller may not read: a refusal, hidden (AU1-E).
    const reading = decide('read', facts);
    if (!reading.allowed) {
      throw refusedBy(
        bindingMissing(naming, `The binding ${binding.id} names no query definition here.`),
        reading,
        facts,
        { kind: 'artifact', id: stored.id },
        true,
      );
    }
    if (stored.definition.retired) {
      throw refused(
        409,
        'definition.retired',
        `The query definition the binding ${binding.id} names is retired, so it runs nothing.`,
      );
    }
    let definition = stored.definition;
    let version = stored.version.id;
    if (binding.version !== undefined) {
      const pinned = await readVersion(trx, binding.version);
      if (!pinned || pinned.artifactId !== stored.id || pinned.kind !== 'queryDefinition') {
        throw bindingMissing(
          naming,
          `The binding ${binding.id} pins a version its query definition does not have.`,
        );
      }
      definition = parseQueryDefinition(pinned.content);
      version = pinned.id;
    }
    // A bound table's binding takes nothing (the TB1 plan, TB1-C): its definition and its parameters
    // are checked, as every binding's are, and no take.
    const take = takes(binding) ? checkTake(binding.take, definition) : null;
    if (take !== null) throw refused(400, 'take.invalid', `${take}.`);
    const arguments_ = await argumentProblems(trx, documentId, placed, definition);
    if (arguments_.length > 0) {
      throw refused(
        400,
        'parameter.invalid',
        'A parameter of the document cannot be this argument.',
        {
          attribution: 'product',
          problems: arguments_,
        },
      );
    }
    // Its document arguments substituted (TP2-C): one the document has no value for is required
    // where its parameter is, and otherwise left out, the run made without it (the TP2 final review).
    const literal = literalValues(questionOf(placed));
    const requires = new Set(
      definition.parameters.filter((each) => each.required).map((each) => each.name),
    );
    const problems = [
      ...literal.fromDocument
        .filter((parameter) => requires.has(parameter))
        .map((parameter) => ({ parameter, rule: 'required' as const, value: '' })),
      ...checkParameterValues(definition.parameters, literal.values).filter(
        (problem) => !literal.fromDocument.includes(problem.parameter),
      ),
    ];
    if (problems.length > 0) {
      throw refused(400, 'parameter.invalid', 'A value does not fit its parameter.', {
        attribution: 'product',
        problems,
      });
    }
    if (definition.fetch.kind === 'dataset') {
      // A stored result's query (R21-A): `read` on the dataset, its tree held to its own columns,
      // run here on no connection, as the service.
      const atDataset = await connectionFacts(trx, caller, definition.fetch.dataset);
      const reads = atDataset && decide('read', atDataset);
      if (!reads?.allowed) {
        throw new AppError(
          403,
          'forbidden',
          `This needs read on the stored result the binding ${binding.id} queries.`,
        );
      }
      const source = await datasetOf(trx, definition.fetch);
      if (!source) {
        throw bindingMissing(
          naming,
          `The binding ${binding.id} queries a stored result this environment no longer holds.`,
        );
      }
      const wrong = datasetProblems(draftOf(definition), source);
      if (wrong.length > 0) {
        throw refused(400, 'definition.invalid', 'The query definition is not valid.', {
          problems: wrong,
        });
      }
      const acting: Acting = { kind: 'service' };
      return {
        placed,
        definition: { id: stored.id, version },
        connection: null,
        sealed: null,
        source,
        draft: draftOf(definition),
        values: literal.values,
        limits: effectiveLimits(definition.limits, await dataPolicy(trx)),
        acting,
        question: `${stored.id} ${version} ${sha256(parametersDigestInput(literal.values))} dataset:${source.version}`,
      };
    }
    const connection = await through.runnable(trx, definition.connection!);
    const atConnection = await connectionFacts(trx, caller, connection.id);
    const using = atConnection && decide('use_connection', atConnection);
    if (!using?.allowed) {
      const error = new AppError(
        403,
        'forbidden',
        `This needs the use connection permission on the connection the binding ${binding.id} runs on.`,
      );
      throw atConnection && using
        ? refusedBy(error, using, atConnection, { kind: 'artifact', id: connection.id }, false)
        : error;
    }
    await requireSqlPermitted(trx, connection, asWritten(definition));
    // Saved against a connection since saved again to a source that binds no parameters (DAT-079).
    if (capabilityProblems(definition, connection.settings).length > 0) {
      throw refused(
        409,
        'capability.undeclared',
        `The query definition the binding ${binding.id} names binds parameters, which its connection's source declares it does not.`,
      );
    }
    const { sealed } = await through.usableSealed(trx, connection.id);
    const limits = effectiveLimits(definition.limits, await dataPolicy(trx));
    const acting = await through.acting(trx, connection);
    return {
      placed,
      definition: { id: stored.id, version },
      connection,
      sealed,
      draft: draftOf(definition),
      values: literal.values,
      limits,
      acting,
      question: `${stored.id} ${version} ${sha256(parametersDigestInput(literal.values))} ${actingKey(acting)}`,
    };
  } catch (error) {
    throw named(error, naming);
  }
}

/** What a binding takes: a column of the only row, or of the row a key names. */
type Take = Binding['take'];

/**
 * A run's outcome: its provenance and what each binding asking its question takes from its rows, by
 * the take's digest - the rows themselves are not kept, since fifty of up to 25 MiB are too many to
 * hold until the recording transaction (B1-H) - or the failure that refuses it.
 */
type Ran =
  | {
      readonly ok: true;
      readonly provenance: Provenance;
      /** Each take's outcome by its digest, or undefined where the cell was not its column's. */
      readonly taken: ReadonlyMap<string, TakeOutcome | undefined>;
      /** Each image the result holds, stored by its hash, by that hash (D8-D). */
      readonly images: ReadonlyMap<string, StoredImage>;
    }
  | { readonly ok: false; readonly failure: FailureIn };

/** An image a run's result holds, as it was stored: its key, its format and its size. */
interface StoredImage {
  readonly key: string;
  readonly format: AssetFormat;
  readonly bytes: number;
}

/**
 * The takes of every binding asking each question, by question: every question asked, a bound
 * table's among them, which takes nothing (TB1-C) and so may ask a question with no take.
 */
function takesByQuestion(prepared: readonly Prepared[]): Map<string, Take[]> {
  const asked = new Map<string, Take[]>();
  for (const each of prepared) {
    const asking = asked.get(each.question) ?? [];
    const { binding } = each.placed;
    if (takes(binding)) asking.push(binding.take);
    asked.set(each.question, asking);
  }
  return asked;
}

/**
 * A take by `takeValue`, held to `takeOutcomeSchema` before it is an outcome (B1-H), or undefined. A
 * result is held to its checksum and to the canonical shape, and neither holds a cell to its column's
 * declared type, so a connector, or a stored object, can give `true` in a text column or `01` in an
 * integer one; `takeValue` is the one rule the page, the editor and the publish share, and takes the
 * cell as it stands, so the service, which alone records, holds it here. What is not an outcome is
 * `unavailable` to the view and recorded nowhere, failing no act, as a result that cannot be read is.
 */
function takeHeld(
  take: Take,
  result: CanonicalResult,
  columns: readonly Column[],
): TakeOutcome | undefined {
  const outcome = takeOutcomeSchema.safeParse(takeValue(take, result, columns));
  return outcome.success ? outcome.data : undefined;
}

/** Records what a binding took from the version its run recorded or found (B1-H), where it took one. */
const recordTaken = async (
  trx: TenantTransaction,
  version: string,
  each: Prepared,
  ran: Extract<Ran, { ok: true }>,
) => {
  // A bound table's binding takes nothing, so records none (TB1-C).
  const { binding } = each.placed;
  if (!takes(binding)) return;
  const take = binding.take;
  const outcome = ran.taken.get(takeDigest(take));
  if (outcome !== undefined) await recordTake(trx, { version, take, outcome });
};

/**
 * Asks the connector for one run, outside any transaction, and holds what it answered to its checksum
 * (D2-K): the rows in their canonical form must hash to what it said, or it is `connector_error`. The
 * bytes are then put in the tenant's store, whose key is their SHA-256, before any row names them
 * (D3-G); a key that is not that checksum's is a store that did not keep what it was given. Each take
 * asking this question is taken from the rows here, by `takeValue` over the columns the run declares,
 * and only its outcome is carried on (B1-H). Each image the answer carries (D8-B) is held to its hash
 * and to the asset door's header reading, the image alone, or the run is `connector_error`; then
 * stored under its hash, as an upload's image is, and carried on by its key alone.
 */
async function runOnce(
  tenant: Tenant,
  prepared: Prepared,
  takes: readonly Take[],
  through: RunsThrough,
  store: () => Promise<{
    put(body: Uint8Array, contentType: string): Promise<{ key: string; size: number }>;
  }>,
  signal: AbortSignal,
): Promise<Ran> {
  const asked = prepared.source
    ? await through.runDataset(
        prepared.source,
        prepared.draft,
        prepared.values,
        prepared.limits,
        prepared.definition.id,
      )
    : await through.run(runRequestOf(tenant, prepared), signal, prepared.definition.id);
  // Nothing of a run whose authority ended is kept, its rows among them (IAM-082).
  if (signal.aborted) throw signal.reason;
  if ('refused' in asked) return { ok: false, failure: { code: asked.refused.code } };
  const ran = asked.answer;
  if (ran.outcome === 'failed') return { ok: false, failure: ran.failure };
  // A person's run says whom the source saw (D7-A); one that does not is no answer of the connector's.
  if (prepared.acting.kind === 'asserted' && ran.asSeen === undefined) {
    return { ok: false, failure: { code: 'connector_error' } };
  }
  const bytes = canonicalResultBytes(ran.result);
  const checksum = sha256(bytes);
  if (checksum !== ran.checksum) return { ok: false, failure: { code: 'connector_error' } };
  const decoded = new Map<string, { image: Buffer; format: AssetFormat }>();
  for (const [hash, encoded] of Object.entries(ran.images ?? {})) {
    const image = Buffer.from(encoded, 'base64');
    const read = readImageHeader(image);
    if (
      createHash('sha256').update(image).digest('hex') !== hash ||
      !read.ok ||
      read.header.end !== image.length
    ) {
      return { ok: false, failure: { code: 'connector_error' } };
    }
    decoded.set(hash, { image, format: read.header.format });
  }
  const kept = await (await store()).put(Buffer.from(bytes, 'utf8'), 'application/json');
  if (kept.key !== `${tenantPrefix(tenant)}sha256/${checksum}`) {
    throw new Error('The store kept a result under a key that is not its checksum');
  }
  const images = new Map<string, StoredImage>();
  for (const [hash, { image, format }] of decoded) {
    const stored = await (await store()).put(image, ADMITTED_FORMATS[format].contentType);
    if (stored.key !== `${tenantPrefix(tenant)}sha256/${hash}`) {
      throw new Error('The store kept an image under a key that is not its hash');
    }
    images.set(hash, { key: stored.key, format, bytes: stored.size });
  }
  const taken = new Map(
    takes.map((take) => [takeDigest(take), takeHeld(take, ran.result, prepared.draft.columns)]),
  );
  return {
    ok: true,
    taken,
    images,
    provenance: {
      schemaVersion: 1,
      queryDefinition: { artifact: prepared.definition.id, version: prepared.definition.version },
      ...(prepared.connection === null
        ? {}
        : {
            connection: {
              artifact: prepared.connection.id,
              version: prepared.connection.version.id,
            },
          }),
      parameters: prepared.values,
      ran: ran.ran,
      identity: provenanceIdentity(prepared.acting, ran.asSeen ?? ''),
      at: new Date().toISOString(),
      durationMs: ran.durationMs,
      rowCount: ran.rowCount,
      columns: prepared.draft.columns,
      canonical: 1,
      checksum,
      images: {},
      // What a check asks the source about next time (FR-C).
      ...(ran.revision === undefined ? {} : { revision: ran.revision }),
    },
  };
}

/** The run a prepared binding sends its connection's connector: none for a stored result's query. */
function runRequestOf(
  tenant: Tenant,
  prepared: Pick<Prepared, 'connection' | 'sealed' | 'draft' | 'values' | 'limits' | 'acting'>,
): RunRequest {
  return {
    requestId: randomUUID(),
    tenant: tenant.id,
    connection: { id: prepared.connection!.id, version: prepared.connection!.version.id },
    settings: prepared.connection!.settings,
    sealed: prepared.sealed!,
    definition: prepared.draft,
    values: prepared.values as RunRequest['values'],
    limits: prepared.limits,
    deadlineMs: prepared.limits.seconds * 1000,
    ...runIdentity(prepared.acting),
  };
}

/** A vocabulary's source query's rows, or why there are none (the VO plan, VO-J). */
export type SourceRun =
  | { readonly ok: true; readonly result: CanonicalResult }
  | { readonly ok: false; readonly failure: FailureIn; readonly seesSource: boolean };

/**
 * **A vocabulary's source query, decided** (LIB-058; the VO plan, VO-J): as a binding's run is, as the
 * administrator refreshing - `read` on the definition, one not retired and asking no required
 * parameter, `use_connection` and SQL permitted at its connection, or `read` on the stored result it
 * queries - in the deciding transaction; the run it answers is asked after, outside any, and recorded
 * as the act `vocabulary` (DAT-053), its rows held to their checksum.
 */
export async function prepareSourceQuery(
  trx: TenantTransaction,
  caller: Caller,
  definitionId: string,
  through: RunsThrough,
): Promise<(tenant: Tenant, signal: AbortSignal) => Promise<SourceRun>> {
  const stored = await readQueryDefinition(trx, definitionId);
  const facts = stored && (await connectionFacts(trx, caller, stored.id));
  // One the caller may not read is answered as one that is not there.
  if (!stored || !facts || !decide('read', facts).allowed) {
    throw refused(
      409,
      'vocabulary.source_missing',
      'The query definition this vocabulary takes its values from is not one here that you may read.',
    );
  }
  const definition = stored.definition;
  if (definition.retired) {
    throw refused(409, 'definition.retired', 'The query definition is retired, so it runs nothing.');
  }
  if (definition.parameters.some((each) => each.required)) {
    throw refused(
      409,
      'vocabulary.source_parameters',
      'A vocabulary takes its values from a query definition that asks no required parameter.',
    );
  }
  const draft = draftOf(definition);
  const limits = effectiveLimits(definition.limits, await dataPolicy(trx));
  const id = stored.id;
  if (definition.fetch.kind === 'dataset') {
    const atDataset = await connectionFacts(trx, caller, definition.fetch.dataset);
    if (!(atDataset && decide('read', atDataset).allowed)) {
      throw new AppError(403, 'forbidden', 'This needs read on the stored result the query reads.');
    }
    const source = await datasetOf(trx, definition.fetch);
    if (!source || datasetProblems(draft, source).length > 0) {
      throw refused(
        409,
        'vocabulary.source_missing',
        'The query definition reads a stored result this environment no longer holds.',
      );
    }
    return async () => {
      const asked = await through.runDataset(source, draft, {}, limits, id);
      if ('refused' in asked) {
        return { ok: false, failure: { code: asked.refused.code }, seesSource: false };
      }
      return asked.answer.outcome === 'ok'
        ? { ok: true, result: asked.answer.result }
        : { ok: false, failure: asked.answer.failure, seesSource: false };
    };
  }
  const connection = await through.runnable(trx, definition.connection!);
  const atConnection = await connectionFacts(trx, caller, connection.id);
  if (!(atConnection && decide('use_connection', atConnection).allowed)) {
    throw new AppError(
      403,
      'forbidden',
      "This needs the use connection permission on the query definition's connection.",
    );
  }
  await requireSqlPermitted(trx, connection, asWritten(definition));
  if (capabilityProblems(definition, connection.settings).length > 0) {
    throw refused(
      409,
      'capability.undeclared',
      "The query definition binds parameters, which its connection's source declares it does not.",
    );
  }
  const { sealed } = await through.usableSealed(trx, connection.id);
  const acting = await through.acting(trx, connection);
  const seesSource = decide('write_sql', atConnection).allowed;
  const prepared = { connection, sealed, draft, values: {}, limits, acting };
  return async (tenant, signal) => {
    const asked = await through.run(runRequestOf(tenant, prepared), signal, id);
    if (signal.aborted) throw signal.reason;
    if ('refused' in asked) return { ok: false, failure: { code: asked.refused.code }, seesSource };
    const ran = asked.answer;
    if (ran.outcome === 'failed') return { ok: false, failure: ran.failure, seesSource };
    // A person's run says whom the source saw (D7-A), and its rows hash to its checksum (D2-K).
    if (
      (acting.kind === 'asserted' && ran.asSeen === undefined) ||
      sha256(canonicalResultBytes(ran.result)) !== ran.checksum
    ) {
      return { ok: false, failure: { code: 'connector_error' }, seesSource };
    }
    return { ok: true, result: ran.result };
  };
}

/**
 * The revision a check may ask a binding's source about before it runs (DAT-073; the FR plan, FR-D):
 * the one its held result was made at, where that result names a connection - never a stored
 * result's (R21) - of a type that reports one, and was made by the definition version, connection
 * version and values this check would run. Undefined where any differs: it runs as it would.
 */
function revisionHeld(prepared: Prepared, holding: HeldResolution | undefined): string | undefined {
  const provenance = holding?.held.provenance;
  const { connection } = prepared;
  if (provenance?.revision === undefined || connection === null || prepared.source) {
    return undefined;
  }
  if (!capabilitiesOf(connection.settings).revision) return undefined;
  return provenance.connection?.artifact === connection.id &&
    provenance.connection.version === connection.version.id &&
    provenance.queryDefinition.version === prepared.definition.version &&
    parametersDigestInput(provenance.parameters) === parametersDigestInput(prepared.values)
    ? provenance.revision
    : undefined;
}

/**
 * The questions whose source says it has not moved since every binding asking it was resolved
 * (DAT-073; FR-D), each asked once, in turn as runs are. A binding held at no revision, at another,
 * or by another run, and the question is not asked, and runs; a source that cannot say has moved.
 */
async function unmovedQuestions(
  tenant: Tenant,
  asking: readonly Prepared[],
  toRun: readonly Prepared[],
  held: ReadonlyMap<string, HeldResolution>,
  through: RunsThrough,
  signal: AbortSignal,
): Promise<Set<string>> {
  const askable = asking.flatMap((each) => {
    const revisions = new Set(
      toRun
        .filter((other) => other.question === each.question)
        .map((other) =>
          revisionHeld(other, held.get(key(other.placed.node, other.placed.binding.id))),
        ),
    );
    const [revision] = revisions;
    return revisions.size === 1 && revision !== undefined ? [{ each, revision }] : [];
  });
  const answers = await inTurn(askable, AT_ONCE, ({ each, revision }) =>
    through.revision({ ...runRequestOf(tenant, each), revision }, signal),
  );
  return new Set(
    askable.flatMap(({ each }, at) =>
      answers[at]?.outcome === 'unchanged' ? [each.question] : [],
    ),
  );
}

/**
 * A run's images as the recording transaction finds them (the D8 plan, D8-D): every one an asset in
 * the definition's space already holds, so the result is recorded at once, by the hashes it holds;
 * or an upload admitting each of the rest, so it waits; or the failure that refuses it.
 */
type Admission =
  | { readonly held: true; readonly provenance: Provenance; readonly hashes: readonly string[] }
  | { readonly held: false; readonly provenance: Provenance; readonly uploads: readonly string[] }
  | { readonly failure: FailureIn };

/**
 * Admits the images of every run an act records (D8-D), each run by its question: each image an
 * asset in the definition's space holds is reused, by the earliest version holding it, and nothing is
 * ingested. Every other image, across all the runs, is held by its hash as `holdObject` holds an
 * upload's, all of them before any is admitted and in the order of the hashes, so two acts sharing
 * images across questions never each hold what the other waits for. Under its lock each is asked of
 * the assets again, found still stored - a refusal of another upload of the same bytes may have
 * removed it since the run stored it - and given the upload already checking it there, or one made
 * for it, its `ingest` queued. Each provenance names the asset version of each image already held.
 */
async function admitAll(
  trx: TenantTransaction,
  store: () => Promise<{ get(key: string): Promise<Buffer> }>,
  principalId: string,
  runs: ReadonlyMap<string, Extract<Ran, { ok: true }>>,
): Promise<Map<string, Admission>> {
  const spaces = new Map<string, string>();
  const found = new Map<
    string,
    { space: string; held: Record<string, string>; missing: string[] }
  >();
  for (const [question, ran] of runs) {
    const definition = ran.provenance.queryDefinition.artifact;
    let space = spaces.get(definition);
    if (space === undefined) {
      space = (
        await trx
          .selectFrom('artifact')
          .select('space_id')
          .where('id', '=', definition)
          .executeTakeFirstOrThrow()
      ).space_id!;
      spaces.set(definition, space);
    }
    const held: Record<string, string> = {};
    const missing: string[] = [];
    for (const hash of [...ran.images.keys()].sort()) {
      const version = await assetHolding(trx, space, hash);
      if (version === undefined) missing.push(hash);
      else held[hash] = version;
    }
    found.set(question, { space, held, missing });
  }
  const locking = [...new Set([...found.values()].flatMap((each) => each.missing))].sort();
  for (const hash of locking) await holdObject(trx, hash);

  const admitted = new Map<string, Admission>();
  for (const [question, ran] of runs) {
    const { space, held, missing } = found.get(question)!;
    const hashes = [...ran.images.keys()].sort();
    const uploads: string[] = [];
    let failure: FailureIn | undefined;
    for (const hash of missing) {
      // Admitted since it was first asked, by an upload that finished meanwhile.
      const version = await assetHolding(trx, space, hash);
      if (version !== undefined) {
        held[hash] = version;
        continue;
      }
      const image = ran.images.get(hash)!;
      const kept = await (await store()).get(image.key).catch(() => undefined);
      if (kept === undefined || createHash('sha256').update(kept).digest('hex') !== hash) {
        failure = { code: 'connector_error' };
        break;
      }
      const { upload } = await uploadForDatasetImage(trx, {
        spaceId: space,
        uploader: principalId,
        key: image.key,
        format: image.format,
        bytes: image.bytes,
      });
      uploads.push(upload.id);
    }
    const provenance = { ...ran.provenance, images: held };
    admitted.set(
      question,
      failure !== undefined
        ? { failure }
        : uploads.length === 0
          ? { held: true, provenance, hashes }
          : { held: false, provenance, uploads },
    );
  }
  return admitted;
}

/** Each question run once, at most `atOnce` at a time, in the order asked. */
async function inTurn<T, R>(
  items: readonly T[],
  atOnce: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(atOnce, items.length) }, async () => {
      while (next < items.length) {
        const at = next;
        next += 1;
        out[at] = await work(items[at]!);
      }
    }),
  );
  return out;
}

/**
 * Whether the request's session or token is still one this environment honours for the same
 * principal: a session that ended, or a token revoked, while the source answered records nothing
 * (D3-H). Its row is read `FOR SHARE` and held to the commit, so a sign-out or a revocation committing
 * meanwhile either lands first, and nothing is recorded, or waits until the record has committed (the
 * review, 2026-10-06).
 */
async function stillSignedIn(trx: TenantTransaction, request: FastifyRequest): Promise<boolean> {
  const principal = request.principal?.principalId;
  const authorization = request.headers.authorization;
  const now = new Date();
  if (authorization !== undefined && isBearer(authorization)) {
    const secret = bearerSecret(authorization);
    if (secret === undefined) return false;
    const held = await trx
      .selectFrom('api_token')
      .select('principal_id')
      .where('token_hash', '=', hashToken(secret))
      .where('expires_at', '>', now)
      .forShare()
      .executeTakeFirst();
    return held !== undefined && held.principal_id === principal;
  }
  const token = request.cookies[SESSION_COOKIE];
  if (token === undefined) return false;
  const held = await trx
    .selectFrom('session')
    .select('principal_id')
    .where('token_hash', '=', hashToken(token))
    .where('expires_at', '>', now)
    .where('idle_expires_at', '>', now)
    .forShare()
    .executeTakeFirst();
  return held !== undefined && held.principal_id === principal;
}

/**
 * Decides again, in the recording transaction, everything the act decided before the source was
 * asked (D3-H): the session, the permission on the document, `read` on each definition and
 * `use_connection` on each connection. Anything lost is `access_changed`, and nothing is recorded.
 */
async function decideAgain(
  trx: TenantTransaction,
  request: FastifyRequest,
  document: { readonly id: string; readonly permission: 'edit' | 'read' },
  runs: readonly Prepared[],
): Promise<void> {
  if (!(await stillSignedIn(trx, request))) throw accessChanged();
  const caller = callerOf(request);
  try {
    await authoriseAt(trx, caller, document.permission, { kind: 'artifact', id: document.id });
  } catch (error) {
    if (error instanceof AppError) throw accessChanged();
    throw error;
  }
  for (const each of runs) {
    const definition = await connectionFacts(trx, caller, each.definition.id);
    // Its source as it asks: the connection's use, or a stored result's read (R21-A).
    const [at, permission] = each.connection
      ? [each.connection.id, 'use_connection' as const]
      : [each.source!.dataset, 'read' as const];
    const source = await connectionFacts(trx, caller, at);
    if (
      !definition ||
      !decide('read', definition).allowed ||
      !source ||
      !decide(permission, source).allowed
    ) {
      throw accessChanged();
    }
  }
}

/**
 * The connections whose source messages the caller may see now, decided again in the recording
 * transaction (D2-H, D3-H): `write_sql` revoked while the source answered shows a failure without what
 * the source said, as it would have been shown had it been revoked before.
 */
async function seeingSourceNow(
  trx: TenantTransaction,
  caller: Caller,
  runs: readonly Prepared[],
): Promise<(run: Prepared) => boolean> {
  const sees = new Map<string, boolean>();
  for (const { connection } of runs) {
    // A stored result's query has no source to say anything (R21-A).
    if (connection === null || sees.has(connection.id)) continue;
    const facts = await connectionFacts(trx, caller, connection.id);
    sees.set(connection.id, facts !== undefined && decide('write_sql', facts).allowed);
  }
  return (run) => run.connection !== null && sees.get(run.connection.id) === true;
}

/** Each run that answered, by its question, for its images to be admitted. */
const recordedRuns = (
  runs: readonly Prepared[],
  ran: ReadonlyMap<string, Ran>,
): Map<string, Extract<Ran, { ok: true }>> =>
  new Map(
    runs.flatMap((each) => {
      const outcome = ran.get(each.question);
      return outcome?.ok === true ? [[each.question, outcome] as const] : [];
    }),
  );

/** The provenance of each result these runs recorded, for the locks on their questions. */
const recordable = (runs: readonly Prepared[], ran: ReadonlyMap<string, Ran>): Provenance[] =>
  runs.flatMap((each) => {
    const outcome = ran.get(each.question);
    return outcome?.ok === true ? [outcome.provenance] : [];
  });

/**
 * Re-reads each binding a run answers, from where it was read, refusing the act where one has changed
 * since (D3-H) - a session's among them, which may have saved again or lost its lock (B2-C).
 */
async function unchangedSince(
  trx: TenantTransaction,
  documentId: string,
  principalId: string,
  bindings: readonly Placed[],
  source?: SessionSource,
): Promise<void> {
  const now = new Map(
    ((await bindingsPlaced(trx, documentId, principalId, source)) ?? []).map((each) => [
      key(each.node, each.binding.id),
      each,
    ]),
  );
  for (const each of bindings) {
    if (now.get(key(each.node, each.binding.id))?.digest !== each.digest) {
      throw bindingChanged({
        definition: each.binding.query,
        binding: each.binding.id,
        node: each.node,
        document: documentId,
      });
    }
  }
}

/**
 * A failure for one binding, named (DAT-086): a data failure, or a refusal of what it needs. What the
 * source said of a statement it refused is shown only where `seesSource`: the caller holds `write_sql`
 * at the connection, decided in the transaction that answers it (D2-H).
 */
function bindingFailure(
  failure: FailureIn | AppError,
  naming: Required<Naming>,
  seesSource = false,
  built = false,
) {
  if (failure instanceof AppError) {
    const said = failure.members.attribution;
    const attribution: 'connector' | 'query' | 'product' =
      said === 'connector' || said === 'query' ? said : 'product';
    return {
      code: failure.code,
      attribution,
      message: failure.message,
      ...naming,
    };
  }
  return { ...failureViewFor(failure, seesSource, built), ...naming };
}

/**
 * What taking a result into a document asks of the source side, as a fetch does (DAT-090): `read` on
 * the query definition it ran, one the caller may not read refused as `binding_missing` in the words a
 * resolve refuses one naming no definition in, so the refusal never tells them whether it exists,
 * naming the binding, its node and the document; and `use_connection` on the connection it ran on,
 * refused `forbidden` as the route's 403 answers any refusal, its message naming the binding alone.
 */
async function mayTakeResult(
  trx: TenantTransaction,
  caller: Caller,
  provenance: Provenance,
  naming: Required<Naming>,
): Promise<void> {
  const definition = await connectionFacts(trx, caller, provenance.queryDefinition.artifact);
  const missing = () =>
    bindingMissing(naming, `The binding ${naming.binding} names no query definition here.`);
  if (!definition) throw missing();
  // One that exists and that the caller may not read: a refusal, hidden (AU1-E).
  const reading = decide('read', definition);
  if (!reading.allowed) {
    throw refusedBy(
      missing(),
      reading,
      definition,
      { kind: 'artifact', id: provenance.queryDefinition.artifact },
      true,
    );
  }
  const runsOn = sourceOf(provenance);
  const connection = await connectionFacts(trx, caller, runsOn.artifact);
  const using = connection && decide(runsOn.permission, connection);
  if (!using?.allowed) {
    const error = new AppError(
      403,
      'forbidden',
      runsOn.permission === 'read'
        ? `This needs read on the stored result the binding ${naming.binding} queries.`
        : `This needs the use connection permission on the connection the binding ${naming.binding} runs on.`,
    );
    throw connection && using
      ? refusedBy(error, using, connection, { kind: 'artifact', id: runsOn.artifact }, false)
      : error;
  }
}

/** A take asked of a dataset version, with the provenance it is taken by. */
interface TakeAsked {
  readonly version: string;
  readonly take: Take;
  readonly provenance: Provenance;
  /** Asked for a figure its author marked decorative, which needs no description (Ken, 2026-10-06). */
  readonly decorative?: true;
}

const takeKey = (version: string, take: Take, decorative?: true) =>
  `${version} ${takeDigest(take)}${decorative ? ' decorative' : ''}`;

/** The declared columns with `column`, where it is an image, declared decorative instead. */
const decorativeColumns = (columns: readonly Column[], column: string): Column[] =>
  columns.map((each) =>
    each.name === column && each.type.base === 'image'
      ? { ...each, type: { ...each.type, description: 'decorative' as const } }
      : each,
  );

/** What a take gave, or that its result could not be read to take it. */
type Taken = TakeOutcome | { readonly unavailable: true };

/**
 * **What a take gives where its binding is placed** (the B6 plan, B6-D), as the view answers it: an
 * image with the asset version its dataset version's provenance admitted it as, or `unavailable` where
 * that names none; an image in a footnote's text `image_not_placeable` (CNT-129), and a figure's
 * binding taking anything but an image `value_not_image`, and a message form's anything but a number
 * `value_not_number` (the MF plan, MF-D) - decided here and by the publish's stage,
 * never recorded, since `dataset_take` keys an outcome by the version and the take alone.
 */
function placedTaken(place: BindingPlace, taken: Taken, provenance: Provenance): TakeOutcomeView {
  if ('unavailable' in taken || 'failure' in taken) return taken;
  // A message form's binding takes a number (the MF plan, MF-D), as the publish's stage refuses.
  if (place === 'form') {
    if (!('value' in taken)) return { failure: 'value_not_number' };
    const base = taken.column.type.base;
    return base === 'integer' || base === 'decimal' ? taken : { failure: 'value_not_number' };
  }
  if ('value' in taken) return place === 'figure' ? { failure: 'value_not_image' } : taken;
  if (place === 'footnote' || place === 'caption') return { failure: 'image_not_placeable' };
  const assetVersion = provenance.images[taken.image];
  return assetVersion === undefined ? { unavailable: true } : { ...taken, assetVersion };
}

/**
 * What each take asked gives (B1-H), by `takeKey`: what `dataset_take` holds, read first; and for a
 * miss, the stored result read once per version by its checksum, held to it and to the canonical
 * shape, each take taken by `takeValue` over the version's own declared columns and recorded. A result
 * that cannot be read - no store, an object gone, or bytes that are not its checksum's or do not parse
 * - is `unavailable` for every take of it, recorded nowhere and failing nothing, so a later read tries
 * again.
 */
async function takenOf(
  trx: TenantTransaction,
  store: (() => Promise<TenantStore>) | undefined,
  keyFor: (checksum: string) => string,
  asked: readonly TakeAsked[],
): Promise<Map<string, Taken>> {
  const unique = [
    ...new Map(asked.map((each) => [takeKey(each.version, each.take), each])).values(),
  ];
  const taken = new Map<string, Taken>(
    (
      await takesOf(
        trx,
        unique.map((each) => ({ version: each.version, takeDigest: takeDigest(each.take) })),
      )
    ).map((each) => [`${each.version} ${each.takeDigest}`, each.outcome]),
  );
  const missed = new Map<string, TakeAsked[]>();
  for (const each of unique) {
    if (taken.has(takeKey(each.version, each.take))) continue;
    missed.set(each.version, [...(missed.get(each.version) ?? []), each]);
  }
  for (const [version, misses] of missed) {
    const { provenance } = misses[0]!;
    const result = store === undefined ? undefined : await readResult(store, keyFor, provenance);
    for (const each of misses) {
      if (result === undefined) {
        taken.set(takeKey(version, each.take), { unavailable: true });
        continue;
      }
      const outcome = takeHeld(each.take, result, provenance.columns);
      if (outcome === undefined) {
        taken.set(takeKey(version, each.take), { unavailable: true });
        continue;
      }
      await recordTake(trx, { version, take: each.take, outcome });
      taken.set(takeKey(version, each.take), outcome);
    }
  }
  // **An author's decorative overrides a missing description** (Ken, 2026-10-06), as the publish's
  // stage takes it (`bind`): a decorative figure whose take failed only for its row's description is
  // taken again from the result as though its column were declared decorative, so the page shows the
  // image the publish prints. Never recorded, since `dataset_take` keys an outcome by the take alone.
  const again = new Map<string, TakeAsked[]>();
  for (const each of asked) {
    const outcome = taken.get(takeKey(each.version, each.take));
    if (!each.decorative || outcome === undefined || !('failure' in outcome)) continue;
    if (outcome.failure !== 'image_description_missing') continue;
    again.set(each.version, [...(again.get(each.version) ?? []), each]);
  }
  for (const [version, misses] of again) {
    const { provenance } = misses[0]!;
    const result = store === undefined ? undefined : await readResult(store, keyFor, provenance);
    for (const each of misses) {
      const columns = decorativeColumns(provenance.columns, each.take.column);
      const outcome = result === undefined ? undefined : takeHeld(each.take, result, columns);
      taken.set(takeKey(version, each.take, true), outcome ?? { unavailable: true });
    }
  }
  return taken;
}

/** What a take asked gave: the decorative take where one was made for it, else the take's own. */
const takenAs = (taken: ReadonlyMap<string, Taken>, version: string, placed: Placed): Taken => {
  const { binding } = placed;
  // A bound table's binding takes nothing (TB1-C), so asks no take: it is never read this way.
  if (!takes(binding)) throw new Error(`The binding ${binding.id} takes no value`);
  return (
    (placed.decorative ? taken.get(takeKey(version, binding.take, true)) : undefined) ??
    taken.get(takeKey(version, binding.take))!
  );
};

/**
 * What the view answers a binding takes from a version: a bound table's binding holds the whole
 * result, `{ table: true }`, never stale for what it takes (TB1-C); any other its take, placed.
 */
const viewTaken = (
  placed: Placed,
  taken: ReadonlyMap<string, Taken>,
  version: string,
  provenance: Provenance,
): TakeOutcomeView =>
  placed.place === 'table'
    ? { table: true }
    : placedTaken(placed.place, takenAs(taken, version, placed), provenance);

/** A stored result, held to its checksum and its shape, or undefined where it cannot be read. */
async function readResult(
  store: () => Promise<TenantStore>,
  keyFor: (checksum: string) => string,
  provenance: Provenance,
) {
  try {
    const bytes = await (await store()).get(keyFor(provenance.checksum));
    if (createHash('sha256').update(bytes).digest('hex') !== provenance.checksum) return undefined;
    const parsed = canonicalResultSchema.safeParse(JSON.parse(bytes.toString('utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The takes a binding's view asks: of the version held, unless stale, and of the one waiting, where it
 * is offered to `principal` (D7-H).
 */
function takesAsked(
  placed: Placed,
  held: HeldResolution | undefined,
  principal: string,
): TakeAsked[] {
  // A bound table's binding takes nothing (TB1-C): its view is the result it holds, never a take.
  if (!held || held.digest !== placed.digest || !takes(placed.binding)) return [];
  const whose = held.waiting && ownViewOf(held.waiting.provenance.identity);
  const offered = whose === undefined || whose === principal;
  const take = placed.binding.take;
  const decorative = placed.decorative ? { decorative: placed.decorative } : {};
  return [
    { version: held.held.version, take, provenance: held.held.provenance, ...decorative },
    ...(held.waiting && offered
      ? [
          {
            version: held.waiting.version,
            take,
            provenance: held.waiting.provenance,
            ...decorative,
          },
        ]
      : []),
  ];
}

/**
 * The takes a binding's standing cell revisions ask of the version held (RV-H): each cell's row by its
 * key and its column, so a row the result no longer has is said (`row_missing`, DAT-063).
 */
function cellTakesAsked(
  placed: Placed,
  held: HeldResolution | undefined,
  revisions: readonly StoredRevision[],
): TakeAsked[] {
  if (!held || held.digest !== placed.digest) return [];
  return revisions.flatMap((each) =>
    each.cell === null || each.resolution !== held.id
      ? []
      : [
          {
            version: held.held.version,
            take: cellTake(each.cell),
            provenance: held.held.provenance,
          },
        ],
  );
}

/** A cell's take: the row its key names, and its column. */
const cellTake = (cell: RevisionCell): Take =>
  ({ key: cell.key, column: cell.column }) as unknown as Take;

/**
 * Everything the bindings view answers beside what D3 answered (B1-I), for one request: each
 * binding's taken values, its definition's title and version and its connection's name where the
 * caller may read them, and who resolved it by name.
 */
function viewer(
  trx: TenantTransaction,
  caller: Caller,
  objects: ObjectStores | undefined,
  tenant: Tenant,
  documentId: string,
) {
  // `read` on any artifact, each asked once: a definition, and a connection.
  const reads = definitionReader(trx, caller);
  const erased = erasedViewer(trx);
  const facts = new Map<string, Promise<boolean>>();
  /** Whether the caller holds a permission on an artifact, each asked once. */
  const may = (permission: 'edit' | 'use_connection' | 'read', artifact: string) => {
    let allowed = facts.get(`${permission} ${artifact}`);
    if (!allowed) {
      allowed = connectionFacts(trx, caller, artifact).then(
        (found) => found !== undefined && decide(permission, found).allowed,
      );
      facts.set(`${permission} ${artifact}`, allowed);
    }
    return allowed;
  };
  let published: ReturnType<typeof publishedBindings> | undefined;
  const latestDefinitions = new Map<string, ReturnType<typeof readQueryDefinition>>();
  const latestOf = (definition: string) => {
    let latest = latestDefinitions.get(definition);
    if (!latest) {
      latest = readQueryDefinition(trx, definition);
      latestDefinitions.set(definition, latest);
    }
    return latest;
  };

  /**
   * The facts the Data tab reads beside the rest (B4-C, B4-D): whether a floating binding's definition
   * has moved on, how it differs from the latest publication, and what the caller may do with it.
   */
  async function dataFacts(
    placed: Placed,
    held: HeldResolution | undefined,
    /** The values revised by hand standing, by cell (RV-H). */
    standing: ReadonlyMap<string, string | boolean>,
  ) {
    const latest = await latestOf(placed.binding.query);
    const asked = placed.binding.version ?? latest?.version.id;
    const ran = held?.held.provenance;
    const definitionChanged =
      placed.binding.version === undefined &&
      ran !== undefined &&
      latest !== undefined &&
      latest.version.id !== ran.queryDefinition.version;
    const printed = await (published ??= publishedBindings(trx, documentId));
    let sincePublished: BindingStateView['sincePublished'] = null;
    if (printed) {
      const was = printed.get(key(placed.node, placed.binding.id));
      if (!was) sincePublished = 'new';
      else {
        const differ = [
          ...(was.digest !== placed.digest ? (['digest'] as const) : []),
          ...(was.datasetVersion !== held?.held.version ? (['dataset'] as const) : []),
          ...(was.definitionVersion !== ran?.queryDefinition.version
            ? (['definition'] as const)
            : []),
          ...(sameRevised(was.revised, standing) ? [] : (['revision'] as const)),
        ];
        sincePublished = differ.length > 0 ? differ : null;
      }
    }
    const whose = held && ownViewOf(held.held.provenance.identity);
    const mayCheck =
      placed.binding.mode === 'checked' &&
      held !== undefined &&
      held.digest === placed.digest &&
      // Another person's own view is checked by them alone (DAT-084, D7-H).
      (whose === undefined || whose === caller.principalId) &&
      (await may(
        sourceOf(held.held.provenance).permission,
        sourceOf(held.held.provenance).artifact,
      ));
    let mayResolve = false;
    if (asked !== undefined && (await reads(placed.binding.query))) {
      const version = await readVersion(trx, asked);
      const runsOn =
        version?.kind === 'queryDefinition'
          ? definitionSource(parseQueryDefinition(version.content))
          : undefined;
      mayResolve =
        runsOn !== undefined &&
        (await may('edit', documentId)) &&
        (await may(runsOn.permission, runsOn.artifact));
    }
    return { definitionChanged, sincePublished, mayCheck, mayResolve };
  }
  let opened: Promise<TenantStore> | undefined;
  // Opened in a savepoint of its own: opening a store reads its credential in this transaction, and
  // a failure there, caught as `unavailable`, must not leave the rest of the view an aborted one.
  const store =
    objects && (() => (opened ??= inSavepoint(trx, () => objects.forTenant(trx, tenant))));
  const keyFor = (checksum: string) => `${tenantPrefix(tenant)}sha256/${checksum}`;
  const names = new Map<string, Promise<string | null>>();
  const nameOf = (principal: string) => {
    let name = names.get(principal);
    if (!name) {
      name = trx
        .selectFrom('principal')
        .select('display_name')
        .where('id', '=', principal)
        .executeTakeFirst()
        .then((row) => row?.display_name ?? null);
      names.set(principal, name);
    }
    return name;
  };

  /** The definition the binding holds a result of, or names: its title and number, to its reader. */
  async function definitionOf(placed: Placed, held: HeldResolution | undefined) {
    const ran = held?.held.provenance.queryDefinition;
    const id = ran?.artifact ?? placed.binding.query;
    if (!(await reads(id))) return null;
    const pinned = ran?.version ?? placed.binding.version;
    let version;
    if (pinned === undefined) {
      version = (await readQueryDefinition(trx, id))?.version;
    } else {
      const found = await readVersion(trx, pinned);
      version = found?.artifactId === id && found.kind === 'queryDefinition' ? found : undefined;
    }
    if (!version) return null;
    return {
      title: parseQueryDefinition(version.content).title,
      version: `${version.revision}.${version.version}`,
    };
  }

  const keys = new Map<string, Promise<readonly string[]>>();
  /** The key of the definition version a result ran (TB3-B), each read once. */
  const keyOf = (version: string) => {
    let found = keys.get(version);
    if (!found) {
      found = definitionKey(trx, version);
      keys.set(version, found);
    }
    return found;
  };

  /** The connection the held result ran on, by name, to a reader of its definition and of it. */
  async function connectionOf(held: HeldResolution | undefined) {
    if (!held) return null;
    const { queryDefinition, connection } = held.held.provenance;
    // A stored result's query ran on no connection (R21-A).
    if (connection === undefined) return null;
    if (!(await reads(queryDefinition.artifact)) || !(await reads(connection.artifact))) {
      return null;
    }
    const version = await readVersion(trx, connection.version);
    const name = (version?.content as { readonly name?: unknown } | undefined)?.name;
    return version?.kind === 'connection' && typeof name === 'string' ? { name } : null;
  }

  /**
   * Whether Keep may hold what a stale binding holds (B2-G): its question unchanged against the held
   * result, by `questionUnchanged`, the definition's latest version read for a binding that floats.
   */
  async function keepable(placed: Placed, held: HeldResolution): Promise<boolean> {
    if (held.digest === placed.digest) return false;
    const latest = await readQueryDefinition(trx, placed.binding.query);
    return (
      latest !== undefined &&
      questionUnchanged(questionOf(placed), held.held.provenance, latest.version.id)
    );
  }

  /**
   * Each binding's revisions as the view lists them (RV-H): the latest of its value or of each cell,
   * standing where it is in front of the resolution held, lapsed otherwise; a standing cell's row gone
   * said.
   */
  async function revisionsOf(
    placed: Placed,
    held: HeldResolution | undefined,
    revisions: readonly StoredRevision[],
    taken: ReadonlyMap<string, Taken>,
  ): Promise<BindingStateView['revisions']> {
    const out: BindingStateView['revisions'] = [];
    for (const each of revisions) {
      const stands = held !== undefined && each.resolution === held.id;
      const fresh = stands && held.digest === placed.digest;
      const cellTaken =
        fresh && each.cell !== null
          ? taken.get(takeKey(held.held.version, cellTake(each.cell)))
          : undefined;
      out.push({
        id: each.id,
        cell: each.cell,
        value: each.value!,
        reason: each.reason,
        by: { id: each.by, displayName: await nameOf(each.by) },
        at: each.at.toISOString(),
        stands,
        ...(cellTaken !== undefined
          ? {
              rowMissing: 'failure' in cellTaken && cellTaken.failure === 'row_missing',
            }
          : {}),
        // Its column one the table no longer shows, or now orders or heads by (M5): the publish
        // fails `revision_column_unavailable`.
        ...(fresh && each.cell !== null && placed.table !== undefined
          ? {
              columnUnavailable: !cellRevisable(
                placed.table,
                await keyOf(held.held.provenance.queryDefinition.version),
                each.cell.column,
              ),
            }
          : {}),
      });
    }
    return out;
  }

  let revised: Promise<Map<string, StoredRevision[]>> | undefined;

  /** The view of each binding as a document holds it now (D3-J, D3-R, B1-I), in the order given. */
  return async function views(
    each: readonly { readonly placed: Placed; readonly held: HeldResolution | undefined }[],
  ): Promise<BindingStateView[]> {
    const latest = await (revised ??= latestRevisions(trx, documentId));
    const revisionsAt = (placed: Placed) => latest.get(key(placed.node, placed.binding.id)) ?? [];
    const taken = await takenOf(trx, store, keyFor, [
      ...each.flatMap(({ placed, held }) => takesAsked(placed, held, caller.principalId)),
      ...each.flatMap(({ placed, held }) => cellTakesAsked(placed, held, revisionsAt(placed))),
    ]);
    const out: BindingStateView[] = [];
    for (const { placed, held } of each) {
      const shown = {
        definition: await definitionOf(placed, held),
        connection: await connectionOf(held),
        ...(await dataFacts(placed, held, standingValues(held, revisionsAt(placed)))),
        revisions: await revisionsOf(placed, held, revisionsAt(placed), taken),
      };
      if (!held) {
        out.push({
          node: placed.node,
          binding: placed.binding,
          held: null,
          waiting: null,
          ...shown,
        });
        continue;
      }
      const stale = held.digest !== placed.digest;
      const changed = stale ? parametersChanged(placed, held.held.provenance, held.digest) : [];
      // A waiting result that is another person's own view is offered to them alone (D7-H).
      const waitingWhose = held.waiting && ownViewOf(held.waiting.provenance.identity);
      const offered = waitingWhose === undefined || waitingWhose === caller.principalId;
      const name = await datasetName(trx, held.held.dataset);
      const readsDefinition = await reads(held.held.provenance.queryDefinition.artifact);
      out.push({
        node: placed.node,
        binding: placed.binding,
        held: {
          resolution: held.id,
          dataset: held.held.dataset,
          version: held.held.version,
          number: `${held.held.number.revision}.${held.held.number.version}`,
          provenance: provenanceView(
            held.held.provenance,
            readsDefinition,
            await erased(held.held.provenance),
          ),
          key: [...(await keyOf(held.held.provenance.queryDefinition.version))],
          name: name?.name ?? null,
          stale,
          ...(changed.length > 0 ? { parameters: changed } : {}),
          taken: stale ? null : viewTaken(placed, taken, held.held.version, held.held.provenance),
          act: held.act,
          keepable: await keepable(placed, held),
          by: { id: held.by, displayName: await nameOf(held.by) },
          at: held.at.toISOString(),
        },
        waiting:
          !stale && held.waiting && offered
            ? {
                version: held.waiting.version,
                provenance: provenanceView(
                  held.waiting.provenance,
                  await reads(held.waiting.provenance.queryDefinition.artifact),
                  await erased(held.waiting.provenance),
                ),
                taken: viewTaken(placed, taken, held.waiting.version, held.waiting.provenance),
              }
            : null,
        ...shown,
      });
    }
    return out;
  };
}

type Views = ReturnType<typeof viewer>;

/**
 * The document's parameters a stale binding reads whose values now differ from those its held result
 * ran with (the TP2 plan, TP2-E), by the document's names, once each: only where each is substituted
 * now and the question, with those arguments at the values the result ran with, is the one held - so
 * only their values moved, and not the component's binding too (the TP2 final review). A component
 * repointing an argument to another parameter whose value differs is not told apart, since the digest
 * held is over the values substituted.
 */
function parametersChanged(placed: Placed, provenance: Provenance, heldDigest: string): string[] {
  const spelled = (value: ParameterValues[string]) =>
    parametersDigestInput(value === undefined ? {} : { value });
  const changed = new Set<string>();
  const atHeld: Record<string, AnyBinding['parameters'][string]> = {
    ...placed.question.parameters,
  };
  for (const [name, parameter] of Object.entries(placed.binding.parameters)) {
    if (!('document' in parameter)) continue;
    const ran = provenance.parameters[name];
    const now = placed.question.parameters[name];
    if (now === undefined || !('literal' in now)) continue;
    if (spelled(ran) === spelled(now.literal as ParameterValues[string])) continue;
    changed.add(parameter.document);
    // A result run without it held the argument as written, as the document then had no value.
    atHeld[name] =
      ran === undefined || ran === null
        ? parameter
        : ({ literal: ran } as AnyBinding['parameters'][string]);
  }
  if (changed.size === 0) return [];
  const asked = { ...placed.question, parameters: atHeld } as AnyBinding;
  return sha256(bindingDigestInput(asked)) === heldDigest ? [...changed] : [];
}

/** The view of one binding as a document holds it now. */
const stateView = async (views: Views, placed: Placed, held: HeldResolution | undefined) =>
  (await views([{ placed, held }]))[0]!;

/**
 * The latest resolution for each node and binding of a document, by both, each waiting only on a
 * result of the definition version its binding as placed asks: its pin, or the latest (B4-A).
 */
async function heldBy(
  trx: TenantTransaction,
  documentId: string,
  placed: readonly Placed[],
): Promise<Map<string, HeldResolution>> {
  const latest = new Map<string, Promise<string | undefined>>();
  const asked = new Map<string, string>();
  for (const { node, binding } of placed) {
    let version = binding.version;
    if (version === undefined) {
      let reading = latest.get(binding.query);
      if (!reading) {
        reading = readQueryDefinition(trx, binding.query).then((found) => found?.version.id);
        latest.set(binding.query, reading);
      }
      version = await reading;
    }
    if (version !== undefined) asked.set(key(node, binding.id), version);
  }
  return new Map(
    (await resolutionsOf(trx, documentId, asked)).map((each) => [
      key(each.node, each.binding),
      each,
    ]),
  );
}

type BindingEvent =
  'binding.resolved' | 'binding.checked' | 'binding.accepted' | 'binding.confirmed';

/**
 * A binding's act on the log (LIF-067; the AU1 plan, AU1-L), in the transaction that records it, not
 * the one that decided it: about the document, at its latest version, naming the node, the binding
 * and the dataset version it holds or found.
 */
async function recordBindingEvent(
  trx: TenantTransaction,
  kind: BindingEvent,
  at: {
    readonly document: string;
    readonly node: string;
    readonly binding: string;
    readonly dataset: string;
    readonly version: string;
    readonly outcome?: 'unchanged' | 'revision';
    /** A check's finding by the source's revision alone, nothing run (FR-D). */
    readonly by?: 'revision';
  },
): Promise<void> {
  const place = await artifactPlace(trx, at.document);
  await recordEvent(
    trx,
    {
      kind,
      subject: { kind: 'document', id: at.document, version: place.version },
      space: place.space,
      detail: { ...at },
    },
    place.labels,
  );
}

const BY_ACT = {
  resolve: 'binding.resolved',
  accept: 'binding.accepted',
  confirm: 'binding.confirmed',
} as const satisfies Record<string, BindingEvent>;

/** A resolution row, and its event beside it: every one this service writes is on the log. */
async function recordLoggedResolution(
  trx: TenantTransaction,
  input: Parameters<typeof recordResolution>[1],
): Promise<Awaited<ReturnType<typeof recordResolution>>> {
  const row = await recordResolution(trx, input);
  await recordBindingEvent(trx, BY_ACT[row.act], {
    document: row.document,
    node: row.node,
    binding: row.binding,
    dataset: row.dataset,
    version: row.version,
  });
  return row;
}

/**
 * The type of the column a revision stands in, in a result (RV-D): a cell's own column, or the column
 * an inline binding takes.
 */
/** The values revised by hand standing in front of what a binding holds, by cell (RV-H). */
const standingValues = (
  held: HeldResolution | undefined,
  revisions: readonly StoredRevision[],
): Map<string, string | boolean> =>
  new Map(
    revisions.flatMap((each) =>
      held !== undefined && each.resolution === held.id && each.value !== null
        ? [[revisionCellKey(each.cell), each.value] as const]
        : [],
    ),
  );

/** Whether two sets of revised values, by cell, are the same. */
const sameRevised = (
  a: ReadonlyMap<string, string | boolean>,
  b: ReadonlyMap<string, string | boolean>,
) => a.size === b.size && [...a].every(([cell, value]) => b.get(cell) === value);

/** A control character, which neither a revised value nor its reason holds. */
const CONTROL = /\p{Cc}/u;

const columnTypeIn =
  (provenance: Provenance, placed: Placed) =>
  (cell: RevisionCell | null): ColumnType | undefined => {
    const column = cell?.column ?? (takes(placed.binding) ? placed.binding.take.column : undefined);
    return provenance.columns.find((each) => each.name === column)?.type;
  };

type ResolveResult = ResolveBindingsView['results'][number];
type CheckResult = CheckBindingsView['results'][number];

/**
 * Resolve (data.md, "Resolve"; D3-E to D3-H): decided and read here, in the transaction `edit` on the
 * document was decided in; each distinct question run once after it commits; and each result recorded
 * as a dataset version, and each binding's resolution, in a second transaction that decides again.
 */
export async function resolveAct(
  db: TenantDatabase,
  tenant: Tenant,
  objects: ObjectStores | undefined,
  request: FastifyRequest,
  { trx, principalId }: Authorised,
  through: RunsThrough,
): Promise<AfterCommit<ResolveBindingsView | Accepted<ResolveBindingsView>>> {
  const { id } = request.params as DocumentBindingParams;
  const body = request.body as ResolveBindingsBody;
  if (!objects) throw storageUnavailable();
  const caller = callerOf(request);
  const fromSession = body.bindings.filter((each) => each.from === 'session');
  const source: SessionSource | undefined =
    body.session === undefined || fromSession.length === 0
      ? undefined
      : { session: body.session, nodes: new Set(fromSession.map((each) => each.node)) };
  const placed = await bindingsPlaced(trx, id, principalId, source);
  if (!placed) throw notFound();
  const byKey = new Map(placed.map((each) => [key(each.node, each.binding.id), each]));
  const asked = [
    ...new Map(body.bindings.map((each) => [key(each.node, each.binding), each])).values(),
  ];
  const prepared: Prepared[] = [];
  for (const each of asked) {
    const found = byKey.get(key(each.node, each.binding));
    if (!found) {
      throw bindingMissing(
        { binding: each.binding, node: each.node, document: id },
        `The component the node ${each.node} places holds no binding ${each.binding}.`,
      );
    }
    const ready = await prepare(trx, caller, id, found, through);
    // One's own view is held only past DAT-091's warning (D7-H, DA-AE), before anything runs.
    if (ready.acting.kind === 'asserted' && body.sharesOwnView !== true) {
      throw acknowledgementRequired({
        definition: ready.definition.id,
        binding: each.binding,
        node: each.node,
        document: id,
      });
    }
    prepared.push(ready);
  }
  // Never silent over a value revised by hand (DAT-060): each binding's decision, before anything runs.
  const decisions = new Map(asked.map((each) => [key(each.node, each.binding), each.revisions]));
  {
    const heldNow = await heldBy(trx, id, placed);
    const views = viewer(trx, caller, objects, tenant, id);
    for (const each of prepared) {
      const at = key(each.placed.node, each.placed.binding.id);
      const holding = heldNow.get(at);
      await revisionsDecided(trx, holding?.id, decisions.get(at), async () => ({
        current: await stateView(views, each.placed, holding),
      }));
    }
  }
  const questions = [...new Map(prepared.map((each) => [each.question, each])).values()];
  // The bindings read from the session: a pending result of one finishes as a resolve from it.
  const sessionNodes = new Set(
    source === undefined ? [] : fromSession.map((each) => key(each.node, each.binding)),
  );
  return new AfterCommit(() =>
    through.whileHeld(async (signal) => {
      let opened: Awaited<ReturnType<ObjectStores['forTenant']>> | undefined;
      const store = async () =>
        (opened ??= await db.withTenant(tenant, (open) => objects.forTenant(open, tenant)));
      const ran = new Map<string, Ran>();
      const takes = takesByQuestion(prepared);
      const outcomes = await inTurn(questions, AT_ONCE, (each) =>
        runOnce(tenant, each, takes.get(each.question)!, through, store, signal),
      );
      questions.forEach((each, at) => ran.set(each.question, outcomes[at]!));
      if (signal.aborted) throw signal.reason;
      return db.withTenant(
        tenant,
        async (record) => {
          const succeeded = prepared.filter((each) => ran.get(each.question)!.ok);
          // Before what each holds is read: an accept or another resolve of one of them waits its turn.
          await lockBindings(
            record,
            id,
            succeeded.map(({ placed: { node, binding } }) => ({ node, binding: binding.id })),
          );
          await decideAgain(record, request, { id, permission: 'edit' }, succeeded);
          await unchangedSince(
            record,
            id,
            principalId,
            succeeded.map((each) => each.placed),
            source,
          );
          const seesSource = await seeingSourceNow(record, caller, prepared);
          const held = await heldBy(record, id, placed);
          // Decided again under the bindings' locks: a revision made or withdrawn while the source
          // answered fails that binding alone, and records nothing for it (RV-D).
          const standing = new Map<string, readonly StoredRevision[]>();
          const undecided = new Map<string, AppError>();
          const views = viewer(record, caller, objects, tenant, id);
          for (const each of succeeded) {
            const at = key(each.placed.node, each.placed.binding.id);
            const holding = held.get(at);
            try {
              standing.set(
                at,
                await revisionsDecided(record, holding?.id, decisions.get(at), async () => ({
                  current: await stateView(views, each.placed, holding),
                })),
              );
            } catch (error) {
              if (!(error instanceof AppError)) throw error;
              undecided.set(at, error);
            }
          }
          // Every question this records, in turn, before the first: after the bindings' locks, as every
          // act takes them, so two acts recording the same questions never wait on each other.
          await lockDatasetQuestions(record, recordable(succeeded, ran));
          const versions = new Map<string, Awaited<ReturnType<typeof recordDatasetVersion>>>();
          const admitted = await admitAll(record, store, principalId, recordedRuns(succeeded, ran));
          const results: ResolveResult[] = [];
          for (const each of prepared) {
            const outcome = ran.get(each.question)!;
            const { node, binding } = each.placed;
            const failed = (failure: FailureIn) =>
              results.push({
                node,
                binding: binding.id,
                failure: bindingFailure(
                  failure,
                  { definition: each.definition.id, binding: binding.id, node, document: id },
                  seesSource(each),
                  each.draft.fetch.kind === 'builder',
                ),
              });
            if (!outcome.ok) {
              failed(outcome.failure);
              continue;
            }
            const naming = {
              definition: each.definition.id,
              binding: binding.id,
              node,
              document: id,
            };
            const refusal = undecided.get(key(node, binding.id));
            if (refusal !== undefined) {
              results.push({
                node,
                binding: binding.id,
                failure: bindingFailure(refusal, naming),
              });
              continue;
            }
            const admission = admitted.get(each.question)!;
            if ('failure' in admission) {
              failed(admission.failure);
              continue;
            }
            if (!admission.held) {
              // Its images are being admitted: recorded once every one is, when it is asked for (D8-E).
              const act: PendingAct = sessionNodes.has(key(node, binding.id))
                ? 'session'
                : 'resolve';
              const waiting = await pendingResult(record, {
                act,
                document: id,
                node,
                binding: binding.id,
                digest: each.placed.digest,
                holding: held.get(key(node, binding.id))?.id ?? null,
                session: act === 'session' ? body.session! : null,
                provenance: admission.provenance,
                uploads: admission.uploads,
                by: principalId,
                revisions: decisions.get(key(node, binding.id)),
              });
              results.push({ node, binding: binding.id, pending: waiting.id });
              continue;
            }
            let recorded = versions.get(each.question);
            if (!recorded) {
              recorded = await recordDatasetVersion(record, {
                provenance: admission.provenance,
                author: principalId,
                images: admission.hashes,
              });
              versions.set(each.question, recorded);
            }
            await recordTaken(record, recorded.version.id, each, outcome);
            // A revision kept must stand in front of the new result: else this binding fails (M2).
            const kept = keptProblem(
              standing.get(key(node, binding.id)) ?? [],
              decisions.get(key(node, binding.id))?.decision,
              columnTypeIn(admission.provenance, each.placed),
            );
            if (kept !== null) {
              results.push({ node, binding: binding.id, failure: bindingFailure(kept, naming) });
              continue;
            }
            const before = held.get(key(node, binding.id));
            const resolved = await recordLoggedResolution(record, {
              document: id,
              node,
              binding: binding.id,
              digest: each.placed.digest,
              version: recorded.version.id,
              // What it held, where that is a version of the same dataset: a binding whose question
              // changed held another dataset, which this does not replace.
              replaces:
                before && before.held.dataset === recorded.dataset.id ? before.held.version : null,
              act: 'resolve',
              by: principalId,
            });
            await carryRevisions(record, {
              standing: standing.get(key(node, binding.id)) ?? [],
              decision: decisions.get(key(node, binding.id))?.decision,
              to: resolved.id,
              by: principalId,
              typeOf: columnTypeIn(admission.provenance, each.placed),
            });
            results.push({
              node,
              binding: binding.id,
              held: {
                dataset: recorded.dataset.id,
                version: recorded.version.id,
                reused: recorded.reused,
              },
            });
          }
          return results.some((each) => 'pending' in each)
            ? new Accepted({ results })
            : { results };
        },
        contextOf(request),
      );
    }),
  );
}

/**
 * Check (data.md, "Check"; D3-I): every checked binding holding a result it still asks for, each
 * distinct question run once, two at a time and at most fifty a check; a different result recorded as
 * a dataset version that nothing holds until it is accepted (D3-J). In D3 every run is the service
 * account's, so every identity key is `service` and every checked binding is compared (DAT-084).
 */
export async function checkAct(
  db: TenantDatabase,
  tenant: Tenant,
  objects: ObjectStores | undefined,
  request: FastifyRequest,
  { trx, principalId }: Authorised,
  through: RunsThrough,
): Promise<AfterCommit<CheckBindingsView | Accepted<CheckBindingsView>>> {
  const { id } = request.params as DocumentBindingParams;
  if (!objects) throw storageUnavailable();
  const caller = callerOf(request);
  const placed = await bindingsPlaced(trx, id, principalId);
  if (!placed) throw notFound();
  const held = await heldBy(trx, id, placed);
  const results = new Map<string, CheckResult>();
  const toRun: Prepared[] = [];
  for (const each of placed) {
    if (each.binding.mode !== 'checked') continue;
    const { node, binding } = each;
    const holding = held.get(key(node, binding.id));
    if (!holding || holding.digest !== each.digest) {
      results.set(key(node, binding.id), {
        node,
        binding: binding.id,
        outcome: 'unchecked',
        reason: 'unresolved',
      });
      continue;
    }
    // Compared only by the identity whose view is held (DAT-084, D7-H): another person's own view is
    // never run again by anybody else, so its source is never said to have moved.
    const unchecked = {
      node,
      binding: binding.id,
      outcome: 'unchecked',
      reason: 'identity',
    } as const;
    const whose = ownViewOf(holding.held.provenance.identity);
    if (whose !== undefined && whose !== principalId) {
      results.set(key(node, binding.id), unchecked);
      continue;
    }
    try {
      const ready = await prepare(trx, caller, id, each, through);
      // Nor is a view asked as one identity compared with one held as another: the account's result
      // on a connection now asserting identity, or the caller's on one no longer doing so.
      if (actingKey(ready.acting) !== identityKey(holding.held.provenance.identity)) {
        results.set(key(node, binding.id), unchecked);
        continue;
      }
      toRun.push(ready);
      results.set(key(node, binding.id), { node, binding: binding.id, outcome: 'unchanged' });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      // Swallowed into the answer, so recorded in the check's own transaction, which commits
      // (the AU1 plan, AU1-E).
      if (isRefusal(error)) await recordRefusalIn(trx, error);
      results.set(
        key(node, binding.id),
        error.status === 403
          ? { node, binding: binding.id, outcome: 'unchecked', reason: 'permission' }
          : {
              node,
              binding: binding.id,
              outcome: 'failed',
              failure: bindingFailure(error, {
                definition: binding.query,
                binding: binding.id,
                node,
                document: id,
              }),
            },
      );
    }
  }
  const questions = [...new Map(toRun.map((each) => [each.question, each])).values()];
  const asking = questions.slice(0, MOST_RUNS);
  const beyond = new Set(questions.slice(MOST_RUNS).map((each) => each.question));
  for (const each of toRun) {
    if (beyond.has(each.question)) {
      const { node, binding } = each.placed;
      results.set(key(node, binding.id), {
        node,
        binding: binding.id,
        outcome: 'unchecked',
        reason: 'limit',
      });
    }
  }
  const ordered = () =>
    placed.flatMap((each) => results.get(key(each.node, each.binding.id)) ?? []);
  if (asking.length === 0) return new AfterCommit(async () => ({ results: ordered() }));
  return new AfterCommit(() =>
    through.whileHeld(async (signal) => {
      let opened: Awaited<ReturnType<ObjectStores['forTenant']>> | undefined;
      const store = async () =>
        (opened ??= await db.withTenant(tenant, (open) => objects.forTenant(open, tenant)));
      const takes = takesByQuestion(toRun);
      // Asked first where the source says cheaply whether it moved, and run only where it has.
      const unmoved = await unmovedQuestions(tenant, asking, toRun, held, through, signal);
      const running = asking.filter((each) => !unmoved.has(each.question));
      const outcomes = await inTurn(running, AT_ONCE, (each) =>
        runOnce(tenant, each, takes.get(each.question)!, through, store, signal),
      );
      const ran = new Map(running.map((each, at) => [each.question, outcomes[at]!]));
      if (signal.aborted) throw signal.reason;
      return db.withTenant(
        tenant,
        async (record) => {
          const succeeded = toRun.filter((each) => ran.get(each.question)?.ok === true);
          const asked = toRun.filter((each) => unmoved.has(each.question));
          const answered = [...succeeded, ...asked];
          await lockBindings(
            record,
            id,
            answered.map(({ placed: { node, binding } }) => ({ node, binding: binding.id })),
          );
          await decideAgain(record, request, { id, permission: 'read' }, answered);
          await unchangedSince(
            record,
            id,
            principalId,
            answered.map((each) => each.placed),
          );
          // What each holds now, under the lock: an accept while the source answered moves what the
          // result is compared with, so what was read before the run is not the comparison.
          const holdingNow = await heldBy(record, id, placed);
          // Unchanged by its revision: nothing run, and nothing recorded but the check (FR-D).
          for (const each of asked) {
            const { node, binding } = each.placed;
            const was = held.get(key(node, binding.id));
            const holding = holdingNow.get(key(node, binding.id));
            if (!holding || holding.held.version !== was?.held.version) {
              results.set(key(node, binding.id), {
                node,
                binding: binding.id,
                outcome: 'unchecked',
                reason: 'unresolved',
              });
              continue;
            }
            await recordBindingEvent(record, 'binding.checked', {
              document: id,
              node,
              binding: binding.id,
              dataset: holding.held.dataset,
              version: holding.held.version,
              outcome: 'unchanged',
              by: 'revision',
            });
          }
          const seesSource = await seeingSourceNow(record, caller, toRun);
          await lockDatasetQuestions(record, recordable(succeeded, ran));
          const versions = new Map<string, Awaited<ReturnType<typeof recordDatasetVersion>>>();
          const admitted = await admitAll(record, store, principalId, recordedRuns(succeeded, ran));
          let waits = false;
          for (const each of toRun) {
            const outcome = ran.get(each.question);
            if (!outcome) continue;
            const { node, binding } = each.placed;
            const naming = {
              definition: each.definition.id,
              binding: binding.id,
              node,
              document: id,
            };
            const failed = (failure: FailureIn) =>
              results.set(key(node, binding.id), {
                node,
                binding: binding.id,
                outcome: 'failed',
                failure: bindingFailure(
                  failure,
                  naming,
                  seesSource(each),
                  each.draft.fetch.kind === 'builder',
                ),
              });
            if (!outcome.ok) {
              failed(outcome.failure);
              continue;
            }
            const admission = admitted.get(each.question)!;
            if ('failure' in admission) {
              failed(admission.failure);
              continue;
            }
            if (!admission.held) {
              // A result whose images are being admitted: recorded, as a check records one, once every
              // one is, when it is asked for (D8-E).
              const waiting = await pendingResult(record, {
                act: 'check',
                document: id,
                node,
                binding: binding.id,
                digest: each.placed.digest,
                holding: holdingNow.get(key(node, binding.id))?.id ?? null,
                session: null,
                provenance: admission.provenance,
                uploads: admission.uploads,
                by: principalId,
              });
              results.set(key(node, binding.id), {
                node,
                binding: binding.id,
                outcome: 'pending',
                pending: waiting.id,
              });
              waits = true;
              continue;
            }
            let recorded = versions.get(each.question);
            if (!recorded) {
              recorded = await recordDatasetVersion(record, {
                provenance: admission.provenance,
                author: principalId,
                images: admission.hashes,
              });
              versions.set(each.question, recorded);
            }
            await recordTaken(record, recorded.version.id, each, outcome);
            const holding = holdingNow.get(key(node, binding.id));
            if (!holding || holding.digest !== each.placed.digest) {
              results.set(key(node, binding.id), {
                node,
                binding: binding.id,
                outcome: 'unchecked',
                reason: 'unresolved',
              });
              continue;
            }
            // A revision where the rows differ, or a floating binding's definition has moved on (B4-A).
            const unchanged =
              outcome.provenance.checksum === holding.held.provenance.checksum &&
              outcome.provenance.queryDefinition.version ===
                holding.held.provenance.queryDefinition.version;
            results.set(
              key(node, binding.id),
              unchanged
                ? { node, binding: binding.id, outcome: 'unchanged' }
                : { node, binding: binding.id, outcome: 'revision', version: recorded.version.id },
            );
            await recordBindingEvent(record, 'binding.checked', {
              document: id,
              node,
              binding: binding.id,
              dataset: recorded.dataset.id,
              version: recorded.version.id,
              outcome: unchanged ? 'unchanged' : 'revision',
            });
          }
          return waits ? new Accepted({ results: ordered() }) : { results: ordered() };
        },
        contextOf(request),
      );
    }),
  );
}

/** The routes of bindings and datasets that ask no source. */
export function bindingHandlers(
  tenantOf: (request: FastifyRequest) => Tenant,
  objects: ObjectStores | undefined,
) {
  return {
    getDocumentBindings: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DocumentBindingParams;
      const { session } = request.query as DocumentBindingsQuery;
      const placed = await bindingsPlaced(
        trx,
        id,
        principalId,
        session === undefined ? undefined : { session, nodes: 'every' },
      );
      if (!placed) throw notFound();
      const held = await heldBy(trx, id, placed);
      const views = viewer(trx, callerOf(request), objects, tenantOf(request), id);
      const bindings = await views(
        placed.map((each) => ({ placed: each, held: held.get(key(each.node, each.binding.id)) })),
      );
      return { bindings };
    },

    /**
     * Accept (data.md, "Accept"; D3-K): a resolution row naming the waiting version and the one it
     * replaces, in this document alone (DAT-093), recording who and when (DAT-037). Queries nothing,
     * and asks what a fetch asks of the source side (DAT-090): `edit` on the document, and `read` on
     * the definition and `use_connection` on the connection the accepted version ran, decided in the
     * one transaction that records it.
     */
    acceptBinding: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DocumentBindingParams;
      const body = request.body as AcceptBindingBody;
      const placed = await bindingsPlaced(trx, id, principalId);
      if (!placed) throw notFound();
      const found = placed.find(
        (each) => each.node === body.node && each.binding.id === body.binding,
      );
      if (!found) {
        throw bindingMissing(
          { binding: body.binding, node: body.node, document: id },
          `The component the node ${body.node} places holds no binding ${body.binding}.`,
        );
      }
      // Before what it holds is read, so two accepts, or an accept and a resolve, take turns.
      await lockBindings(trx, id, [{ node: found.node, binding: found.binding.id }]);
      const held = (await heldBy(trx, id, placed)).get(key(body.node, body.binding));
      const views = viewer(trx, callerOf(request), objects, tenantOf(request), id);
      const precondition = async () =>
        refused(
          409,
          'resolution.precondition',
          'This binding no longer holds what this was accepted from, or that is not a newer result of it.',
          { current: await stateView(views, found, held) },
        );
      if (!held || held.digest !== found.digest || held.held.version !== body.replaces) {
        throw await precondition();
      }
      // Only the version waiting: a newer result of the definition version the binding asks (B4-B).
      if (held.waiting?.version !== body.version) throw await precondition();
      const naming = {
        definition: found.binding.query,
        binding: found.binding.id,
        node: found.node,
        document: id,
      };
      // A person's own view is accepted by them alone, and past DAT-091's warning (D7-H, DA-AE).
      const whose = ownViewOf(held.waiting.provenance.identity);
      if (whose !== undefined && whose !== principalId) throw identityDiffers(naming);
      if (whose !== undefined && body.sharesOwnView !== true) {
        throw acknowledgementRequired(naming);
      }
      await mayTakeResult(trx, callerOf(request), held.waiting.provenance, naming);
      // Never silent over a value revised by hand (DAT-060): withdrawn or kept, as the caller says.
      const standing = await revisionsDecided(trx, held.id, body.revisions, async () => ({
        current: await stateView(views, found, held),
      }));
      const accepted = await recordLoggedResolution(trx, {
        document: id,
        node: found.node,
        binding: found.binding.id,
        digest: found.digest,
        version: body.version,
        replaces: held.held.version,
        act: 'accept',
        by: principalId,
      });
      await carryRevisions(trx, {
        standing,
        decision: body.revisions?.decision,
        to: accepted.id,
        by: principalId,
        typeOf: columnTypeIn(held.waiting.provenance, found),
      });
      return stateView(
        views,
        found,
        (await heldBy(trx, id, placed)).get(key(body.node, body.binding)),
      );
    },

    /**
     * Keep (bindings.md, "Keeping a value across a changed binding"; B2-F, BI-J): a resolution row
     * holding the version the binding already holds under its changed digest, `act: 'confirm'`,
     * replacing that same version, querying nothing - only where its question is unchanged
     * (`questionUnchanged`, B2-E) and what it now takes is that version's. `edit` on the document is
     * the route's; `read` on the definition is decided here, one not readable answered as none.
     */
    confirmBinding: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DocumentBindingParams;
      const body = request.body as ConfirmBindingBody;
      const placed = await bindingsPlaced(
        trx,
        id,
        principalId,
        body.from === 'session' && body.session !== undefined
          ? { session: body.session, nodes: new Set([body.node]) }
          : undefined,
      );
      if (!placed) throw notFound();
      const found = placed.find(
        (each) => each.node === body.node && each.binding.id === body.binding,
      );
      const naming = { binding: body.binding, node: body.node, document: id };
      if (!found) {
        throw bindingMissing(
          naming,
          `The component the node ${body.node} places holds no binding ${body.binding}.`,
        );
      }
      await lockBindings(trx, id, [{ node: found.node, binding: found.binding.id }]);
      const caller = callerOf(request);
      const facts = await connectionFacts(trx, caller, found.binding.query);
      const missing = () =>
        bindingMissing(
          { ...naming, definition: found.binding.query },
          `The binding ${found.binding.id} names no query definition here.`,
        );
      if (!facts) throw missing();
      // One that exists and that the caller may not read: a refusal, hidden (AU1-E).
      const reading = decide('read', facts);
      if (!reading.allowed) {
        throw refusedBy(
          missing(),
          reading,
          facts,
          { kind: 'artifact', id: found.binding.query },
          true,
        );
      }
      const held = (await heldBy(trx, id, placed)).get(key(body.node, body.binding));
      const views = viewer(trx, caller, objects, tenantOf(request), id);
      if (!held || held.held.version !== body.replaces) {
        throw refused(
          409,
          'resolution.precondition',
          'This binding no longer holds what this was kept from.',
          { current: await stateView(views, found, held) },
        );
      }
      const latest = await readQueryDefinition(trx, found.binding.query);
      const { provenance } = held.held;
      // Only a stale binding is kept, as `keepable` decides: one holding its value unchanged has
      // nothing to keep, and a second row would record a Keep nobody needed.
      if (held.digest === found.digest) {
        throw refused(
          409,
          'confirm.not_possible',
          `The binding ${found.binding.id} already holds this result: there is nothing to keep.`,
          { ...naming, definition: found.binding.query },
        );
      }
      if (!latest || !questionUnchanged(questionOf(found), provenance, latest.version.id)) {
        throw refused(
          409,
          'confirm.not_possible',
          `The binding ${found.binding.id} asks another question than the result it holds answers: resolve it instead.`,
          { ...naming, definition: found.binding.query },
        );
      }
      // A bound table's binding takes nothing, so has no take to check (TB1-C): only its mode moved.
      if (takes(found.binding)) {
        const ran = await readVersion(trx, provenance.queryDefinition.version);
        const take = checkTake(found.binding.take, parseQueryDefinition(ran!.content));
        if (take !== null) throw named(refused(400, 'take.invalid', `${take}.`), naming);
      }
      const standing = await revisionsDecided(trx, held.id, body.revisions, async () => ({
        current: await stateView(views, found, held),
      }));
      // A value kept stands in front of the same take only (the RV final review, M1): Keep holds a
      // result across a changed take too, which a person's value for another column or row must not
      // follow. Only a binding whose mode alone changed keeps its value.
      const modeAlone = (['checked', 'pinned'] as const).some(
        (mode) =>
          sha256(bindingDigestInput({ ...found.question, mode } as AnyBinding)) === held.digest,
      );
      if (
        body.revisions?.decision === 'keep' &&
        !modeAlone &&
        standing.some((each) => each.cell === null)
      ) {
        throw refused(
          409,
          'revision.not_possible',
          'The binding now takes another value than the one revised by hand: withdraw the revision.',
          { ...naming, current: await stateView(views, found, held) },
        );
      }
      const confirmed = await recordLoggedResolution(trx, {
        document: id,
        node: found.node,
        binding: found.binding.id,
        digest: found.digest,
        version: held.held.version,
        replaces: held.held.version,
        act: 'confirm',
        by: principalId,
      });
      await carryRevisions(trx, {
        standing,
        decision: body.revisions?.decision,
        to: confirmed.id,
        by: principalId,
        typeOf: columnTypeIn(held.held.provenance, found),
      });
      return stateView(
        views,
        found,
        (await heldBy(trx, id, placed)).get(key(body.node, body.binding)),
      );
    },

    /**
     * **Revise, or withdraw, a value by hand** (bindings.md, "A value revised by hand"; the RV plan,
     * RV-C): a revision row in front of the resolution the binding holds, never in place of it
     * (DAT-058), of an inline value or a bound table's cell by key (DAT-057, DAT-063). Queries nothing
     * and needs `edit` on the document alone, the route's: it is the person's value, not the source's.
     * Under the binding's lock, so it takes turns with every act that records a resolution.
     */
    reviseBinding: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DocumentBindingParams;
      const body = request.body as ReviseBindingBody;
      const placed = await bindingsPlaced(trx, id, principalId);
      if (!placed) throw notFound();
      const found = placed.find(
        (each) => each.node === body.node && each.binding.id === body.binding,
      );
      const naming = { binding: body.binding, node: body.node, document: id };
      if (!found) {
        throw bindingMissing(
          naming,
          `The component the node ${body.node} places holds no binding ${body.binding}.`,
        );
      }
      await lockBindings(trx, id, [{ node: found.node, binding: found.binding.id }]);
      const held = (await heldBy(trx, id, placed)).get(key(body.node, body.binding));
      const caller = callerOf(request);
      const tenant = tenantOf(request);
      const current = async () => ({
        current: await stateView(viewer(trx, caller, objects, tenant, id), found, held),
      });
      if (!held || held.id !== body.resolution) {
        throw refused(
          409,
          'revision.precondition',
          'This binding no longer holds the result this was revised from.',
          await current(),
        );
      }
      if (held.digest !== found.digest) {
        throw refused(
          409,
          'binding.stale',
          `The binding ${found.binding.id} changed since its result was taken: resolve it, or keep its result, first.`,
          naming,
        );
      }
      // A cell's key, every key column's value made canonical by its column's type, so one cell is
      // one revision whatever spelling names it (the RV final review, H2).
      let cell: RevisionCell | null = null;
      let keyColumns: readonly string[] = [];
      if (body.cell !== undefined) {
        keyColumns = await definitionKey(trx, held.held.provenance.queryDefinition.version);
        const refusedKey = (why: string) => named(refused(400, 'key.required', why), naming);
        if (keyColumns.length === 0) {
          throw refusedKey('Its query definition declares no key to find a row by.');
        }
        if (!keyNamesTheKey(body.cell.key, keyColumns)) {
          throw refusedKey(`A cell's key names every key column: ${keyColumns.join(', ')}.`);
        }
        const key: Record<string, CanonicalValue> = {};
        for (const name of keyColumns) {
          const type = held.held.provenance.columns.find((each) => each.name === name)?.type;
          const given = body.cell.key[name];
          const value =
            type === undefined || given === null || given === undefined
              ? null
              : canonicalKeyValue(type, String(given));
          if (value === null) throw refusedKey(`The key's ${name} is not a value of its column.`);
          key[name] = value;
        }
        cell = { key, column: body.cell.column };
      }
      const at = revisionCellKey(cell);
      const standing = ((await revisionsStanding(trx, [held.id])).get(held.id) ?? []).find(
        (each) => revisionCellKey(each.cell) === at,
      );
      if ((standing?.id ?? null) !== body.replaces) {
        throw refused(
          409,
          'revision.precondition',
          'The value revised by hand here is no longer the one this replaces.',
          await current(),
        );
      }
      const reason = body.reason.normalize('NFC');
      // Counted as stored, after NFC (the RV final review, L8).
      if (reason.trim() === '' || CONTROL.test(reason) || [...reason].length > 1000) {
        throw named(
          refused(400, 'value.invalid', 'A reason is words, with no control characters.'),
          naming,
        );
      }
      const answer = async () => stateView(viewer(trx, caller, objects, tenant, id), found, held);

      if (body.act === 'withdraw') {
        if (!standing) {
          throw refused(
            409,
            'revision.not_standing',
            'No value revised by hand stands here to withdraw.',
            naming,
          );
        }
        const withdrawn = await recordRevision(trx, {
          document: id,
          node: found.node,
          binding: found.binding.id,
          cell: at,
          resolution: held.id,
          act: 'withdraw',
          value: null,
          reason,
          replaces: standing.id,
          by: principalId,
        });
        await recordRevisionEvent(trx, withdrawn, 'withdraw', standing.value);
        return answer();
      }

      // What can be revised (RV-C): a value the binding takes, or a value column a bound table shows.
      const notPossible = (why: string) =>
        refused(409, 'revision.not_possible', why, { ...naming, ...(cell ? { cell } : {}) });
      const { provenance } = held.held;
      let take: Take;
      if (cell === null) {
        if (!takes(found.binding) || found.place === 'figure') {
          throw notPossible(
            "A bound table is revised by its cells, and a bound figure's image is not a value.",
          );
        }
        take = found.binding.take;
      } else {
        const table = found.table;
        if (found.place !== 'table' || table === undefined) {
          throw notPossible('Only a bound table has cells to revise.');
        }
        if (!cellRevisable(table, keyColumns, cell.column)) {
          throw notPossible(
            `The column ${cell.column} is not a value column the table shows: never its key, a group's column or subtotal, or the column it is turned by.`,
          );
        }
        take = cellTake(cell);
      }
      const type = provenance.columns.find((each) => each.name === take.column)?.type;
      if (type === undefined || type.base === 'image') {
        throw notPossible(`The column ${take.column} holds no value that can be revised by hand.`);
      }
      const opened = objects && (() => objects.forTenant(trx, tenant));
      const keyFor = (checksum: string) => `${tenantPrefix(tenant)}sha256/${checksum}`;
      const outcome = (
        await takenOf(trx, opened, keyFor, [{ version: held.held.version, take, provenance }])
      ).get(takeKey(held.held.version, take));
      if (outcome !== undefined && 'failure' in outcome && outcome.failure === 'row_missing') {
        throw refused(
          409,
          'revision.row_missing',
          `The result this binding holds has no row by the key ${JSON.stringify(cell?.key ?? {})}.`,
          { ...naming, ...(cell ? { cell } : {}) },
        );
      }
      if (outcome === undefined || !('value' in outcome)) {
        throw notPossible('Its result gives no value here to revise.');
      }
      const value = typeof body.value === 'string' ? body.value.normalize('NFC') : body.value!;
      if (typeof value === 'string' && [...value].length > 10000) {
        throw named(
          refused(400, 'value.invalid', 'A value revised by hand is at most 10,000 characters.'),
          naming,
        );
      }
      if (typeof value === 'string' && value.trim() === '') {
        throw named(refused(400, 'value.empty', 'A value revised by hand is never blank.'), naming);
      }
      if (
        (typeof value === 'string' && CONTROL.test(value)) ||
        valueProblem(type, value) !== null
      ) {
        throw named(
          refused(
            400,
            'value.invalid',
            `That is not a value of the column ${take.column}, which is ${type.base}.`,
          ),
          naming,
        );
      }
      const revised = await recordRevision(trx, {
        document: id,
        node: found.node,
        binding: found.binding.id,
        cell: at,
        resolution: held.id,
        act: 'revise',
        value,
        reason,
        replaces: standing?.id ?? null,
        by: principalId,
      });
      await recordRevisionEvent(trx, revised, 'revise', standing?.value ?? outcome.value);
      return answer();
    },

    /**
     * The documents holding a value for one binding of a component (B2-I): those the caller may read
     * by title, the rest counted. `read` on the component is the route's.
     */
    getBindingHolders: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id, binding } = request.params as ComponentBindingParams;
      const component = await trx
        .selectFrom('artifact')
        .select('id')
        .where('id', '=', id)
        .where('kind', '=', 'component')
        .executeTakeFirst();
      if (!component) throw notFound();
      const uses = await documentsHolding(trx, principalId, id, binding, languageOf(request));
      return {
        documents: { readable: uses.readable.map((each) => ({ ...each })), others: uses.others },
      };
    },

    /**
     * A stored result read through a document (DAT-090; D3-O): on `read` on the document, only a version
     * its bindings view shows the caller - one a binding they can see holds, or has waiting while it is
     * not stale - whole, from the bytes kept under its checksum, held to it. A resolution in a component
     * they may not read, or at a node the outline no longer has, shows nothing and reads nothing.
     */
    getDocumentDataset: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id, version } = request.params as DocumentDatasetParams;
      const placed = await bindingsPlaced(trx, id, principalId);
      if (!placed) throw notFound();
      const held = await heldBy(trx, id, placed);
      let found: { dataset: string; provenance: Provenance } | undefined;
      for (const each of placed) {
        const holding = held.get(key(each.node, each.binding.id));
        if (!holding) continue;
        if (holding.held.version === version) {
          found = { dataset: holding.held.dataset, provenance: holding.held.provenance };
        } else if (
          holding.digest === each.digest &&
          holding.waiting?.version === version &&
          // Another person's own view waiting is theirs alone to see (D7-H).
          [undefined, principalId].includes(ownViewOf(holding.waiting.provenance.identity))
        ) {
          found = { dataset: holding.held.dataset, provenance: holding.waiting.provenance };
        }
        if (found) break;
      }
      if (!found) throw notFound();
      if (!objects) throw storageUnavailable();
      const tenant = tenantOf(request);
      const store = await objects.forTenant(trx, tenant);
      const bytes = await store.get(`${tenantPrefix(tenant)}sha256/${found.provenance.checksum}`);
      if (createHash('sha256').update(bytes).digest('hex') !== found.provenance.checksum) {
        throw new Error(`The result kept for dataset version ${version} is not its checksum's`);
      }
      const result = JSON.parse(bytes.toString('utf8')) as {
        columns: [string, string][];
        rows: (string | boolean | null)[][];
      };
      const name = await datasetName(trx, found.dataset);
      return {
        dataset: found.dataset,
        version,
        name: name?.name ?? null,
        provenance: provenanceView(
          found.provenance,
          await definitionReader(trx, callerOf(request))(found.provenance.queryDefinition.artifact),
          await erasedViewer(trx)(found.provenance),
        ),
        result: { columns: result.columns, rows: result.rows },
      };
    },

    /**
     * **A bound table's rows for the page** (the TB2 plan, TB2-A): on `read` on the document, the result
     * a bound table holds there - only the version held, named as the view names it, never one
     * waiting; only where its binding is unchanged since and its rows at most `TABLE_ROWS_MAX` - read
     * by its checksum. **To a reader**, sorted here by the table's own sort and trimmed to the columns
     * it shows, `presorted`, so neither a column its author left out nor one it only sorts by reaches
     * them (the TB2 final review). **To the lock holder's own `session`**, where they may read the
     * binding's definition, the table as that session holds it, its sort columns sent and its rows in
     * stored order, so an unsaved sort lays out at once; a session that cannot answer, or a caller who
     * may not read the definition, is answered as a reader. Revalidated by an `ETag` over the version,
     * the columns sent and the order, so asking again reads nothing.
     */
    getBoundTableRows: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id, node, binding } = request.params as BoundTableRowsParams;
      const { version, session } = request.query as BoundTableRowsQuery;
      const at = (placed: Placed[]) =>
        placed.find((each) => each.node === node && each.binding.id === binding);
      let placed = await bindingsPlaced(
        trx,
        id,
        principalId,
        session === undefined ? undefined : { session, nodes: new Set([node]), fallBack: true },
      );
      if (!placed) throw notFound();
      // A session is honoured only for whoever may read the definition its table names (the TB2
      // final review): another is answered the version's table, as a reader is.
      const fromSession = at(placed);
      if (
        fromSession?.fromSession === true &&
        !(await definitionReader(trx, callerOf(request))(fromSession.binding.query))
      ) {
        placed = (await bindingsPlaced(trx, id, principalId))!;
      }
      const naming = { binding, node, document: id };
      const found = at(placed);
      if (!found) {
        throw bindingMissing(
          naming,
          `The component the node ${node} places holds no binding ${binding}.`,
        );
      }
      if (found.table === undefined) {
        throw refused(
          400,
          'binding.not_table',
          `The binding ${binding} takes a value: it is no bound table's, and has no rows to send.`,
          naming,
        );
      }
      const held = (await heldBy(trx, id, [found])).get(key(node, binding));
      if (!held) {
        throw refused(
          409,
          'binding.unresolved',
          `The document holds no result for the binding ${binding}: resolve it.`,
          naming,
        );
      }
      if (held.digest !== found.digest) {
        throw refused(
          409,
          'binding.stale',
          `The binding ${binding} has changed since its result was held: resolve it again.`,
          naming,
        );
      }
      if (held.held.version !== version) {
        throw refused(
          409,
          'version.not_held',
          `The binding ${binding} does not hold the version ${version}.`,
          naming,
        );
      }
      const { provenance } = held.held;
      if (provenance.rowCount > TABLE_ROWS_MAX) {
        throw refused(
          409,
          'table.too_long',
          `The result has ${provenance.rowCount} rows, more than the ${TABLE_ROWS_MAX} a table prints.`,
          naming,
        );
      }
      const own = found.fromSession === true;
      // A grouped column's values head its rows and a subtotal column decides which are totals, so
      // each is sent whoever asks, as a shown column is (TG2).
      const named = new Set([
        ...found.table.columns.map((each) => each.column),
        ...(own ? (found.table.sort ?? []).map((each) => each.column) : []),
        ...(found.table.groups ?? []).flatMap((each) =>
          each.subtotal === undefined ? [each.column] : [each.column, each.subtotal],
        ),
        ...(found.table.transpose === undefined ? [] : [found.table.transpose.header]),
      ]);
      const sent = provenance.columns.map((each) => each.name).filter((name) => named.has(name));
      // Its sort and its groups, which order the rows sent alike (TG1).
      const order = own
        ? null
        : [found.table.sort ?? [], found.table.groups ?? [], found.table.transpose ?? null];
      // The keyed notes' anchors, so a note added or removed is answered anew, never a 304 (TB3.3).
      const anchors = (found.table.notes ?? []).flatMap((each) =>
        each.anchor.kind === 'keyed' ? [[each.id, each.anchor.key]] : [],
      );
      // The values revised by hand standing in its cells (RV-J), so one made or withdrawn is answered
      // anew, never a 304.
      const cellRevisions = ((await revisionsStanding(trx, [held.id])).get(held.id) ?? []).filter(
        (each) => each.cell !== null,
      );
      const etag = `"${sha256(
        JSON.stringify([version, sent, order, anchors, cellRevisions.map((each) => each.id)]),
      )}"`;
      if (tagMatches(request.headers['if-none-match'], etag)) {
        return new Revalidated<never>(etag, undefined);
      }
      if (!objects) throw storageUnavailable();
      const tenant = tenantOf(request);
      const store = await objects.forTenant(trx, tenant);
      const result = await readResult(
        () => Promise.resolve(store),
        (checksum) => `${tenantPrefix(tenant)}sha256/${checksum}`,
        provenance,
      );
      if (result === undefined) {
        throw new AppError(
          503,
          'result_unreadable',
          "The table's stored result cannot be read now. Try again later.",
        );
      }
      // Each revised cell set in the result before it is sorted, as the publish's stage sets it
      // (RV-F), found by its key over the whole result.
      const revisedRows = new Map<number, Set<string>>();
      let stored = result;
      if (cellRevisions.length > 0) {
        const keyColumns = await definitionKey(trx, provenance.queryDefinition.version);
        const index = new Map(result.columns.map(([name], at) => [name, at]));
        const rows = result.rows.map((row) => [...row]);
        for (const each of cellRevisions) {
          const row = keyedRow(each.cell!.key, result, keyColumns, provenance.columns);
          const column = index.get(each.cell!.column);
          // Only where the publish's stage sets it (M5): a column no longer revisable is said on the
          // Data tab, and the cell shows the query's value.
          if (
            row === null ||
            column === undefined ||
            !cellRevisable(found.table, keyColumns, each.cell!.column)
          ) {
            continue;
          }
          rows[row]![column] = each.value;
          revisedRows.set(row, new Set([...(revisedRows.get(row) ?? []), each.cell!.column]));
        }
        stored = { columns: result.columns, rows };
      }
      const sequence = own
        ? stored.rows.map((_, at) => at)
        : tableOrder(found.table, stored, provenance.columns);
      const ordered = { columns: stored.columns, rows: sequence.map((at) => stored.rows[at]!) };
      const kept = ordered.columns.flatMap(([name], index) => (named.has(name) ? [index] : []));
      // Each keyed note's row matched over the whole result, before it is trimmed, so a key column
      // the table does not show finds its row and is never sent (TB3-C).
      const notes =
        anchors.length === 0
          ? new Map<string, number | null>()
          : matchNoteRows(
              found.table.notes ?? [],
              ordered,
              await definitionKey(trx, provenance.queryDefinition.version),
              provenance.columns,
            );
      return new Revalidated(etag, {
        version,
        presorted: !own,
        result: {
          columns: kept.map((index): [string, string] => [...ordered.columns[index]!]),
          rows: ordered.rows.map((row) => kept.map((index) => row[index] ?? null)),
        },
        notes: Object.fromEntries(notes),
        revised: sequence.flatMap((from, row) =>
          [...(revisedRows.get(from) ?? [])].map((column) => ({ row, column })),
        ),
      });
    },

    /** Naming a dataset (DAT-092; D3-N): `edit` on it, in its definition's space. */
    nameDataset: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as DatasetParams;
      const { name } = request.body as DatasetNameBody;
      const answer = await nameDataset(trx, { dataset: id, name, by: principalId });
      if (answer.answer === 'dataset.missing') throw notFound();
      if (answer.answer === 'name.invalid') {
        throw refused(
          400,
          'name.invalid',
          'A name is 1 to 200 characters, with no space before or after and no control character.',
        );
      }
      return { name: answer.name, namedBy: answer.namedBy, namedAt: answer.namedAt.toISOString() };
    },

    /** Where a definition is used (DAT-016; D3-M): computed when asked, readable ones by title. */
    getQueryDefinitionUses: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as QueryDefinitionParams;
      if (!(await readQueryDefinition(trx, id))) throw notFound();
      const view = (uses: Awaited<ReturnType<typeof componentsBinding>>) => ({
        readable: uses.readable.map((each) => ({ ...each })),
        others: uses.others,
      });
      return {
        components: view(await componentsBinding(trx, principalId, id)),
        documents: view(
          await documentsResolving(trx, principalId, { definition: id }, languageOf(request)),
        ),
      };
    },
  };
}

/**
 * Where the first cell holding an image is in a stored result - its row, counted from 1, and its
 * column - or nothing where the result cannot be read: `image_refused` names them where it can.
 */
async function whereImage(
  store: TenantStore,
  key: string,
  hash: string,
): Promise<{ row?: number; column?: string }> {
  try {
    const parsed = canonicalResultSchema.safeParse(JSON.parse((await store.get(key)).toString()));
    if (!parsed.success) return {};
    const { columns, rows } = parsed.data;
    for (const [at, row] of rows.entries()) {
      const column = columns.findIndex(
        ([, base], index) => base === 'image' && row[index] === hash,
      );
      if (column >= 0) return { row: at + 1, column: columns[column]![0] };
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Every image hash a stored result's image cells hold, read from the result object itself and held to
 * its checksum, so what a finish records is checked against the result rather than against the
 * pending row that names it (the final review, finding 6). Throws where it cannot be read: nothing is
 * recorded, and asking again tries again.
 */
async function resultImages(store: TenantStore, key: string, checksum: string): Promise<string[]> {
  const bytes = await store.get(key);
  if (createHash('sha256').update(bytes).digest('hex') !== checksum) {
    throw new Error(`The result kept under ${checksum} is not its checksum's`);
  }
  const { columns, rows } = canonicalResultSchema.parse(JSON.parse(bytes.toString('utf8')));
  const hashes = new Set<string>();
  for (const row of rows) {
    for (const [at, [, base]] of columns.entries()) {
      const cell = row[at];
      if (base === 'image' && typeof cell === 'string') hashes.add(cell);
    }
  }
  return [...hashes];
}

/**
 * What a pending result's act decided about access before its source was asked, decided again as it
 * is followed (D8-E, D3-H): `edit` on the document for a resolve, `read` for a check; `read` on the
 * definition it ran and `use_connection` on the connection, each lost answered `access_changed`.
 */
async function mayStillAct(
  trx: TenantTransaction,
  caller: Caller,
  pending: StoredPending,
): Promise<void> {
  // A person's own view is finished for them alone, as it was asked (D7-H).
  const whose = ownViewOf(pending.provenance.identity);
  if (whose !== undefined && whose !== caller.principalId) {
    throw identityDiffers({
      definition: pending.provenance.queryDefinition.artifact,
      binding: pending.binding,
      node: pending.node,
      document: pending.document,
    });
  }
  try {
    await authoriseAt(trx, caller, pending.act === 'check' ? 'read' : 'edit', {
      kind: 'artifact',
      id: pending.document,
    });
  } catch (error) {
    if (error instanceof AppError) throw accessChanged();
    throw error;
  }
  const definition = await connectionFacts(
    trx,
    caller,
    pending.provenance.queryDefinition.artifact,
  );
  const runsOn = sourceOf(pending.provenance);
  const connection = await connectionFacts(trx, caller, runsOn.artifact);
  if (
    !definition ||
    !decide('read', definition).allowed ||
    !connection ||
    !decide(runsOn.permission, connection).allowed
  ) {
    throw accessChanged();
  }
}

/**
 * Everything a pending result's act decided, decided again as it is finished, under the binding's
 * lock: access (`mayStillAct`); the binding as the act read it - from the session a resolve from one
 * read - or `binding_changed`; and what the binding holds, still the resolution it held when the act
 * read it, or none as then, or `resolution_precondition`, so a finish never records over a newer
 * result (the final review, finding 1). Answers what the binding holds now.
 */
async function mayFinish(
  trx: TenantTransaction,
  caller: Caller,
  pending: StoredPending,
): Promise<{ holding: HeldResolution | undefined; placed: Placed }> {
  const naming = {
    definition: pending.provenance.queryDefinition.artifact,
    binding: pending.binding,
    node: pending.node,
    document: pending.document,
  };
  await mayStillAct(trx, caller, pending);
  const placed =
    (await bindingsPlaced(
      trx,
      pending.document,
      caller.principalId,
      pending.session === null
        ? undefined
        : { session: pending.session, nodes: new Set([pending.node]) },
    )) ?? [];
  const found = placed.find(
    (each) => each.node === pending.node && each.binding.id === pending.binding,
  );
  if (found === undefined || found.digest !== pending.digest) throw bindingChanged(naming);
  const holding = (await heldBy(trx, pending.document, placed)).get(
    key(pending.node, pending.binding),
  );
  if ((holding?.id ?? null) !== pending.holding) {
    throw refused(
      409,
      'resolution.precondition',
      `The binding ${pending.binding} holds another result than it held when this one was run, so this one is not kept.`,
      naming,
    );
  }
  return { holding, placed: found };
}

/**
 * Following a pending result (the D8 plan, D8-E): the person whose act ran it, and nobody else, asks
 * for it until it is done. Every image admitted, it is finished under the act's own locks - the
 * binding's, then the question's - recording the dataset version, and for a resolve the binding's
 * resolution, as the act would have, and removing the pending result in the same transaction; any
 * image refused, it is refused `image_refused`, naming the row and column, and nothing is recorded.
 * Access is decided again before anything of it is answered. The pending row is held while it is
 * finished, once it is found to be the caller's, so two asking at once take turns and the second
 * finds it gone.
 */
export function pendingHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  objects: ObjectStores | undefined,
) {
  return {
    getPendingResult: async (request: FastifyRequest): Promise<PendingResultView> => {
      const { id } = request.params as PendingResultParams;
      const tenant = tenantOf(request);
      const caller = callerOf(request);
      return db.withTenant(
        tenant,
        async (trx) => {
          // Whose it is, before its row is taken: nobody else's request ever waits on it.
          const seen = await readPendingResult(trx, id);
          if (!seen || seen.requestedBy !== caller.principalId) throw notFound();
          const pending = await readPendingResult(trx, id, true);
          if (!pending) throw notFound();
          const { node, binding, document } = pending;
          const view = (result: PendingResultView['result']): PendingResultView => ({
            id,
            act: pending.act,
            document,
            node,
            binding,
            state: result === null ? 'pending' : 'done',
            result,
          });
          type Failure = ReturnType<typeof bindingFailure>;
          const failed = (failure: Failure): PendingResultView['result'] =>
            pending.act === 'check'
              ? { node, binding, outcome: 'failed', failure }
              : { node, binding, failure };
          const refuse = async (failure: Failure) => {
            await refusePending(trx, id, failure);
            return view(failed(failure));
          };
          const naming = {
            definition: pending.provenance.queryDefinition.artifact,
            binding,
            node,
            document,
          };
          const resultKey = `${tenantPrefix(tenant)}sha256/${pending.provenance.checksum}`;
          if (pending.state === 'refused') {
            try {
              await mayStillAct(trx, caller, pending);
            } catch (error) {
              if (!(error instanceof AppError)) throw error;
              return view(failed(bindingFailure(error, naming)));
            }
            return view(failed(pending.failure as Failure));
          }
          const images = await pendingImages(trx, pending);
          if (images.state === 'waiting') return view(null);
          if (!objects) throw storageUnavailable();
          const store = await objects.forTenant(trx, tenant);
          await lockBindings(trx, document, [{ node, binding }]);
          if (images.state === 'refused') {
            try {
              await mayStillAct(trx, caller, pending);
            } catch (error) {
              if (!(error instanceof AppError)) throw error;
              return refuse(bindingFailure(error, naming));
            }
            const at = await whereImage(store, resultKey, images.hash);
            return refuse(bindingFailure({ code: 'image_refused', ...at }, naming));
          }
          let holding: HeldResolution | undefined;
          let found: Placed;
          let standing: readonly StoredRevision[] = [];
          try {
            ({ holding, placed: found } = await mayFinish(trx, caller, pending));
            // The resolve's decision over the revisions standing, held to them still (RV-D).
            if (pending.act !== 'check') {
              standing = await revisionsDecided(
                trx,
                holding?.id,
                pending.revisions === null
                  ? undefined
                  : { decision: pending.revisions.decision, over: [...pending.revisions.over] },
                async () => naming,
              );
              // A value kept must stand in front of this result (the RV final review, M2).
              const kept = keptProblem(
                standing,
                pending.revisions?.decision,
                columnTypeIn({ ...pending.provenance }, found),
              );
              if (kept !== null) throw kept;
            }
          } catch (error) {
            if (!(error instanceof AppError)) throw error;
            return refuse(bindingFailure(error, naming));
          }
          const provenance = { ...pending.provenance, images: images.images };
          await lockDatasetQuestions(trx, [provenance]);
          const recorded = await recordDatasetVersion(trx, {
            provenance,
            author: pending.requestedBy,
            images: await resultImages(store, resultKey, pending.provenance.checksum),
          });
          // Held since it was read, so nothing else has finished it.
          if (!(await finishPending(trx, id)))
            throw new Error(`Pending result ${id} was finished twice`);
          if (pending.act === 'check') {
            if (!holding || holding.digest !== pending.digest) {
              return view({ node, binding, outcome: 'unchecked', reason: 'unresolved' });
            }
            const unchanged =
              provenance.checksum === holding.held.provenance.checksum &&
              provenance.queryDefinition.version ===
                holding.held.provenance.queryDefinition.version;
            await recordBindingEvent(trx, 'binding.checked', {
              document,
              node,
              binding,
              dataset: recorded.dataset.id,
              version: recorded.version.id,
              outcome: unchanged ? 'unchanged' : 'revision',
            });
            return view(
              unchanged
                ? { node, binding, outcome: 'unchanged' }
                : { node, binding, outcome: 'revision', version: recorded.version.id },
            );
          }
          const resolved = await recordLoggedResolution(trx, {
            document,
            node,
            binding,
            digest: pending.digest,
            version: recorded.version.id,
            replaces:
              holding && holding.held.dataset === recorded.dataset.id ? holding.held.version : null,
            act: 'resolve',
            by: caller.principalId,
          });
          await carryRevisions(trx, {
            standing,
            decision: pending.revisions?.decision,
            to: resolved.id,
            by: caller.principalId,
            typeOf: columnTypeIn(provenance, found),
          });
          return view({
            node,
            binding,
            held: {
              dataset: recorded.dataset.id,
              version: recorded.version.id,
              reused: recorded.reused,
            },
          });
          // As the person whose act it finishes, who alone may ask for it (the AU1 plan, AU1-L).
        },
        contextOf(request),
      );
    },
  };
}

/** The connection's own documents, for its `uses` (DAT-064; D3-M). */
export async function documentsOnConnection(
  trx: TenantTransaction,
  principalId: string,
  connection: string,
) {
  const uses = await documentsResolving(trx, principalId, { connection });
  return { readable: uses.readable.map((each) => ({ ...each })), others: uses.others };
}

/** Thrown to roll back the savepoint a creation is prepared in, once what it runs is decided. */
const PREPARED = Symbol('prepared');

/**
 * A document made from a template whose required components hold bindings (the R9 plan, R9-E;
 * TPL-063, TPL-065, TPL-024): **queries first, the document second**. In a savepoint of the deciding
 * transaction the document is made, with an identifier and node identifiers chosen here, its bindings
 * found and each prepared as a resolve prepares one - everything a run needs decided as the creator -
 * then the savepoint is rolled back, so nothing is written. Once that commits, every question runs
 * through the connector, outside any transaction; any that fails refuses the creation, `creation_failed`,
 * naming each, and nothing is made. Then, in one transaction that decides again, the document is made
 * with the same identifiers, `create` in the space decided again, and every result recorded as its
 * binding's resolution; one holding images the space does not hold yet refuses it, since only a
 * followed resolve admits them. Undefined where the template runs no query: made as any document is.
 */
export async function creationAct(
  db: TenantDatabase,
  tenant: Tenant,
  objects: ObjectStores | undefined,
  request: FastifyRequest,
  { trx, principalId, facts }: Authorised,
  through: (document: string) => RunsThrough,
): Promise<AfterCommit<Awaited<ReturnType<typeof createdView>>> | undefined> {
  const { space } = request.params as SpaceParams;
  const body = request.body as CreateDocumentBody;
  if (body.template === undefined) return undefined;
  const resolution = await resolveForDocument(trx, principalId, body.template);
  // Refused as the plain path refuses it, which reads it again.
  if (resolution.answer !== 'resolved') return undefined;
  const resolved = resolvedFrom(resolution.resolution);
  if (!resolved.ok || resolved.querySet.length === 0) return undefined;
  if (!objects) throw storageUnavailable();
  // A key's answer is kept where the document is made, after its queries run (#661; API-008): the
  // deciding transaction recalled it already, and the making one recalls it again under its lock.
  const keyed = keyedRequest(request, 'createDocument');
  const caller = callerOf(request);
  const artifactId = randomUUID();
  // Its runs are the document's it makes, by the id chosen here (the R18 plan, R18-D).
  const running = through(artifactId);
  const ids: string[] = [];
  const input = {
    spaceId: space,
    title: body.title.trim(),
    language: body.language,
    direction: body.direction,
    author: principalId,
    ...(body.parameters === undefined ? {} : { parameters: body.parameters }),
  };
  const prepared: Prepared[] = [];
  let refusal: CreateDocumentAnswer | undefined;
  try {
    await inSavepoint(trx, async () => {
      const made = await createFromResolution(
        trx,
        {
          ...input,
          identity: {
            artifactId,
            newIdentifier: () => {
              const id = newNodeIdentifier();
              ids.push(id);
              return id;
            },
          },
        },
        resolution.resolution,
      );
      if (made.answer !== 'created') {
        refusal = made;
        throw PREPARED;
      }
      for (const each of (await bindingsPlaced(trx, artifactId, principalId)) ?? []) {
        const ready = await prepare(trx, caller, artifactId, each, running);
        // One's own view is held only past DAT-091's warning (D7-H), before anything runs.
        if (ready.acting.kind === 'asserted' && body.sharesOwnView !== true) {
          throw acknowledgementRequired({
            definition: ready.definition.id,
            binding: each.binding.id,
            node: each.node,
            document: artifactId,
          });
        }
        prepared.push(ready);
      }
      throw PREPARED;
    });
  } catch (error) {
    if (error !== PREPARED) throw error;
  }
  // Refused as the plain path refuses it: `createdView` throws for anything not made.
  if (refusal !== undefined) await createdView(trx, principalId, facts, space, refusal);
  const questions = [...new Map(prepared.map((each) => [each.question, each])).values()];
  const failedAs = (each: Prepared, failure: FailureIn | AppError) =>
    bindingFailure(
      failure,
      {
        definition: each.definition.id,
        binding: each.placed.binding.id,
        node: each.placed.node,
        document: artifactId,
      },
      false,
      each.draft.fetch.kind === 'builder',
    );
  const failedCreation = (failures: ReturnType<typeof failedAs>[]) =>
    refused(
      409,
      'creation.failed',
      `A query a required component holds failed, so the document was not made: ${failures
        .map((each) => each.message)
        .join(' ')}`,
      { failures },
    );
  return new AfterCommit(
    () =>
      running.whileHeld(async (signal) => {
        let opened: Awaited<ReturnType<ObjectStores['forTenant']>> | undefined;
        const store = async () =>
          (opened ??= await db.withTenant(tenant, (open) => objects.forTenant(open, tenant)));
        const takes = takesByQuestion(prepared);
        const outcomes = await inTurn(questions, AT_ONCE, (each) =>
          runOnce(tenant, each, takes.get(each.question)!, running, store, signal),
        );
        if (signal.aborted) throw signal.reason;
        const ran = new Map(questions.map((each, at) => [each.question, outcomes[at]!]));
        // Nothing is made where a query failed (TPL-024): each failure named.
        const failures = prepared.flatMap((each) => {
          const outcome = ran.get(each.question)!;
          return outcome.ok ? [] : [failedAs(each, outcome.failure)];
        });
        if (failures.length > 0) throw failedCreation(failures);
        return db.withTenant(
          tenant,
          async (record) => {
            // Another request with this key may have made it while these queries ran: its answer stands.
            if (keyed) {
              const recalled = await recallAnswer(record, { ...keyed, principal: principalId });
              if (recalled.kind === 'replay') {
                return recalled.body as Awaited<ReturnType<typeof createdView>>;
              }
              if (recalled.kind === 'reused') throw keyReused();
            }
            // `create` in the space, decided again: it may have ended while the source answered.
            try {
              await authoriseAt(record, caller, 'create', { kind: 'space', id: space });
            } catch (error) {
              if (error instanceof AppError) throw accessChanged();
              throw error;
            }
            let at = 0;
            const made = await createFromResolution(
              record,
              { ...input, identity: { artifactId, newIdentifier: () => ids[at++]! } },
              resolution.resolution,
            );
            if (made.answer !== 'created')
              return createdView(record, principalId, facts, space, made);
            await decideAgain(record, request, { id: artifactId, permission: 'read' }, prepared);
            await lockDatasetQuestions(record, recordable(prepared, ran));
            const admitted = await admitAll(
              record,
              store,
              principalId,
              recordedRuns(prepared, ran),
            );
            const versions = new Map<string, Awaited<ReturnType<typeof recordDatasetVersion>>>();
            const refusedNow: ReturnType<typeof failedAs>[] = [];
            for (const each of prepared) {
              const outcome = ran.get(each.question)! as Extract<Ran, { ok: true }>;
              const { node, binding } = each.placed;
              const admission = admitted.get(each.question)!;
              if ('failure' in admission) {
                refusedNow.push(failedAs(each, admission.failure));
                continue;
              }
              if (!admission.held) {
                // Images the space does not hold yet are admitted only as a resolve's are, followed by
                // whoever asked (D8-E), which a creation has no way to be: refused, nothing made.
                refusedNow.push(
                  failedAs(
                    each,
                    new AppError(
                      409,
                      'images_pending',
                      `The result of the binding ${binding.id} holds images this space does not hold yet, which a document being made cannot take in.`,
                    ),
                  ),
                );
                continue;
              }
              let recorded = versions.get(each.question);
              if (!recorded) {
                recorded = await recordDatasetVersion(record, {
                  provenance: admission.provenance,
                  author: principalId,
                  images: admission.hashes,
                });
                versions.set(each.question, recorded);
              }
              await recordTaken(record, recorded.version.id, each, outcome);
              await recordLoggedResolution(record, {
                document: artifactId,
                node,
                binding: binding.id,
                digest: each.placed.digest,
                version: recorded.version.id,
                replaces: null,
                act: 'resolve',
                by: principalId,
              });
            }
            // Refused here, the transaction rolls back and nothing is made (TPL-024), nor remembered.
            if (refusedNow.length > 0) throw failedCreation(refusedNow);
            const view = await createdView(record, principalId, facts, space, made);
            if (keyed) {
              await rememberAnswer(record, {
                ...keyed,
                principal: principalId,
                status: 200,
                body: view,
              });
            }
            return view;
          },
          contextOf(request),
        );
      }),
    true,
  );
}
