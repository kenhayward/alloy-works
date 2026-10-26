import { createHash, randomUUID } from 'node:crypto';
import type {
  ConnectionListQuery,
  ConnectionParams,
  ConnectionVersionBody,
  DatasetParams,
  DatasetSourceList,
  DatasetSourceQuery,
  ConnectionView,
  CreateConnectionBody,
  CredentialBody,
  DescribeBody,
  DocumentParams,
  SampleBody,
  SampleView,
  SpaceParams,
  TestView,
} from '@alloy-works/api-contract';
import { SAMPLE_ROWS } from '@alloy-works/api-contract';
import {
  createConnection,
  credentialOf,
  dataPolicy,
  definitionsNaming,
  listDatasetSources,
  giveQuerySlot,
  recordQueryRun,
  takeQuerySlot,
  type QueryAct,
  type QueryRun,
  latestConnectionTest,
  listReadableConnections,
  readConnection,
  recordConnectionTest,
  recordConnectionVersion,
  setConnectionCredential,
  usableCredentialOf,
  type ConnectionAnswer,
  type ConnectionTestFailure,
  type NamingDefinitions,
  type StoredConnection,
  type Tenant,
  type TenantDatabase,
  type TenantListener,
  type TenantTransaction,
  extensionAtDigest,
} from '@alloy-works/db';
import {
  BindingRefused,
  DefinitionRefused,
  RAN_MAX_CHARACTERS,
  bindFetch,
  canonicalResultBytes,
  checkParameterValues,
  checkQueryDefinition,
  checkTree,
  capabilityProblems,
  connectionFetchProblems,
  connectionSettingsSchema,
  headerValueProblem,
  httpValueProblems,
  keyPairText,
  objectKeyProblems,
  sampleDraft,
  dataFailures,
  decide,
  effectiveLimits,
  lexPostgres,
  parseDraftDefinition,
  readImageHeader,
  type AccessFacts,
  type AuditContext,
  type ConnectionProblem,
  type DataFailureCode,
  type DefinitionProblem,
  type DraftDefinition,
  type Parameter,
  type Query,
  type ParameterValues,
  type Limits,
  type RunAnswer,
  type RunRequest,
  type TestAnswer,
  dataFailure,
  runsAtOnce,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { administerOrAbove, notFound, type Authorised } from '../access.js';
import { versionView } from '../components.js';
import { AfterCommit } from '../after-commit.js';
import { contextOf } from '../audit.js';
import { authorityEnded, watchAuthority, type AuthorityEnded } from '../authority.js';
import { AppError } from '../errors.js';
import { cursorFor, pageAsked } from '../listing.js';
import type { SessionPrincipal } from '../sessions.js';
import { refused } from '../wire-codes.js';
import { actingOn, runIdentity } from './acting.js';
import {
  checkAct,
  creationAct,
  documentsOnConnection,
  resolveAct,
  type RunAsked,
  type RunsThrough,
} from './bindings.js';
import { createConnectorClient } from './connector.js';
import {
  answerDataset,
  datasetOf,
  datasetProblems,
  readRows,
  type ReadSource,
} from './dataset-source.js';
import { failureView, failureViewFor, type FailureIn } from './failure-words.js';
import {
  asWritten,
  fetchRefused,
  mayRunFetch,
  maySqlWith,
  requireSqlPermitted,
} from './sql-access.js';
import { languageOf } from '../listing.js';

/** Where the connector answers, the key the service presents, and, in a test, a fetch of its own. */
export interface ConnectorOptions {
  readonly url: string;
  readonly key: string;
  readonly fetch?: typeof globalThis.fetch;
  /** How long a run waits for a slot before it is `query_throttled`; the product's unless a test says. */
  readonly waitMs?: number;
}

/** A sealed credential a request is made with, and its row's number, which a test records. */
interface Usable {
  readonly sealed: string;
  readonly credentialId: string;
}

/** A test's deadline, its connect timeout within it (the D1 plan, D1-R). */
const TEST_DEADLINE_MS = 10_000;
/** A describe's deadline. */
const DESCRIBE_DEADLINE_MS = 20_000;

/**
 * How long a sample of an HTTP request or an object for its columns may take: its body is read
 * whole, at most JSON Lines' 12 MiB, so the time of a run at the default limit, rather than a
 * describe's.
 */
const HTTP_SAMPLE_DEADLINE_MS = 30_000;

/**
 * The problems of an HTTP request or an object a describe is sent to sample (the D6 plan, D6-E and
 * task 2): its template's or its key's rules against its parameters, as a definition's, so the
 * connector never meets one it refuses.
 */
function sampleProblems(
  sampled: NonNullable<DescribeBody['http']> | NonNullable<DescribeBody['file']>,
): DefinitionProblem[] {
  const http = 'request' in sampled;
  return checkQueryDefinition(
    sampleDraft(
      sampled.parameters,
      http
        ? { kind: 'http', request: sampled.request, format: sampled.format }
        : { kind: 'file', key: sampled.key, format: sampled.format },
    ),
  ).map((problem) => ({
    ...problem,
    path: problem.path
      .replace(/^fetch\.request/, 'http.request')
      .replace(/^fetch\.key/, 'file.key'),
  }));
}

/** The failures a test is recorded with (the stored-shape check, row 13). */
const TEST_FAILURES: readonly ConnectionTestFailure[] = [
  'connection_failed',
  'timeout',
  'connector_error',
  'source_unsupported',
];

/**
 * A data act refused by a data failure: its code, its words, whose failure it is (DAT-049), and the
 * column, the row and what the source said where it names them - the source's message only where the
 * caller `seesSource`, holding `write_sql` (D2-H), and a built query's refusals in the product's words
 * (D4-K).
 */
function dataRefused(
  status: number,
  failed: FailureIn | DataFailureCode,
  seesSource = true,
  built = false,
): AppError {
  const { code, message, ...members } =
    typeof failed === 'string' ? failureView(failed) : failureViewFor(failed, seesSource, built);
  return new AppError(status, code, message, undefined, members);
}

/**
 * A describe's failure by where it arose (D1-Q, D2-G): the source's side and the connector's are 502,
 * a deadline passed 504, and a statement the source refused or one with no columns is the author's to
 * fix, 400.
 */
function describedStatus(failure: FailureIn): number {
  if (failure.code === 'timeout') return 504;
  return dataFailures[failure.code] === 'query' ? 400 : 502;
}

/** The definitions naming a connection, as the API answers them (D2-O). */
function namingView(naming: NamingDefinitions) {
  return { readable: naming.readable.map((each) => ({ ...each })), others: naming.others };
}

/** A definition refused by its rules, each problem named (the D2 plan's stored-shape check). */
function definitionRefused(problems: readonly DefinitionProblem[]): AppError {
  return refused(400, 'definition.invalid', 'The query definition is not valid.', { problems });
}

/**
 * The problems of a statement a describe is sent (D2-G): it lexes whole, declares each parameter once,
 * and each marker names a declared parameter of its kind. The connector refuses anything else at its
 * door, which would read as a connector that failed rather than SQL that did.
 */
function statementProblems(sql: {
  readonly text: string;
  readonly parameters: readonly Parameter[];
}): DefinitionProblem[] {
  const problem = (path: string, message: string): DefinitionProblem => ({
    rule: 'definition_invalid',
    path,
    message,
  });
  const lexed = lexPostgres(sql.text);
  if (!Array.isArray(lexed)) return [problem('sql.text', `${lexed.problem} (line ${lexed.line})`)];
  const byName = new Map(sql.parameters.map((parameter) => [parameter.name, parameter]));
  if (byName.size !== sql.parameters.length) {
    return [problem('sql.parameters', 'A parameter is declared once')];
  }
  const problems: DefinitionProblem[] = [];
  for (const piece of lexed) {
    if (piece.kind === 'text') continue;
    const parameter = byName.get(piece.name);
    if (!parameter) {
      problems.push(
        problem('sql.text', `The marker for ${piece.name} names no declared parameter`),
      );
    } else if ((piece.kind === 'variation') !== (parameter.variation !== undefined)) {
      problems.push(
        problem(
          'sql.text',
          `The marker for ${piece.name} is not of the kind its parameter declares`,
        ),
      );
    }
  }
  return problems;
}

/**
 * The problems of a built query a describe is sent (D4-Q): each parameter declared once, the
 * builder's checks of its tree (but those that need its declared columns), and its shape statement
 * generated whole and within what a run reports it ran. The connector refuses anything else at its
 * door, which would read as a connector that failed rather than a query that did.
 */
function builtProblems(builder: {
  readonly query: Query;
  readonly parameters: readonly Parameter[];
}): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];
  const problem = (path: string, message: string) => {
    problems.push({
      rule: 'definition_invalid',
      path: path
        .replace(/^fetch\.query/, 'builder.query')
        .replace(/^parameters/, 'builder.parameters'),
      message,
    });
  };
  const names = new Set(builder.parameters.map((parameter) => parameter.name));
  if (names.size !== builder.parameters.length)
    problem('parameters', 'A parameter is declared once');
  checkTree(builder.query, builder.parameters, problem);
  if (problems.length > 0) return problems;
  try {
    const shape = bindFetch(
      {
        parameters: [...builder.parameters],
        fetch: { kind: 'builder', format: 1, query: builder.query },
        columns: [],
        order: 'multiset',
      },
      {},
      'shape',
    );
    if (shape.text.length > RAN_MAX_CHARACTERS) {
      problem(
        'fetch.query',
        `The query generates SQL longer than ${RAN_MAX_CHARACTERS} characters`,
      );
    }
  } catch (error) {
    if (!(error instanceof BindingRefused)) throw error;
    problem('fetch.query', 'The query cannot be generated whole');
  }
  return problems;
}

