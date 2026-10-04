import { aggregates, type AggregateName, type ValueType } from '@alloy-works/domain';
import { useId } from 'react';

import { Choice, Status } from './Choice.js';
import {
  BASES,
  COMPARISON_WORDS,
  comparisonsFor,
  fitFilter,
  operandOf,
  type BuilderDraft,
  type FilterDraft,
  type ParameterDraft,
  type SummaryDraft,
} from './definitionDraft.js';
import styles from './QueryDefinitionPage.module.css';
import { isRecord, type Described } from './shapes.js';

/**
 * The builder's half of a query definition's Query step (the D4 plan, D4-O): one table or view from
 * the source's own list, the columns it returns and the names it returns them as, filters each
 * comparing a column with a parameter or a fixed value under all or any, and grouping by the columns
 * returned with the five aggregates. Built from the page's own kit; the page shows the SQL it runs.
 */

const AGGREGATE_WORDS: Readonly<Record<AggregateName, string>> = {
  count: 'Count',
  sum: 'Sum',
  average: 'Average',
  minimum: 'Minimum',
  maximum: 'Maximum',
};

/** Whether a source's name can be held by a definition, which holds names in NFC alone (D2-F, D4-P). */
const composed = (name: string) => name === name.normalize('NFC');

/** A table or view as the select's value: its schema and name, each whole. */
const tableKey = (schema: string, name: string) => JSON.stringify([schema, name]);

/** The type the source proposed for a column, where it proposed one a filter's value can take. */
function proposedType(proposed: unknown): ValueType | null {
  if (!isRecord(proposed) || !BASES.some((each) => each.base === proposed.base)) return null;
  return proposed as ValueType;
}

/** What a relation's describe says of one column: its name, and the type proposed for it. */
interface SourceColumn {
  readonly name: string;
  readonly type: ValueType | null;
}

/** What a describe lists, said as the Connections page says it. */
function listedLines(described: Described): string[] {
  const lines: string[] = [];
  if (described.truncated) {
    lines.push(
      'The list was cut short: the source has more tables and views than the connector lists at once.',
    );
  }
  const { relations, columns } = described.leftOut;
  const parts = [
    relations > 0 && `${relations} ${relations === 1 ? 'table or view' : 'tables or views'}`,
    columns > 0 && `${columns} ${columns === 1 ? 'column' : 'columns'}`,
  ].filter((part): part is string => typeof part === 'string');
  if (parts.length > 0) {
    lines.push(
      `Left out because their names or types cannot be shown here: ${parts.join(', and ')}.`,
    );
  }
  return lines;
}

/** A unique name for a new summary, from its aggregate. */
function summaryName(aggregate: AggregateName, taken: readonly string[]): string {
  if (!taken.includes(aggregate)) return aggregate;
  for (let at = 2; ; at += 1) {
    const name = `${aggregate}_${at}`;
    if (!taken.includes(name)) return name;
  }
}

