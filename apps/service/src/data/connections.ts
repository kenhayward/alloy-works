import { randomUUID } from 'node:crypto';
import type {
  ConnectionListQuery,
  ConnectionParams,
  ConnectionVersionBody,
  ConnectionView,
  CreateConnectionBody,
  CredentialBody,
  SpaceParams,
  TestView,
} from '@alloy-works/api-contract';
import {
  createConnection,
  credentialOf,
  latestConnectionTest,
  listReadableConnections,
  readConnection,
  recordConnectionTest,
  recordConnectionVersion,
  setConnectionCredential,
  usableCredentialOf,
  type ConnectionAnswer,
  type ConnectionTestFailure,
  type StoredConnection,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  dataFailure,
  decide,
  type AccessFacts,
  type ConnectionProblem,
  type DataFailureCode,
  type TestAnswer,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { administerOrAbove, notFound, type Authorised } from '../access.js';
import { versionView } from '../components.js';
import { AfterCommit } from '../after-commit.js';
import { AppError } from '../errors.js';
import { cursorFor, pageAsked } from '../listing.js';
import type { SessionPrincipal } from '../sessions.js';
import { refused } from '../wire-codes.js';
import { createConnectorClient, type Answered } from './connector.js';

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

/** What a person is told of each failure a connection act meets: one reason, naming no address. */
const MESSAGES: Partial<Record<DataFailureCode, string>> = {
  connection_failed:
    'Could not connect to the source or sign in to it. Check its settings and its credential.',
  timeout: 'The source did not answer in time.',
  connector_error: 'The connector failed while it was working on this. Try again.',
  source_unsupported:
    'This source is older than PostgreSQL 14, which the connector cannot check. Use a newer one.',
  connector_unavailable: 'No connector is available to reach the source. Try again later.',
  connector_busy: 'The connector is busy. Try again in a moment.',
};

function failureView(code: DataFailureCode) {
  return {
    ...dataFailure(code),
    message: MESSAGES[code] ?? 'This could not be done.',
  };
}

/** A data act refused by a data failure: its code, its words, and whose failure it is (DAT-049). */
function dataRefused(status: number, code: DataFailureCode): AppError {
  const failure = failureView(code);
  return new AppError(status, code, failure.message, undefined, {
    attribution: failure.attribution,
  });
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
        return { credential, test: tested };
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

    describeConnection: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as ConnectionParams;
      const connection = await runnable(trx, id);
      const { sealed } = await usableSealed(trx, id);
      const client = connected();
      const tenant = tenantOf(request);
      // Decided and read here; the connector is asked once this transaction, and its lock on access,
      // is let go (the D1 fix, C4). A describe records nothing.
      return new AfterCommit(async () => {
        const described = answered(
          await client.describe({
            requestId: randomUUID(),
            tenant: tenant.id,
            connection: { id: connection.id, version: connection.version.id },
            settings: connection.settings,
            sealed,
            deadlineMs: DESCRIBE_DEADLINE_MS,
          }),
        );
        if ('failure' in described) {
          throw dataRefused(
            described.failure.code === 'timeout' ? 504 : 502,
            described.failure.code,
          );
        }
        return described;
      });
    },
  };
}
