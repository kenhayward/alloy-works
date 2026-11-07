import type { createApiClient } from '@alloy-works/api-client';
import { isFixed, startsCopied, type CopyPlacement } from '@alloy-works/domain';
import { useEffect, useId, useState } from 'react';

import { Icon } from '../editor/Icon.js';
import { Modal } from '../layouts/Modal.js';
import { useCreatableSpaces } from '../spaces.js';
import { Lozenge, StateLozenge } from '../states/Lozenge.js';
import { words } from '../words/words.js';
import type { RowKind } from './ContentRowMenu.js';
import styles from './DuplicateDialog.module.css';

type Client = ReturnType<typeof createApiClient>;

/** Where a document's copy starts its components from (REU-057; the RM plan, RM-G). */
export type Components = 'reuse' | 'own' | 'all';

/** A component the document places, as the preview answers it. */
export interface Placed {
  readonly component: string;
  /** Null where the reader may not read it: never named (REU-057). */
  readonly title: string | null;
  readonly placed: CopyPlacement;
  readonly others: number | null;
  readonly grouped: boolean;
}

/** A sentence of what the copy does: said, or lost in another space. */
export interface Cost {
  readonly text: string;
  readonly lost: boolean;
}

/** What the preview says a copy would do, read rather than trusted. */
export interface Previewed {
  /** How many components it would copy. */
  readonly copies: number;
  readonly titleInUse: boolean;
  /** What it says it would refuse, in the service's words, or null. */
  readonly refused: string | null;
  /** What it reuses rather than copies, and leaves behind in another space, each said whole. */
  readonly costs: readonly Cost[];
  readonly components: readonly Placed[];
  /** The document's local overrides, and of those the ones a copy keeping them drops (REU-068). */
  readonly overrides: number;
  readonly overridesDropped: number;
}

