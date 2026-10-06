import { createHash, randomUUID } from 'node:crypto';
import type {
  AcceptBindingBody,
  BindingStateView,
  CheckBindingsView,
  ComponentBindingParams,
  ConfirmBindingBody,
  DatasetNameBody,
  DatasetParams,
  DocumentBindingParams,
  DocumentBindingsQuery,
  DocumentDatasetParams,
  PendingResultParams,
  PendingResultView,
  QueryDefinitionParams,
  ResolveBindingsBody,
  ResolveBindingsView,
  TakeOutcomeView,
} from '@alloy-works/api-contract';
import { SESSION_COOKIE, type ProvenanceView } from '@alloy-works/api-contract';
import {
  assetHolding,
  componentsBinding,
  dataPolicy,
  datasetName,
  documentsHolding,
  documentsResolving,
  finishPending,
  holdObject,
  inSavepoint,
  lockBindings,
  lockDatasetQuestions,
  nameDataset,
  pendingImages,
  pendingResult,
  readDocument,
  readPendingResult,
  readQueryDefinition,
  readVersion,
  recordDatasetVersion,
  recordResolution,
  recordTake,
  refusePending,
  publishedBindings,
  resolutionsOf,
  resolveOccurrences,
  sessionContent,
  takeDigest,
  takesOf,
  uploadForDatasetImage,
  type HeldResolution,
  type PendingAct,
  type StoredPending,
  type StoredConnection,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  ADMITTED_FORMATS,
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
  parametersDigestInput,
  parseQueryDefinition,
  questionUnchanged,
  readContent,
  readImageHeader,
  readOutline,
  walkOutline,
  takeOutcomeSchema,
  takeValue,
  type AssetFormat,
  type Binding,
  type BindingPlace,
  type CanonicalResult,
  type Column,
  type DraftDefinition,
  type Limits,
  type ParameterValues,
  type Provenance,
  type QueryDefinition,
  type RunAnswer,
  type RunRequest,
  type TakeOutcome,
} from '@alloy-works/domain';
import { tenantPrefix, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { authoriseAt, callerOf, notFound, type Authorised, type Caller } from '../access.js';
import { Accepted, AfterCommit } from '../after-commit.js';
import { AppError, storageUnavailable } from '../errors.js';
import { hashToken } from '../sessions.js';
import { bearerSecret, isBearer } from '../tokens.js';
import { refused } from '../wire-codes.js';
import { actingKey, ownViewOf, provenanceIdentity, runIdentity, type Acting } from './acting.js';
import { failureViewFor, type FailureIn } from './failure-words.js';
import { connectionFacts, requireSqlPermitted } from './sql-access.js';

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
const provenanceView = (provenance: Provenance, readsDefinition: boolean) =>
  (readsDefinition
    ? provenance
    : {
        ...provenance,
        connection: null,
        ran: 'sql' in provenance.ran ? { sql: null } : { request: null },
        columns: provenance.columns.map((column) => ({ ...column, from: null })),
      }) as unknown as z.infer<typeof ProvenanceView>;

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
  | { readonly refused: { readonly code: 'connector_busy' | 'connector_unavailable' } };

/**
 * What the connection routes lend a resolve and a check: the run itself, the connection's own
 * refusals - a connection that cannot run, and the sealed credential it runs with - who the caller
 * runs as on a connection (D7-G), and the watch on their authority while the source answers (D7-I).
 */
export interface RunsThrough {
  readonly run: (request: RunRequest, signal: AbortSignal) => Promise<RunAsked>;
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

/** A binding as a document places it: the node, the component version, and its digest (D3-R). */
interface Placed {
  readonly node: string;
  readonly component: string;
  readonly binding: Binding;
  readonly digest: string;
  /** In a line, in a footnote's line, or as a figure's image: where an image may stand (B6-D). */
  readonly place: BindingPlace;
  /** A figure's binding whose figure its author marked decorative (Ken, 2026-10-06). */
  readonly decorative?: true;
}

const key = (node: string, binding: string) => `${node} ${binding}`;

/**
 * Where bindings are read from beside the component versions (B2-C): the caller's own editing session,
 * for the nodes named - `strict`, a node it cannot be read for holds nothing, so its binding is
 * `binding_missing` - or for every node, falling back to the version where it cannot (the view's).
 */
interface SessionSource {
  readonly session: string;
  readonly nodes: ReadonlySet<string> | 'every';
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
      if (saved?.openedFrom === occurrence.version) substance = saved.content;
      else if (source.nodes !== 'every') continue;
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
      placed.push({
        node: occurrence.node,
        component: occurrence.component,
        binding,
        digest: sha256(bindingDigestInput(binding)),
        place,
        ...(decorative ? { decorative } : {}),
      });
    }
  }
  return placed;
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
  return new AppError(error.status, error.code, error.message, error.rule, {
    ...error.members,
    ...naming,
  });
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

/** Everything a binding's run needs, decided and read in the deciding transaction. */
interface Prepared {
  readonly placed: Placed;
  readonly definition: { readonly id: string; readonly version: string };
  readonly connection: StoredConnection;
  readonly sealed: string;
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
    if (!stored || !facts || !decide('read', facts).allowed) {
      throw bindingMissing(naming, `The binding ${binding.id} names no query definition here.`);
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
    const take = checkTake(binding.take, definition);
    if (take !== null) throw refused(400, 'take.invalid', `${take}.`);
    const literal = literalValues(binding);
    if ('document' in literal) {
      throw refused(
        400,
        'parameter.invalid',
        `The binding ${binding.id} takes its ${literal.document} from the document, and no document has parameters yet.`,
        { attribution: 'product' },
      );
    }
    const problems = checkParameterValues(definition.parameters, literal.values);
    if (problems.length > 0) {
      throw refused(400, 'parameter.invalid', 'A value does not fit its parameter.', {
        attribution: 'product',
        problems,
      });
    }
    const connection = await through.runnable(trx, definition.connection);
    const atConnection = await connectionFacts(trx, caller, connection.id);
    if (!atConnection || !decide('use_connection', atConnection).allowed) {
      throw new AppError(
        403,
        'forbidden',
        `This needs the use connection permission on the connection the binding ${binding.id} runs on.`,
      );
    }
    await requireSqlPermitted(trx, connection, definition.fetch);
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

/** The takes of every binding asking each question, by question. */
function takesByQuestion(prepared: readonly Prepared[]): Map<string, Take[]> {
  const takes = new Map<string, Take[]>();
  for (const each of prepared) {
    const asking = takes.get(each.question) ?? [];
    asking.push(each.placed.binding.take);
    takes.set(each.question, asking);
  }
  return takes;
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
  const take = each.placed.binding.take;
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
  const asked = await through.run(
    {
      requestId: randomUUID(),
      tenant: tenant.id,
      connection: { id: prepared.connection.id, version: prepared.connection.version.id },
      settings: prepared.connection.settings,
      sealed: prepared.sealed,
      definition: prepared.draft,
      values: prepared.values as RunRequest['values'],
      limits: prepared.limits,
      deadlineMs: prepared.limits.seconds * 1000,
      ...runIdentity(prepared.acting),
    },
    signal,
  );
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
      connection: { artifact: prepared.connection.id, version: prepared.connection.version.id },
      parameters: prepared.values,
      ran: 'sql' in ran.ran ? { sql: ran.ran.sql } : { request: ran.ran.request },
      identity: provenanceIdentity(prepared.acting, ran.asSeen ?? ''),
      at: new Date().toISOString(),
      durationMs: ran.durationMs,
      rowCount: ran.rowCount,
      columns: prepared.draft.columns,
      canonical: 1,
      checksum,
      images: {},
    },
  };
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
    const connection = await connectionFacts(trx, caller, each.connection.id);
    if (
      !definition ||
      !decide('read', definition).allowed ||
      !connection ||
      !decide('use_connection', connection).allowed
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
    if (sees.has(connection.id)) continue;
    const facts = await connectionFacts(trx, caller, connection.id);
    sees.set(connection.id, facts !== undefined && decide('write_sql', facts).allowed);
  }
  return (run) => sees.get(run.connection.id) === true;
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
  if (!definition || !decide('read', definition).allowed) {
    throw bindingMissing(naming, `The binding ${naming.binding} names no query definition here.`);
  }
  const connection = await connectionFacts(trx, caller, provenance.connection.artifact);
  if (!connection || !decide('use_connection', connection).allowed) {
    throw new AppError(
      403,
      'forbidden',
      `This needs the use connection permission on the connection the binding ${naming.binding} runs on.`,
    );
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
 * binding taking anything but an image `value_not_image` - decided here and by the publish's stage,
 * never recorded, since `dataset_take` keys an outcome by the version and the take alone.
 */
function placedTaken(place: BindingPlace, taken: Taken, provenance: Provenance): TakeOutcomeView {
  if ('unavailable' in taken || 'failure' in taken) return taken;
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
const takenAs = (taken: ReadonlyMap<string, Taken>, version: string, placed: Placed): Taken =>
  (placed.decorative ? taken.get(takeKey(version, placed.binding.take, true)) : undefined) ??
  taken.get(takeKey(version, placed.binding.take))!;

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
  if (!held || held.digest !== placed.digest) return [];
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
  const facts = new Map<string, Promise<boolean>>();
  /** Whether the caller holds a permission on an artifact, each asked once. */
  const may = (permission: 'edit' | 'use_connection', artifact: string) => {
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
  async function dataFacts(placed: Placed, held: HeldResolution | undefined) {
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
      (await may('use_connection', held.held.provenance.connection.artifact));
    let mayResolve = false;
    if (asked !== undefined && (await reads(placed.binding.query))) {
      const version = await readVersion(trx, asked);
      const connection =
        version?.kind === 'queryDefinition'
          ? parseQueryDefinition(version.content).connection
          : undefined;
      mayResolve =
        connection !== undefined &&
        (await may('edit', documentId)) &&
        (await may('use_connection', connection));
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

  /** The connection the held result ran on, by name, to a reader of its definition and of it. */
  async function connectionOf(held: HeldResolution | undefined) {
    if (!held) return null;
    const { queryDefinition, connection } = held.held.provenance;
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
      questionUnchanged(placed.binding, held.held.provenance, latest.version.id)
    );
  }

  /** The view of each binding as a document holds it now (D3-J, D3-R, B1-I), in the order given. */
  return async function views(
    each: readonly { readonly placed: Placed; readonly held: HeldResolution | undefined }[],
  ): Promise<BindingStateView[]> {
    const taken = await takenOf(
      trx,
      store,
      keyFor,
      each.flatMap(({ placed, held }) => takesAsked(placed, held, caller.principalId)),
    );
    const out: BindingStateView[] = [];
    for (const { placed, held } of each) {
      const shown = {
        definition: await definitionOf(placed, held),
        connection: await connectionOf(held),
        ...(await dataFacts(placed, held)),
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
      // A waiting result that is another person's own view is offered to them alone (D7-H).
      const waitingWhose = held.waiting && ownViewOf(held.waiting.provenance.identity);
      const offered = waitingWhose === undefined || waitingWhose === caller.principalId;
      const name = await datasetName(trx, held.held.dataset);
      const readsDefinition = await reads(held.held.provenance.queryDefinition.artifact);
      out.push({
        node: placed.node,
        binding: placed.binding,
        held: {
          dataset: held.held.dataset,
          version: held.held.version,
          number: `${held.held.number.revision}.${held.held.number.version}`,
          provenance: provenanceView(held.held.provenance, readsDefinition),
          name: name?.name ?? null,
          stale,
          taken: stale
            ? null
            : placedTaken(
                placed.place,
                takenAs(taken, held.held.version, placed),
                held.held.provenance,
              ),
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
                ),
                taken: placedTaken(
                  placed.place,
                  takenAs(taken, held.waiting.version, placed),
                  held.waiting.provenance,
                ),
              }
            : null,
        ...shown,
      });
    }
    return out;
  };
}

type Views = ReturnType<typeof viewer>;

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
      return db.withTenant(tenant, async (record) => {
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
          const admission = admitted.get(each.question)!;
          if ('failure' in admission) {
            failed(admission.failure);
            continue;
          }
          if (!admission.held) {
            // Its images are being admitted: recorded once every one is, when it is asked for (D8-E).
            const act: PendingAct = sessionNodes.has(key(node, binding.id)) ? 'session' : 'resolve';
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
          const before = held.get(key(node, binding.id));
          await recordResolution(record, {
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
        return results.some((each) => 'pending' in each) ? new Accepted({ results }) : { results };
      });
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
      const outcomes = await inTurn(asking, AT_ONCE, (each) =>
        runOnce(tenant, each, takes.get(each.question)!, through, store, signal),
      );
      const ran = new Map(asking.map((each, at) => [each.question, outcomes[at]!]));
      if (signal.aborted) throw signal.reason;
      return db.withTenant(tenant, async (record) => {
        const succeeded = toRun.filter((each) => ran.get(each.question)?.ok === true);
        await lockBindings(
          record,
          id,
          succeeded.map(({ placed: { node, binding } }) => ({ node, binding: binding.id })),
        );
        await decideAgain(record, request, { id, permission: 'read' }, succeeded);
        await unchangedSince(
          record,
          id,
          principalId,
          succeeded.map((each) => each.placed),
        );
        // What each holds now, under the lock: an accept while the source answered moves what the
        // result is compared with, so what was read before the run is not the comparison.
        const holdingNow = await heldBy(record, id, placed);
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
          results.set(
            key(node, binding.id),
            outcome.provenance.checksum === holding.held.provenance.checksum &&
              outcome.provenance.queryDefinition.version ===
                holding.held.provenance.queryDefinition.version
              ? { node, binding: binding.id, outcome: 'unchanged' }
              : { node, binding: binding.id, outcome: 'revision', version: recorded.version.id },
          );
        }
        return waits ? new Accepted({ results: ordered() }) : { results: ordered() };
      });
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
      await recordResolution(trx, {
        document: id,
        node: found.node,
        binding: found.binding.id,
        digest: found.digest,
        version: body.version,
        replaces: held.held.version,
        act: 'accept',
        by: principalId,
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
      if (!facts || !decide('read', facts).allowed) {
        throw bindingMissing(
          { ...naming, definition: found.binding.query },
          `The binding ${found.binding.id} names no query definition here.`,
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
      if (!latest || !questionUnchanged(found.binding, provenance, latest.version.id)) {
        throw refused(
          409,
          'confirm.not_possible',
          `The binding ${found.binding.id} asks another question than the result it holds answers: resolve it instead.`,
          { ...naming, definition: found.binding.query },
        );
      }
      const ran = await readVersion(trx, provenance.queryDefinition.version);
      const take = checkTake(found.binding.take, parseQueryDefinition(ran!.content));
      if (take !== null) throw named(refused(400, 'take.invalid', `${take}.`), naming);
      await recordResolution(trx, {
        document: id,
        node: found.node,
        binding: found.binding.id,
        digest: found.digest,
        version: held.held.version,
        replaces: held.held.version,
        act: 'confirm',
        by: principalId,
      });
      return stateView(
        views,
        found,
        (await heldBy(trx, id, placed)).get(key(body.node, body.binding)),
      );
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
      const uses = await documentsHolding(trx, principalId, id, binding);
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
        ),
        result: { columns: result.columns, rows: result.rows },
      };
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
        documents: view(await documentsResolving(trx, principalId, { definition: id })),
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
  const connection = await connectionFacts(trx, caller, pending.provenance.connection.artifact);
  if (
    !definition ||
    !decide('read', definition).allowed ||
    !connection ||
    !decide('use_connection', connection).allowed
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
): Promise<HeldResolution | undefined> {
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
  if (found?.digest !== pending.digest) throw bindingChanged(naming);
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
  return holding;
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
      return db.withTenant(tenant, async (trx) => {
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
        try {
          holding = await mayFinish(trx, caller, pending);
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
          return view(
            provenance.checksum === holding.held.provenance.checksum &&
              provenance.queryDefinition.version === holding.held.provenance.queryDefinition.version
              ? { node, binding, outcome: 'unchanged' }
              : { node, binding, outcome: 'revision', version: recorded.version.id },
          );
        }
        await recordResolution(trx, {
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
        return view({
          node,
          binding,
          held: {
            dataset: recorded.dataset.id,
            version: recorded.version.id,
            reused: recorded.reused,
          },
        });
      });
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
