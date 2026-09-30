import {
  dataFailure,
  type ChildRequest,
  type DataFailureCode,
  type DescribeAnswer,
  type TestAnswer,
} from '@alloy-works/domain';
import type pg from 'pg';

import { guardedAddress, type Lookup } from './guard.js';
import {
  connectPostgres,
  describeRelations,
  OLDEST_SERVER_VERSION,
  readOnlyFindings,
  serverVersion,
} from './postgres.js';

/** A failure the child answers with, thrown inside it and caught once. */
class Failed extends Error {
  constructor(readonly code: DataFailureCode) {
    super(code);
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** PostgreSQL's code for a statement cancelled by `statement_timeout`. */
const QUERY_CANCELED = '57014';

/**
 * The child's one request (the D1 plan, task 4): guard the host, connect as the account, check the
 * source can be read, and test or describe. **Every failure to reach or authenticate is
 * `connection_failed`**, answered no sooner than the failure floor, so neither the words nor the time
 * tell a refused port from a filtered one, an unknown host, a guarded address or a wrong password
 * (DAT-075, D1-L). The source connection is closed before the answer is given (DAT-114).
 */
export async function answerRequest(
  request: ChildRequest,
  options: { readonly lookup?: Lookup } = {},
): Promise<TestAnswer | DescribeAnswer> {
  const started = Date.now();
  const deadline = started + request.request.deadlineMs;
  let client: pg.Client | undefined;
  try {
    const address = await guardedAddress(request.request.settings.source.host, {
      deny: request.deny,
      ...(options.lookup ? { lookup: options.lookup } : {}),
    });
    if (address === 'refused') throw new Failed('connection_failed');
    try {
      client = await connectPostgres(request.request.settings, request.secret, address.address, {
        connectTimeoutMs: Math.min(request.connectTimeoutMs, Math.max(1, deadline - Date.now())),
        statementTimeoutMs: Math.max(1, deadline - Date.now()),
      });
    } catch {
      throw new Failed(Date.now() >= deadline ? 'timeout' : 'connection_failed');
    }
    try {
      if ((await serverVersion(client)) < OLDEST_SERVER_VERSION)
        throw new Failed('source_unsupported');
      if (request.kind === 'test') {
        return { outcome: 'ok', findings: await readOnlyFindings(client) };
      }
      return await describeRelations(client);
    } catch (error) {
      if (error instanceof Failed) throw error;
      const code = (error as { code?: unknown }).code;
      throw new Failed(
        code === QUERY_CANCELED || Date.now() >= deadline ? 'timeout' : 'connector_error',
      );
    }
  } catch (error) {
    const code = error instanceof Failed ? error.code : 'connector_error';
    if (code === 'connection_failed') await pause(started + request.failureFloorMs - Date.now());
    const failure = dataFailure(code);
    return request.kind === 'test' ? { outcome: 'failed', failure } : { failure };
  } finally {
    await client?.end().catch(() => {});
  }
}
