import type { createApiClient } from '@alloy-works/api-client';
import { formatsFor, type Binding, type ValueFormats } from '@alloy-works/domain';
import { bindingFailureWords, CHANGED_SINCE_RESOLVED } from '@alloy-works/editor';
import { useEffect, useId, useRef, useState } from 'react';

import {
  failureHeld,
  shownValue,
  type BindingState,
  type Taken,
} from '../structure/bindingContexts.js';
import { usePresentation } from '../theme/presentation.js';
import { longDate } from './shapes.js';
import styles from './ProvenancePanel.module.css';

type Client = ReturnType<typeof createApiClient>;

/** The most rows **Show the result** shows; the count of the rest is said beneath them. */
export const ROWS_SHOWN = 200;

/** How many characters of a checksum are shown until the whole is asked for. */
const CHECKSUM_SHOWN = 12;

const MODES = {
  checked: 'Checked - looked for each time the document is opened',
  pinned: 'Pinned - never looked for',
} as const;

/**
 * A value as the document shows it, or why there is none in the words the text shows: changed since it
 * was resolved where the view answers it stale, and a take's failure by its reason.
 */
function said(
  taken: Taken | null,
  formats: ValueFormats,
  binding: Binding,
  stale = false,
): string {
  if (stale) return CHANGED_SINCE_RESOLVED;
  if (taken === null || 'unavailable' in taken) return 'The result cannot be read';
  if ('value' in taken) return shownValue(taken, formats);
  return bindingFailureWords(binding, failureHeld(taken, binding));
}

/** What a taken value was, as the query returned it: its canonical form, its column and its type. */
function returned(taken: Taken | null): string | null {
  if (taken === null || !('value' in taken)) return null;
  return `${String(taken.value)}, from the column ${taken.column.name} (${taken.column.type.base})`;
}

type Result =
  | { readonly state: 'hidden' }
  | { readonly state: 'reading' }
  | { readonly state: 'failed' }
  | {
      readonly state: 'shown';
      readonly columns: readonly string[];
      readonly rows: readonly (readonly (string | boolean | null)[])[];
    };

export interface ProvenancePanelProps {
  readonly client: Client;
  readonly document: string;
  /** The document's language, whose formats a value is shown in (B1-G). */
  readonly language: string | null;
  readonly state: BindingState;
  /** Closes the panel; the page returns the focus to what opened it. */
  readonly onClose: () => void;
}

/**
 * **A value's provenance** (the B1 plan, B1-M; bindings.md, "Provenance, from the value"; DAT-041), in
 * the document page's side column beside the text it stands in, never a modal: the value, as shown and
 * as the query returned it; where it came from - the query definition and version, the connection
 * where the reader may read it, and the parameters the document supplied; whose view; when and what -
 * fetched, the rows, the checksum, the dataset and its version, who resolved or accepted it, and the
 * mode; and what ran, the SQL only where the view gives it, with **Show the result**. A newer result
 * waiting is shown beside the held one. The focus goes to its heading as it opens; **Close** and
 * Escape close it.
 */
