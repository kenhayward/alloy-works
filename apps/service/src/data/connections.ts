import { createHash, randomUUID } from 'node:crypto';
import type {
  ConnectionListQuery,
  ConnectionParams,
  ConnectionVersionBody,
  ConnectionView,
  CreateConnectionBody,
  CredentialBody,
  DescribeBody,
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
  type TenantTransaction,
} from '@alloy-works/db';
import {
  BindingRefused,
  DefinitionRefused,
  RAN_MAX_CHARACTERS,
  bindFetch,
  canonicalResultBytes,
  checkParameterValues,
  checkTree,
  dataFailures,
  decide,
  effectiveLimits,
  lexPostgres,
  parseDraftDefinition,
  readImageHeader,
  type AccessFacts,
  type ConnectionProblem,
  type DataFailureCode,
  type DefinitionProblem,
  type DraftDefinition,
  type Parameter,
  type Query,
  type ParameterValues,
  type TestAnswer,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { administerOrAbove, notFound, type Authorised } from '../access.js';
import { versionView } from '../components.js';
import { AfterCommit } from '../after-commit.js';
import { AppError } from '../errors.js';
import { cursorFor, pageAsked } from '../listing.js';
import type { SessionPrincipal } from '../sessions.js';
import { refused } from '../wire-codes.js';
import { checkAct, documentsOnConnection, resolveAct, type RunsThrough } from './bindings.js';
import { createConnectorClient, type Answered } from './connector.js';
import { failureView, failureViewFor, type FailureIn } from './failure-words.js';
import {
  fetchForbidden,
  mayRunFetch,
  maySqlWith,
  requireSqlPermitted,
  sqlForbidden,
} from './sql-access.js';

/** Where the connector answers, the key the service presents, and, in a test, a fetch of its own. */
export interface ConnectorOptions {
  readonly url: string;
  readonly key: string;
  readonly fetch?: typeof globalThis.fetch;
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
) {
  const client = connector ? createConnectorClient(connector) : undefined;

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

  /** What a resolve and a check run through: this connector, and these routes' own refusals. */
  function runsThrough(): RunsThrough {
    const asking = connected();
    return { run: (request) => asking.run(request), runnable, usableSealed };
  }

  function answered<T>(answer: Answered<T>): T {
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
  ): Promise<TestView> {
    const answer = await connected().test({
      requestId: randomUUID(),
      tenant: tenant.id,
      connection: { id: connection.id, version: connection.version.id },
      settings: connection.settings,
      sealed,
      deadlineMs: TEST_DEADLINE_MS,
    });
    const tested: TestAnswer = answered(answer);
    if (tested.outcome === 'failed' && !TEST_FAILURES.includes(tested.failure.code as never)) {
      // A failure a test cannot give is not an answer this service can record.
      throw dataRefused(503, 'connector_unavailable');
    }
    const recordedAt = await db.withTenant(tenant, (trx) =>
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
      const asked = pageAsked('connections', query);
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
        next: cursorFor('connections', asked.sort, asked.order, listed.snapshot, listed.next),
        total: listed.total,
        facets: { spaces: listed.facets.spaces.map((each) => ({ ...each })) },
      };
    },

    createConnection: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const body = request.body as CreateConnectionBody;
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
      const { secret } = request.body as CredentialBody;
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
          tested = await test(
            tenant,
            connection,
            { sealed, credentialId: set.credentialId },
            principalId,
          );
        } catch (error) {
          if (!(error instanceof AppError) || error.status !== 503) throw error;
          tested = {
            outcome: 'failed',
            failure: failureView(error.code as DataFailureCode),
            at: new Date().toISOString(),
          };
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
      return new AfterCommit(() => test(tenant, connection, usable, principalId));
    },

    describeConnection: async (request: FastifyRequest, { trx, facts }: Authorised) => {
      const { id } = request.params as ConnectionParams;
      const { sql, builder } = request.body as DescribeBody;
      if (sql !== undefined && builder !== undefined) {
        throw definitionRefused([
          {
            rule: 'definition_invalid',
            path: 'builder',
            message: 'A describe is sent SQL or a built query, never both',
          },
        ]);
      }
      // A statement is SQL against the connection: write_sql there as well as use_connection (D2-G).
      // A built query needs use_connection alone, the route's own (D4-J).
      if (sql !== undefined && !maySqlWith(facts)) throw sqlForbidden();
      const connection = await runnable(trx, id);
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
      const asked = {
        requestId: randomUUID(),
        tenant: tenant.id,
        connection: { id: connection.id, version: connection.version.id },
        settings: connection.settings,
        sealed,
        deadlineMs: DESCRIBE_DEADLINE_MS,
      };
      // Decided and read here; the connector is asked once this transaction, and its lock on access,
      // is let go (the D1 fix, C4). A describe records nothing.
      if (sql !== undefined) {
        return new AfterCommit(async () => {
          const described = answered(await client.describeSql({ ...asked, sql }));
          if ('failure' in described)
            throw dataRefused(describedStatus(described.failure), described.failure);
          return described;
        });
      }
      if (builder !== undefined) {
        return new AfterCommit(async () => {
          const described = answered(await client.describeSql({ ...asked, builder }));
          if ('failure' in described) {
            throw dataRefused(
              describedStatus(described.failure),
              described.failure,
              seesSource,
              true,
            );
          }
          return described;
        });
      }
      return new AfterCommit(async () => {
        const described = answered(await client.describe(asked));
        if ('failure' in described) {
          throw dataRefused(describedStatus(described.failure), described.failure);
        }
        return described;
      });
    },

    sampleConnection: async (request: FastifyRequest, { trx, facts }: Authorised) => {
      const { id } = request.params as ConnectionParams;
      const body = request.body as SampleBody;
      // use_connection is the route's; a sample of SQL runs SQL, so write_sql as well, at the
      // connection (DAT-101); a built query needs no more (D4-J). The contract has held the draft's
      // fetch to its shape, so its kind is known before the draft is checked whole.
      const asFetched = (body.definition as DraftDefinition).fetch;
      if (!mayRunFetch(facts, asFetched)) throw fetchForbidden(asFetched);
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
      // Every value against its declaration, before the connector is asked (DAT-020).
      const values = body.values as ParameterValues;
      const problems = checkParameterValues(draft.parameters, values);
      if (problems.length > 0) {
        throw refused(400, 'parameter.invalid', 'A value does not fit its parameter.', {
          attribution: 'product',
          problems,
        });
      }
      await requireSqlPermitted(trx, connection, draft.fetch);
      const built = draft.fetch.kind === 'builder';
      const { sealed } = await usableSealed(trx, id);
      const client = connected();
      const tenant = tenantOf(request);
      // The least of the definition's limits and the tenant's (DAT-050), and a deadline of the time.
      const limits = effectiveLimits(draft.limits, await dataPolicy(trx));
      // Decided and read here; the connector is asked once this transaction commits (the D1 fix, C4).
      // Nothing of a sample is stored (D2-I).
      return new AfterCommit(async (): Promise<SampleView> => {
        const ran = answered(
          await client.run({
            requestId: randomUUID(),
            tenant: tenant.id,
            connection: { id: connection.id, version: connection.version.id },
            settings: connection.settings,
            sealed,
            definition: draft,
            values: body.values,
            limits,
            deadlineMs: limits.seconds * 1000,
          }),
        );
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
          ran: { sql: ran.ran.sql },
          durationMs: ran.durationMs,
          images,
        };
      });
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
      const through = runsThrough();
      connected();
      return resolveAct(db, tenantOf(request), objects, request, authorised, through);
    },

    checkBindings: async (request: FastifyRequest, authorised: Authorised) => {
      const through = runsThrough();
      connected();
      return checkAct(db, tenantOf(request), objects, request, authorised, through);
    },
  };
}