const PLACEMENTS = new Set(['only', 'shared', 'required', 'kept', 'unreadable']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const count = (data: Record<string, unknown>, key: string): number =>
  typeof data[key] === 'number' ? (data[key] as number) : 0;

/** What a count says, where it is not none, in the plural it needs. */
const said = (key: string, n: number, lost = false): Cost[] =>
  n > 0 ? [{ text: words(key as never, { count: n } as never), lost }] : [];

const placedIn = (value: unknown): Placed[] =>
  (Array.isArray(value) ? value : []).filter(isRecord).flatMap((each) =>
    typeof each.component === 'string' && PLACEMENTS.has(String(each.placed))
      ? [
          {
            component: each.component,
            title: typeof each.title === 'string' ? each.title : null,
            placed: each.placed as CopyPlacement,
            others: typeof each.others === 'number' ? each.others : null,
            grouped: each.grouped === true,
          },
        ]
      : [],
  );

/**
 * The preview's answer (`CopyPreviewAnswer`): the counts said as sentences, and what would refuse the
 * copy said here, since the preview reports rather than refuses.
 */
export function previewIn(data: unknown): Previewed | null {
  if (!isRecord(data)) return null;
  const limit = count(data, 'limit');
  const copied = count(data, 'copied');
  const left = isRecord(data.consequences) ? data.consequences : {};
  const components = placedIn(data.components);
  const grouped = Array.isArray(data.components)
    ? data.components.filter(
        (each) => isRecord(each) && each.grouped === true && each.outcome === 'copy',
      ).length
    : 0;
  return {
    copies: copied,
    titleInUse: data.titleInUse === true,
    refused: limit > 0 && copied > limit ? words('rows.copy-too-large', { limit }) : null,
    costs: [
      ...said('rows.copy-required', count(data, 'required')),
      ...said('rows.copy-kept', count(data, 'kept')),
      ...said('rows.copy-grouped', grouped),
      ...said('rows.copy-approved-to-latest', count(data, 'approvedToLatest')),
      ...said('rows.copy-newest-shown', count(data, 'newestShown')),
      ...said('rows.copy-lines', count(data, 'lines') + count(data, 'translations')),
      ...said('moving.citations', count(left, 'citations'), true),
      ...said('moving.terms', count(left, 'terms'), true),
      ...said('moving.images-staying', count(left, 'imagesStaying'), true),
      ...said('moving.bound', count(left, 'bound'), true),
    ],
    components,
    overrides: count(data, 'overrides'),
    overridesDropped: count(data, 'overridesDropped'),
  };
}

const refusalIn = (data: unknown): string =>
  isRecord(data) && typeof data.message === 'string' ? data.message : words('rows.copy-failed');

type Exception = { component: string; as: 'copy' | 'reuse' };
type Body = {
  to: string;
  title: string;
  components?: Components;
  exceptions?: Exception[];
  rewordings?: 'keep' | 'drop';
};

async function post(client: Client, id: string, path: 'copy' | 'copy/preview', body: Body) {
  const options = { params: { path: { id } }, body };
  try {
    const { data, error, response } =
      path === 'copy'
        ? await client.POST('/v1/artifacts/{id}/copy', options)
        : await client.POST('/v1/artifacts/{id}/copy/preview', options);
    return { data: data as unknown, error: error as unknown, ok: response.ok };
  } catch {
    return { data: undefined, error: undefined, ok: false };
  }
}

/** Whether the components panel is open, kept for the session (the duplicate handoff). */
const OPEN = 'aw.duplicate.components-open';
const openAtFirst = () => {
  try {
    return window.sessionStorage.getItem(OPEN) === 'true';
  } catch {
    return false;
  }
};

const STARTS: readonly {
  readonly value: Components;
  readonly icon: string;
  readonly name: () => string;
  readonly said: () => string;
}[] = [
  {
    value: 'reuse',
    icon: 'Link',
    name: () => words('rows.reuse-every-component'),
    said: () => words('rows.reuse-every-said'),
  },
  {
    value: 'own',
    icon: 'Branch',
    name: () => words('rows.copy-its-own-reuse-shared'),
    said: () => words('rows.copy-own-said'),
  },
  {
    value: 'all',
    icon: 'Duplicate',
    name: () => words('rows.copy-every-component'),
    said: () => words('rows.copy-every-said'),
  },
];

/** Where else a component is placed, or why no choice copies it; one not the reader's, by its lozenge. */
function whereElse(each: Placed): string {
  if (each.placed === 'required') return words('rows.fixed-required');
  if (each.placed === 'kept') return words('rows.fixed-kept');
  if (each.placed === 'unreadable') return words('states.not-yours-to-read');
  if (each.grouped) return words('rows.placed-in-a-group');
  if (each.placed === 'only') return words('rows.placed-only-here');
  return each.others !== null && each.others > 0
    ? words('rows.placed-also-in', { count: each.others })
    : words('rows.placed-elsewhere');
}

/**
 * Duplicate (REU-056 to REU-058, REU-068; the RM plan, the duplicate handoff): a new title and a space,
 * warned of a title in use there; for a document, where its components start from, each one set the
 * other way as an exception, and whether its local rewordings come along, counted first. It stays
 * open, with a progress bar, until the copy is made or refused.
 */
export function DuplicateDialog({
  client,
  kind,
  id,
  title,
  space,
  spaceName,
  state,
  onDone,
  onClose,
}: {
  client: Client;
  kind: RowKind;
  id: string;
  title: string;
  /** The original's space: where the copy goes unless another is chosen (RM-F). */
  space: string;
  /** Its name, for the header. */
  spaceName?: string | undefined;
  /** Its lifecycle state, for the header, where the row knows it. */
  state?: { readonly key: string; readonly name: string } | null | undefined;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
  const heading = useId();
  const { spaces, where, setWhere } = useCreatableSpaces(
    client,
    kind === 'template' ? 'mayDesign' : 'mayCreate',
  );
  // The original's space once the spaces are read, where the caller may make one there.
  const [placedIn, setPlacedIn] = useState(false);
  useEffect(() => {
    if (placedIn || spaces === null) return;
    setPlacedIn(true);
    if (spaces.some((each) => each.id === space)) setWhere(space);
  }, [placedIn, spaces, space, setWhere]);
  const document = kind === 'document';
  const [named, setNamed] = useState(words('rows.copy-of', { title }));
  const [components, setComponents] = useState<Components>('own');
  const [exceptions, setExceptions] = useState<ReadonlyMap<string, 'copy' | 'reuse'>>(new Map());
  const [rewordings, setRewordings] = useState<'keep' | 'drop'>('keep');
  const [open, setOpen] = useState(openAtFirst);
  const [previewed, setPreviewed] = useState<Previewed | null>(null);
  // The last answer's components and overrides, kept while the next is counted.
  const [known, setKnown] = useState<Previewed | null>(null);
  const [copying, setCopying] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const exceptionList = (): Exception[] =>
    [...exceptions].map(([component, as]) => ({ component, as }));
  const body = (): Body => ({
    to: where,
    title: named.trim(),
    ...(document ? { components, exceptions: exceptionList(), rewordings } : {}),
  });

  // Asked again as the choice changes, a moment after typing stops.
  useEffect(() => {
    // What was counted for another choice is not this one's.
    setPreviewed(null);
    if (where === '' || named.trim() === '') return undefined;
    let current = true;
    const wait = setTimeout(() => {
      void post(client, id, 'copy/preview', body()).then(({ data, error, ok }) => {
        if (!current) return;
        const read = ok ? previewIn(data) : { ...EMPTY, refused: refusalIn(error) };
        setPreviewed(read);
        if (ok && read !== null) setKnown(read);
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(wait);
    };
    // `body` is rebuilt from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, id, where, named, components, exceptions, rewordings]);

  const copy = async () => {
    setCopying(true);
    setRefused(null);
    const { error, ok } = await post(client, id, 'copy', body());
    setCopying(false);
    if (ok) onDone(words('rows.duplicated', { title: named.trim() }));
    else setRefused(refusalIn(error));
  };

  const start = (value: Components) => {
    setComponents(value);
    // Another starting point resets every exception, at once (the duplicate handoff).
    setExceptions(new Map());
  };
  const set = (component: string, placed: CopyPlacement, as: 'copy' | 'reuse') => {
    const next = new Map(exceptions);
    if ((as === 'copy') === startsCopied(components, placed)) next.delete(component);
    else next.set(component, as);
    setExceptions(next);
  };
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.sessionStorage.setItem(OPEN, String(next));
    } catch {
      // Remembered for this dialog only.
    }
  };

  const placed = known?.components ?? [];
  const outcome = (each: Placed): 'copy' | 'reuse' =>
    exceptions.get(each.component) ?? (startsCopied(components, each.placed) ? 'copy' : 'reuse');
  const copiedNow = placed.filter((each) => outcome(each) === 'copy').length;
  const reusedNow = placed.length - copiedNow;
  const target = (spaces ?? []).find((each) => each.id === where)?.name ?? '';

  const reason =
    named.trim() === ''
      ? words('rows.copy-needs-a-title')
      : where === ''
        ? words('rows.copy-needs-a-space')
        : previewed === null
          ? words('rows.copy-counting')
          : previewed.refused;
  const name = `${heading}-components`;
  const listId = `${heading}-list`;

  return (
    <Modal labelledBy={heading} size="duplicate" onClose={copying ? () => undefined : onClose}>
      <div className={styles['dialog']} data-copying={copying || undefined}>
        <header className={styles['head']}>
          <span className={styles['tile']}>
            <Icon name="Duplicate" size={20} />
          </span>
          <div>
            <h2 id={heading}>{words('rows.duplicate-heading', { kind })}</h2>
            <p className={styles['about']}>
              <Icon name="Document" size={14} />
              <span className={styles['original']}>{title}</span>
              {state && <StateLozenge size="small" state={state} />}
              {spaceName !== undefined && <span>· {spaceName}</span>}
              {document && known !== null && (
                <span>· {words('rows.components-count', { count: placed.length })}</span>
              )}
            </p>
          </div>
        </header>
        <div className={styles['body']}>
          <div className={styles['copyRow']}>
            <label className={styles['field']}>
              {words('rows.title-of-the-copy')}
              <input
                data-autofocus
                value={named}
                disabled={copying}
                onChange={(event) => setNamed(event.target.value)}
              />
              {previewed?.titleInUse === true && (
                <span className={styles['warn']}>{words('rows.title-in-use')}</span>
              )}
            </label>
            <label className={styles['field']}>
              {words('document.where')}
              <span className={styles['where']}>
                <Icon name="Folder" size={14} />
                <select
                  value={where}
                  disabled={copying}
                  onChange={(event) => setWhere(event.target.value)}
                >
                  {(spaces ?? []).map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.name}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
          {document && (
            <fieldset className={styles['starts']} aria-describedby={`${heading}-hint`}>
              <legend>
                <strong>{words('rows.start-from')}</strong>{' '}
                <span id={`${heading}-hint`}>{words('rows.start-from-hint')}</span>
              </legend>
              {STARTS.map((each) => (
                <label
                  key={each.value}
                  className={styles['card']}
                  data-chosen={components === each.value || undefined}
                >
                  <span className={styles['cardTile']}>
                    <Icon name={each.icon} size={16} />
                  </span>
                  <span className={styles['cardName']}>{each.name()}</span>
                  <input
                    type="radio"
                    name={name}
                    value={each.value}
                    checked={components === each.value}
                    disabled={copying}
                    aria-describedby={`${heading}-${each.value}`}
                    onChange={() => start(each.value)}
                  />
                  <span id={`${heading}-${each.value}`} className={styles['cardSaid']}>
                    {each.said()}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {document && known !== null && (
            <div className={styles['panel']}>
              <div className={styles['panelHead']}>
                <button
                  type="button"
                  className={styles['toggle']}
                  aria-expanded={open}
                  aria-controls={listId}
                  disabled={copying}
                  onClick={toggle}
                >
                  <Icon name={open ? 'Chevron up' : 'Chevron down'} size={14} />
                  <span className={styles['copied']}>
                    {words('rows.copied-count', { count: copiedNow })}
                  </span>{' '}
                  <span className={styles['reused']}>
                    {words('rows.reused-count', { count: reusedNow })}
                  </span>{' '}
                  <span className={styles['more']}>
                    {open
                      ? words('rows.hide-the-components')
                      : words('rows.show-all-components', { count: placed.length })}
                  </span>
                </button>
                {exceptions.size > 0 && (
                  <span className={styles['chip']}>
                    {words('rows.exceptions-count', { count: exceptions.size })}
                    <button
                      type="button"
                      aria-label={words('rows.clear-the-exceptions')}
                      disabled={copying}
                      onClick={() => setExceptions(new Map())}
                    >
                      <Icon name="Close" size={12} />
                    </button>
                  </span>
                )}
              </div>
              <div className={styles['bar']} aria-hidden="true">
                <span className={styles['barCopied']} style={{ flexGrow: copiedNow }} />
                <span className={styles['barReused']} style={{ flexGrow: reusedNow }} />
              </div>
              {open && (
                <ul id={listId} className={styles['list']} aria-label={words('rows.components')}>
                  {placed.map((each) => {
                    const fixed = isFixed(each.placed);
                    const shown = each.title ?? words('rows.unreadable-component');
                    const as = outcome(each);
                    const excepted = exceptions.has(each.component);
                    return (
                      <li
                        key={each.component}
                        data-exception={excepted || undefined}
                        data-fixed={fixed || undefined}
                      >
                        <span className={styles['rowName']}>
                          <Icon name="Part component" size={14} />
                          <span>{shown}</span>
                          {excepted && (
                            <span className={styles['exception']}>{words('rows.exception')}</span>
                          )}
                        </span>
                        <span className={styles['elsewhere']}>
                          {each.placed === 'unreadable' ? (
                            <Lozenge kind="notYoursToRead" size="small" />
                          ) : (
                            whereElse(each)
                          )}
                        </span>
                        {fixed ? (
                          <span className={styles['fixed']} title={whereElse(each)}>
                            <Icon name="Fixed" size={12} />
                            {words('rows.reused')}
                          </span>
                        ) : (
                          <span
                            role="radiogroup"
                            aria-label={words('rows.in-the-copy', { name: shown })}
                            className={styles['switch']}
                          >
                            {(['copy', 'reuse'] as const).map((value) => (
                              <label key={value} data-on={as === value || undefined}>
                                <input
                                  type="radio"
                                  name={`${heading}-${each.component}`}
                                  value={value}
                                  checked={as === value}
                                  disabled={copying}
                                  onChange={() => set(each.component, each.placed, value)}
                                />
                                <Icon name={value === 'copy' ? 'Duplicate' : 'Link'} size={12} />
                                {words(value === 'copy' ? 'rows.copy' : 'rows.reuse')}
                              </label>
                            ))}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {document && known !== null && known.overrides > 0 && (
            <label className={styles['rewordings']}>
              <input
                type="checkbox"
                checked={rewordings === 'keep'}
                disabled={copying}
                onChange={(event) => setRewordings(event.target.checked ? 'keep' : 'drop')}
              />
              <span>
                <span className={styles['rewordingsName']}>
                  {words('rows.keep-rewordings')}
                  <span
                    className={styles['badge']}
                    aria-label={words('rows.rewordings-count', { count: known.overrides })}
                  >
                    {known.overrides}
                  </span>
                </span>
                <span className={styles['rewordingsSaid']}>
                  {rewordings === 'keep'
                    ? [
                        words('rows.keep-rewordings-said'),
                        ...(known.overridesDropped > 0
                          ? [words('rows.rewordings-dropped', { count: known.overridesDropped })]
                          : []),
                      ].join(' ')
                    : words('rows.drop-rewordings-said')}
                </span>
              </span>
            </label>
          )}
          {previewed !== null && previewed.costs.length > 0 && (
            <ul className={styles['costs']} aria-label={words('rows.what-the-copy-leaves')}>
              {previewed.costs.map((cost) => (
                <li key={cost.text} data-lost={cost.lost || undefined}>
                  <Icon name={cost.lost ? 'Warning' : 'Information'} size={14} />
                  {cost.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className={styles['foot']}>
          {copying && (
            <progress className={styles['progress']} aria-label={words('rows.copying')} />
          )}
          <p
            role="status"
            data-refused={(refused ?? previewed?.refused ?? null) !== null || undefined}
          >
            {refused ??
              (copying
                ? document
                  ? words('rows.copying-wait', { count: copiedNow })
                  : words('rows.copying')
                : (reason ?? words('rows.into-space', { space: target })))}
          </p>
          <button type="button" disabled={copying} onClick={onClose}>
            {words('document.cancel')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={copying}
            aria-disabled={reason !== null || undefined}
            onClick={() => {
              if (reason === null) void copy();
            }}
          >
            <Icon name="Duplicate" size={16} />
            {words('rows.duplicate-act')}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

const EMPTY: Previewed = {
  copies: 0,
  titleInUse: false,
  refused: null,
  costs: [],
  components: [],
  overrides: 0,
  overridesDropped: 0,
};
