import { Choice } from './Choice.js';
import type { FormatDraft } from './httpDraft.js';
import styles from './QueryDefinitionPage.module.css';

/** The words for each CSV delimiter, as the format offers it. */
const DELIMITERS: Readonly<Record<FormatDraft['delimiter'], string>> = {
  comma: 'Comma',
  semicolon: 'Semicolon',
  tab: 'Tab',
  pipe: 'Vertical bar',
};

/**
 * The format rows are read in, whatever carried them (the D6 plan, D6-F): JSON at a pointer, JSON
 * Lines, or CSV with its delimiter, its header and its convention for an empty field.
 */
export function FormatFields<Draft extends FormatDraft>({
  draft,
  noun,
  onChange,
}: {
  readonly draft: Draft;
  /** What holds the rows: "answer" or "file". */
  readonly noun: string;
  readonly onChange: (draft: Draft) => void;
}) {
  return (
    <>
      <Choice label={`The ${noun} is`}>
        {(id) => (
          <select
            id={id}
            value={draft.format}
            onChange={(event) =>
              onChange({ ...draft, format: event.target.value as FormatDraft['format'] })
            }
          >
            <option value="json">JSON</option>
            <option value="jsonLines">JSON Lines, an object a line</option>
            <option value="csv">CSV</option>
          </select>
        )}
      </Choice>
      {draft.format === 'json' && (
        <>
          <label>
            Rows at
            <input
              value={draft.rows}
              spellCheck={false}
              placeholder="/data/items"
              onChange={(event) => onChange({ ...draft, rows: event.target.value })}
            />
          </label>
          <label>
            {`Row count at, where the ${noun} states one`}
            <input
              value={draft.count}
              spellCheck={false}
              onChange={(event) => onChange({ ...draft, count: event.target.value })}
            />
          </label>
          <p className={styles['hint']}>
            Each is a JSON Pointer: empty for the whole {noun}, or each name after a /. A stated
            count is checked against the rows read.
          </p>
        </>
      )}
      {draft.format === 'csv' && (
        <>
          <Choice label="Fields are separated by">
            {(id) => (
              <select
                id={id}
                value={draft.delimiter}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    delimiter: event.target.value as FormatDraft['delimiter'],
                  })
                }
              >
                {(Object.keys(DELIMITERS) as FormatDraft['delimiter'][]).map((each) => (
                  <option key={each} value={each}>
                    {DELIMITERS[each]}
                  </option>
                ))}
              </select>
            )}
          </Choice>
          <label className={styles['check']}>
            <input
              type="checkbox"
              checked={draft.headerRow}
              onChange={(event) => onChange({ ...draft, headerRow: event.target.checked })}
            />
            The first record names the fields
          </label>
          <Choice label="An empty field">
            {(id) => (
              <select
                id={id}
                value={draft.nulls}
                onChange={(event) =>
                  onChange({ ...draft, nulls: event.target.value as FormatDraft['nulls'] })
                }
              >
                <option value="empty">Is empty, unless it is quoted</option>
                <option value="never">Is empty text</option>
              </select>
            )}
          </Choice>
          <p className={styles['hint']}>
            A column is read by its field&apos;s header, or by its letter, A for the first. Under
            the first convention, &quot;&quot; is empty text and a field with nothing in it is
            empty.
          </p>
        </>
      )}
    </>
  );
}
