import type { EventEmitter } from 'node:events';

import {
  dataFailure,
  sourceMessage,
  sourceNameSchema,
  sourceTypeSchema,
  type DataFailure,
  type DescribeSqlAnswer,
} from '@alloy-works/domain';
import type pg from 'pg';

import { proposedType, sourceTypes } from './postgres.js';

/**
 * Describing a statement without running it (the D2 plan, D2-G; Q1): the protocol's Parse, Describe
 * (statement) and Sync, which the source answers with the parameters' types and the result's row
 * description - or `noData` - and nothing executed. `pg` routes neither `parameterDescription` nor
 * `noData` to a query, so this listens on the connection for both; it takes `rowDescription` and
 * `readyForQuery` as any query does. On an error the client drops its active query before
 * `readyForQuery`, so the description finishes in `handleError` rather than waiting for it.
 */

/** A result column as the source describes it: its name, and its type's OID and modifier. */
export interface DescribedField {
  readonly name: string;
  readonly dataTypeID: number;
  readonly dataTypeModifier: number;
}

/** A statement's shape: its result's fields, or null where it returns none, and its parameters' OIDs. */
export interface Description {
  readonly fields: readonly DescribedField[] | null;
  readonly parameters: readonly number[];
}

type Connection = EventEmitter & {
  parse(message: { text: string; types: number[] }): void;
  describe(message: { type: 'S' | 'P'; name: string }): void;
  sync(): void;
};

class Describe {
  private fields: DescribedField[] | null = null;
  private parameters: number[] = [];
  private connection: Connection | undefined;
  private finished = false;

  constructor(
    private readonly text: string,
    private readonly done: (outcome: Error | Description) => void,
  ) {}

  private readonly onParameters = (message: { dataTypeIDs: number[] }) => {
    this.parameters = [...message.dataTypeIDs];
  };

  private readonly onNoData = () => {
    this.fields = null;
  };

  submit(connection: Connection): void {
    this.connection = connection;
    connection.on('parameterDescription', this.onParameters);
    connection.on('noData', this.onNoData);
    connection.parse({ text: this.text, types: [] });
    connection.describe({ type: 'S', name: '' });
    connection.sync();
  }

  handleRowDescription(message: { fields: DescribedField[] }): void {
    this.fields = message.fields.map(({ name, dataTypeID, dataTypeModifier }) => ({
      name,
      dataTypeID,
      dataTypeModifier,
    }));
  }

  handleReadyForQuery(): void {
    this.finish({ fields: this.fields, parameters: this.parameters });
  }

  handleError(error: Error): void {
    this.finish(error);
  }

  handleParseComplete(): void {}
  handleDataRow(): void {}
  handleCommandComplete(): void {}
  handleEmptyQuery(): void {}
  handlePortalSuspended(): void {}

  private finish(outcome: Error | Description): void {
    if (this.finished) return;
    this.finished = true;
    this.connection?.removeListener('parameterDescription', this.onParameters);
    this.connection?.removeListener('noData', this.onNoData);
    this.done(outcome);
  }
}

/** A statement's shape, described by the source and never run. Rejects with the source's error. */
export function describeStatement(client: pg.Client, text: string): Promise<Description> {
  return new Promise((resolve, reject) => {
    client.query(
      new Describe(text, (outcome) => {
        if (outcome instanceof Error) reject(outcome);
        else resolve(outcome);
      }) as unknown as pg.Submittable,
    );
  });
}

/** PostgreSQL's code for a statement cancelled, by `statement_timeout` among others. */
export const QUERY_CANCELED = '57014';

/** The SQLSTATE of an error the source sent, or undefined for one it did not. */
export function sqlstateOf(error: unknown): string | undefined {
  const { code, severity } = (error ?? {}) as { code?: unknown; severity?: unknown };
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && typeof severity === 'string'
    ? code
    : undefined;
}

/**
 * The source's refusal of a statement (D2-H): its SQLSTATE and its message, cut to 1,000 characters,
 * laid at the query - a syntax error, a permission, a division by zero is the author's to put right.
 * Undefined for an error the source did not send.
 */
export function sourceRefused(error: unknown): DataFailure | undefined {
  const sqlstate = sqlstateOf(error);
  if (sqlstate === undefined) return undefined;
  const message = sourceMessage(String((error as { message?: unknown }).message ?? ''));
  return dataFailure('source_refused', { source: { sqlstate, message } });
}

/**
 * A SQL describe's answer (D2-G): each column's name, the source's type and the proposal D1's map
 * makes of it, and each parameter's type as the source reads it. A statement that returns no columns,
 * or a column a page cannot show, is `result_mismatch`: nothing could be declared from it.
 */
export async function describedColumns(
  client: pg.Client,
  description: Description,
): Promise<DescribeSqlAnswer> {
  const { fields } = description;
  if (fields === null || fields.length === 0) return { failure: dataFailure('result_mismatch') };
  const columns = await sourceTypes(
    client,
    fields.map((field) => ({ oid: field.dataTypeID, typmod: field.dataTypeModifier })),
  );
  const parameters = await sourceTypes(
    client,
    description.parameters.map((oid) => ({ oid, typmod: -1 })),
  );
  const answer = {
    columns: fields.map((field, at) => ({
      name: field.name,
      sourceType: columns[at]!.formatted,
      proposed: proposedType(columns[at]!),
    })),
    parameters: parameters.map((each) => each.formatted),
  };
  const shown = answer.columns.every(
    (column) =>
      sourceNameSchema.safeParse(column.name).success &&
      sourceTypeSchema.safeParse(column.sourceType).success,
  );
  return shown ? answer : { failure: dataFailure('result_mismatch') };
}