export function BuilderFields({
  builder,
  parameters,
  described,
  describedLines,
  busy,
  onDescribe,
  onChange,
}: {
  readonly builder: BuilderDraft;
  readonly parameters: readonly ParameterDraft[];
  /** The source's tables and views, once described. */
  readonly described: Described | null;
  readonly describedLines: readonly string[] | null;
  readonly busy: boolean;
  readonly onDescribe: () => void;
  readonly onChange: (builder: BuilderDraft) => void;
}) {
  const matchName = useId();
  const relations = described?.relations ?? [];
  const chosen =
    builder.table === null
      ? undefined
      : relations.find(
          (each) => each.schema === builder.table!.schema && each.name === builder.table!.name,
        );
  // The chosen table's columns as the source listed them, or, before it is described again, those
  // the draft already names.
  const available: readonly SourceColumn[] =
    chosen !== undefined
      ? chosen.columns.map((column) => ({
          name: column.name,
          type: proposedType((column as { proposed?: unknown }).proposed),
        }))
      : [
          ...new Set([
            ...builder.columns.map((each) => each.column),
            ...builder.filters.map((each) => each.column),
            ...builder.summaries.map((each) => each.column).filter((each) => each !== ''),
          ]),
        ].map((name) => ({ name, type: null }));
  const offered = available.filter((column) => composed(column.name));
  const typeOf = (column: string) => available.find((each) => each.name === column)?.type ?? null;

  const unoffered = relations
    .filter((each) => !composed(each.schema) || !composed(each.name))
    .map((each) => `${each.schema}.${each.name}`);
  const schemas = [...new Set(relations.map((each) => each.schema))];

  const setFilter = (at: number, filter: FilterDraft) =>
    onChange({
      ...builder,
      filters: builder.filters.map((held, place) =>
        place === at ? fitFilter(filter, parameters) : held,
      ),
    });
  const setSummary = (at: number, summary: SummaryDraft) =>
    onChange({
      ...builder,
      summaries: builder.summaries.map((held, place) => (place === at ? summary : held)),
    });

  return (
    <div className={styles['form']}>
      <button type="button" disabled={busy} onClick={onDescribe}>
        Describe the source
      </button>
      <p className={styles['hint']}>
        Lists the tables and views the connection&apos;s account may read, to build the query from.
      </p>
      <Status lines={describedLines} />
      {described !== null && listedLines(described).map((line) => <p key={line}>{line}</p>)}

      {(described !== null || builder.table !== null) && (
        <Choice label="Table or view">
          {(id) => (
            <select
              id={id}
              value={
                builder.table === null ? '' : tableKey(builder.table.schema, builder.table.name)
              }
              onChange={(event) => {
                const [schema, name] = JSON.parse(event.target.value) as [string, string];
                onChange({
                  ...builder,
                  table: { schema, name },
                  columns: [],
                  filters: [],
                  summaries: [],
                });
              }}
            >
              {builder.table === null && <option value="">Choose a table or view</option>}
              {builder.table !== null && chosen === undefined && (
                <option value={tableKey(builder.table.schema, builder.table.name)}>
                  {`${builder.table.schema}.${builder.table.name}`}
                </option>
              )}
              {schemas.map((schema) => (
                <optgroup key={schema} label={schema}>
                  {relations
                    .filter((each) => each.schema === schema)
                    .map((each) => {
                      const holdable = composed(each.schema) && composed(each.name);
                      return (
                        <option
                          key={each.name}
                          value={tableKey(each.schema, each.name)}
                          disabled={!holdable}
                        >
                          {`${each.schema}.${each.name}${holdable ? '' : ' (not offered)'}`}
                        </option>
                      );
                    })}
                </optgroup>
              ))}
            </select>
          )}
        </Choice>
      )}
      {unoffered.length > 0 && (
        <p className={styles['hint']}>
          {`Not offered, as ${unoffered.length === 1 ? 'its name is' : 'their names are'} not in the composed form a query definition holds: ${unoffered.join(', ')}. A view at the source under a composed name reaches ${unoffered.length === 1 ? 'it' : 'each'}.`}
        </p>
      )}

      {builder.table !== null && (
        <>
          <fieldset className={styles['parameter']}>
            <legend>Columns to return</legend>
            {available.map((column) => {
              const picked = builder.columns.find((each) => each.column === column.name);
              return (
                <div key={column.name} className={styles['fragment']}>
                  <label className={styles['check']}>
                    <input
                      type="checkbox"
                      checked={picked !== undefined}
                      disabled={!composed(column.name)}
                      onChange={(event) =>
                        onChange({
                          ...builder,
                          columns: event.target.checked
                            ? [...builder.columns, { column: column.name, name: column.name }]
                            : builder.columns.filter((each) => each.column !== column.name),
                        })
                      }
                    />
                    {column.name}
                  </label>
                  {picked !== undefined && (
                    <label>
                      {`Name of ${column.name}`}
                      <input
                        value={picked.name}
                        spellCheck={false}
                        onChange={(event) =>
                          onChange({
                            ...builder,
                            columns: builder.columns.map((each) =>
                              each.column === column.name
                                ? { ...each, name: event.target.value }
                                : each,
                            ),
                          })
                        }
                      />
                    </label>
                  )}
                </div>
              );
            })}
            {offered.length < available.length && (
              <p className={styles['hint']}>
                A column whose name is not in the composed form a query definition holds is shown
                and not offered. A view at the source under a composed name reaches it.
              </p>
            )}
          </fieldset>

          {builder.filters.map((filter, at) => {
            const { type, list } = operandOf(filter, parameters);
            const fixed = 'value' in filter.to;
            const compares = filter.is !== 'isNull' && filter.is !== 'isNotNull';
            return (
              <fieldset key={at} className={styles['parameter']}>
                <legend>{`Filter ${at + 1}`}</legend>
                <Choice label="Column">
                  {(id) => (
                    <select
                      id={id}
                      value={filter.column}
                      onChange={(event) => {
                        const column = event.target.value;
                        setFilter(at, {
                          ...filter,
                          column,
                          to:
                            'value' in filter.to
                              ? { ...filter.to, type: typeOf(column) ?? { base: 'text' } }
                              : filter.to,
                        });
                      }}
                    >
                      {offered.map((column) => (
                        <option key={column.name} value={column.name}>
                          {column.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Choice>
                <Choice label="Compared with">
                  {(id) => (
                    <select
                      id={id}
                      value={
                        'parameter' in filter.to ? `parameter:${filter.to.parameter}` : 'value'
                      }
                      onChange={(event) => {
                        const chosenOperand = event.target.value;
                        setFilter(at, {
                          ...filter,
                          to: chosenOperand.startsWith('parameter:')
                            ? { parameter: chosenOperand.slice('parameter:'.length) }
                            : { value: '', type: typeOf(filter.column) ?? { base: 'text' } },
                        });
                      }}
                    >
                      {parameters.map((parameter) => (
                        <option key={parameter.name} value={`parameter:${parameter.name}`}>
                          {parameter.name}
                        </option>
                      ))}
                      <option value="value">A fixed value</option>
                    </select>
                  )}
                </Choice>
                <Choice label="Comparison">
                  {(id) => (
                    <select
                      id={id}
                      value={filter.is}
                      onChange={(event) =>
                        setFilter(at, { ...filter, is: event.target.value as FilterDraft['is'] })
                      }
                    >
                      {comparisonsFor(type, list).map((each) => (
                        <option key={each} value={each}>
                          {COMPARISON_WORDS[each]}
                        </option>
                      ))}
                    </select>
                  )}
                </Choice>
                {fixed && compares && 'value' in filter.to && (
                  <label>
                    Value
                    <input
                      value={filter.to.value}
                      onChange={(event) =>
                        setFilter(at, {
                          ...filter,
                          to: {
                            ...(filter.to as { value: string; type: ValueType }),
                            value: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...builder,
                      filters: builder.filters.filter((_, place) => place !== at),
                    })
                  }
                >
                  {`Remove filter ${at + 1}`}
                </button>
              </fieldset>
            );
          })}
          {offered.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const column = offered[0]!.name;
                const first = parameters[0];
                onChange({
                  ...builder,
                  filters: [
                    ...builder.filters,
                    fitFilter(
                      {
                        column,
                        is: 'equal',
                        to:
                          first === undefined
                            ? { value: '', type: typeOf(column) ?? { base: 'text' } }
                            : { parameter: first.name },
                      },
                      parameters,
                    ),
                  ],
                });
              }}
            >
              Add a filter
            </button>
          )}
          <p className={styles['hint']}>
            Text is compared by code point, so a filter matches the text exactly as it is written. A
            value is always sent apart from the SQL, never placed in it.
          </p>
          {builder.filters.length > 1 && (
            <fieldset>
              <legend>Match</legend>
              <label className={styles['check']}>
                <input
                  type="radio"
                  name={matchName}
                  checked={builder.match === 'all'}
                  onChange={() => onChange({ ...builder, match: 'all' })}
                />
                Match all
              </label>
              <label className={styles['check']}>
                <input
                  type="radio"
                  name={matchName}
                  checked={builder.match === 'any'}
                  onChange={() => onChange({ ...builder, match: 'any' })}
                />
                Match any
              </label>
            </fieldset>
          )}

          <label className={styles['check']}>
            <input
              type="checkbox"
              checked={builder.grouped}
              onChange={(event) =>
                onChange({
                  ...builder,
                  grouped: event.target.checked,
                  summaries: event.target.checked ? builder.summaries : [],
                })
              }
            />
            Group and summarise
          </label>
          {builder.grouped && (
            <>
              <p className={styles['hint']}>
                Rows are grouped by the columns returned, and each summary is taken over a group.
              </p>
              {builder.summaries.map((summary, at) => (
                <fieldset key={at} className={styles['parameter']}>
                  <legend>{`Summary ${at + 1}`}</legend>
                  <Choice label="Summary">
                    {(id) => (
                      <select
                        id={id}
                        value={summary.aggregate}
                        onChange={(event) => {
                          const aggregate = event.target.value as AggregateName;
                          const others = builder.summaries
                            .filter((_, place) => place !== at)
                            .map((each) => each.name);
                          setSummary(at, {
                            ...summary,
                            aggregate,
                            column:
                              aggregate !== 'count' && summary.column === ''
                                ? (offered[0]?.name ?? '')
                                : summary.column,
                            name:
                              summary.name === summaryName(summary.aggregate, others)
                                ? summaryName(aggregate, others)
                                : summary.name,
                            places: aggregate === 'average' ? summary.places || '2' : '',
                          });
                        }}
                      >
                        {aggregates.map((each) => (
                          <option key={each} value={each}>
                            {AGGREGATE_WORDS[each]}
                          </option>
                        ))}
                      </select>
                    )}
                  </Choice>
                  <Choice label="Of">
                    {(id) => (
                      <select
                        id={id}
                        value={summary.column}
                        onChange={(event) =>
                          setSummary(at, { ...summary, column: event.target.value })
                        }
                      >
                        {summary.aggregate === 'count' && <option value="">Every row</option>}
                        {offered.map((column) => (
                          <option key={column.name} value={column.name}>
                            {column.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Choice>
                  <label>
                    Name
                    <input
                      value={summary.name}
                      spellCheck={false}
                      onChange={(event) => setSummary(at, { ...summary, name: event.target.value })}
                    />
                  </label>
                  {summary.aggregate === 'average' && (
                    <label>
                      Places
                      <input
                        inputMode="numeric"
                        value={summary.places}
                        onChange={(event) =>
                          setSummary(at, { ...summary, places: event.target.value })
                        }
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...builder,
                        summaries: builder.summaries.filter((_, place) => place !== at),
                      })
                    }
                  >
                    {`Remove summary ${at + 1}`}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...builder,
                    summaries: [
                      ...builder.summaries,
                      {
                        aggregate: 'count',
                        column: '',
                        name: summaryName(
                          'count',
                          builder.summaries.map((each) => each.name),
                        ),
                        places: '',
                      },
                    ],
                  })
                }
              >
                Add a summary
              </button>
              <p className={styles['hint']}>
                An average is rounded at the source to the places it declares, so its column is
                declared a decimal of at least those places.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
