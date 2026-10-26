import { aggregates, type AggregateName, type ValueType } from '@alloy-works/domain';
import type { ReactNode } from 'react';

import { RowTable } from '../parts/RowTable.js';
import { Segmented } from '../parts/Segmented.js';

import { MatchCase } from './MatchCase.js';
import { Choice, Status } from './Choice.js';
import {
  BASES,
  COMPARISON_WORDS,
  comparisonsFor,
  withComparison,
  fitFilter,
  operandOf,
  type BuilderDraft,
  type FilterDraft,
  type ParameterDraft,
  type SummaryDraft,
} from './definitionDraft.js';
import fileStyles from './FileFields.module.css';
import { Act, Section } from './FileFields.js';
import styles from './QueryDefinitionPage.module.css';
import { isRecord, leftOutText, type Described } from './shapes.js';
import { formats, words } from '../words/words.js';

/**
 * The builder's half of a query definition's Query step (the D4 plan, D4-O): one table or view from
 * the source's own list, the columns it returns and the names it returns them as, filters each
 * comparing a column with a parameter or a fixed value under all or any, and grouping by the columns
 * returned with the five aggregates. Built from the page's own kit; the page shows the SQL it runs.
 * Drawn as sections of the Query tab's one card (the postgres query handoff): a line for the query,
 * then Columns to return, Filters and Summaries, each repeating thing a row.
 */

