import {
  BindingRefused,
  bindFetch,
  dataFailure,
  ignoresCase,
  type ChildRequest,
  type Query,
  type ConnectionSettings,
  type HttpSettings,
  type PostgresSettings,
  type S3Settings,
  limitCeilings,
  type DataFailure,
  type DataFailureCode,
  type DescribeAnswer,
  type DescribeSqlAnswer,
  type ParameterValues,
  type RunAnswer,
  type TestAnswer,
  type TestFinding,
} from '@alloy-works/domain';
import type pg from 'pg';

import {
  describedColumns,
  describeStatement,
  QUERY_CANCELED,
  sourceRefused,
  withRefusedColumn,
} from './describe.js';
import { guardedAddress, type Lookup } from './guard.js';
import { describeHttp, runHttp, testHttp, type HttpPolicy } from './http-source.js';
import {
  accountHoldsPrivilege,
  assertRole,
  cancelBackend,
  connectPostgres,
  heldAs,
  describeRelations,
  OLDEST_SERVER_VERSION,
  readOnlyFindings,
  hasRootCollation,
  serverVersion,
} from './postgres.js';
import { runStatement } from './run.js';
import { describeS3, runS3, testS3 } from './s3.js';

/** A failure the child answers with, thrown inside it and caught once. */
class Failed extends Error {
  constructor(readonly failure: DataFailure) {
    super(failure.code);
  }
}

const failedWith = (code: DataFailureCode) => new Failed(dataFailure(code));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

type Answer = TestAnswer | DescribeAnswer | RunAnswer | DescribeSqlAnswer;

/**
 * What a test finds of the account (D1-M): whether it may write, and, on a connection that asserts a
 * person's identity, whether it may read data of its own, as every asserted run checks (DAT-112, D7-D).
 */
async function testFindings(
  client: pg.Client,
  settings: ConnectionSettings,
): Promise<TestFinding[]> {
  const findings = await readOnlyFindings(client);
  const { identity } = settings;
  if (identity.kind === 'endUser' && identity.mechanism === 'asserted') {
    if (await accountHoldsPrivilege(client)) findings.push('account_holds_privilege');
  }
  return findings;
}

/** A failure in the shape of the request's answer: a test's and a run's say `failed`. */
function failureAnswer(kind: ChildRequest['kind'], failure: DataFailure): Answer {
  return kind === 'test' || kind === 'run' ? { outcome: 'failed', failure } : { failure };
}

/** The person's role a request asserts (D7-G), or undefined for one run as the account. */
function assertedRole(request: ChildRequest): string | undefined {
  if (request.kind === 'test' || !('identity' in request.request)) return undefined;
  const identity = request.request.identity;
  return identity?.kind === 'asserted' ? identity.role : undefined;
}

/**
 * A describe as a person (D7-G): in a read-only transaction, the role asserted first as a run asserts
 * it (D7-A, D7-D), and still the source's `current_user` once the describe is done (D7-E).
 */
async function describedAs<T>(client: pg.Client, role: string, work: () => Promise<T>): Promise<T> {
  await client.query('begin transaction read only');
  const asserted = await assertRole(client, role);
  if ('refused' in asserted) throw failedWith(asserted.refused);
  const answer = await work();
  if (!(await heldAs(client, role))) throw failedWith('identity_unmatched');
  return answer;
}

/**
 * A SQL describe (D2-G): the statement bound as a run would bind it - each variation marker by its
 * first fragment, since a variation changes an order or a unit and not the columns - described by
 * the source and never run. A built query is described by its shape statement, its values all null
 * (the D4 plan, D4-H, D4-Q), bound through the same `bindFetch` a run binds through.
 */
