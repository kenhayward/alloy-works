import {
  bindPostgres,
  dataFailure,
  type ChildRequest,
  type DataFailure,
  type DataFailureCode,
  type DescribeAnswer,
  type DescribeSqlAnswer,
  type ParameterValues,
  type RunAnswer,
  type TestAnswer,
} from '@alloy-works/domain';
import type pg from 'pg';

import { describedColumns, describeStatement, QUERY_CANCELED, sourceRefused } from './describe.js';
import { guardedAddress, type Lookup } from './guard.js';
import {
  connectPostgres,
  describeRelations,
  OLDEST_SERVER_VERSION,
  readOnlyFindings,
  serverVersion,
} from './postgres.js';
import { runStatement } from './run.js';

/** A failure the child answers with, thrown inside it and caught once. */
class Failed extends Error {
  constructor(readonly failure: DataFailure) {
    super(failure.code);
  }
}

const failedWith = (code: DataFailureCode) => new Failed(dataFailure(code));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

type Answer = TestAnswer | DescribeAnswer | RunAnswer | DescribeSqlAnswer;

/** A failure in the shape of the request's answer: a test's and a run's say `failed`. */
function failureAnswer(kind: ChildRequest['kind'], failure: DataFailure): Answer {
  return kind === 'test' || kind === 'run' ? { outcome: 'failed', failure } : { failure };
}

/**
 * A SQL describe (D2-G): the statement bound as a run would bind it - each variation marker by its
 * first fragment, since a variation changes an order or a unit and not the columns - described by
 * the source and never run.
 */
async function describeSql(
  client: pg.Client,
  request: Extract<ChildRequest, { kind: 'describeSql' }>['request'],
): Promise<DescribeSqlAnswer> {
  const { text, parameters } = request.sql;
  const values: ParameterValues = Object.fromEntries(
    parameters.map((parameter) => [parameter.name, parameter.variation?.[0]?.key ?? null]),
  );
  const bound = bindPostgres({ parameters, fetch: { kind: 'sql', text } }, values);
  let description;
  try {
    description = await describeStatement(client, bound.text);
  } catch (error) {
    const refused = sourceRefused(error);
    if (refused === undefined) throw error;
    throw new Failed(
      refused.source?.sqlstate === QUERY_CANCELED ? dataFailure('timeout') : refused,
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
  options: { readonly lookup?: Lookup } = {},
): Promise<Answer> {
  const started = Date.now();
  const deadline = started + request.request.deadlineMs;
  let client: pg.Client | undefined;
  try {
    const address = await guardedAddress(request.request.settings.source.host, {
      deny: request.deny,
      ...(options.lookup ? { lookup: options.lookup } : {}),
    });
    if (address === 'refused') throw failedWith('connection_failed');
    try {
      client = await connectPostgres(request.request.settings, request.secret, address.address, {
        connectTimeoutMs: Math.min(request.connectTimeoutMs, Math.max(1, deadline - Date.now())),
        statementTimeoutMs: Math.max(1, deadline - Date.now()),
      });
    } catch {
      throw failedWith(Date.now() >= deadline ? 'timeout' : 'connection_failed');
    }
    try {
      if ((await serverVersion(client)) < OLDEST_SERVER_VERSION)
        throw failedWith('source_unsupported');
      switch (request.kind) {
        case 'test':
          return { outcome: 'ok', findings: await readOnlyFindings(client) };
        case 'describe':
          return await describeRelations(client);
        case 'describeSql':
          return await describeSql(client, request.request);
        case 'run':
          return await runStatement(
            client,
            request.request.definition,
            request.request.values as ParameterValues,
            request.request.limits,
            deadline,
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
