import type { createApiClient } from '@alloy-works/api-client';
import {
  formatsFor,
  type BoundTableNode,
  type TableFailure,
  type TablePresentation,
} from '@alloy-works/domain';
import { useId, useState } from 'react';

import { said } from '../data/ProvenancePanel.js';
import { failureWords } from '../publishing/failures.js';
import { usePresentation } from '../theme/presentation.js';
import type { BindingState, SinceDiffers } from './bindingContexts.js';
import { DATA_STATE_WORDS, dataState, type DataState } from './dataStates.js';
import styles from './DataTab.module.css';
import { codeOf, identityRefusal, NOT_HELD, whoseView } from './ownView.js';
import { useOwnViewAsk } from './OwnViewAsk.js';
import { settleBinding } from './settleBinding.js';
import { noteFailures, tableFailures, type TableRows } from './tableRows.js';

type Client = ReturnType<typeof createApiClient>;

const MODES = { checked: 'Checked', pinned: 'Pinned' } as const;

const DIFFERS = {
  digest: 'the binding',
  dataset: 'its result',
  definition: 'its definition version',
} as const satisfies Record<SinceDiffers, string>;

/** What an accept the service refused is said as, by its status. */
const REFUSED = {
  403: 'This value can be accepted only by somebody who may use its connection.',
  409: 'The value changed meanwhile. Look at it again in the Data tab.',
} as const;

/** `a`, `a and b`, `a, b and c`. */
const listed = (words: readonly string[]) =>
  words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

/** How a binding differs from the latest publication, in words, or null. */
function sinceWords(since: BindingState['sincePublished']): string | null {
  if (since === null) return null;
  if (since === 'new') return 'New since the last publication';
  return `Since the last publication: ${listed(since.map((each) => DIFFERS[each]))}`;
}

const key = (node: string, binding: string) => `${node} ${binding}`;

/** A bound table's result, by its rows (TB2-H). */
const tableOf = (rows: number) => `A table of ${rows} ${rows === 1 ? 'row' : 'rows'}`;

/** A table's failure, or its notes' (TB3.3), as the stage names it. */
type TableFailing =
  TableFailure | { readonly code: 'key_required' | 'note_row_missing'; readonly detail: string };

/** A table's failure in the words a publish's failure is said in, which it is at the stage (TB1-H). */
const tableFailureSaid = (failure: TableFailing, node: string) =>
  failureWords({
    stage: 'bind',
    code: failure.code,
    node,
    block: null,
    detail:
      failure.code === 'format_mismatch'
        ? `${failure.column}: ${failure.detail}`
        : 'column' in failure
          ? failure.column
          : failure.detail,
  });

const NO_TABLES: ReadonlyMap<string, BoundTableNode> = new Map();
const NO_ROWS: ReadonlyMap<string, TableRows> = new Map();
const NO_STYLES: ReadonlyMap<string, TablePresentation> = new Map();

export interface DataTabProps {
  readonly client: Client;
  readonly document: string;
  /** The bindings view, in the outline's order. */
  readonly states: readonly BindingState[];
  /** The check this page made, failed for a binding, by `node binding`, in the product's words. */
  readonly checkFailures: ReadonlyMap<string, string>;
  /** A node's number and title, as the outline shows them. */
  readonly headingOf: (node: string) => string;
  readonly language: string | null;
  /**
   * Each bound table by its node and binding, from the texts and the editor open in place (TB2-H):
   * what `checkTable` checks a table's result against. None given, a table is never failed for it.
   */
  readonly tables?: ReadonlyMap<string, BoundTableNode>;
  /**
   * The rows the page has read for each bound table, by node and binding (TB3.3): what a note whose
   * row is gone is failed by. None given, no note is.
   */
  readonly rows?: ReadonlyMap<string, TableRows>;
  /** Whether a check is in flight. */
  readonly checking: boolean;
  /** An act changed what the document holds: the view is read again. */
  readonly onChanged: () => void;
  readonly onCheckNow: () => void;
  readonly onGoTo: (node: string, binding: string) => void;
  /** Says something to the page's live region, or, given null, stops saying it. */
  readonly onNotice: (words: string | null) => void;
}

/**
 * **The Data tab** (bindings.md, "The Data tab"; BI-H): every binding the reader can see, grouped under
 * its node, each with its value as the document shows it, its definition, its mode and its state, a
 * waiting value beside the held one, and the acts the reader may take; filtered by state.
 */
