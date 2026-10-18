import { createHash } from 'node:crypto';
import { readDatasetSource, type TenantTransaction } from '@alloy-works/db';
import {
  canonicalResultBytes,
  canonicalResultSchema,
  checkDatasetQuery,
  dataFailure,
  evaluateDatasetQuery,
  orderRows,
  sortRows,
  valueProblem,
  type CanonicalResult,
  type CanonicalValue,
  type DatasetFetch,
  type DefinitionProblem,
  type DraftDefinition,
  type Limits,
  type ParameterValues,
  type Provenance,
  type RunAnswer,
} from '@alloy-works/domain';
import { tenantPrefix } from '@alloy-works/objects';
import type { Tenant } from '@alloy-works/db';

/**
 * **A stored result queried as a source of its own** (DAT-094; data.md, "A dataset as a source"; the
 * R21 plan, R21-A): the dataset version a definition names read from the tenant's store by its
 * checksum, and the builder's tree evaluated over its rows here - never by the source it came from,
 * and on no connection. Read on the dataset is the caller's to decide first.
 */

/** A dataset version as a source: where it is and what it holds, as its provenance says. */
export interface ReadSource {
  readonly dataset: string;
  readonly spaceId: string;
  readonly version: string;
  readonly provenance: Provenance;
}

/** The dataset a fetch names, at the version it pins or its latest, or undefined where there is none. */
export const datasetOf = (trx: TenantTransaction, fetch: DatasetFetch) =>
  readDatasetSource(trx, fetch.dataset, fetch.version);

/**
 * What a dataset query's definition must answer before it runs or is saved, against the version it
 * reads (R21-A): the tree over the result's own columns, no image column queried from it - an image a
 * stored result holds stays in the document that admitted it.
 */
export function datasetProblems(draft: DraftDefinition, source: ReadSource): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];
  if (draft.fetch.kind !== 'dataset') return problems;
  const columns = source.provenance.columns.map((each) => [each.name, each.type] as const);
  checkDatasetQuery(draft.fetch.query, columns, draft.parameters, (path, message) =>
    problems.push({ rule: 'definition_invalid', path, message }),
  );
  for (const [at, column] of draft.columns.entries()) {
    if (column.type.base === 'image') {
      problems.push({
        rule: 'definition_invalid',
        path: `columns.${at}.type`,
        message: 'An image is not queried from a stored result',
      });
    }
  }
  return problems;
}

/** The stored result's rows, held to its checksum and its shape, or undefined where they cannot be read. */
export async function readRows(
  tenant: Tenant,
  store: { get(key: string): Promise<Buffer> },
  source: ReadSource,
): Promise<CanonicalResult | undefined> {
  try {
    const bytes = await store.get(`${tenantPrefix(tenant)}sha256/${source.provenance.checksum}`);
    if (createHash('sha256').update(bytes).digest('hex') !== source.provenance.checksum)
      return undefined;
    const parsed = canonicalResultSchema.safeParse(JSON.parse(bytes.toString('utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A dataset query's answer, as a connector's would be (R21-A): the tree evaluated over the rows, each
 * selected value held to the column declared for it, the rows in the declared order, the query's limit
 * and the run's row limit applied, then held to the key, the order, emptiness and the byte limit as
 * every run's result is - a failure named as a source's would be, never a partial result.
 */
export function answerDataset(
  draft: DraftDefinition,
  values: ParameterValues,
  limits: Limits,
  source: ReadSource,
  rows: CanonicalResult,
  startedAt: number,
): RunAnswer {
  if (draft.fetch.kind !== 'dataset') throw new Error('Not a stored result’s query');
  const { query } = draft.fetch;
  const types = source.provenance.columns.map((each) => [each.name, each.type] as const);
  const answered = evaluateDatasetQuery(
    query,
    { columns: types, rows: rows.rows },
    draft.parameters,
    values,
  );
  const at = new Map(answered.columns.map((name, index) => [name, index]));
  const declared = draft.columns.map((column) => ({
    column,
    from: at.get('column' in column.from ? column.from.column : '')!,
  }));
  const projected: CanonicalValue[][] = [];
  for (const [row, values_] of answered.rows.entries()) {
    const out: CanonicalValue[] = [];
    for (const { column, from } of declared) {
      const value = values_[from] ?? null;
      if (value !== null && valueProblem(column.type, value) !== null) {
        return {
          outcome: 'failed',
          failure: dataFailure('value_unrepresentable', { column: column.name, row: row + 1 }),
        };
      }
      out.push(value);
    }
    projected.push(out);
  }
  const ordered = sortRows(projected, draft);
  const limited = query.limit === undefined ? ordered : ordered.slice(0, query.limit);
  if (limited.length > limits.rows) return { outcome: 'failed', failure: dataFailure('row_limit') };
  const result: CanonicalResult = {
    columns: draft.columns.map((column) => [column.name, column.type.base]),
    rows: limited,
  };
  const held = orderRows(result, draft);
  if ('mismatch' in held && held.mismatch === 'key') {
    return { outcome: 'failed', failure: dataFailure('key_repeated', { row: held.row }) };
  }
  if ('mismatch' in held) {
    return {
      outcome: 'failed',
      failure: dataFailure('result_mismatch', {
        row: held.row,
        ...(held.column === undefined ? {} : { column: held.column }),
      }),
    };
  }
  if (held.rows.length === 0 && draft.empty === 'invalid') {
    return { outcome: 'failed', failure: dataFailure('empty_result') };
  }
  const bytes = canonicalResultBytes(held);
  if (Buffer.byteLength(bytes, 'utf8') > limits.bytes) {
    return { outcome: 'failed', failure: dataFailure('byte_limit') };
  }
  return {
    outcome: 'ok',
    result: {
      columns: held.columns.map(([name, base]) => [name, base]),
      rows: held.rows.map((row) => [...row]),
    },
    checksum: createHash('sha256').update(bytes, 'utf8').digest('hex'),
    rowCount: held.rows.length,
    ran: {
      dataset: {
        artifact: source.dataset,
        version: source.version,
        checksum: source.provenance.checksum,
      },
    },
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}
