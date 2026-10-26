import { useId, type ReactNode } from 'react';

import type { ValueType } from '@alloy-works/domain';

import { Icon } from '../editor/Icon.js';
import { Chip } from '../parts/Chip.js';
import { RowTable } from '../parts/RowTable.js';
import { Segmented } from '../parts/Segmented.js';
import {
  COMPARISON_WORDS,
  comparisonsFor,
  withComparison,
  type FilterDraft,
  type ParameterDraft,
} from './definitionDraft.js';
import styles from './FileFields.module.css';
import type { FileDraft } from './fileDraft.js';
import { FormatFields } from './FormatFields.js';
import { MatchCase } from './MatchCase.js';
import { partOfKind } from './HttpFields.js';
import { NEW_PART, type PartDraft } from './httpDraft.js';
import pageStyles from './QueryDefinitionPage.module.css';
import { formats, words as say, wordsWith } from '../words/words.js';

/** A segment as the path shows it: its text, or its parameter's name in braces. */
const segmentText = (part: PartDraft) => (part.kind === 'parameter' ? `{${part.text}}` : part.text);

/** A section of the card: its heading, its count, its acts on the heading's line, its hint beneath. */
export function Section({
  heading,
  count,
  aside,
  acts,
  region = true,
  hint,
  children,
}: {
  readonly heading: string;
  readonly count?: number | string;
  /** Beside the heading, before the acts: a Describe's status. */
  readonly aside?: ReactNode;
  readonly acts?: ReactNode;
  /** A landmark named by its heading; not where its one field takes the heading's words. */
  readonly region?: boolean;
  readonly hint?: ReactNode;
  readonly children?: ReactNode;
}) {
  const id = useId();
  return (
    <section {...(region ? { 'aria-labelledby': id } : {})} className={styles['section']}>
      <div className={styles['head']}>
        <h3 id={id}>{heading}</h3>
        {count !== undefined && (
          <Chip>{typeof count === 'number' ? formats().number(count) : count}</Chip>
        )}
        {aside}
        <span className={styles['spacer']} />
        {acts}
      </div>
      {hint !== undefined && <p className={pageStyles['hint']}>{hint}</p>}
      {children}
    </section>
  );
}

/** An act on a heading's line, in words beside its glyph: "Add segment". */
export function Act({ words, onClick }: { readonly words: string; readonly onClick: () => void }) {
  return (
    <button type="button" className={styles['act']} onClick={onClick}>
      <Icon name="Add" size={13} />
      {words}
    </button>
  );
}

/**
 * An S3 connection's half of a query definition's Query step (the D6 plan, task 2), drawn as one
 * card (the query file handoff): the object's key, a segment a row, fixed text or one of the
 * parameters placed whole; the format its rows are read in, on one line; and filters over the
 * columns declared, a row each, which the connector applies to the file's own rows as typed
 * comparisons. A value is never typed into a key: a segment refuses a slash, . and .. .
 */
