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
  QueryDefinitionParams,
  ResolveBindingsBody,
  ResolveBindingsView,
  TakeOutcomeView,
} from '@alloy-works/api-contract';
import { SESSION_COOKIE, type ProvenanceView } from '@alloy-works/api-contract';
import {
  componentsBinding,
  dataPolicy,
  datasetName,
  documentsHolding,
  documentsResolving,
  findApiToken,
  inSavepoint,
  lockBindings,
  lockDatasetQuestions,
  nameDataset,
  readDocument,
  readQueryDefinition,
  readVersion,
  recordDatasetVersion,
  recordResolution,
  recordTake,
  resolutionsOf,
  resolveOccurrences,
  sessionContent,
  takeDigest,
  takesOf,
  type HeldResolution,
  type StoredConnection,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  bindingDigestInput,
  bindingsIn,
  canonicalResultBytes,
  canonicalResultSchema,
  checkParameterValues,
  checkTake,
  decide,
  effectiveLimits,
  literalValues,
  parametersDigestInput,
  parseProvenance,
  parseQueryDefinition,
  questionUnchanged,
  readContent,
  readOutline,
  walkOutline,
  takeOutcomeSchema,
  takeValue,
  type Binding,
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
import { AfterCommit } from '../after-commit.js';
import { AppError, storageUnavailable } from '../errors.js';
import { findSession, hashToken } from '../sessions.js';
import { bearerSecret, isBearer } from '../tokens.js';
import { refused } from '../wire-codes.js';
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
        ran: { sql: null },
        columns: provenance.columns.map((column) => ({ ...column, from: null })),
      }) as unknown as z.infer<typeof ProvenanceView>;

