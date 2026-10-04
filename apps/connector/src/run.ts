import type { Socket } from 'node:net';

import {
  BindingRefused,
  bindFetch,
  dataFailure,
  sourceNameSchema,
  type CanonicalValue,
  type DataFailure,
  type DraftDefinition,
  type Limits,
  type ParameterValues,
  type RunAnswer,
} from '@alloy-works/domain';
import pg from 'pg';

import { describeStatement, QUERY_CANCELED, sourceRefused } from './describe.js';
import { admits, fromPostgresText } from './from-text.js';
import { SERVER_TEXT, sourceTypes } from './postgres.js';
import { finishResult } from './result.js';

/**
 * A run in the child (the D2 plan, D2-Q, D2-J): the definition bound by PostgreSQL's binder, in a
 * read-only transaction; described first, so the result's columns and types are held to the
 * declaration before anything is computed; then run a page of 500 rows at a time, so the source
 * computes no more than is read, every value the server's text. The bytes read from the source after
 * the statement is sent are counted at the socket, and the rows as they arrive: past a limit, or at the
 * deadline, the socket is destroyed and the statement cancelled at the source by the protocol's
 * CancelRequest, which is waited for before the child answers. Neither is left to the source's own
 * connection check or statement timeout, both of which the author's SQL can turn off (DAT-109).
 */

/** Rows a page: the source hands over this many, and computes no more until they are read. */
export const PAGE_ROWS = 500;

/** A run stopped by the child: a limit, the deadline, or a value it could not take. */
class Stopped extends Error {
  constructor(readonly failure: DataFailure) {
    super(failure.code);
  }
}

/** The failure a statement's error is: the deadline where the source cancelled it, or its refusal. */
function sourceFailure(error: unknown, deadline: number): DataFailure {
  const refused = sourceRefused(error);
  if (refused?.source?.sqlstate === QUERY_CANCELED || Date.now() >= deadline) {
    return dataFailure('timeout');
  }
  return refused ?? dataFailure('connector_error');
}

/**
 * Runs a definition against its values, under its limits, by the deadline (a `Date.now()` time), and
 * answers the canonical result or one named failure. The client is the child's, and closed by it.
 */
export async function runStatement(
  client: pg.Client,
  definition: DraftDefinition,
  values: ParameterValues,
  limits: Limits,
  deadline: number,
  cancel: () => Promise<void>,
): Promise<RunAnswer> {
  const started = Date.now();
  const failed = (failure: DataFailure): RunAnswer => ({ outcome: 'failed', failure });
  let bound: ReturnType<typeof bindFetch>;
  try {
    bound = bindFetch(definition, values);
  } catch (error) {
    // A binding refused is the definition's to fix, and nothing of it is sent.
    if (error instanceof BindingRefused) return failed(dataFailure('definition_unbindable'));
    throw error;
  }
  try {
    await client.query('begin transaction read only');
    const description = await describeStatement(client, bound.text);
    const fields = description.fields ?? [];
    if (fields.length === 0) return failed(dataFailure('result_mismatch'));

    // Every declared column read from exactly one of the result's columns, of a type its base
    // admits, and no column of the result left undeclared (DAT-106).
    const types = await sourceTypes(
      client,
      fields.map((field) => ({ oid: field.dataTypeID, typmod: field.dataTypeModifier })),
    );
    const places: number[] = [];
    for (const column of definition.columns) {
      const matching = fields.flatMap((field, at) =>
        field.name === column.from.column ? [at] : [],
      );
      if (matching.length !== 1 || !admits(column.type.base, types[matching[0]!]!)) {
        return failed(dataFailure('result_mismatch', { column: column.name }));
      }
      places.push(matching[0]!);
    }
    const declared = new Set(definition.columns.map((column) => column.from.column));
    const extra = fields.find((field) => !declared.has(field.name));
    if (extra !== undefined) {
      return failed(
        dataFailure(
          'result_mismatch',
          sourceNameSchema.safeParse(extra.name).success ? { column: extra.name } : {},
        ),
      );
    }

    const remaining = Math.max(1, Math.floor(deadline - Date.now()));
    await client.query(`set local statement_timeout = ${remaining}`);
    const rows = await readRows(client, bound, definition, places, limits, deadline, cancel);
    const finished = finishResult(rows, definition, limits);
    if ('failure' in finished) return failed(finished.failure);
    return {
      outcome: 'ok',
      // The result as the interface's schema types it: the same arrays, read-only here.
      result: finished.result as Extract<RunAnswer, { outcome: 'ok' }>['result'],
      checksum: finished.checksum,
      rowCount: finished.rowCount,
      ran: { sql: bound.text },
      durationMs: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof Stopped) return failed(error.failure);
    return failed(sourceFailure(error, deadline));
  }
}