async function describeSql(
  client: pg.Client,
  request: Extract<ChildRequest, { kind: 'describeSql' }>['request'],
): Promise<DescribeSqlAnswer> {
  // A sample of an HTTP request or a file is its own source's, never sent to a database
  // (`connectionFetchProblems`).
  if ('http' in request || 'file' in request) throw failedWith('describe_not_supported');
  const { parameters } = 'sql' in request ? request.sql : request.builder;
  const values: ParameterValues = Object.fromEntries(
    parameters.map((parameter) => [parameter.name, parameter.variation?.[0]?.key ?? null]),
  );
  const fetch =
    'sql' in request
      ? { kind: 'sql' as const, text: request.sql.text }
      : { kind: 'builder' as const, format: 1 as const, query: request.builder.query };
  let bound: ReturnType<typeof bindFetch>;
  try {
    bound = bindFetch({ parameters, fetch, columns: [], order: 'multiset' }, values, 'shape');
  } catch (error) {
    if (error instanceof BindingRefused) throw new Failed(dataFailure('definition_unbindable'));
    throw error;
  }
  let description;
  try {
    description = await describeStatement(client, bound.text);
  } catch (error) {
    const refused = sourceRefused(error);
    if (refused === undefined) throw error;
    if (refused.source?.sqlstate === QUERY_CANCELED) throw new Failed(dataFailure('timeout'));
    // A built query's column the source does not have is named, as a run names it.
    throw new Failed(
      fetch.kind === 'builder' ? withRefusedColumn(refused, error, bound.text) : refused,
    );
  }
  return describedColumns(client, description);
}

/**
 * The child's one request (the D1 plan, task 4; the D2 plan, task 3): guard the host, connect as the
 * account, check the source can be read, and test, describe, describe a statement or run a
 * definition. **Every failure to reach or authenticate is `connection_failed`**, answered no sooner
 * than the failure floor, so neither the words nor the time tell a refused port from a filtered one,
 * an unknown host, a guarded address or a wrong password (DAT-075, D1-L). The source connection is
 * closed before the answer is given (DAT-114).
 */
export async function answerRequest(
  request: ChildRequest,
  options: { readonly lookup?: Lookup; readonly startedAt?: number } = {},
): Promise<Answer> {
  // The source is chosen by the connection's type (the D6 plan, D6-A); PostgreSQL's is as it was.
  const { type } = request.request.settings;
  return type === 'http' || type === 's3'
    ? answerHttp(request, options)
    : answerPostgres(request, options);
}

/** The deadline a request runs to: from when the child's process started (DAT-109). */
const deadlineOf = (request: ChildRequest, started: number, startedAt?: number) =>
  (startedAt ?? started) + request.request.deadlineMs;

/**
 * An HTTP or an S3 request (the D6 plan, D6-A): a test, a run, or a sample for columns; a describe of
 * relations is `describe_not_supported`, since neither lists any. A failure to reach or sign in is
 * answered no sooner than the failure floor, as a database's is (DAT-075).
 */
async function answerHttp(
  request: ChildRequest,
  options: { readonly lookup?: Lookup; readonly startedAt?: number },
): Promise<Answer> {
  const started = Date.now();
  const deadline = deadlineOf(request, started, options.startedAt);
  const settings = request.request.settings as HttpSettings | S3Settings;
  const policy: HttpPolicy = {
    deny: request.deny,
    connectTimeoutMs: request.connectTimeoutMs,
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(request.ca === undefined ? {} : { ca: request.ca }),
  };
  let answer: Answer;
  try {
    const s3 = settings.type === 's3';
    switch (request.kind) {
      case 'test':
        answer = s3
          ? await testS3(settings, request.secret, policy, deadline)
          : await testHttp(settings, request.secret, policy, deadline);
        break;
      case 'run':
        answer = s3
          ? await runS3(request.request, request.secret, policy, deadline)
          : await runHttp(request.request, request.secret, policy, deadline);
        break;
      case 'describeSql': {
        const asked = request.request;
        answer =
          'http' in asked && !s3
            ? await describeHttp(asked, request.secret, policy, deadline, limitCeilings.bytes)
            : 'file' in asked && s3
              ? await describeS3(asked, request.secret, policy, deadline, limitCeilings.bytes)
              : { failure: dataFailure('describe_not_supported') };
        break;
      }
      default:
        answer = { failure: dataFailure('describe_not_supported') };
    }
  } catch {
    answer = failureAnswer(request.kind, dataFailure('connector_error'));
  }
  const failure = 'failure' in answer ? answer.failure : undefined;
  if (failure?.code === 'connection_failed') {
    await pause(started + request.failureFloorMs - Date.now());
  }
  return answer;
}