/**
 * An extension's connection held to the manifest its snapshot names (the EX plan, EX-D): one the
 * extension has had, by its digest; its endpoint, whether it takes a secret and its capabilities that
 * manifest's; its settings the fields it asks for, each of its type. A removed extension's takes only a
 * retirement. Every problem, or none for any other type.
 */
async function extensionSnapshotProblems(
  trx: TenantTransaction,
  value: unknown,
): Promise<ConnectionProblem[]> {
  const parsed = connectionSettingsSchema.safeParse(value);
  if (!parsed.success || parsed.data.type !== 'extension') return [];
  const { source, retired } = parsed.data;
  const problem = (path: string, message: string): ConnectionProblem => ({
    rule: 'connection_invalid',
    path: `source.${path}`,
    message,
  });
  const held = await extensionAtDigest(trx, source.extension, source.digest);
  if (!held) return [problem('digest', 'No manifest of an installed extension has this digest')];
  if (held.removed && !retired) {
    return [problem('extension', 'This extension is removed: a connection to it may only retire')];
  }
  const { manifest } = held;
  if (manifest.kind !== 'source') {
    return [
      problem('extension', 'This extension is a reference source: a connection is to a source'),
    ];
  }
  const problems: ConnectionProblem[] = [];
  if (manifest.authentication === 'none') {
    problems.push(
      problem(
        'authenticated',
        'A connection to an extension takes a secret: this one declares none',
      ),
    );
  }
  if (source.endpoint !== manifest.endpoint) {
    problems.push(problem('endpoint', 'The endpoint is the manifest’s'));
  }
  if (!source.authenticated) {
    problems.push(problem('authenticated', 'The manifest takes a secret'));
  }
  const capabilities = manifest.capabilities;
  if (
    source.capabilities.parameters !== capabilities.parameters ||
    source.capabilities.keyColumns !== capabilities.keyColumns ||
    source.capabilities.rowLimit !== capabilities.rowLimit
  ) {
    problems.push(problem('capabilities', 'The capabilities are the manifest’s'));
  }
  for (const field of manifest.settings) {
    // Its own member alone, never one every object inherits; an empty text is no value.
    const given = Object.hasOwn(source.settings, field.key)
      ? source.settings[field.key]
      : undefined;
    if (given === undefined || (typeof given === 'string' && given.trim() === '')) {
      if (field.required)
        problems.push(problem(`settings.${field.key}`, `${field.label} is required`));
      continue;
    }
    const type = typeof given === 'string' ? 'text' : typeof given;
    if (type !== field.type) {
      problems.push(problem(`settings.${field.key}`, `${field.label} is ${field.type}`));
    }
  }
  for (const key of Object.keys(source.settings)) {
    if (!manifest.settings.some((field) => field.key === key)) {
      problems.push(problem(`settings.${key}`, 'The manifest asks for no such setting'));
    }
  }
  return problems;
}