/** The client's socket to the source: the TLS socket, once negotiated. */
const socketOf = (client: pg.Client) =>
  (client as unknown as { connection: { stream: Socket } }).connection.stream;

/**
 * The statement's rows, each in canonical form, read a page at a time: stopped at the socket past
 * the row limit, the byte limit or the deadline, or at the first value its declared type does not take.
 */
function readRows(
  client: pg.Client,
  bound: ReturnType<typeof bindFetch>,
  definition: DraftDefinition,
  places: readonly number[],
  limits: Limits,
  deadline: number,
  cancel: () => Promise<void>,
): Promise<CanonicalValue[][]> {
  return new Promise((resolve, reject) => {
    const socket = socketOf(client);
    const rows: CanonicalValue[][] = [];
    let received = 0;
    let kept = 0;
    let stopped: DataFailure | undefined;
    let cancelled: Promise<void> = Promise.resolve();
    const stop = (failure: DataFailure) => {
      if (stopped) return;
      stopped = failure;
      // Nothing more is read, and the statement is cancelled at the source, whatever the author's SQL
      // set its connection check or its timeout to (DAT-109).
      socket.destroy();
      cancelled = cancel();
    };
    const counting = (chunk: Buffer) => {
      received += chunk.length;
      if (received > limits.bytes) stop(dataFailure('byte_limit'));
    };
    const timer = setTimeout(
      () => stop(dataFailure('timeout')),
      Math.max(0, deadline - Date.now()),
    );
    // An answer waits for the cancel to be sent, so the child does not exit before it is.
    const settle = (outcome: () => void) => {
      clearTimeout(timer);
      socket.removeListener('data', counting);
      void cancelled.then(outcome);
    };

    // `rows` is the driver's own, though its types leave it out: a portal read a page at a time.
    const query = new pg.Query({
      text: bound.text,
      values: bound.values as unknown[],
      rows: PAGE_ROWS,
      rowMode: 'array',
      types: SERVER_TEXT,
    } as pg.QueryConfig);
    query.on('row', (row: (string | null)[]) => {
      if (stopped) return;
      if (rows.length >= limits.rows) {
        stop(dataFailure('row_limit'));
        return;
      }
      const canonical: CanonicalValue[] = [];
      for (const [at, column] of definition.columns.entries()) {
        const text = row[places[at]!];
        if (text === null || text === undefined) {
          canonical.push(null);
          continue;
        }
        const taken = fromPostgresText(text, column.type);
        if ('refused' in taken) {
          stop(dataFailure(taken.refused, { column: column.name, row: rows.length + 1 }));
          return;
        }
        canonical.push(taken.value);
      }
      rows.push(canonical);
      // What is kept, as it grows: a row's JSON and its comma, which the canonical bytes are.
      kept += Buffer.byteLength(JSON.stringify(canonical), 'utf8') + 1;
      if (kept > limits.bytes) stop(dataFailure('byte_limit'));
    });
    query.on('end', () => settle(() => (stopped ? reject(new Stopped(stopped)) : resolve(rows))));
    query.on('error', (error: Error) =>
      settle(() => reject(stopped ? new Stopped(stopped) : error)),
    );
    client.query(query);
    // Counted once the statement is sent: what the source answers it with, and nothing before.
    socket.on('data', counting);
  });
}