/** The built query a run or a describe of one sends, if it sends one. */
function builtQuery(request: ChildRequest): Query | undefined {
  if (request.kind === 'run') {
    const { fetch } = request.request.definition;
    return fetch.kind === 'builder' ? fetch.query : undefined;
  }
  if (request.kind === 'describeSql' && 'builder' in request.request) {
    return request.request.builder.query;
  }
  return undefined;
}

/** A PostgreSQL request, as D1 to D7 built it. */
async function answerPostgres(
  request: ChildRequest,
  options: { readonly lookup?: Lookup; readonly startedAt?: number },
): Promise<Answer> {
  const started = Date.now();
  // The child's deadline runs from when its process started, as the supervisor's does from the spawn,
  // so it stops a run and cancels it before the supervisor's kill a second after (DAT-109).
  const deadline = deadlineOf(request, started, options.startedAt);
  const settings = request.request.settings as PostgresSettings;
  let client: pg.Client | undefined;
  try {
    const address = await guardedAddress(settings.source.host, {
      deny: request.deny,
      ...(options.lookup ? { lookup: options.lookup } : {}),
    });
    if (address === 'refused') throw failedWith('connection_failed');
    try {
      client = await connectPostgres(settings, request.secret, address.address, {
        connectTimeoutMs: Math.min(request.connectTimeoutMs, Math.max(1, deadline - Date.now())),
        statementTimeoutMs: Math.max(1, deadline - Date.now()),
      });
    } catch {
      throw failedWith(Date.now() >= deadline ? 'timeout' : 'connection_failed');
    }
    try {
      if ((await serverVersion(client)) < OLDEST_SERVER_VERSION)
        throw failedWith('source_unsupported');
      // A filter ignoring case lower-cases by ICU's root collation, which a source may lack (MC-F).
      const tree = builtQuery(request);
      if (tree !== undefined && ignoresCase(tree) && !(await hasRootCollation(client)))
        throw failedWith('source_unsupported');
      const role = assertedRole(request);
      switch (request.kind) {
        case 'test':
          return { outcome: 'ok', findings: await testFindings(client, request.request.settings) };
        case 'describe':
          return role === undefined
            ? await describeRelations(client)
            : await describedAs(client, role, () => describeRelations(client!));
        case 'describeSql':
          return role === undefined
            ? await describeSql(client, request.request)
            : await describedAs(client, role, () => describeSql(client!, request.request));
        case 'run':
          return await runStatement(
            client,
            request.request.definition,
            request.request.values as ParameterValues,
            request.request.limits,
            deadline,
            () => cancelBackend(address.address, settings.source.port, client!),
            role,
          );
        default:
          throw failedWith('connector_error');
      }
    } catch (error) {
      if (error instanceof Failed) throw error;
      const code = (error as { code?: unknown }).code;
      throw failedWith(
        code === QUERY_CANCELED || Date.now() >= deadline ? 'timeout' : 'connector_error',
      );
    }
  } catch (error) {
    const failure = error instanceof Failed ? error.failure : dataFailure('connector_error');
    if (failure.code === 'connection_failed') {
      await pause(started + request.failureFloorMs - Date.now());
    }
    return failureAnswer(request.kind, failure);
  } finally {
    // A client whose socket a run destroyed has ended already; one that has not is ended here.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      client?.end().catch(() => {}),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 1000);
      }),
    ]);
    clearTimeout(timer);
  }
}
