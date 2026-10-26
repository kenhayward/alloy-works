import type { createApiClient } from '@alloy-works/api-client';
import { formatsFor, type AnyBinding, type ValueFormats } from '@alloy-works/domain';
import { bindingFailureWords, CHANGED_SINCE_RESOLVED } from '@alloy-works/editor';
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../editor/Icon.js';
import shell from '../layouts/Modal.module.css';
import { PanelTabs } from '../parts/PanelTabs.js';
import {
  failureHeld,
  shownValue,
  type BindingState,
  type ProvenanceShown,
  type Taken,
  standingRevision,
} from '../structure/bindingContexts.js';
import { whoseView } from '../structure/ownView.js';
import { usePresentation } from '../theme/presentation.js';
import { longDate } from './shapes.js';
import styles from './ProvenancePanel.module.css';
import { formats as interfaceFormats, words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** The most rows **Results** shows; the count of the rest is said beneath them. */
export const ROWS_SHOWN = 200;

/** How many characters of a checksum are shown until the whole is asked for. */
const CHECKSUM_SHOWN = 12;

/**
 * Whose view a value is (DAT-024; bindings.md, "Provenance, from the value"): the service account, or
 * the person by name, how they signed in, and the name the source saw them by.
 */
function whoseViewSaid(
  provenance: ProvenanceShown,
  by: { readonly id: string; readonly displayName: string | null },
): string {
  if (provenance.identity === 'service') return words('data.the-service-account');
  // How they signed in (DAT-024): a route the service names and this page does not is left out.
  return words('data.whose-view-said', {
    whose: whoseView(provenance, by) ?? words('data.a-person-s-own-view'),
    route: provenance.signInRoute ?? 'none',
    seen: provenance.asSeen ? 'yes' : 'no',
    asSeen: provenance.asSeen ?? '',
  });
}

const MODES = {
  get checked() {
    return words('data.checked-looked-for-each-time');
  },
  get pinned() {
    return words('data.pinned-never-looked-for');
  },
} as const;

/**
 * A value as the document shows it, or why there is none in the words the text shows: changed since it
 * was resolved where the view answers it stale, and a take's failure by its reason.
 */
export function said(
  taken: Taken | null,
  formats: ValueFormats,
  binding: AnyBinding,
  stale = false,
): string {
  if (stale) return CHANGED_SINCE_RESOLVED();
  if (taken === null || 'unavailable' in taken) return words('data.the-result-cannot-be-read');
  if ('table' in taken) return words('data.a-table-of-the-whole');
  if ('value' in taken || 'image' in taken) return shownValue(taken, formats);
  return bindingFailureWords(binding, failureHeld(taken, binding));
}

/** What a taken value was, as the query returned it: its canonical form, its column and its type. */
function returned(taken: Taken | null): string | null {
  if (taken === null || !('value' in taken)) return null;
  return words('data.from-the-column', {
    value: String(taken.value),
    name: taken.column.name,
    base: taken.column.type.base,
  });
}

/** The dialog's two tabs: the facts, then the rows, read only once their tab is chosen. */
const TABS = [
  {
    key: 'provenance',
    get label() {
      return words('data.provenance');
    },
  },
  {
    key: 'results',
    get label() {
      return words('data.results');
    },
  },
] as const;

type Tab = (typeof TABS)[number]['key'];

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
 * **A value's provenance** (the B1 plan, B1-M; bindings.md, "Provenance, from the value"; DAT-041), a
 * modal over the page with two tabs. **Provenance**: the value, as shown and as the query returned
 * it; where it came from - the query definition and version, the connection where the reader may read
 * it, and the parameters the document supplied; whose view; when and what - fetched, the rows, the
 * checksum, the dataset and its version, who resolved or accepted it, and the mode; and what ran, the
 * SQL only where the view gives it. **Results**: the rows, read only once its tab is chosen. A newer
 * result waiting is shown beside the held one. The focus goes to its heading as it opens; **Close**
 * and Escape close it.
 */
export function ProvenancePanel({
  client,
  document: documentId,
  language,
  state,
  onClose,
}: ProvenancePanelProps) {
  const heading = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const presentation = usePresentation();
  const theme = presentation?.state === 'ready' ? presentation.theme : null;
  const formats = formatsFor(theme?.valueCatalogue ?? null, language);
  const [whole, setWhole] = useState(false);
  const [tab, setTab] = useState<Tab>('provenance');
  const [result, setResult] = useState<Result>({ state: 'hidden' });
  // Each result asked for, counted: one answered after another value, or another version of it, has
  // opened here is dropped, rather than shown for what is open now.
  const asking = useRef(0);
  const { held, binding } = state;
  const ids = (key: string) => ({ tab: `${heading}-tab-${key}`, panel: `${heading}-${key}` });

  useEffect(() => {
    headingRef.current?.focus();
  }, [state.node, binding.id]);
  useEffect(() => {
    asking.current += 1;
    setResult({ state: 'hidden' });
    setWhole(false);
    setTab('provenance');
  }, [state.node, binding.id, held?.version]);
  // Modal in full, as the Format dialog is: the rest of the page inert while it stands, and taken
  // back as it is laid out of the page, so the page can give the focus back at once.
  const shown = held !== null;
  useLayoutEffect(() => {
    if (!shown) return;
    const own = dialog.current?.closest('body > *');
    const others = [...document.body.children].filter(
      (each) => each !== own && !each.hasAttribute('inert'),
    );
    for (const each of others) each.setAttribute('inert', '');
    return () => {
      for (const each of others) each.removeAttribute('inert');
    };
  }, [shown]);

  if (held === null) return null;
  const { provenance } = held;
  // The person's value standing in front of the query's, where one does (DAT-062).
  const standing = standingRevision(state);
  const parameters = Object.entries(provenance.parameters);

  const showResult = async () => {
    const mine = (asking.current += 1);
    setResult({ state: 'reading' });
    try {
      const { data } = await client.GET('/v1/documents/{id}/datasets/{version}', {
        params: { path: { id: documentId, version: held.version } },
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    // The focus kept inside, as the Format dialog keeps it.
    const stops = [
      ...(dialog.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]') ?? []),
    ].filter((each) => each.tabIndex >= 0);
    if (stops.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const inside = active !== null && dialog.current?.contains(active) === true;
    const end = event.shiftKey ? stops[0] : stops.at(-1);
    if (inside && active !== end) return;
    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
  };

  const by = held.by.displayName ?? words('data.somebody');
  return createPortal(
    <div className={shell['scrim']}>
      <div
        ref={dialog}
        className={`${shell['dialog']} ${shell['wide']}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
        onKeyDown={onKeyDown}
      >
        <div className={styles['panel']}>
          <h2 id={heading} ref={headingRef} tabIndex={-1} className={styles['heading']}>
            {words('data.provenance')}
          </h2>
          <PanelTabs
            label={words('data.provenance-and-results')}
            tabs={TABS}
            chosen={tab}
            onChoose={(key) => {
              setTab(key as Tab);
              if (key === 'results' && result.state === 'hidden') void showResult();
            }}
            ids={ids}
          />
          <div
            id={ids('provenance').panel}
            role="tabpanel"
            aria-labelledby={ids('provenance').tab}
            hidden={tab !== 'provenance'}
          >
            <dl className={styles['facts']}>
              <dt>{words('data.value')}</dt>
              <dd>
                {said(
                  standing !== undefined && held.taken !== null && 'value' in held.taken
                    ? { ...held.taken, value: standing.value }
                    : held.taken,
                  formats,
                  binding,
                  held.stale,
                )}
              </dd>
              {returned(held.taken) !== null && (
                <>
                  <dt>{words('data.as-the-query-returned-it')}</dt>
                  <dd>{returned(held.taken)}</dd>
                </>
              )}
              {/* Both halves (DAT-062): each value a person revised by hand standing in front of the
                  query's, who, when and why, the query's own value said beside it above. */}
              {(state.revisions ?? [])
                .filter((each) => each.stands)
                .map((each) => (
                  <Fragment key={each.id}>
                    <dt>{words('data.revised-by-hand')}</dt>
                    <dd data-revision={each.id}>
                      {words('data.by', {
                        value: String(each.value),
                        inCell: each.cell === null ? 'no' : 'yes',
                        column: each.cell?.column ?? '',
                        row: interfaceFormats().list(
                          Object.values(each.cell?.key ?? {}).map(String),
                          { type: 'unit', style: 'short' },
                        ),
                        name: each.by.displayName ?? words('data.somebody'),
                        date: longDate(each.at),
                        reason: each.reason,
                      })}
                    </dd>
                  </Fragment>
                ))}
              {state.waiting !== null && (
                <>
                  <dt>{words('data.waiting')}</dt>
                  <dd>
                    {words('data.a-newer-result-is-waiting', {
                      value: said(state.waiting.taken, formats, binding),
                    })}
                  </dd>
                </>
              )}
              <dt>{words('data.query-definition-2')}</dt>
              <dd>
                {state.definition === null
                  ? words('data.a-query-definition-you-cannot')
                  : words('data.version-2', {
                      title: state.definition.title,
                      version: state.definition.version,
                    })}
              </dd>
              {state.connection !== null && (
                <>
                  <dt>{words('data.connection')}</dt>
                  <dd data-content>{state.connection.name}</dd>
                </>
              )}
              <dt>{words('data.parameters')}</dt>
              {parameters.length === 0 ? (
                <dd>{words('data.none')}</dd>
              ) : (
                <dd data-content>
                  {interfaceFormats().list(
                    parameters.map(([name, value]) =>
                      words('data.parameter-value', { name, value: String(value) }),
                    ),
                    { type: 'unit', style: 'short' },
                  )}
                </dd>
              )}
              <dt>{words('data.whose-view')}</dt>
              <dd>{whoseViewSaid(provenance, held.by)}</dd>
              <dt>{words('data.fetched')}</dt>
              <dd>{longDate(provenance.at)}</dd>
              <dt>{words('data.rows')}</dt>
              <dd>{words('data.rows-2', { count: provenance.rowCount })}</dd>
              <dt>{words('data.checksum')}</dt>
              <dd>
                <code data-content>
                  {whole ? provenance.checksum : provenance.checksum.slice(0, CHECKSUM_SHOWN)}
                </code>{' '}
                {!whole && (
                  <button type="button" onClick={() => setWhole(true)}>
                    {words('data.show-the-whole-checksum')}
                  </button>
                )}
              </dd>
              <dt>{words('data.dataset')}</dt>
              <dd>
                {words('data.version-3', {
                  named: held.name === null ? 'no' : 'yes',
                  name: held.name ?? '',
                  number: held.number,
                })}
              </dd>
              <dt>{held.act === 'accept' ? words('data.accepted') : words('data.resolved')}</dt>
              <dd>{words('data.by-on-2', { act: held.act, by, date: longDate(held.at) })}</dd>
              <dt>{words('data.mode')}</dt>
              <dd>{MODES[binding.mode]}</dd>
              {provenance.sql !== null && (
                <>
                  <dt>{words('data.what-ran')}</dt>
                  <dd>
                    <pre className={styles['sql']} data-content>
                      {provenance.sql}
                    </pre>
                  </dd>
                </>
              )}
            </dl>
          </div>
          {tab === 'results' && (
            <div id={ids('results').panel} role="tabpanel" aria-labelledby={ids('results').tab}>
              {result.state === 'failed' ? (
                <p>{words('data.the-result-could-not-be')}</p>
              ) : result.state !== 'shown' ? (
                <p>{words('data.reading-the-result')}</p>
              ) : (
                // Scrolled within the dialog, so reachable by the keyboard as well as the pointer.
                <div
                  className={styles['result']}
                  tabIndex={0}
                  role="group"
                  aria-label={words('data.the-result')}
                >
                  <table>
                    <thead>
                      <tr>
                        {result.columns.map((column, at) => (
                          <th key={at} scope="col" data-content>
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, ROWS_SHOWN).map((row, at) => (
                        <tr key={at}>
                          {row.map((cell, column) => (
                            <td key={column} data-content>
                              {cell === null ? 'null' : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.rows.length > ROWS_SHOWN && (
                    <p>{words('data.and-more-rows', { count: result.rows.length - ROWS_SHOWN })}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className={shell['close']}
          aria-label={words('data.close')}
          title={words('data.close')}
          onClick={onClose}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