const AGGREGATE_WORDS: Readonly<Record<AggregateName, string>> = {
  get count() {
    return words('data.count');
  },
  get sum() {
    return words('data.sum');
  },
  get average() {
    return words('data.average');
  },
  get minimum() {
    return words('data.minimum');
  },
  get maximum() {
    return words('data.maximum');
  },
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
    lines.push(words('data.the-list-was-cut-short'));
  }
  const left = leftOutText(described.leftOut);
  if (left !== null) lines.push(left);
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
  head,
}: {
  readonly builder: BuilderDraft;
  readonly parameters: readonly ParameterDraft[];
  /** The source's tables and views, once described. */
  readonly described: Described | null;
  readonly describedLines: readonly string[] | null;
  readonly busy: boolean;
  readonly onDescribe: () => void;
  readonly onChange: (builder: BuilderDraft) => void;
  /** The query line's switch, Builder or SQL, or why SQL is not offered. */
  readonly head: ReactNode;
}) {
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
  const addFilter = () => {
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
  };
  const addSummary = () =>
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
    });
  const setSummary = (at: number, summary: SummaryDraft) =>
    onChange({
      ...builder,
      summaries: builder.summaries.map((held, place) => (place === at ? summary : held)),
    });

  // Every column the definition may hold; Select all ticks them, or clears them once all are ticked.
  const picked = (name: string) => builder.columns.some((each) => each.column === name);
  const allPicked = offered.length > 0 && offered.every((column) => picked(column.name));
  const somePicked = builder.columns.length > 0 && !allPicked;
  const selectAll = () =>
    onChange({
      ...builder,
      columns: allPicked
        ? []
        : [
            ...builder.columns,
            ...offered
              .filter((column) => !picked(column.name))
              .map((column) => ({ column: column.name, name: column.name })),
          ],
    });
  // Three columns side by side, read down each (PQ-B).
  const perColumn = Math.max(1, Math.ceil(available.length / 3));

  return (
    <>
      <Section
        heading={words('data.write-the-query-with')}
        aside={
          <span className={styles['queryLine']}>
            {head}
            {(described !== null || builder.table !== null) && (
              <Choice label={words('data.table-or-view')}>
                {(id) => (
                  <select
                    id={id}
                    value={
                      builder.table === null
                        ? ''
                        : tableKey(builder.table.schema, builder.table.name)
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
                    {builder.table === null && (
                      <option value="">{words('data.choose-a-table-or-view')}</option>
                    )}
                    {builder.table !== null && chosen === undefined && (
                      <option
                        value={tableKey(builder.table.schema, builder.table.name)}
                        data-content
                      >
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
                                {holdable
                                  ? `${each.schema}.${each.name}`
                                  : words('data.relation-not-offered', {
                                      name: `${each.schema}.${each.name}`,
                                    })}
                              </option>
                            );
                          })}
                      </optgroup>
                    ))}
                  </select>
                )}
              </Choice>
            )}
          </span>
        }
        acts={
          <button
            type="button"
            disabled={busy}
            title={words('data.lists-the-tables-and-views')}
            onClick={onDescribe}
          >
            {words('data.describe-the-source')}
          </button>
        }
      >
        <Status lines={describedLines} />
        {described !== null &&
          listedLines(described).map((line) => (
            <p key={line} className={styles['hint']}>
              {line}
            </p>
          ))}
        {unoffered.length > 0 && (
          <p className={styles['hint']}>
            {words('data.not-offered-as-not-in', {
              count: unoffered.length,
              names: formats().list(unoffered, { type: 'unit', style: 'short' }),
            })}
          </p>
        )}
      </Section>

      {builder.table !== null && (
        <>
          <Section
            heading={words('data.columns-to-return')}
            count={words('data.of', { picked: builder.columns.length, offered: offered.length })}
            aside={
              <label className={styles['check']}>
                <input
                  type="checkbox"
                  ref={(element) => {
                    if (element !== null) element.indeterminate = somePicked;
                  }}
                  checked={allPicked}
                  disabled={offered.length === 0}
                  onChange={selectAll}
                />
                {words('data.select-all')}
              </label>
            }
          >
            <div className={styles['returnedHead']} aria-hidden="true">
              {[0, 1, 2]
                .filter((place) => place * perColumn < available.length)
                .map((place) => (
                  <span key={place}>
                    <span>{words('data.at-the-source')}</span>
                    <span>{words('data.returned-as')}</span>
                  </span>
                ))}
            </div>
            <ul
              className={styles['returned']}
              style={{ gridTemplateRows: `repeat(${perColumn}, auto)` }}
            >
              {available.map((column) => {
                const held = builder.columns.find((each) => each.column === column.name);
                return (
                  <li key={column.name}>
                    <label className={styles['check']}>
                      <input
                        type="checkbox"
                        checked={held !== undefined}
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
                      <span className={styles['mono']} data-content>
                        {column.name}
                      </span>
                    </label>
                    {held !== undefined && (
                      <input
                        aria-label={words('data.name-of', { name: column.name })}
                        value={held.name}
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
                    )}
                  </li>
                );
              })}
            </ul>
            {offered.length < available.length && (
              <p className={styles['hint']}>{words('data.a-column-whose-name-is')}</p>
            )}
          </Section>

          <Section
            heading={words('data.filters')}
            hint={words('data.text-is-compared-by-code-point')}
            acts={
              <>
                {builder.filters.length > 1 && (
                  <Segmented
                    label={words('data.match')}
                    value={builder.match}
                    onChange={(match) =>
                      onChange({ ...builder, match: match as BuilderDraft['match'] })
                    }
                    options={[
                      {
                        value: 'all',
                        label: words('data.match-all'),
                        name: words('data.match-all'),
                      },
                      {
                        value: 'any',
                        label: words('data.match-any'),
                        name: words('data.match-any'),
                      },
                    ]}
                  />
                )}
                {offered.length > 0 && (
                  <Act words={words('data.add-a-filter')} onClick={addFilter} />
                )}
              </>
            }
          >
            {builder.filters.length > 0 && (
              <RowTable
                label={words('data.filters')}
                columns={[
                  { head: words('data.column'), width: 230 },
                  { head: words('data.compared-with'), width: 210 },
                  { head: words('data.comparison'), width: 190 },
                  { head: words('data.value') },
                ]}
                rows={builder.filters.map((filter, at) => {
                  const n = at + 1;
                  const { type, list } = operandOf(filter, parameters);
                  const compares = filter.is !== 'isNull' && filter.is !== 'isNotNull';
                  return {
                    key: at,
                    cells: [
                      <select
                        key="column"
                        aria-label={words('data.column-of-filter', { n })}
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
                      </select>,
                      <select
                        key="to"
                        aria-label={words('data.filter-compared-with', { n })}
                        value={
                          'parameter' in filter.to ? `parameter:${filter.to.parameter}` : 'value'
                        }
                        onChange={(event) => {
                          const operand = event.target.value;
                          setFilter(at, {
                            ...filter,
                            to: operand.startsWith('parameter:')
                              ? { parameter: operand.slice('parameter:'.length) }
                              : { value: '', type: typeOf(filter.column) ?? { base: 'text' } },
                          });
                        }}
                      >
                        {parameters.map((parameter) => (
                          <option key={parameter.name} value={`parameter:${parameter.name}`}>
                            {parameter.name}
                          </option>
                        ))}
                        <option value="value">{words('data.a-fixed-value')}</option>
                      </select>,
                      <select
                        key="is"
                        aria-label={words('data.comparison-of-filter', { n })}
                        value={filter.is}
                        onChange={(event) =>
                          setFilter(
                            at,
                            withComparison(filter, event.target.value as FilterDraft['is']),
                          )
                        }
                      >
                        {comparisonsFor(type, list).map((each) => (
                          <option key={each} value={each}>
                            {COMPARISON_WORDS[each]}
                          </option>
                        ))}
                      </select>,
                      !compares ? null : (
                        <span key="value" className={fileStyles['value']}>
                          {'value' in filter.to ? (
                            <input
                              aria-label={words('data.value-of-filter', { n })}
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
                          ) : (
                            <span className={styles['hint']}>
                              {words('data.the-value-of', { parameter: filter.to.parameter })}
                            </span>
                          )}
                          <MatchCase
                            filter={filter}
                            name={words('data.match-case-of-filter', { n })}
                            onChange={(changed) => setFilter(at, changed)}
                          />
                        </span>
                      ),
                    ],
                    remove: words('data.remove-filter', { n }),
                    onRemove: () =>
                      onChange({
                        ...builder,
                        filters: builder.filters.filter((_, place) => place !== at),
                      }),
                  };
                })}
              />
            )}
          </Section>

          <Section
            heading={words('data.summaries')}
            aside={
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
                {words('data.group-and-summarise')}
              </label>
            }
            hint={
              builder.grouped
                ? words('data.rows-are-grouped-by-the')
                : words('data.rows-are-grouped-by-the-2')
            }
            acts={
              builder.grouped && <Act words={words('data.add-a-summary')} onClick={addSummary} />
            }
          >
            {builder.grouped && builder.summaries.length > 0 && (
              <RowTable
                label={words('data.summaries')}
                columns={[
                  { head: words('data.summary'), width: 170 },
                  { head: words('data.of-2'), width: 230 },
                  { head: words('data.name') },
                  { head: words('data.places'), width: 170 },
                ]}
                rows={builder.summaries.map((summary, at) => {
                  const n = at + 1;
                  return {
                    key: at,
                    cells: [
                      <select
                        key="aggregate"
                        aria-label={words('data.summary-2', { n })}
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
                      </select>,
                      <select
                        key="of"
                        aria-label={words('data.of-summary', { n })}
                        value={summary.column}
                        onChange={(event) =>
                          setSummary(at, { ...summary, column: event.target.value })
                        }
                      >
                        {summary.aggregate === 'count' && (
                          <option value="">{words('data.every-row')}</option>
                        )}
                        {offered.map((column) => (
                          <option key={column.name} value={column.name}>
                            {column.name}
                          </option>
                        ))}
                      </select>,
                      <input
                        key="name"
                        aria-label={words('data.name-of-summary', { n })}
                        value={summary.name}
                        spellCheck={false}
                        onChange={(event) =>
                          setSummary(at, { ...summary, name: event.target.value })
                        }
                      />,
                      summary.aggregate === 'average' ? (
                        <input
                          key="places"
                          aria-label={words('data.places-of-summary', { n })}
                          inputMode="numeric"
                          value={summary.places}
                          onChange={(event) =>
                            setSummary(at, { ...summary, places: event.target.value })
                          }
                        />
                      ) : (
                        <span key="places" className={styles['hint']}>
                          {words('data.only-for-an-average')}
                        </span>
                      ),
                    ],
                    remove: words('data.remove-summary', { n }),
                    onRemove: () =>
                      onChange({
                        ...builder,
                        summaries: builder.summaries.filter((_, place) => place !== at),
                      }),
                  };
                })}
              />
            )}
          </Section>
        </>
      )}
    </>
  );
}
