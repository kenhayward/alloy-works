import {
  dataFailure,
  type DataFailure,
  type DataFormat,
  type DescribeSqlAnswer,
  type DescribeSqlRequest,
  type ExtensionFetch,
  type ExtensionSettings,
  type ParameterValues,
  type RunAnswer,
  type RunRequest,
  type TestAnswer,
} from '@alloy-works/domain';

import { bodyLimit, proposeColumns, readRows } from './formats/rows.js';
import type { HttpPolicy } from './http-source.js';
import { exchange } from './https.js';
import { finishResult } from './result.js';

/**
 * An extension's source (extensions.md; the EX plan, EX-H and EX-I; ADR-0066): its endpoint, as the
 * connection snapshotted it, called as an HTTP source is - the guard, the pinned address, no redirect,
 * the product's limits - with only what it declares (API-033): its settings, the definition's request,
 * the values bound where it binds them, and its one secret as a bearer. Its answer's rows are read as
 * JSON at `/rows`, so the product's canonical form, checksum and limits hold.
 */

/** How an extension's rows are read: JSON, at `/rows`. */
const ROWS: DataFormat = { kind: 'json', rows: '/rows' };

class Refused extends Error {
  constructor(readonly failure: DataFailure) {
    super(failure.code);
  }
}

/** A refusal the extension caused, in its own codes (EX-I); a failure to reach it, as an HTTP source's. */
function extensionFailure(failure: DataFailure): DataFailure {
  if (failure.code === 'source_refused') {
    return dataFailure((failure.status ?? 500) >= 500 ? 'extension_failed' : 'extension_refused');
  }
  if (failure.code === 'result_incomplete') return dataFailure('extension_invalid');
  return failure;
}

/** One call: `POST` its endpoint and path with this body, the secret where it takes one. */
async function call(
  settings: ExtensionSettings,
  secret: string,
  path: '/test' | '/run',
  body: unknown,
  policy: HttpPolicy,
  deadline: number,
  maxBytes: number,
): Promise<Buffer> {
  const url = new URL(settings.source.endpoint);
  const exchanged = await exchange(
    {
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port === '' ? 443 : Number(url.port),
      secure: true,
      path: `${url.pathname.replace(/\/$/, '')}${path}`,
      method: 'POST',
      headers: [
        ['accept', 'application/json'],
        ...(settings.source.authenticated
          ? [['authorization', `Bearer ${secret}`] as [string, string]]
          : []),
      ],
      body: JSON.stringify(body),
    },
    {
      deny: policy.deny,
      ...(policy.lookup ? { lookup: policy.lookup } : {}),
      ...(policy.ca === undefined ? {} : { ca: policy.ca }),
      deadline,
      connectTimeoutMs: policy.connectTimeoutMs,
      maxBytes,
    },
  );
  if (!exchanged.ok) throw new Refused(extensionFailure(exchanged.failure));
  return exchanged.body;
}

/** What a run sends (API-033): the settings, the request, and the values and row limit where declared. */
function runBody(
  settings: ExtensionSettings,
  request: Record<string, unknown>,
  values: ParameterValues,
  rows: number,
) {
  const { capabilities } = settings.source;
  return {
    settings: settings.source.settings,
    request,
    ...(capabilities.parameters ? { parameters: values } : {}),
    ...(capabilities.rowLimit ? { limits: { rows } } : {}),
  };
}

/** A test: `/test` with its settings; any answer but a refusal to sign in proves it. */
export async function testExtension(
  settings: ExtensionSettings,
  secret: string,
  policy: HttpPolicy,
  deadline: number,
): Promise<TestAnswer> {
  try {
    await call(
      settings,
      secret,
      '/test',
      { settings: settings.source.settings },
      policy,
      deadline,
      64 * 1024,
    );
    return { outcome: 'ok', findings: [] };
  } catch (error) {
    if (error instanceof Refused) return { outcome: 'failed', failure: error.failure };
    throw error;
  }
}

/** A run: `/run`, its rows read by pointer and finished as every source's are. */
export async function runExtension(
  request: RunRequest,
  secret: string,
  policy: HttpPolicy,
  deadline: number,
): Promise<RunAnswer> {
  const started = Date.now();
  const { definition, limits } = request;
  const settings = request.settings as ExtensionSettings;
  const fetch = definition.fetch as ExtensionFetch;
  try {
    let body: Buffer | undefined = await call(
      settings,
      secret,
      '/run',
      runBody(settings, fetch.request, request.values as ParameterValues, limits.rows),
      policy,
      deadline,
      bodyLimit(ROWS, limits.bytes),
    );
    const read = readRows(body, ROWS, definition.columns, limits);
    body = undefined;
    // An answer not of the shape - not JSON, no rows at `/rows` - is the extension's (EX-I).
    if ('failure' in read) {
      const { failure } = read;
      return {
        outcome: 'failed',
        failure:
          failure.code === 'result_mismatch' || failure.code === 'result_incomplete'
            ? dataFailure('extension_invalid')
            : failure,
      };
    }
    const finished = finishResult(read.rows, definition, limits, read.imageBytes);
    if ('failure' in finished) return { outcome: 'failed', failure: finished.failure };
    return {
      outcome: 'ok',
      result: finished.result as Extract<RunAnswer, { outcome: 'ok' }>['result'],
      checksum: finished.checksum,
      rowCount: finished.rowCount,
      ran: { extension: fetch.request },
      durationMs: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof Refused) return { outcome: 'failed', failure: error.failure };
    throw error;
  }
}

/** A sample for columns (DAT-105): `/run`, its first rows proposed by pointer. */
export async function describeExtension(
  request: Extract<DescribeSqlRequest, { extension: unknown }>,
  secret: string,
  policy: HttpPolicy,
  deadline: number,
  maxBytes: number,
): Promise<DescribeSqlAnswer> {
  const settings = request.settings as ExtensionSettings;
  try {
    const body = await call(
      settings,
      secret,
      '/run',
      runBody(
        settings,
        request.extension.request,
        request.extension.values as ParameterValues,
        100,
      ),
      policy,
      deadline,
      bodyLimit(ROWS, maxBytes),
    );
    return proposeColumns(body, ROWS);
  } catch (error) {
    if (error instanceof Refused) return { failure: error.failure };
    throw error;
  }
}