/** Whether the caller may read a query definition, each asked once a request. */
function definitionReader(trx: TenantTransaction, caller: Caller) {
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
 * What the connection routes lend a resolve and a check: the run itself, and the connection's own
 * refusals - a connection that cannot run, and the sealed credential it runs with.
 */
export interface RunsThrough {
  readonly run: (request: RunRequest) => Promise<RunAsked>;
  readonly runnable: (trx: TenantTransaction, id: string) => Promise<StoredConnection>;
  readonly usableSealed: (
    trx: TenantTransaction,
    id: string,
  ) => Promise<{ readonly sealed: string }>;
}

/** A binding as a document places it: the node, the component version, and its digest (D3-R). */
interface Placed {
  readonly node: string;
  readonly component: string;
  readonly binding: Binding;
  readonly digest: string;
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
    for (const { binding } of bindingsIn(content.document)) {
      placed.push({
        node: occurrence.node,
        component: occurrence.component,
        binding,
        digest: sha256(bindingDigestInput(binding)),
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
    return {
      placed,
      definition: { id: stored.id, version },
      connection,
      sealed,
      draft: draftOf(definition),
      values: literal.values,
      limits,
      question: `${stored.id} ${version} ${sha256(parametersDigestInput(literal.values))}`,
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
    }
  | { readonly ok: false; readonly failure: FailureIn };

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
 * and only its outcome is carried on (B1-H).
 */
async function runOnce(
  tenant: Tenant,
  prepared: Prepared,
  takes: readonly Take[],
  through: RunsThrough,
  store: () => Promise<{ put(body: Uint8Array, contentType: string): Promise<{ key: string }> }>,
): Promise<Ran> {
  const asked = await through.run({
    requestId: randomUUID(),
    tenant: tenant.id,
    connection: { id: prepared.connection.id, version: prepared.connection.version.id },
    settings: prepared.connection.settings,
    sealed: prepared.sealed,
    definition: prepared.draft,
    values: prepared.values as RunRequest['values'],
    limits: prepared.limits,
    deadlineMs: prepared.limits.seconds * 1000,
  });
  if ('refused' in asked) return { ok: false, failure: { code: asked.refused.code } };
  const ran = asked.answer;
  if (ran.outcome === 'failed') return { ok: false, failure: ran.failure };
  const bytes = canonicalResultBytes(ran.result);
  const checksum = sha256(bytes);
  if (checksum !== ran.checksum) return { ok: false, failure: { code: 'connector_error' } };
  const kept = await (await store()).put(Buffer.from(bytes, 'utf8'), 'application/json');
  if (kept.key !== `${tenantPrefix(tenant)}sha256/${checksum}`) {
    throw new Error('The store kept a result under a key that is not its checksum');
  }
  const taken = new Map(
    takes.map((take) => [takeDigest(take), takeHeld(take, ran.result, prepared.draft.columns)]),
  );
  return {
    ok: true,
    taken,
    provenance: {
      schemaVersion: 1,
      queryDefinition: { artifact: prepared.definition.id, version: prepared.definition.version },
      connection: { artifact: prepared.connection.id, version: prepared.connection.version.id },
      parameters: prepared.values,
      ran: { sql: ran.ran.sql },
      identity: { kind: 'service' },
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
 * (D3-H).
 */
async function stillSignedIn(trx: TenantTransaction, request: FastifyRequest): Promise<boolean> {
  const principal = request.principal?.principalId;
  const authorization = request.headers.authorization;
  if (authorization !== undefined && isBearer(authorization)) {
    const secret = bearerSecret(authorization);
    const holder = secret === undefined ? undefined : await findApiToken(trx, hashToken(secret));
    return holder !== undefined && holder.principalId === principal;
  }
  const token = request.cookies[SESSION_COOKIE];
  const found = token === undefined ? undefined : await findSession(trx, token);
  return found !== undefined && found.principalId === principal;
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
}

const takeKey = (version: string, take: Take) => `${version} ${takeDigest(take)}`;

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
): Promise<Map<string, TakeOutcomeView>> {
  const unique = [
    ...new Map(asked.map((each) => [takeKey(each.version, each.take), each])).values(),
  ];
  const taken = new Map<string, TakeOutcomeView>(
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
  return taken;
}

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

/** The takes a binding's view asks: of the version held, unless stale, and of the one waiting. */
function takesAsked(placed: Placed, held: HeldResolution | undefined): TakeAsked[] {
  if (!held || held.digest !== placed.digest) return [];
  const take = placed.binding.take;
  return [
    { version: held.held.version, take, provenance: held.held.provenance },
    ...(held.waiting
      ? [{ version: held.waiting.version, take, provenance: held.waiting.provenance }]
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
) {
  // `read` on any artifact, each asked once: a definition, and a connection.
  const reads = definitionReader(trx, caller);
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
      each.flatMap(({ placed, held }) => takesAsked(placed, held)),
    );
    const out: BindingStateView[] = [];
    for (const { placed, held } of each) {
      const shown = {
        definition: await definitionOf(placed, held),
        connection: await connectionOf(held),
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
      const name = await datasetName(trx, held.held.dataset);
      const readsDefinition = await reads(held.held.provenance.queryDefinition.artifact);
      const take = placed.binding.take;
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
          taken: stale ? null : taken.get(takeKey(held.held.version, take))!,
          act: held.act,
          keepable: await keepable(placed, held),
          by: { id: held.by, displayName: await nameOf(held.by) },
          at: held.at.toISOString(),
        },
        waiting:
          !stale && held.waiting
            ? {
                version: held.waiting.version,
                provenance: provenanceView(
                  held.waiting.provenance,
                  await reads(held.waiting.provenance.queryDefinition.artifact),
                ),
                taken: taken.get(takeKey(held.waiting.version, take))!,
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

/** The latest resolution for each node and binding of a document, by both. */
async function heldBy(
  trx: TenantTransaction,
  documentId: string,
): Promise<Map<string, HeldResolution>> {
  return new Map(
    (await resolutionsOf(trx, documentId)).map((each) => [key(each.node, each.binding), each]),
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
): Promise<AfterCommit<ResolveBindingsView>> {
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
    prepared.push(await prepare(trx, caller, id, found, through));
  }
  const questions = [...new Map(prepared.map((each) => [each.question, each])).values()];
  return new AfterCommit(async () => {
    let opened: Awaited<ReturnType<ObjectStores['forTenant']>> | undefined;
    const store = async () =>
      (opened ??= await db.withTenant(tenant, (open) => objects.forTenant(open, tenant)));
    const ran = new Map<string, Ran>();
    const takes = takesByQuestion(prepared);
    const outcomes = await inTurn(questions, AT_ONCE, (each) =>
      runOnce(tenant, each, takes.get(each.question)!, through, store),
    );
    questions.forEach((each, at) => ran.set(each.question, outcomes[at]!));
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
      const held = await heldBy(record, id);
      // Every question this records, in turn, before the first: after the bindings' locks, as every
      // act takes them, so two acts recording the same questions never wait on each other.
      await lockDatasetQuestions(record, recordable(succeeded, ran));
      const versions = new Map<string, Awaited<ReturnType<typeof recordDatasetVersion>>>();
      const results: ResolveResult[] = [];
      for (const each of prepared) {
        const outcome = ran.get(each.question)!;
        const { node, binding } = each.placed;
        if (!outcome.ok) {
          results.push({
            node,
            binding: binding.id,
            failure: bindingFailure(
              outcome.failure,
              { definition: each.definition.id, binding: binding.id, node, document: id },
              seesSource(each),
              each.draft.fetch.kind === 'builder',
            ),
          });
          continue;
        }
        let recorded = versions.get(each.question);
        if (!recorded) {
          recorded = await recordDatasetVersion(record, {
            provenance: outcome.provenance,
            author: principalId,
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
      return { results };
    });
  });
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
): Promise<AfterCommit<CheckBindingsView>> {
  const { id } = request.params as DocumentBindingParams;
  if (!objects) throw storageUnavailable();
  const caller = callerOf(request);
  const placed = await bindingsPlaced(trx, id, principalId);
  if (!placed) throw notFound();
  const held = await heldBy(trx, id);
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
    try {
      toRun.push(await prepare(trx, caller, id, each, through));
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
  return new AfterCommit(async () => {
    let opened: Awaited<ReturnType<ObjectStores['forTenant']>> | undefined;
    const store = async () =>
      (opened ??= await db.withTenant(tenant, (open) => objects.forTenant(open, tenant)));
    const takes = takesByQuestion(toRun);
    const outcomes = await inTurn(asking, AT_ONCE, (each) =>
      runOnce(tenant, each, takes.get(each.question)!, through, store),
    );
    const ran = new Map(asking.map((each, at) => [each.question, outcomes[at]!]));
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
      const holdingNow = await heldBy(record, id);
      const seesSource = await seeingSourceNow(record, caller, toRun);
      await lockDatasetQuestions(record, recordable(succeeded, ran));
      const versions = new Map<string, Awaited<ReturnType<typeof recordDatasetVersion>>>();
      for (const each of toRun) {
        const outcome = ran.get(each.question);
        if (!outcome) continue;
        const { node, binding } = each.placed;
        const naming = { definition: each.definition.id, binding: binding.id, node, document: id };
        if (!outcome.ok) {
          results.set(key(node, binding.id), {
            node,
            binding: binding.id,
            outcome: 'failed',
            failure: bindingFailure(
              outcome.failure,
              naming,
              seesSource(each),
              each.draft.fetch.kind === 'builder',
            ),
          });
          continue;
        }
        let recorded = versions.get(each.question);
        if (!recorded) {
          recorded = await recordDatasetVersion(record, {
            provenance: outcome.provenance,
            author: principalId,
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
        results.set(
          key(node, binding.id),
          outcome.provenance.checksum === holding.held.provenance.checksum
            ? { node, binding: binding.id, outcome: 'unchanged' }
            : { node, binding: binding.id, outcome: 'revision', version: recorded.version.id },
        );
      }
      return { results: ordered() };
    });
  });
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
      const held = await heldBy(trx, id);
      const views = viewer(trx, callerOf(request), objects, tenantOf(request));
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
      const held = (await heldBy(trx, id)).get(key(body.node, body.binding));
      const views = viewer(trx, callerOf(request), objects, tenantOf(request));
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
      const offered = await readVersion(trx, body.version);
      const newer =
        offered !== undefined &&
        offered.kind === 'dataset' &&
        offered.artifactId === held.held.dataset &&
        (offered.revision > held.held.number.revision ||
          (offered.revision === held.held.number.revision &&
            offered.version > held.held.number.version));
      if (!newer) throw await precondition();
      await mayTakeResult(trx, callerOf(request), parseProvenance(offered.content), {
        definition: found.binding.query,
        binding: found.binding.id,
        node: found.node,
        document: id,
      });
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
      return stateView(views, found, (await heldBy(trx, id)).get(key(body.node, body.binding)));
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
      const held = (await heldBy(trx, id)).get(key(body.node, body.binding));
      const views = viewer(trx, caller, objects, tenantOf(request));
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
      return stateView(views, found, (await heldBy(trx, id)).get(key(body.node, body.binding)));
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
      const held = await heldBy(trx, id);
      let found: { dataset: string; provenance: Provenance } | undefined;
      for (const each of placed) {
        const holding = held.get(key(each.node, each.binding.id));
        if (!holding) continue;
        if (holding.held.version === version) {
          found = { dataset: holding.held.dataset, provenance: holding.held.provenance };
        } else if (holding.digest === each.digest && holding.waiting?.version === version) {
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

/** The connection's own documents, for its `uses` (DAT-064; D3-M). */
export async function documentsOnConnection(
  trx: TenantTransaction,
  principalId: string,
  connection: string,
) {
  const uses = await documentsResolving(trx, principalId, { connection });
  return { readable: uses.readable.map((each) => ({ ...each })), others: uses.others };
}
