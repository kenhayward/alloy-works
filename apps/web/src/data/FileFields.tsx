import { useId } from 'react';

import type { ValueType } from '@alloy-works/domain';

import { Choice } from './Choice.js';
import {
  COMPARISON_WORDS,
  comparisonsFor,
  type FilterDraft,
  type ParameterDraft,
} from './definitionDraft.js';
import type { FileDraft } from './fileDraft.js';
import { FormatFields } from './FormatFields.js';
import { PartField } from './HttpFields.js';
import { NEW_PART, type PartDraft } from './httpDraft.js';
import styles from './QueryDefinitionPage.module.css';

/** A segment as the path shows it: its text, or its parameter's name in braces. */
const segmentText = (part: PartDraft) => (part.kind === 'parameter' ? `{${part.text}}` : part.text);

/**
 * An S3 connection's half of a query definition's Query step (the D6 plan, task 2): the object's key,
 * a segment each, fixed text or one of the parameters below placed whole; the format its rows are
 * read in; and filters over the columns declared, which the connector applies to the file's own rows
 * as typed comparisons. A value is never typed into a key: a segment refuses a slash, . and .. .
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
  const matchName = useId();
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
    return allowed.includes(filter.is) ? filter : { ...filter, is: allowed[0]! };
  };
  const setFilter = (at: number, filter: FilterDraft) =>
    onChange({
      ...file,
      filters: file.filters.map((held, place) => (place === at ? fitted(filter) : held)),
    });
  return (
    <div className={styles['form']}>
      <fieldset className={styles['parameter']}>
        <legend>Where the file is in the bucket</legend>
        <p className={styles['hint']}>
          Each segment is one folder of the path, in order, then the file name: the parts of what S3
          calls its key.
        </p>
        {file.key.map((part, at) => (
          <div key={at} className={styles['fragment']}>
            <PartField
              label={`Segment ${at + 1}`}
              part={part}
              parameters={parameters}
              onChange={(changed) => setSegment(at, changed)}
            />
            <button
              type="button"
              onClick={() =>
                onChange({ ...file, key: file.key.filter((_, place) => place !== at) })
              }
            >
              {`Remove segment ${at + 1}`}
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onChange({ ...file, key: [...file.key, NEW_PART] })}>
          Add segment
        </button>
        {file.key.length > 0 && (
          <p className={styles['hint']}>{`Reads ${file.key.map(segmentText).join('/')}`}</p>
        )}
      </fieldset>
      <FormatFields draft={file} noun="file" onChange={onChange} />

      {file.filters.map((filter, at) => {
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
                  onChange={(event) => setFilter(at, { ...filter, column: event.target.value })}
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
                  {comparisonsFor(typeOf(filter.column), listed(filter)).map((each) => (
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
                onChange({ ...file, filters: file.filters.filter((_, place) => place !== at) })
              }
            >
              {`Remove filter ${at + 1}`}
            </button>
          </fieldset>
        );
      })}
      {offered.length > 0 ? (
        <button
          type="button"
          onClick={() => {
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
          }}
        >
          Add a filter
        </button>
      ) : (
        <p className={styles['hint']}>
          Sample the file and confirm its columns to filter its rows.
        </p>
      )}
      {file.filters.length > 1 && (
        <fieldset>
          <legend>Match</legend>
          <label className={styles['check']}>
            <input
              type="radio"
              name={matchName}
              checked={file.match === 'all'}
              onChange={() => onChange({ ...file, match: 'all' })}
            />
            Match all
          </label>
          <label className={styles['check']}>
            <input
              type="radio"
              name={matchName}
              checked={file.match === 'any'}
              onChange={() => onChange({ ...file, match: 'any' })}
            />
            Match any
          </label>
        </fieldset>
      )}
      <p className={styles['hint']}>
        A filter compares each row&apos;s value as its column&apos;s type: a time by its value, text
        by code point. A value is placed in the key whole, and a segment refuses a slash, . and ..;
        the key is read in the connection&apos;s bucket alone.
      </p>
    </div>
  );
}
