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

import { describeStatement, QUERY_CANCELED, sourceRefused, withRefusedColumn } from './describe.js';
import { admits, fromPostgresText } from './from-text.js';
import { readImage } from './image.js';
import { assertRole, heldAs, SERVER_TEXT, sourceTypes } from './postgres.js';
import { finishResult } from './result.js';

/**
 * A run in the child (the D2 plan, D2-Q, D2-J): the definition bound by its fetch's kind - SQL by
 * PostgreSQL's binder, a built query by the generator (the D4 plan, D4-H) - in a read-only
 * transaction; described first, so the result's columns and types are held to the declaration before
 * anything is computed, a built query's shape statement before its run statement; then run a page of 500 rows at a time, so the source
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
 * Given a person's role, it is asserted first in the transaction and held to the end (the D7 plan,
 * D7-A, D7-D, D7-E): a result read under any other role is refused, nothing returned.
 */
export async function runStatement(
  client: pg.Client,
  definition: DraftDefinition,
  values: ParameterValues,
  limits: Limits,
  deadline: number,
  cancel: () => Promise<void>,
  role?: string,
): Promise<RunAnswer> {
  const started = Date.now();
  const failed = (failure: DataFailure): RunAnswer => ({ outcome: 'failed', failure });
  let bound: ReturnType<typeof bindFetch>;
  let shape: ReturnType<typeof bindFetch> | undefined;
  try {
    bound = bindFetch(definition, values, 'run');
    // A built query's shape: its columns as the source types them, before the run's code-point keys
    // cast a minimum or a maximum to text (the D4 plan, D4-H).
    if (definition.fetch.kind === 'builder') shape = bindFetch(definition, values, 'shape');
  } catch (error) {
    // A binding refused is the definition's to fix, and nothing of it is sent.
    if (error instanceof BindingRefused) return failed(dataFailure('definition_unbindable'));
    throw error;
  }
  // The statement being sent, so a built query's column the source refused can be named from it.
  let sending = '';
  try {
    await client.query('begin transaction read only');
    let asSeen: string | undefined;
    if (role !== undefined) {
      const asserted = await assertRole(client, role);
      if ('refused' in asserted) return failed(dataFailure(asserted.refused));
      asSeen = asserted.asSeen;
    }
    if (shape !== undefined) {
      sending = shape.text;
      const admitted = await admittedColumns(client, shape.text, definition);
      if ('failure' in admitted) return failed(admitted.failure);
    }
    sending = bound.text;
    const admitted = await admittedColumns(client, bound.text, definition);
    if ('failure' in admitted) return failed(admitted.failure);
    const places = admitted.places;

    const remaining = Math.max(1, Math.floor(deadline - Date.now()));
    await client.query(`set local statement_timeout = ${remaining}`);
    const { rows, images, imageBytes } = await readRows(
      client,
      bound,
      definition,
      places,
      limits,
      deadline,
      cancel,
    );
    const finished = finishResult(rows, definition, limits, imageBytes);
    if ('failure' in finished) return failed(finished.failure);
    if (role !== undefined && !(await heldAs(client, role))) {
      return failed(dataFailure('identity_unmatched'));
    }
    return {
      outcome: 'ok',
      // The result as the interface's schema types it: the same arrays, read-only here.
      result: finished.result as Extract<RunAnswer, { outcome: 'ok' }>['result'],
      checksum: finished.checksum,
      rowCount: finished.rowCount,
      ran: { sql: bound.text },
      durationMs: Date.now() - started,
      images: Object.fromEntries(
        [...images].map(([hash, bytes]) => [hash, bytes.toString('base64')]),
      ),
      ...(asSeen === undefined ? {} : { asSeen }),
    };
  } catch (error) {
    if (error instanceof Stopped) return failed(error.failure);
    const failure = sourceFailure(error, deadline);
    return failed(
      definition.fetch.kind === 'builder' ? withRefusedColumn(failure, error, sending) : failure,
    );
  }
}

/**
 * A statement described and its result held to the declaration (DAT-106, D2-L): every declared
 * column read from exactly one of the result's columns, of a type its base admits, and no column of
 * the result left undeclared. Answers where each declared column stands in the result, or the failure.
 */
async function admittedColumns(
  client: pg.Client,
  text: string,
  definition: DraftDefinition,
): Promise<{ readonly places: number[] } | { readonly failure: DataFailure }> {
  const description = await describeStatement(client, text);
  const fields = description.fields ?? [];
  if (fields.length === 0) return { failure: dataFailure('result_mismatch') };
  const types = await sourceTypes(
    client,
    fields.map((field) => ({ oid: field.dataTypeID, typmod: field.dataTypeModifier })),
  );
  const places: number[] = [];
  for (const column of definition.columns) {
    const read = 'column' in column.from ? column.from.column : undefined;
    const matching = fields.flatMap((field, at) => (field.name === read ? [at] : []));
    if (matching.length !== 1 || !admits(column.type, types[matching[0]!]!)) {
      return { failure: dataFailure('result_mismatch', { column: column.name }) };
    }
    places.push(matching[0]!);
  }
  const declared = new Set(
    definition.columns.flatMap((column) => ('column' in column.from ? [column.from.column] : [])),
  );
  const extra = fields.find((field) => !declared.has(field.name));
  if (extra !== undefined) {
    return {
      failure: dataFailure(
        'result_mismatch',
        sourceNameSchema.safeParse(extra.name).success ? { column: extra.name } : {},
      ),
    };
  }
  return { places };
}

/** The client's socket to the source: the TLS socket, once negotiated. */
const socketOf = (client: pg.Client) =>
  (client as unknown as { connection: { stream: Socket } }).connection.stream;

/** The rows a run read, and each distinct image they hold by its hash, with those images' bytes. */
interface Read {
  readonly rows: CanonicalValue[][];
  readonly images: ReadonlyMap<string, Buffer>;
  readonly imageBytes: number;
}

/**
 * The statement's rows, each in canonical form, read a page at a time: stopped at the socket past
 * the row limit, the byte limit or the deadline, or at the first value its declared type does not take.
 * An image cell is its hash, the image kept once, and its bytes counted against the byte limit beside
 * the rows' (D8-B, D8-C); one not admitted is `image_refused`, naming its row and column.
 */
function readRows(
  client: pg.Client,
  bound: ReturnType<typeof bindFetch>,
  definition: DraftDefinition,
  places: readonly number[],
  limits: Limits,
  deadline: number,
  cancel: () => Promise<void>,
): Promise<Read> {
  return new Promise((resolve, reject) => {
    const socket = socketOf(client);
    const rows: CanonicalValue[][] = [];
    const images = new Map<string, Buffer>();
    let imageBytes = 0;
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
        if (column.type.base === 'image') {
          const image = readImage(text, column.type.encoding);
          if ('refused' in image) {
            stop(dataFailure('image_refused', { column: column.name, row: rows.length + 1 }));
            return;
          }
          if (!images.has(image.hash)) {
            images.set(image.hash, image.bytes);
            imageBytes += image.bytes.length;
          }
          canonical.push(image.hash);
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
      if (kept + imageBytes > limits.bytes) stop(dataFailure('byte_limit'));
    });
    query.on('end', () =>
      settle(() =>
        stopped ? reject(new Stopped(stopped)) : resolve({ rows, images, imageBytes }),
      ),
    );
    query.on('error', (error: Error) =>
      settle(() => reject(stopped ? new Stopped(stopped) : error)),
    );
    client.query(query);
    // Counted once the statement is sent: what the source answers it with, and nothing before.
    socket.on('data', counting);
  });
}