/** Settings refused by rule, with every problem (DAT-001, DAT-078). */
function settingsRefused(problems: readonly ConnectionProblem[]): AppError {
  const identity = problems.some((problem) => problem.rule === 'identity_not_supported');
  return identity
    ? refused(
        400,
        'identity.not_supported',
        "This connection's type does not support that identity.",
        { problems },
      )
    : refused(400, 'connection.invalid', "This connection's settings are not valid.", {
        problems,
      });
}

/** The connection as the routes answer it: never its credential, only whether one is set. */
async function connectionView(
  trx: TenantTransaction,
  connection: StoredConnection,
  facts: AccessFacts,
): Promise<ConnectionView> {
  const credential = await credentialOf(trx, connection.id);
  const last = await latestConnectionTest(trx, connection.id);
  return {
    id: connection.id,
    space: connection.space,
    version: versionView(connection.version),
    settings: connection.settings,
    credential: credential.set
      ? {
          set: true,
          setBy: credential.setBy,
          setAt: credential.setAt.toISOString(),
          targetChanged: credential.targetChanged,
          setBeforeBinding: credential.setBeforeBinding,
        }
      : { set: false },
    lastTest: last
      ? {
          outcome: last.outcome,
          findings: [...last.findings],
          ...(last.failure === null ? {} : { failure: failureView(last.failure) }),
          at: last.at.toISOString(),
          by: last.by,
          version: last.version,
          credentialCurrent: last.credentialCurrent,
        }
      : null,
    mayAdminister: administerOrAbove(facts).allowed,
    mayUse: decide('use_connection', facts).allowed,
  };
}

/**
 * The connection routes (data.md, "Routes"; the D1 plan, task 5): the only callers of the connector,
 * and each only on a person's request (DAT-089). Without a connector every act that needs one is
 * refused `connector_unavailable` before anything is asked or recorded.
 */