export function FileFields({
  file,
  parameters,
  columns,
  onChange,
}: {
  readonly file: FileDraft;
  readonly parameters: readonly ParameterDraft[];
  /** The declared columns a filter may compare, each with its type where it has one. */
  readonly columns: readonly { readonly name: string; readonly type: ValueType | null }[];
  readonly onChange: (file: FileDraft) => void;
}) {
  const setSegment = (at: number, part: PartDraft) =>
    onChange({ ...file, key: file.key.map((held, place) => (place === at ? part : held)) });
  const offered = columns.filter((column) => column.type !== null);
  const typeOf = (name: string) => offered.find((each) => each.name === name)?.type ?? null;
  const listed = (filter: FilterDraft) =>
    'parameter' in filter.to &&
    parameters.some(
      (each) => 'parameter' in filter.to && each.name === filter.to.parameter && each.list,
    );
  /** A filter whose comparison its column and operand no longer take takes the first they do. */
  const fitted = (filter: FilterDraft): FilterDraft => {
    const allowed = comparisonsFor(typeOf(filter.column), listed(filter));
    return allowed.includes(filter.is) ? filter : withComparison(filter, allowed[0]!);
  };
  const setFilter = (at: number, filter: FilterDraft) =>
    onChange({
      ...file,
      filters: file.filters.map((held, place) => (place === at ? fitted(filter) : held)),
    });
  const addFilter = () => {
    const column = offered[0]!.name;
    const first = parameters.find((each) => !each.list);
    onChange({
      ...file,
      filters: [
        ...file.filters,
        fitted({
          column,
          is: 'equal',
          to:
            first === undefined
              ? { value: '', type: typeOf(column) ?? { base: 'text' } }
              : { parameter: first.name },
        }),
      ],
    });
  };

  return (
    <>
      <Section
        heading={say('data.where-the-file-is-in-the-bucket')}
        hint={say('data.each-segment-is-one-folder')}
        acts={
          <>
            {file.key.length > 0 && (
              <span className={styles['reads']}>
                {wordsWith(
                  'data.reads-key',
                  {},
                  { key: <code data-content>{file.key.map(segmentText).join('/')}</code> },
                )}
              </span>
            )}
            <Act
              words={say('data.add-segment')}
              onClick={() => onChange({ ...file, key: [...file.key, NEW_PART] })}
            />
          </>
        }
      >
        {file.key.length > 0 && (
          <RowTable
            label={say('data.segments-of-the-key')}
            columns={[
              { head: say('data.fixed-or-a-parameter'), width: 200 },
              { head: say('data.segment') },
            ]}
            rows={file.key.map((part, at) => {
              const label = say('data.segment-2', { n: at + 1 });
              return {
                key: at,
                cells: [
                  <select
                    key="kind"
                    aria-label={say('data.fixed-or-a-parameter-2', { label })}
                    value={part.kind}
                    onChange={(event) =>
                      setSegment(
                        at,
                        partOfKind(event.target.value as PartDraft['kind'], parameters),
                      )
                    }
                  >
                    <option value="fixed">{say('data.fixed')}</option>
                    <option value="parameter">{say('data.parameter')}</option>
                  </select>,
                  part.kind === 'fixed' ? (
                    <input
                      key="text"
                      aria-label={label}
                      className={styles['mono']}
                      value={part.text}
                      spellCheck={false}
                      onChange={(event) => setSegment(at, { ...part, text: event.target.value })}
                    />
                  ) : (
                    <select
                      key="parameter"
                      aria-label={say('data.parameter-2', { label })}
                      value={part.text}
                      onChange={(event) => setSegment(at, { ...part, text: event.target.value })}
                    >
                      {part.text === '' && (
                        <option value="">{say('data.choose-a-parameter')}</option>
                      )}
                      {parameters.map((parameter) => (
                        <option key={parameter.name} value={parameter.name}>
                          {parameter.name}
                        </option>
                      ))}
                    </select>
                  ),
                ],
                remove: say('data.remove-segment', { n: at + 1 }),
                onRemove: () =>
                  onChange({ ...file, key: file.key.filter((_, place) => place !== at) }),
              };
            })}
          />
        )}
      </Section>

      <Section heading={say('data.format')}>
        <FormatFields draft={file} holder="file" onChange={onChange} />
      </Section>

      <Section
        heading={say('data.filters')}
        hint={say('data.a-filter-compares-each-rows')}
        acts={
          <>
            {file.filters.length > 1 && (
              <Segmented
                label={say('data.match')}
                value={file.match}
                onChange={(match) => onChange({ ...file, match: match as FileDraft['match'] })}
                options={[
                  { value: 'all', label: say('data.match-all'), name: say('data.match-all') },
                  { value: 'any', label: say('data.match-any'), name: say('data.match-any') },
                ]}
              />
            )}
            {offered.length > 0 && <Act words={say('data.add-a-filter')} onClick={addFilter} />}
          </>
        }
      >
        {offered.length === 0 && (
          <p className={pageStyles['hint']}>{say('data.sample-the-file-and-confirm')}</p>
        )}
        {file.filters.length > 0 && (
          <RowTable
            label={say('data.filters')}
            columns={[
              { head: say('data.column'), width: 240 },
              { head: say('data.compared-with'), width: 220 },
              { head: say('data.comparison'), width: 200 },
              { head: say('data.value') },
            ]}
            rows={file.filters.map((filter, at) => {
              const n = at + 1;
              const compares = filter.is !== 'isNull' && filter.is !== 'isNotNull';
              return {
                key: at,
                cells: [
                  <select
                    key="column"
                    aria-label={say('data.column-of-filter', { n })}
                    value={filter.column}
                    onChange={(event) => setFilter(at, { ...filter, column: event.target.value })}
                  >
                    {offered.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>,
                  <select
                    key="to"
                    aria-label={say('data.filter-compared-with', { n })}
                    value={'parameter' in filter.to ? `parameter:${filter.to.parameter}` : 'value'}
                    onChange={(event) => {
                      const chosen = event.target.value;
                      setFilter(at, {
                        ...filter,
                        to: chosen.startsWith('parameter:')
                          ? { parameter: chosen.slice('parameter:'.length) }
                          : { value: '', type: typeOf(filter.column) ?? { base: 'text' } },
                      });
                    }}
                  >
                    {parameters.map((parameter) => (
                      <option key={parameter.name} value={`parameter:${parameter.name}`}>
                        {parameter.name}
                      </option>
                    ))}
                    <option value="value">{say('data.a-fixed-value')}</option>
                  </select>,
                  <select
                    key="is"
                    aria-label={say('data.comparison-of-filter', { n })}
                    value={filter.is}
                    onChange={(event) =>
                      setFilter(at, withComparison(filter, event.target.value as FilterDraft['is']))
                    }
                  >
                    {comparisonsFor(typeOf(filter.column), listed(filter)).map((each) => (
                      <option key={each} value={each}>
                        {COMPARISON_WORDS[each]}
                      </option>
                    ))}
                  </select>,
                  !compares ? null : (
                    <span key="value" className={styles['value']}>
                      {'value' in filter.to ? (
                        <input
                          aria-label={say('data.value-of-filter', { n })}
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
                        <span className={pageStyles['hint']}>
                          {say('data.the-value-of', { parameter: filter.to.parameter })}
                        </span>
                      )}
                      <MatchCase
                        filter={filter}
                        name={say('data.match-case-of-filter', { n })}
                        onChange={(changed) => setFilter(at, changed)}
                      />
                    </span>
                  ),
                ],
                remove: say('data.remove-filter', { n }),
                onRemove: () =>
                  onChange({ ...file, filters: file.filters.filter((_, place) => place !== at) }),
              };
            })}
          />
        )}
      </Section>
    </>
  );
}