export function DataTab({
  client,
  document,
  states,
  checkFailures,
  headingOf,
  language,
  tables = NO_TABLES,
  rows: tableRows = NO_ROWS,
  checking,
  onChanged,
  onCheckNow,
  onGoTo,
  onNotice,
}: DataTabProps) {
  const filterId = useId();
  const [filter, setFilter] = useState<DataState | 'all'>('all');
  const [acting, setActing] = useState(false);
  const { ask, prompt } = useOwnViewAsk();
  const presentation = usePresentation();
  const theme = presentation?.state === 'ready' ? presentation.theme : null;
  const formats = formatsFor(theme?.valueCatalogue ?? null, language);

  const tableStyles = theme?.tableStyles ?? NO_STYLES;
  const rows = states.map((state) => {
    const failure = checkFailures.get(key(state.node, state.binding.id));
    const table = tables.get(key(state.node, state.binding.id));
    const failing: readonly TableFailing[] = [
      ...tableFailures(state, table, tableStyles),
      ...noteFailures(state, table, tableRows.get(key(state.node, state.binding.id))),
    ];
    return {
      state,
      failure,
      failing,
      shown: dataState(state, failure !== undefined, failing.length > 0),
    };
  });
  const present = new Set(rows.map((row) => row.shown));
  const groups: { node: string; rows: typeof rows }[] = [];
  for (const row of rows) {
    if (filter !== 'all' && row.shown !== filter) continue;
    const last = groups.at(-1);
    if (last?.node === row.state.node) last.rows.push(row);
    else groups.push({ node: row.state.node, rows: [row] });
  }

  /** One act at a time; whatever it changed is read again, and anything to say is said. */
  const act = (work: () => Promise<string | null>) => {
    if (acting) return;
    setActing(true);
    void work()
      .then((words) => {
        if (words !== null) onNotice(words);
      })
      .catch(() => onNotice('That could not be done. Try again.'))
      .finally(() => {
        setActing(false);
        onChanged();
      });
  };
  const settle = (state: BindingState, how: 'resolve' | 'keep') =>
    act(async () => {
      // A result waiting on its images is said while it waits, and unsaid once it is held.
      let waited = false;
      const said = await settleBinding(client, document, state.node, state.binding.id, null, how, {
        ask,
        onWaiting: (words) => {
          waited = true;
          onNotice(words);
        },
      });
      if (said === null && waited) onNotice(null);
      return said;
    });
  /**
   * Accepts what waits. One's own view is held only past DAT-091's warning, asked before anything is
   * sent where the waiting result says whose it is, and where the service asks for it besides.
   */
  const accept = (state: BindingState) =>
    act(async () => {
      const send = (sharesOwnView: boolean) =>
        client.POST('/v1/documents/{id}/bindings/accept', {
          params: { path: { id: document } },
          body: {
            node: state.node,
            binding: state.binding.id,
            version: state.waiting!.version,
            replaces: state.held!.version,
            ...(sharesOwnView ? { sharesOwnView } : {}),
          },
        });
      const own = state.waiting!.provenance.identity === 'endUser';
      if (own && !(await ask())) return NOT_HELD;
      let { error, response } = await send(own);
      if (!own && codeOf(error) === 'acknowledgement_required') {
        if (!(await ask())) return NOT_HELD;
        ({ error, response } = await send(true));
      }
      if (response.ok) return null;
      const refused = identityRefusal(error);
      if (refused !== null) return refused;
      return response.status === 403 || response.status === 409
        ? REFUSED[response.status]
        : 'The value could not be accepted. Try again.';
    });

  const mayCheck = states.some((state) => state.mayCheck);
  return (
    <div className={styles['tab']}>
      <div className={styles['controls']}>
        <label htmlFor={filterId}>Show</label>
        <select
          id={filterId}
          value={filter}
          onChange={(event) => setFilter(event.target.value as DataState | 'all')}
        >
          <option value="all">All</option>
          {(Object.keys(DATA_STATE_WORDS) as DataState[])
            .filter((state) => present.has(state))
            .map((state) => (
              <option key={state} value={state}>
                {DATA_STATE_WORDS[state]}
              </option>
            ))}
        </select>
        {mayCheck && (
          <button type="button" onClick={() => !checking && onCheckNow()} aria-busy={checking}>
            Check now
          </button>
        )}
      </div>
      {!mayCheck && <p className={styles['note']}>Values were not checked for you.</p>}
      {prompt}
      {groups.map((group) => (
        <section key={group.node} className={styles['group']}>
          <h3 className={styles['heading']}>{headingOf(group.node)}</h3>
          <ul className={styles['rows']}>
            {group.rows.map(({ state, failure, failing, shown }) => {
              const held = state.held;
              const value =
                held === null
                  ? 'No value'
                  : !held.stale && held.taken !== null && 'table' in held.taken
                    ? tableOf(held.provenance.rowCount)
                    : said(held.taken, formats, state.binding, held.stale);
              const since = sinceWords(state.sincePublished);
              const whose = held === null ? null : whoseView(held.provenance, held.by);
              const resolvable =
                state.mayResolve && (shown === 'never' || shown === 'stale' || shown === 'failed');
              return (
                <li
                  key={state.binding.id}
                  data-binding={state.binding.id}
                  className={styles['row']}
                >
                  <span className={styles['value']}>{value}</span>
                  {state.waiting !== null && (
                    <span className={styles['waiting']}>
                      Waiting: {said(state.waiting.taken, formats, state.binding)}
                    </span>
                  )}
                  <span className={styles['facts']}>
                    {state.definition === null
                      ? 'A definition you may not read'
                      : `${state.definition.title} ${state.definition.version}`}
                    {' - '}
                    {MODES[state.binding.mode]}
                  </span>
                  <span className={styles['state']} data-state={shown}>
                    {DATA_STATE_WORDS[shown]}
                  </span>
                  {whose !== null && <span className={styles['facts']}>{whose}</span>}
                  {failure !== undefined && <span className={styles['facts']}>{failure}</span>}
                  {failing.map((each, at) => (
                    <span key={at} className={styles['facts']} data-table-failure={each.code}>
                      {tableFailureSaid(each, state.node)}
                    </span>
                  ))}
                  {state.definitionChanged && shown !== 'definition' && (
                    <span className={styles['facts']}>{DATA_STATE_WORDS.definition}</span>
                  )}
                  {since !== null && <span className={styles['facts']}>{since}</span>}
                  <span className={styles['acts']}>
                    {state.waiting !== null && state.mayResolve && (
                      <button type="button" onClick={() => accept(state)}>
                        Accept
                      </button>
                    )}
                    {shown === 'stale' && held?.keepable === true && state.mayResolve && (
                      <button type="button" onClick={() => settle(state, 'keep')}>
                        Keep
                      </button>
                    )}
                    {resolvable && (
                      <button type="button" onClick={() => settle(state, 'resolve')}>
                        Resolve
                      </button>
                    )}
                    <button type="button" onClick={() => onGoTo(state.node, state.binding.id)}>
                      Go to
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