export function ProvenancePanel({
  client,
  document,
  language,
  state,
  onClose,
}: ProvenancePanelProps) {
  const heading = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const presentation = usePresentation();
  const theme = presentation?.state === 'ready' ? presentation.theme : null;
  const formats = formatsFor(theme?.valueCatalogue ?? null, language);
  const [whole, setWhole] = useState(false);
  const [result, setResult] = useState<Result>({ state: 'hidden' });
  // Each result asked for, counted: one answered after another value, or another version of it, has
  // opened here is dropped, rather than shown for what is open now.
  const asking = useRef(0);
  const { held, binding } = state;

  useEffect(() => {
    headingRef.current?.focus();
  }, [state.node, binding.id]);
  useEffect(() => {
    asking.current += 1;
    setResult({ state: 'hidden' });
    setWhole(false);
  }, [state.node, binding.id, held?.version]);

  if (held === null) return null;
  const { provenance } = held;
  const parameters = Object.entries(provenance.parameters);

  const showResult = async () => {
    const mine = (asking.current += 1);
    setResult({ state: 'reading' });
    try {
      const { data } = await client.GET('/v1/documents/{id}/datasets/{version}', {
        params: { path: { id: document, version: held.version } },
      });
      if (asking.current !== mine) return;
      const body: unknown = data;
      const read =
        typeof body === 'object' && body !== null && 'result' in body
          ? (body as { result: { columns?: unknown; rows?: unknown } }).result
          : null;
      if (!read || !Array.isArray(read.columns) || !Array.isArray(read.rows)) {
        setResult({ state: 'failed' });
        return;
      }
      setResult({
        state: 'shown',
        columns: (read.columns as unknown[]).map((each) =>
          Array.isArray(each) && typeof each[0] === 'string' ? each[0] : '',
        ),
        rows: read.rows as (string | boolean | null)[][],
      });
    } catch {
      if (asking.current === mine) setResult({ state: 'failed' });
    }
  };

  const by = held.by.displayName ?? 'somebody';
  return (
    <section
      className={styles['panel']}
      aria-labelledby={heading}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
      <h3 id={heading} ref={headingRef} tabIndex={-1} className={styles['heading']}>
        Provenance
      </h3>
      <dl className={styles['facts']}>
        <dt>Value</dt>
        <dd>{said(held.taken, formats, binding, held.stale)}</dd>
        {returned(held.taken) !== null && (
          <>
            <dt>As the query returned it</dt>
            <dd>{returned(held.taken)}</dd>
          </>
        )}
        {state.waiting !== null && (
          <>
            <dt>Waiting</dt>
            <dd>A newer result is waiting: {said(state.waiting.taken, formats, binding)}</dd>
          </>
        )}
        <dt>Query definition</dt>
        <dd>
          {state.definition === null
            ? 'a query definition you cannot read'
            : `${state.definition.title}, version ${state.definition.version}`}
        </dd>
        {state.connection !== null && (
          <>
            <dt>Connection</dt>
            <dd>{state.connection.name}</dd>
          </>
        )}
        <dt>Parameters</dt>
        <dd>
          {parameters.length === 0
            ? 'None'
            : parameters.map(([name, value]) => `${name}: ${String(value)}`).join(', ')}
        </dd>
        <dt>Whose view</dt>
        <dd>{provenance.identity === 'service' ? 'The service account' : provenance.identity}</dd>
        <dt>Fetched</dt>
        <dd>{longDate(provenance.at)}</dd>
        <dt>Rows</dt>
        <dd>{provenance.rowCount === 1 ? '1 row' : `${provenance.rowCount} rows`}</dd>
        <dt>Checksum</dt>
        <dd>
          <code>{whole ? provenance.checksum : provenance.checksum.slice(0, CHECKSUM_SHOWN)}</code>{' '}
          {!whole && (
            <button type="button" onClick={() => setWhole(true)}>
              Show the whole checksum
            </button>
          )}
        </dd>
        <dt>Dataset</dt>
        <dd>{`${held.name ?? 'An unnamed dataset'}, version ${held.number}`}</dd>
        <dt>{held.act === 'accept' ? 'Accepted' : 'Resolved'}</dt>
        <dd>{`${held.act === 'accept' ? 'Accepted' : 'Resolved'} by ${by} on ${longDate(held.at)}`}</dd>
        <dt>Mode</dt>
        <dd>{MODES[binding.mode]}</dd>
        {provenance.sql !== null && (
          <>
            <dt>What ran</dt>
            <dd>
              <pre className={styles['sql']}>{provenance.sql}</pre>
            </dd>
          </>
        )}
      </dl>
      {result.state === 'hidden' && (
        <button type="button" onClick={() => void showResult()}>
          Show the result
        </button>
      )}
      {result.state === 'reading' && <p>Reading the result...</p>}
      {result.state === 'failed' && <p>The result could not be read.</p>}
      {result.state === 'shown' && (
        // Scrolled within the column, so reachable by the keyboard as well as the pointer.
        <div className={styles['result']} tabIndex={0} role="group" aria-label="The result">
          <table>
            <thead>
              <tr>
                {result.columns.map((column, at) => (
                  <th key={at} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.slice(0, ROWS_SHOWN).map((row, at) => (
                <tr key={at}>
                  {row.map((cell, column) => (
                    <td key={column}>{cell === null ? 'null' : String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.length > ROWS_SHOWN && (
            <p>
              and {result.rows.length - ROWS_SHOWN} more{' '}
              {result.rows.length - ROWS_SHOWN === 1 ? 'row' : 'rows'}
            </p>
          )}
        </div>
      )}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </section>
  );
}