export function connectionHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
  connector?: ConnectorOptions,
  objects?: ObjectStores,
  events?: TenantListener,
) {
  const client = connector ? createConnectorClient(connector) : undefined;

  /**
   * Does `work` - asking the connector - while the caller's session or token is watched (IAM-082, the
   * D7 plan's D7-I): signed out or revoked meanwhile, `work`'s signal aborts, which closes every
   * request it has open, and the act answers `authority_ended`, its reason logged, recording nothing.
   * `work` throws its signal's reason before it records anything once its signal has aborted, and
   * what it answered whole stands.
   */
  async function whileHeld<T>(
    request: FastifyRequest,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const authority = watchAuthority({
      db,
      tenant: tenantOf(request),
      credential: request.credential,
      events,
    });
    try {
      return await work(authority.signal);
    } catch (error) {
      if (authority.ended() === undefined) throw error;
      const { reason } = authority.signal.reason as AuthorityEnded;
      request.log.info({ reason }, 'an act was stopped: the authority it ran by ended');
      throw authorityEnded(reason);
    } finally {
      authority.stop();
    }
  }

  /** The connection a route names, refused where it cannot run: absent, or retired. */
  async function runnable(trx: TenantTransaction, id: string): Promise<StoredConnection> {
    const connection = await readConnection(trx, id);
    if (!connection) throw notFound();
    if (connection.settings.retired) {
      throw refused(409, 'connection.retired', 'This connection is retired, so it runs nothing.');
    }
    return connection;
  }

  /**
   * The sealed credential a request is made with: refused where none is set, or where the one set was
   * set for a host, port, database, account or TLS the connection no longer has (the D1 fix, C3).
   */
  async function usableSealed(trx: TenantTransaction, id: string): Promise<Usable> {
    const credential = await usableCredentialOf(trx, id);
    if (credential.answer === 'usable') {
      return { sealed: credential.sealed, credentialId: credential.credentialId };
    }
    if (credential.answer === 'missing') {
      throw refused(409, 'credential.missing', 'This connection has no credential set yet.');
    }
    if (credential.answer === 'unbound') {
      throw refused(
        409,
        'credential.target_changed',
        "This connection's password was set before this version of the product. Set the password " +
          'again to use it.',
      );
    }
    throw refused(
      409,
      'credential.target_changed',
      "This connection's host, port, database, account or TLS changed after its password was " +
        'set. Set the password again to use it.',
    );
  }

  function connected() {
    if (!client) throw dataRefused(503, 'connector_unavailable');
    return client;
  }

  const waitMs = connector?.waitMs ?? runsAtOnce.waitMs;

  /**
   * **The one door every run passes** (DAT-071, DAT-053; the R18 plan): a slot of the tenant's runs at
   * once, waited for up to `waitMs` and then `query_throttled`, leased for the run's deadline and the
   * client's slack; the run; and its record - which act, who, the connection, the query definition, the
   * document, its time, rows, bytes and outcome - written as the slot is given back. Outside any
   * transaction, as every run is.
   */
  function metered(request: FastifyRequest, act: QueryAct, document: string | null) {
    const tenant = tenantOf(request);
    const principal = principalOf(request).principalId;
    return async (
      asked: RunRequest,
      signal: AbortSignal,
      queryDefinition: string | null,
    ): Promise<RunAsked> => {
      const asking = connected();
      const leaseMs = asked.deadlineMs + 3_000;
      const waiting = Date.now();
      let slot: string | undefined;
      for (;;) {
        slot = await db.withTenant(tenant, (trx) => takeQuerySlot(trx, { leaseMs }));
        const waited = Date.now() - waiting;
        if (slot !== undefined || waited >= waitMs || signal.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(200, waitMs - waited)));
      }
      // The slot given back and the run recorded, apart: a record that fails costs the record, never
      // the run's answer, and the slot is given back whatever (the final review). A run whose caller's
      // authority ended records nothing (IAM-082), as its act does.
      const record = async (
        run: Omit<QueryRun, 'act' | 'principal' | 'connection' | 'queryDefinition' | 'document'>,
      ) => {
        try {
          if (slot !== undefined) {
            const given = slot;
            await db.withTenant(tenant, (trx) => giveQuerySlot(trx, given));
          }
        } catch (error) {
          request.log.warn({ err: error }, 'a query slot was not given back; its lease frees it');
        }
        if (signal.aborted) return;
        try {
          await db.withTenant(tenant, (trx) =>
            recordQueryRun(trx, {
              act,
              principal,
              connection: asked.connection.id,
              queryDefinition,
              document,
              ...run,
            }),
          );
        } catch (error) {
          request.log.warn({ err: error }, 'a query run was not recorded');
        }
      };
      if (slot === undefined) {
        await record({
          durationMs: Date.now() - waiting,
          rows: null,
          bytes: null,
          outcome: 'throttled',
          failure: 'query_throttled',
        });
        return { refused: { code: 'query_throttled' } };
      }
      const began = Date.now();
      let answered: RunAsked | undefined;
      try {
        answered = await asking.run(asked, signal);
        return answered;
      } finally {
        const ran = answered !== undefined && 'answer' in answered ? answered.answer : undefined;
        await record({
          durationMs: Date.now() - began,
          rows: ran?.outcome === 'ok' ? ran.rowCount : null,
          bytes:
            ran?.outcome === 'ok'
              ? Buffer.byteLength(canonicalResultBytes(ran.result), 'utf8')
              : null,
          outcome: ran?.outcome === 'ok' ? 'ran' : 'failed',
          failure:
            ran === undefined
              ? answered !== undefined && 'refused' in answered
                ? answered.refused.code
                : 'connector_unavailable'
              : ran.outcome === 'failed'
                ? ran.failure.code
                : null,
        });
      }
    };
  }

  /**
   * What a resolve and a check run through: this connector, these routes' own refusals, who the
   * caller runs as on a connection, and the watch on their authority.
   */
  /**
   * A stored result's query, run here (DAT-094; R21-A): its rows read from the tenant's store by their
   * checksum, the tree evaluated over them, and the run recorded as any is (DAT-053) - on no connection,
   * so taking no slot of the tenant's runs at once, which meter the connector.
   */
  function datasetRun(request: FastifyRequest, act: QueryAct, document: string | null) {
    const tenant = tenantOf(request);
    const principal = principalOf(request).principalId;
    return async (
      source: ReadSource,
      draft: DraftDefinition,
      values: ParameterValues,
      limits: Limits,
      queryDefinition: string | null,
    ): Promise<RunAsked> => {
      const began = Date.now();
      if (!objects) return { refused: { code: 'connector_unavailable' } };
      const store = await db.withTenant(tenant, (trx) => objects.forTenant(trx, tenant));
      const rows = await readRows(tenant, store, source);
      const answer: RunAnswer = rows
        ? answerDataset(draft, values, limits, source, rows, began)
        : { outcome: 'failed', failure: dataFailure('connector_error') };
      try {
        await db.withTenant(tenant, (trx) =>
          recordQueryRun(trx, {
            act,
            principal,
            connection: null,
            queryDefinition,
            document,
            durationMs: Date.now() - began,
            rows: answer.outcome === 'ok' ? answer.rowCount : null,
            bytes:
              answer.outcome === 'ok'
                ? Buffer.byteLength(canonicalResultBytes(answer.result), 'utf8')
                : null,
            outcome: answer.outcome === 'ok' ? 'ran' : 'failed',
            failure: answer.outcome === 'ok' ? null : answer.failure.code,
          }),
        );
      } catch (error) {
        request.log.warn({ err: error }, 'a query run was not recorded');
      }
      return { answer };
    };
  }

  function runsThrough(
    request: FastifyRequest,
    act: QueryAct,
    document: string | null,
  ): RunsThrough {
    connected();
    return {
      run: metered(request, act, document),
      runDataset: datasetRun(request, act, document),
      // Asked of the connector alone: no run, so no slot and no run recorded (FR-D).
      revision: async (asked, signal) => {
        const answered = await connected().revision(asked, signal);
        return 'answer' in answered ? answered.answer : undefined;
      },
      runnable,
      usableSealed,
      acting: (trx, connection) => actingOn(trx, request, connection),
      whileHeld: (work) => whileHeld(request, work),
    };
  }

  function answered<T>(
    answer: { readonly answer: T } | { readonly refused: { readonly code: DataFailureCode } },
  ): T {
    if ('refused' in answer) throw dataRefused(503, answer.refused.code);
    return answer.answer;
  }

  /**
   * Asks the connector to test a connection with a sealed credential, outside any transaction, and
   * records what it answered in a short transaction of its own, against the version it tested (D1-N;
   * the D1 fix, C4) - even where a newer version was cut while the source was answering, since the
   * row says which version it tested and that test is still true of it; the connection's read then
   * says the latest version is untested. A connector that is full or unavailable answered nothing,
   * so nothing is recorded.
   */
  async function test(
    tenant: Tenant,
    connection: StoredConnection,
    { sealed, credentialId }: Usable,
    by: string,
    context: AuditContext | undefined,
    signal?: AbortSignal,
  ): Promise<TestView> {
    // As the account, always: a test checks the account (D7-G).
    const answer = await connected().test(
      {
        requestId: randomUUID(),
        tenant: tenant.id,
        connection: { id: connection.id, version: connection.version.id },
        settings: connection.settings,
        sealed,
        deadlineMs: TEST_DEADLINE_MS,
      },
      signal,
    );
    if (signal?.aborted) throw signal.reason;
    const tested: TestAnswer = answered(answer);
    if (tested.outcome === 'failed' && !TEST_FAILURES.includes(tested.failure.code as never)) {
      // A failure a test cannot give is not an answer this service can record.
      throw dataRefused(503, 'connector_unavailable');
    }
    // As whoever asked for it: its event is theirs (DAT-007; the AU1 plan, AU1-K).
    const recordedAt = await db.withTenant(
      tenant,
      (trx) =>
        recordConnectionTest(trx, {
          connectionId: connection.id,
          versionId: connection.version.id,
          credentialId,
          by,
          ...(tested.outcome === 'ok'
            ? { outcome: 'ok', findings: tested.findings, failure: null }
            : {
                outcome: 'failed',
                findings: [],
                failure: tested.failure.code as ConnectionTestFailure,
              }),
        }),
      context,
    );
    const at = recordedAt.toISOString();
    return tested.outcome === 'ok'
      ? { outcome: 'ok', findings: tested.findings, at }
      : { outcome: 'failed', failure: failureView(tested.failure.code), at };
  }

  function refusedConnection(
    answer: Exclude<ConnectionAnswer, { connection: StoredConnection }>,
    trx: TenantTransaction,
    facts: AccessFacts,
  ): Promise<never> {
    switch (answer.answer) {
      case 'connection.refused':
        throw settingsRefused(answer.problems);
      case 'version.precondition':
        return connectionView(trx, answer.current, facts).then((current) => {
          throw refused(
            409,
            'version.precondition',
            'This connection has a newer version than the one this page opened.',
            { current },
          );
        });
      case 'connection.in_use':
        // A query definition in service still names it (DAT-065): those the caller may read, by
        // title, and the rest counted.
        throw refused(
          409,
          'connection.in_use',
          'This connection is used by a query definition that is not retired.',
          { definitions: answer.definitions },
        );
      case 'space.missing':
      case 'connection.missing':
        throw notFound();
    }
  }

  return {
    listConnections: async (request: FastifyRequest) => {
      const query = request.query as ConnectionListQuery;
      const asked = pageAsked('connections', query, languageOf(request));
      const listed = await db.withTenant(tenantOf(request), (trx) =>
        listReadableConnections(
          trx,
          principalOf(request).principalId,
          asked,
          query.spaces === undefined ? {} : { spaces: query.spaces.split(',') },
        ),
      );
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map((item) => ({
          id: item.id,
          name: item.name,
          space: item.space,
          type: item.type,
          retired: item.retired,
          version: {
            id: item.version.id,
            number: `${item.version.revision}.${item.version.version}`,
          },
          credentialSet: item.credentialSet,
          lastTest: item.lastTest && {
            outcome: item.lastTest.outcome,
            at: item.lastTest.at.toISOString(),
            version: item.lastTest.version,
            credentialCurrent: item.lastTest.credentialCurrent,
          },
          changedAt: item.changedAt.toISOString(),
        })),
        next: cursorFor(
          'connections',
          asked.sort,
          asked.order,
          listed.snapshot,
          listed.next,
          asked.language,
        ),
        total: listed.total,
        facets: { spaces: listed.facets.spaces.map((each) => ({ ...each })) },
      };
    },

    createConnection: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const body = request.body as CreateConnectionBody;
      const unsnapped = await extensionSnapshotProblems(trx, body.settings);
      if (unsnapped.length > 0) throw settingsRefused(unsnapped);
      const answer = await createConnection(trx, {
        author: principalId,
        spaceId: space,
        settings: body.settings,
      });
      if (answer.answer !== 'created') {
        return refusedConnection(
          answer as Exclude<ConnectionAnswer, { connection: StoredConnection }>,
          trx,
          facts,
        );
      }
      return connectionView(trx, answer.connection, facts);
    },

    // `authorise` never looks at an artifact's kind, so another kind's id authorises cleanly here;
    // `readConnection` answers nothing for it, and neither does this.
    getConnection: async (request: FastifyRequest, { trx, facts }: Authorised) => {
      const { id } = request.params as ConnectionParams;
      const connection = await readConnection(trx, id);
      if (!connection) throw notFound();
      return connectionView(trx, connection, facts);
    },

    recordConnectionVersion: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { id } = request.params as ConnectionParams;
      const body = request.body as ConnectionVersionBody;
      const unsnapped = await extensionSnapshotProblems(trx, body.settings);
      if (unsnapped.length > 0) throw settingsRefused(unsnapped);
      const answer = await recordConnectionVersion(trx, {
        author: principalId,
        id,
        openedFrom: body.openedFrom,
        settings: body.settings,
      });
      if (answer.answer === 'recorded' || answer.answer === 'version.unchanged') {
        return connectionView(trx, answer.connection, facts);
      }
      return refusedConnection(
        answer as Exclude<ConnectionAnswer, { connection: StoredConnection }>,
        trx,
        facts,
      );
    },

    setConnectionCredential: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as ConnectionParams;
      const connection = await runnable(trx, id);
      const body = request.body as CredentialBody;
      // An S3 connection's credential is its key pair, sealed together; any other's is one secret.
      if ((body.secret !== undefined) !== (connection.settings.type !== 's3')) {
        throw new AppError(
          400,
          'invalid_request',
          connection.settings.type === 's3'
            ? "An S3 connection's credential is its access key id and its secret access key."
            : "This connection's credential is one secret.",
        );
      }
      const secret =
        body.secret ??
        keyPairText({ accessKeyId: body.accessKeyId!, secretAccessKey: body.secretAccessKey! });
      // An HTTP connection's secret is sent as a header's value, so it is one a header carries (D6-D).
      // An extension's is sent as a bearer, a header's value too (the EX plan, EX-H).
      if (
        (connection.settings.type === 'http' || connection.settings.type === 'extension') &&
        headerValueProblem(secret) !== undefined
      ) {
        throw new AppError(
          400,
          'invalid_request',
          'A secret sent in a header is printable ASCII, with no space before or after it.',
        );
      }
      // Sealed by the connector with a key the service never holds; the service keeps only what
      // comes back, and no record of the request is kept (D1-S). Sealed for where this version signs
      // in, and stored beside that target's digest: a later version pointing anywhere else leaves it
      // unusable (the D1 fix, C3). Sealing reaches no source, so it is done in the deciding
      // transaction, with the write it answers; only the test waits for a source, after the commit.
      const { sealed } = answered(
        await connected().seal(tenantOf(request).id, connection.id, secret, connection.settings),
      );
      const set = await setConnectionCredential(trx, {
        id,
        sealed,
        by: principalId,
        sealedFor: connection.settings,
      });
      if (set.answer !== 'set') {
        if (set.answer === 'connection.missing') throw notFound();
        throw refused(409, 'connection.retired', 'This connection is retired, so it runs nothing.');
      }
      const credential = {
        set: true as const,
        setBy: { id: set.credential.setBy.id, name: set.credential.setBy.name },
        setAt: set.credential.setAt.toISOString(),
        targetChanged: set.credential.targetChanged,
        setBeforeBinding: set.credential.setBeforeBinding,
      };
      const tenant = tenantOf(request);
      // Where the test fails, every definition naming the connection is named with it, once (DAT-066;
      // D2-O): read here, with the caller's readable set, and answered only for a failure.
      const dependents = namingView(await definitionsNaming(trx, principalId, id));
      // Tested straight after, as the rotation act (DA-T), once the credential is committed. A
      // connector that could seal and then not test answers the test's failure without recording it.
      return new AfterCommit(async () => {
        let tested: TestView;
        try {
          tested = await whileHeld(request, (signal) =>
            test(
              tenant,
              connection,
              { sealed, credentialId: set.credentialId },
              principalId,
              contextOf(request),
              signal,
            ),
          );
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          if (error.code === 'authority_ended') {
            // The credential is set whatever stopped its test: said as the test's failure (the
            // review, 2026-10-06), never as a refusal of what was saved.
            tested = {
              outcome: 'failed',
              failure: { code: error.code, attribution: 'product', message: error.message },
              at: new Date().toISOString(),
            };
          } else {
            if (error.status !== 503) throw error;
            tested = {
              outcome: 'failed',
              failure: failureView(error.code as DataFailureCode),
              at: new Date().toISOString(),
            };
          }
        }
        return tested.outcome === 'failed'
          ? { credential, test: tested, dependents }
          : { credential, test: tested };
      });
    },

    testConnection: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as ConnectionParams;
      const connection = await runnable(trx, id);
      const usable = await usableSealed(trx, id);
      connected();
      const tenant = tenantOf(request);
      // Decided and read here; the connector is asked once this transaction, and its lock on access,
      // is let go (the D1 fix, C4).
      return new AfterCommit(() =>
        whileHeld(request, (signal) =>
          test(tenant, connection, usable, principalId, contextOf(request), signal),
        ),
      );
    },

    describeConnection: async (request: FastifyRequest, { trx, facts }: Authorised) => {
      const { id } = request.params as ConnectionParams;
      const { sql, builder, http, file, extension } = request.body as DescribeBody;
      if ([sql, builder, http, file, extension].filter((each) => each !== undefined).length > 1) {
        throw definitionRefused([
          {
            rule: 'definition_invalid',
            path: file !== undefined ? 'file' : http === undefined ? 'builder' : 'http',
            message: 'A describe is sent SQL, a built query, an HTTP request or a file, one alone',
          },
        ]);
      }
      // A statement is SQL against the connection: write_sql there as well as use_connection (D2-G).
      // A built query, an HTTP request and a file need use_connection alone, the route's own (D4-J,
      // D6-A).
      if (sql !== undefined && !maySqlWith(facts)) throw fetchRefused(facts, { kind: 'sql' }, id);
      const connection = await runnable(trx, id);
      // What is described suits the connection's type; neither HTTP nor S3 lists tables (D6-A).
      const asked =
        extension !== undefined
          ? { kind: 'extension' as const, request: extension.request }
          : file !== undefined
            ? { kind: 'file' as const, key: file.key, format: file.format }
            : http !== undefined
              ? { kind: 'http' as const, request: http.request, format: http.format }
              : sql !== undefined
                ? { kind: 'sql' as const, text: sql.text }
                : builder !== undefined
                  ? { kind: 'builder' as const, format: 1 as const, query: builder.query }
                  : undefined;
      if (asked === undefined && connection.settings.type !== 'postgres') {
        throw dataRefused(409, 'describe_not_supported');
      }
      if (asked !== undefined) {
        const unsuited = connectionFetchProblems(asked, connection.settings);
        if (unsuited.length > 0) throw definitionRefused(unsuited);
      }
      // An extension's request is its own: only its values are held to their declarations (EX-G).
      if (extension !== undefined) {
        const problems = [
          ...capabilityProblems(extension, connection.settings),
          ...checkParameterValues(extension.parameters, extension.values as ParameterValues),
        ];
        if (problems.length > 0) {
          throw refused(400, 'parameter.invalid', 'A value does not fit its parameter.', {
            attribution: 'product',
            problems,
          });
        }
      }
      const sampled = http ?? file;
      if (sampled !== undefined) {
        const problems = sampleProblems(sampled);
        if (problems.length > 0) throw definitionRefused(problems);
        const values = sampled.values as ParameterValues;
        const typed = checkParameterValues(sampled.parameters, values);
        const invalid = [
          ...typed,
          ...(typed.length > 0
            ? []
            : 'request' in sampled
              ? httpValueProblems(sampled.request, values)
              : objectKeyProblems(sampled.key, values)),
        ];
        if (invalid.length > 0) {
          throw refused(400, 'parameter.invalid', 'A value does not fit its parameter.', {
            attribution: 'product',
            problems: invalid,
          });
        }
      }
      if (sql !== undefined) {
        const problems = statementProblems(sql);
        if (problems.length > 0) throw definitionRefused(problems);
        await requireSqlPermitted(trx, connection, { kind: 'sql' });
      }
      if (builder !== undefined) {
        const problems = builtProblems(builder);
        if (problems.length > 0) throw definitionRefused(problems);
      }
      // What the source said of a statement it refused only to a holder of write_sql (D2-H).
      const seesSource = decide('write_sql', facts).allowed;
      const { sealed } = await usableSealed(trx, id);
      const client = connected();
      const tenant = tenantOf(request);
      // As the caller, on a connection asserting identity (D7-G): as the account it lists nothing.
      const acting = await actingOn(trx, request, connection);
      const describing = {
        requestId: randomUUID(),
        tenant: tenant.id,
        connection: { id: connection.id, version: connection.version.id },
        settings: connection.settings,
        sealed,
        deadlineMs: DESCRIBE_DEADLINE_MS,
        ...runIdentity(acting),
      };
      // Decided and read here; the connector is asked once this transaction, and its lock on access,
      // is let go (the D1 fix, C4). A describe records nothing.
      if (extension !== undefined) {
        const values = extension.values as Record<string, string>;
        return new AfterCommit(() =>
          whileHeld(request, async (signal) => {
            const described = answered(
              await client.describeSql(
                {
                  ...describing,
                  deadlineMs: HTTP_SAMPLE_DEADLINE_MS,
                  extension: { ...extension, values },
                },
                signal,
              ),
            );
            if ('failure' in described)
              throw dataRefused(describedStatus(described.failure), described.failure);
            return described;
          }),
        );
      }
      if (sampled !== undefined) {
        // An HTTP request is sent, or an object read, to sample its columns, as the account: no
        // person runs either (ADR-0041; an S3 connection declares no person, DAT-077).
        const values = sampled.values as Record<string, string>;
        return new AfterCommit(() =>
          whileHeld(request, async (signal) => {
            const described = answered(
              await client.describeSql(
                {
                  ...describing,
                  deadlineMs: HTTP_SAMPLE_DEADLINE_MS,
                  ...(http !== undefined
                    ? { http: { ...http, values } }
                    : { file: { ...file!, values } }),
                },
                signal,
              ),
            );
            if ('failure' in described)
              throw dataRefused(describedStatus(described.failure), described.failure);
            return described;
          }),
        );
      }
      if (sql !== undefined) {
        return new AfterCommit(() =>
          whileHeld(request, async (signal) => {
            const described = answered(await client.describeSql({ ...describing, sql }, signal));
            if ('failure' in described)
              throw dataRefused(describedStatus(described.failure), described.failure);
            return described;
          }),
        );
      }
      if (builder !== undefined) {
        return new AfterCommit(() =>
          whileHeld(request, async (signal) => {
            const described = answered(
              await client.describeSql({ ...describing, builder }, signal),
            );
            if ('failure' in described) {
              throw dataRefused(
                describedStatus(described.failure),
                described.failure,
                seesSource,
                true,
              );
            }
            return described;
          }),
        );
      }
      return new AfterCommit(() =>
        whileHeld(request, async (signal) => {
          const described = answered(await client.describe(describing, signal));
          if ('failure' in described) {
            throw dataRefused(describedStatus(described.failure), described.failure);
          }
          return described;
        }),
      );
    },

    /** The stored results the caller may read, to query as sources (DAT-094; R21-A). */
    listDatasetSources: async (request: FastifyRequest): Promise<DatasetSourceList> => {
      const asked = pageAsked('datasets', request.query as DatasetSourceQuery, languageOf(request));
      const listed = await db.withTenant(tenantOf(request), (trx) =>
        listDatasetSources(trx, principalOf(request).principalId, asked),
      );
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map((each) => ({
          id: each.id,
          name: each.name,
          definition: each.definition && { ...each.definition },
          latest: { ...each.latest, at: each.latest.at.toISOString() },
          columns: each.columns.map((column) => ({ ...column })),
        })),
        next: cursorFor(
          'datasets',
          asked.sort,
          asked.order,
          listed.snapshot,
          listed.next,
          asked.language,
        ),
      };
    },

    /**
     * A draft query over a stored result, run here against sample values, storing nothing (DAT-094;
     * R21-A): `read` on the dataset is the route's; the draft's tree is held to the result's columns,
     * evaluated once this transaction commits, and recorded as a run on no connection.
     */
    sampleDataset: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as DatasetParams;
      const body = request.body as SampleBody;
      let draft: DraftDefinition;
      try {
        draft = parseDraftDefinition(body.definition);
      } catch (error) {
        if (error instanceof DefinitionRefused) throw definitionRefused(error.problems);
        throw error;
      }
      if (draft.fetch.kind !== 'dataset' || draft.fetch.dataset !== id) {
        throw definitionRefused([
          {
            rule: 'definition_invalid',
            path: 'fetch',
            message: 'A sample runs a query over the stored result it is sent to',
          },
        ]);
      }
      const source = await datasetOf(trx, draft.fetch);
      if (!source) throw notFound();
      const wrong = datasetProblems(draft, source);
      if (wrong.length > 0) throw definitionRefused(wrong);
      const values = body.values as ParameterValues;
      const problems = checkParameterValues(draft.parameters, values);
      if (problems.length > 0) {
        throw refused(400, 'parameter.invalid', 'A value does not fit its parameter.', {
          attribution: 'product',
          problems,
        });
      }
      const limits = effectiveLimits(draft.limits, await dataPolicy(trx));
      const run = datasetRun(request, 'sample', null);
      return new AfterCommit(async (): Promise<SampleView> => {
        const ran = answered(await run(source, draft, values, limits, null));
        if (ran.outcome === 'failed') {
          return { outcome: 'failed', failure: failureViewFor(ran.failure, true, true) };
        }
        return {
          outcome: 'ok',
          columns: ran.result.columns.map(([name, base]) => [name, base] as [string, string]),
          rows: ran.result.rows.slice(0, SAMPLE_ROWS).map((row) => [...row]),
          rowCount: ran.rowCount,
          checksum: ran.checksum,
          ran: ran.ran,
          durationMs: ran.durationMs,
          images: {},
        };
      });
    },

    sampleConnection: async (request: FastifyRequest, { trx, facts }: Authorised) => {
      const { id } = request.params as ConnectionParams;
      const body = request.body as SampleBody;
      // use_connection is the route's; a sample of SQL runs SQL, so write_sql as well, at the
      // connection (DAT-101); a built query needs no more (D4-J). The contract has held the draft's
      // fetch to its shape, so its kind is known before the draft is checked whole.
      const asFetched = asWritten(body.definition as DraftDefinition);
      if (!mayRunFetch(facts, asFetched)) throw fetchRefused(facts, asFetched, id);
      const seesSource = decide('write_sql', facts).allowed;
      const connection = await runnable(trx, id);
      let draft: DraftDefinition;
      try {
        draft = parseDraftDefinition(body.definition);
      } catch (error) {
        if (error instanceof DefinitionRefused) throw definitionRefused(error.problems);
        throw error;
      }
      if (draft.connection !== connection.id) {
        throw definitionRefused([
          {
            rule: 'definition_invalid',
            path: 'connection',
            message: 'A sample runs a definition of the connection it is sent to',
          },
        ]);
      }
      // A fetch of the connection's type, by the version it runs on (D6-A).
      const unsuited = [
        ...connectionFetchProblems(draft.fetch, connection.settings),
        ...capabilityProblems(draft, connection.settings),
      ];
      if (unsuited.length > 0) throw definitionRefused(unsuited);
      // Every value against its declaration, and an HTTP value or a key's against its position,
      // before the connector is asked (DAT-020, DAT-081).
      const values = body.values as ParameterValues;
      const typed = checkParameterValues(draft.parameters, values);
      const problems = [
        ...typed,
        ...(typed.length > 0
          ? []
          : draft.fetch.kind === 'http'
            ? httpValueProblems(draft.fetch.request, values)
            : draft.fetch.kind === 'file'
              ? objectKeyProblems(draft.fetch.key, values)
              : []),
      ];
      if (problems.length > 0) {
        throw refused(400, 'parameter.invalid', 'A value does not fit its parameter.', {
          attribution: 'product',
          problems,
        });
      }
      await requireSqlPermitted(trx, connection, asWritten(draft));
      const built = draft.fetch.kind === 'builder';
      const { sealed } = await usableSealed(trx, id);
      connected();
      const run = metered(request, 'sample', null);
      const tenant = tenantOf(request);
      // The least of the definition's limits and the tenant's (DAT-050), and a deadline of the time.
      const limits = effectiveLimits(draft.limits, await dataPolicy(trx));
      // As the caller, on a connection asserting identity (D7-G).
      const acting = await actingOn(trx, request, connection);
      // Decided and read here; the connector is asked once this transaction commits (the D1 fix, C4).
      // Nothing of a sample is stored (D2-I).
      return new AfterCommit(() =>
        whileHeld(request, async (signal): Promise<SampleView> => {
          const ran = answered(
            await run(
              {
                requestId: randomUUID(),
                tenant: tenant.id,
                connection: { id: connection.id, version: connection.version.id },
                settings: connection.settings,
                sealed,
                definition: draft,
                values: body.values,
                limits,
                deadlineMs: limits.seconds * 1000,
                ...runIdentity(acting),
              },
              signal,
              // A sample runs a draft, saved or not: its definition is none (R18-D).
              null,
            ),
          );
          if (signal.aborted) throw signal.reason;
          if (ran.outcome === 'failed') {
            return { outcome: 'failed', failure: failureViewFor(ran.failure, seesSource, built) };
          }
          // The checksum is the service's to hold the connector to (D2-K): the rows it answered, in
          // the canonical form, must hash to what it said.
          const checksum = createHash('sha256')
            .update(canonicalResultBytes(ran.result), 'utf8')
            .digest('hex');
          if (checksum !== ran.checksum) {
            return { outcome: 'failed', failure: failureView('connector_error') };
          }
          const rows = ran.result.rows.slice(0, SAMPLE_ROWS);
          // Each image in the rows shown, by its header alone (the D8 plan, D8-G): nothing is stored,
          // and an image that is not what its hash says is the connector's error, as a resolve's is.
          const shown = new Set<string>();
          ran.result.columns.forEach(([, base], at) => {
            if (base !== 'image') return;
            for (const row of rows) if (typeof row[at] === 'string') shown.add(row[at]);
          });
          const images: Extract<SampleView, { outcome: 'ok' }>['images'] = {};
          for (const hash of [...shown].sort()) {
            const encoded = ran.images?.[hash];
            const image = encoded === undefined ? null : Buffer.from(encoded, 'base64');
            const read = image === null ? null : readImageHeader(image);
            if (
              image === null ||
              read === null ||
              !read.ok ||
              read.header.end !== image.length ||
              createHash('sha256').update(image).digest('hex') !== hash
            ) {
              return { outcome: 'failed', failure: failureView('connector_error') };
            }
            const { format, width, height } = read.header;
            images[hash] = { format, bytes: image.length, width, height };
          }
          return {
            outcome: 'ok',
            columns: ran.result.columns.map(([name, base]) => [name, base] as [string, string]),
            rows: rows.map((row) => [...row]),
            rowCount: ran.rowCount,
            checksum,
            ran: ran.ran,
            durationMs: ran.durationMs,
            images,
          };
        }),
      );
    },

    getConnectionUses: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as ConnectionParams;
      const connection = await readConnection(trx, id);
      if (!connection) throw notFound();
      // The definitions naming it by their latest versions, the caller's readable ones by title and
      // the rest counted (D2-O), and through them the documents holding a result run on it (D3-M).
      return {
        definitions: namingView(await definitionsNaming(trx, principalId, id)),
        documents: await documentsOnConnection(trx, principalId, id),
      };
    },

    // A resolve and a check ask the connector for runs (DAT-089), each a person's act on a document
    // (data.md, "Resolve" and "Check"): decided and read in the deciding transaction, asked once it
    // commits, and recorded in a second that decides again (D3-H). `bindings.ts` holds the rest.
    resolveBindings: async (request: FastifyRequest, authorised: Authorised) => {
      const through = runsThrough(request, 'resolve', (request.params as DocumentParams).id);
      connected();
      return resolveAct(db, tenantOf(request), objects, request, authorised, through);
    },

    checkBindings: async (request: FastifyRequest, authorised: Authorised) => {
      const through = runsThrough(request, 'check', (request.params as DocumentParams).id);
      connected();
      return checkAct(db, tenantOf(request), objects, request, authorised, through);
    },

    // A document whose template's required components run queries is made after they run (the R9
    // plan, R9-E): not a route of its own, handed to `createDocument`.
    boundCreation: (request: FastifyRequest, authorised: Authorised) =>
      creationAct(db, tenantOf(request), objects, request, authorised, (document) =>
        runsThrough(request, 'creation', document),
      ),
  };
}
