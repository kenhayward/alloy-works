import { Choice } from './Choice.js';
import type { FormatDraft } from './httpDraft.js';
import styles from './QueryDefinitionPage.module.css';
import { words } from '../words/words.js';

/** The words for each CSV delimiter, as the format offers it. */
const DELIMITERS: Readonly<Record<FormatDraft['delimiter'], string>> = {
  get comma() {
    return words('data.comma');
  },
  get semicolon() {
    return words('data.semicolon');
  },
  get tab() {
    return words('data.tab');
  },
  get pipe() {
    return words('data.vertical-bar');
  },
};

/**
 * The format rows are read in, whatever carried them (the D6 plan, D6-F): JSON at a pointer, JSON
 * Lines, CSV with its delimiter, its header and its convention for an empty field, or XLSX by sheet.
 * Its hint first, then its fields on one line (the query file handoff).
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
      {draft.format === 'xlsx' && (
        <p className={styles['hint']}>{words('data.a-column-is-read-by')}</p>
      )}
      {draft.format === 'json' && (
        <p className={styles['hint']}>
          {words('data.each-is-a-json-pointer')}
          {noun}
          {words('data.or-each-name-after-a')}
        </p>
      )}
      {draft.format === 'csv' && (
        <p className={styles['hint']}>{words('data.a-column-is-read-by-2')}</p>
      )}
      <div className={styles['formatLine']}>
        <Choice label={words('data.the-is', { noun })}>
          {(id) => (
            <select
              id={id}
              value={draft.format}
              onChange={(event) =>
                onChange({ ...draft, format: event.target.value as FormatDraft['format'] })
              }
            >
              <option value="json">JSON</option>
              <option value="jsonLines">{words('data.json-lines-an-object-a')}</option>
              <option value="csv">CSV</option>
              <option value="xlsx">{words('data.xlsx-one-sheet-of-a')}</option>
            </select>
          )}
        </Choice>
        {draft.format === 'xlsx' && (
          <>
            <label>
              {words('data.sheet')}
              <input
                value={draft.sheet}
                spellCheck={false}
                placeholder={words('data.sheet1')}
                onChange={(event) => onChange({ ...draft, sheet: event.target.value })}
              />
            </label>
            <label className={styles['check']}>
              <input
                type="checkbox"
                checked={draft.headerRow}
                onChange={(event) => onChange({ ...draft, headerRow: event.target.checked })}
              />
              {words('data.the-first-row-names-the')}
            </label>
          </>
        )}
        {draft.format === 'json' && (
          <>
            <label>
              {words('data.rows-at')}
              <input
                value={draft.rows}
                spellCheck={false}
                placeholder="/data/items"
                onChange={(event) => onChange({ ...draft, rows: event.target.value })}
              />
            </label>
            <label>
              {words('data.row-count-at-where-the', { noun })}
              <input
                value={draft.count}
                spellCheck={false}
                onChange={(event) => onChange({ ...draft, count: event.target.value })}
              />
            </label>
          </>
        )}
        {draft.format === 'csv' && (
          <>
            <Choice label={words('data.fields-are-separated-by')}>
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
              {words('data.the-first-record-names-the')}
            </label>
            <Choice label={words('data.an-empty-field')}>
              {(id) => (
                <select
                  id={id}
                  value={draft.nulls}
                  onChange={(event) =>
                    onChange({ ...draft, nulls: event.target.value as FormatDraft['nulls'] })
                  }
                >
                  <option value="empty">{words('data.is-empty-unless-it-is')}</option>
                  <option value="never">{words('data.is-empty-text')}</option>
                </select>
              )}
            </Choice>
          </>
        )}
      </div>
    </>
  );
}
