import type { ReferenceViewNode } from '@alloy-works/domain';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../editor/Icon.js';
import { StateLozenge } from '../states/Lozenge.js';
import styles from './VersionChoice.module.css';
import { formats, words } from '../words/words.js';

/** One version of a component, as the list offers it: its id, its number, and when it was made. */
export interface OfferedVersion {
  readonly id: string;
  readonly number: string;
  readonly createdAt: string;
  /** What a gate designated it, where one did, and where that stands now. */
  readonly revision?:
    | {
        readonly state: { readonly key: string; readonly name: string };
        readonly standing: string | null;
      }
    | null
    | undefined;
}

/** A page of a component's versions, newest first, and the cursor for the next or null at the end. */
export interface VersionsPage {
  readonly items: readonly OfferedVersion[];
  readonly next: string | null;
}

/** What a reference may be set to from its label: pinned to a version, the latest, or the latest approved revision (CNT-159). */
export type ChosenMode =
  | { readonly kind: 'pinned'; readonly version: string }
  | { readonly kind: 'latest' }
  | { readonly kind: 'approved' };

/** How the label and the list reach the service, given by the page only where the choice is offered. */
export interface Choosing {
  /** A page of the component's versions, newest first; null where it could not be read. */
  readonly list: (component: string, cursor: string | undefined) => Promise<VersionsPage | null>;
  /** Sets the reference's mode, as the outline's own act; true once it is done. */
  readonly choose: (node: string, mode: ChosenMode) => Promise<boolean>;
}

/**
 * What a reference's label says of its version (CNT-162): the number it resolves to, where the reader
 * is told one, and whether it is pinned there or follows the latest; and for one tracking the latest
 * approved revision, which revision that is, or that none is approved (CNT-163; the WF4 plan, WF4-B).
 */
export function versionSaid(
  mode: ReferenceViewNode['mode'],
  number: string | undefined,
  revision?: number,
): string {
  if (mode.kind === 'approved') {
    return revision === undefined
      ? words('document.no-approved-revision')
      : words('document.revision-latest-approved', { revision });
  }
  return number === undefined
    ? mode.kind
    : words('document.version-3', { number, kind: mode.kind });
}

/** When a version was made, as the list says it: "21 Oct 2026, 09:15". */
const madeOn = (iso: string) =>
  formats().date(new Date(iso), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Whether a listed version is an approved revision that still stands: not displaced, nor never in force. */
const standsApproved = (version: OfferedVersion): boolean =>
  version.revision !== null &&
  version.revision !== undefined &&
  version.revision.standing !== 'superseded' &&
  version.revision.standing !== 'neverInForce';

/**
 * What the approved choice says it is now, from the versions read so far, newest first: a number, that
 * none is approved, or nothing. "None" is said only once every version has been read, as one on a later
 * page may be the approved one; and a reference tracking it already knows its number.
 */
export function approvedNow(
  items: readonly OfferedVersion[],
  next: string | null,
  known: string | undefined,
): { readonly number: string } | 'none' | null {
  if (known !== undefined) return { number: known };
  const found = items.find(standsApproved);
  if (found !== undefined) return { number: found.number };
  return next === null ? 'none' : null;
}

/** Where the menu stands, from its row: under it, as wide as it, above where there is no room. */
export function menuPlace(
  row: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly width: number;
  },
  height: number,
  windowHeight: number,
): CSSProperties {
  const gap = 4;
  const edge = 8;
  const below = windowHeight - row.bottom - gap - edge;
  const above = row.top - gap - edge;
  const side = { left: row.left, width: row.width };
  return height <= below || below >= above
    ? { ...side, top: row.bottom + gap, maxHeight: Math.max(below, 0) }
    : { ...side, bottom: windowHeight - row.top + gap, maxHeight: Math.max(above, 0) };
}

/** What the row says of the mode: the words in the panel, where the label's are a sentence. */
function modeWords(mode: ReferenceViewNode['mode'], revision: number | undefined): string {
  if (mode.kind === 'latest') return words('document.always-the-latest');
  if (mode.kind === 'pinned') return words('document.pinned');
  return revision === undefined
    ? words('document.no-approved-revision-row')
    : words('document.latest-approved-revision', { revision });
}

/** The row's face (CNT-162, CNT-163): the version icon, "Version", its number, and its mode. */
export function VersionFace({
  mode,
  number,
  revision,
}: {
  mode: ReferenceViewNode['mode'];
  number: string | undefined;
  revision: number | undefined;
}) {
  const none = mode.kind === 'approved' && revision === undefined;
  return (
    <>
      <Icon name="Versions" size={14} />
      <span className={styles['label']}>{words('document.version-row')}</span>
      {number !== undefined && !none && <span className={styles['number']}>{number}</span>}
      <span className={styles['mode']}>{modeWords(mode, revision)}</span>
    </>
  );
}

/** The row where no choice is offered: the same words, opening nothing. */
export function VersionRow(props: Parameters<typeof VersionFace>[0]) {
  return (
    <div className={styles['row']}>
      <VersionFace {...props} />
    </div>
  );
}

type Listed =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | {
      readonly state: 'loaded';
      readonly items: readonly OfferedVersion[];
      readonly next: string | null;
    };

/**
 * The version row as a button, and the menu it opens (document-view.md, "Versions"; CNT-158):
 * **Always the latest**, the latest approved, then each version of the component, newest first, with its
 * number and when it was made, the one the reference stands at now ticked. The arrow keys, Home and End
 * move through it; Escape closes it with the focus back on the button, as the focus leaving it does.
 * Choosing one sets the reference's mode through the outline's own act, and the row then says what it
 * resolves to. The menu is portalled to the page, so no pane's overflow clips it (part-panel-2).
 */
export function VersionChoice({
  node,
  component,
  name,
  said,
  number,
  revision,
  choosing,
}: {
  node: ReferenceViewNode;
  component: string;
  name: string;
  said: string;
  number: string | undefined;
  revision: number | undefined;
  choosing: Choosing;
}) {
  // Read through `list` alone, which the page keeps the same, so an act elsewhere on the page that
  // gives it a new `choose` does not read the list again under the reader.
  const { list } = choosing;
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState<Listed>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Focus goes into the list once, when it first shows its versions; not on every later page.
  const focused = useRef(false);
  // Where the focus goes once an older page arrives: its first version, in place of the button that
  // asked for it, which the page may take away.
  const olderFrom = useRef<number | null>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });

  // Placed from the row before it paints, again as what it holds grows, and as anything scrolls or the
  // window changes under it: its own list scrolling moves nothing.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const placeIt = () => {
      const row = button.current?.getBoundingClientRect();
      if (row === undefined) return;
      setPlace(menuPlace(row, menu.current?.scrollHeight ?? 0, window.innerHeight));
    };
    placeIt();
    const moved = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      placeIt();
    };
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', placeIt);
    return () => {
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', placeIt);
    };
  }, [open, listed]);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    setListed({ state: 'loading' });
    list(component, undefined)
      .then((page) => {
        if (!current) return;
        setListed(page === null ? { state: 'failed' } : { state: 'loaded', ...page });
      })
      .catch(() => {
        if (current) setListed({ state: 'failed' });
      });
    return () => {
      current = false;
    };
  }, [open, component, list, attempt]);

  // An older page, asked for from the list's last item.
  useEffect(() => {
    if (more === null) return undefined;
    let current = true;
    list(component, more)
      .then((page) => {
        if (!current) return;
        setMore(null);
        setListed((was) => {
          if (page === null || was.state !== 'loaded') return { state: 'failed' };
          // After the two Always choices and every version already shown.
          olderFrom.current = was.items.length + 2;
          return { state: 'loaded', items: [...was.items, ...page.items], next: page.next };
        });
      })
      .catch(() => {
        if (current) {
          setMore(null);
          setListed({ state: 'failed' });
        }
      });
    return () => {
      current = false;
    };
  }, [more, component, list]);

  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []),
  ];

  useEffect(() => {
    if (!open) {
      focused.current = false;
      olderFrom.current = null;
      return;
    }
    if (listed.state === 'loading') return;
    const all = items();
    if (olderFrom.current !== null) {
      (all[olderFrom.current] ?? all[all.length - 1])?.focus();
      olderFrom.current = null;
      return;
    }
    if (focused.current) return;
    focused.current = true;
    (all.find((each) => each.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
  }, [open, listed]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setMore(null);
    if (refocus) button.current?.focus();
  };

  const pick = async (mode: ChosenMode) => {
    const same =
      mode.kind === node.mode.kind &&
      (mode.kind !== 'pinned' ||
        (node.mode.kind === 'pinned' && node.mode.version === mode.version));
    close(true);
    if (!same) await choosing.choose(node.id, mode);
  };

  const checked = (mode: ChosenMode) =>
    mode.kind !== 'pinned'
      ? node.mode.kind === mode.kind
      : node.mode.kind === 'pinned' && node.mode.version === mode.version;

  const approved =
    listed.state === 'loaded'
      ? approvedNow(listed.items, listed.next, node.mode.kind === 'approved' ? number : undefined)
      : null;
  const newest = listed.state === 'loaded' ? listed.items[0]?.number : undefined;
  const tick = (mode: ChosenMode) => (
    <span className={styles['tick']} aria-hidden="true">
      {checked(mode) && <Icon name="Confirmed" size={14} />}
    </span>
  );

  return (
    <div
      className={styles['holder']}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === 'Escape') {
          event.stopPropagation();
          event.preventDefault();
          close(true);
          return;
        }
        const moves: Record<string, (at: number, count: number) => number> = {
          ArrowDown: (at, count) => (at + 1) % count,
          ArrowUp: (at, count) => (at - 1 + count) % count,
          Home: () => 0,
          End: (_, count) => count - 1,
        };
        const move = moves[event.key];
        if (move === undefined) return;
        const all = items();
        if (all.length === 0) return;
        event.preventDefault();
        const at = all.indexOf(document.activeElement as HTMLElement);
        all[move(at < 0 ? -1 : at, all.length)]?.focus();
      }}
      onBlur={(event) => {
        // The menu is elsewhere in the page, though its events come through here.
        const to = event.relatedTarget as Node | null;
        if (open && !event.currentTarget.contains(to) && !menu.current?.contains(to)) close(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className={styles['row']}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={words('document.choose-the-version-of', { said, name })}
        onClick={() => setOpen((was) => !was)}
      >
        <VersionFace mode={node.mode} number={number} revision={revision} />
        <Icon name={open ? 'Chevron up' : 'Chevron down'} size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={words('document.versions-of', { name })}
            aria-busy={listed.state === 'loading' || more !== null}
            className={styles['menu']}
            style={place}
            // A press on its heading, or between its items, is no leaving it.
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              role="menuitemradio"
              className={styles['item']}
              aria-checked={checked({ kind: 'latest' })}
              aria-label={words('document.always-the-latest')}
              {...(newest === undefined
                ? {}
                : { 'aria-description': words('document.now-number', { number: newest }) })}
              tabIndex={-1}
              onClick={() => void pick({ kind: 'latest' })}
            >
              {tick({ kind: 'latest' })}
              <span className={styles['choice']}>
                {words('document.always-the-latest')}
                {newest !== undefined && (
                  <span className={styles['now']}>
                    {words('document.now-number', { number: newest })}
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              role="menuitemradio"
              className={styles['item']}
              aria-checked={checked({ kind: 'approved' })}
              aria-label={words('document.always-the-latest-approved-revision')}
              {...(approved === null
                ? {}
                : {
                    'aria-description':
                      approved === 'none'
                        ? words('document.none-approved')
                        : words('document.now-number', { number: approved.number }),
                  })}
              tabIndex={-1}
              onClick={() => void pick({ kind: 'approved' })}
            >
              {tick({ kind: 'approved' })}
              <span className={styles['choice']}>
                {words('document.always-the-latest-approved-revision')}
                {approved !== null && (
                  <span className={styles['now']}>
                    {approved === 'none'
                      ? words('document.none-approved')
                      : words('document.now-number', { number: approved.number })}
                  </span>
                )}
              </span>
            </button>
            {listed.state === 'loading' && (
              <p className={styles['said']}>{words('document.reading-the-versions')}</p>
            )}
            {listed.state === 'failed' && (
              <>
                <p className={styles['said']}>{words('document.the-versions-could-not-be')}</p>
                <button
                  type="button"
                  role="menuitem"
                  className={styles['item']}
                  tabIndex={-1}
                  onClick={() => {
                    // The focus waits on Always the latest while the list is read again, and goes
                    // into it once it has been.
                    items()[0]?.focus();
                    focused.current = false;
                    setAttempt((count) => count + 1);
                  }}
                >
                  <span className={styles['tick']} aria-hidden="true" />
                  {words('document.try-again')}
                </button>
              </>
            )}
            {listed.state === 'loaded' && listed.items.length > 0 && (
              <>
                <hr className={styles['rule']} />
                <div
                  role="group"
                  aria-label={words('document.pin-to-a-version')}
                  className={styles['pinned']}
                >
                  <span className={styles['heading']} aria-hidden="true">
                    {words('document.pin-to-a-version')}
                  </span>
                  {listed.items.map((version) => {
                    const when = madeOn(version.createdAt);
                    const stands = standsApproved(version) ? version.revision!.state : null;
                    const made = words('document.version-made-on', {
                      number: version.number,
                      when,
                    });
                    return (
                      <button
                        key={version.id}
                        type="button"
                        role="menuitemradio"
                        className={styles['item']}
                        aria-checked={checked({ kind: 'pinned', version: version.id })}
                        aria-label={stands === null ? made : `${made}, ${stands.name}`}
                        tabIndex={-1}
                        onClick={() => void pick({ kind: 'pinned', version: version.id })}
                      >
                        {tick({ kind: 'pinned', version: version.id })}
                        <span className={styles['versionNumber']}>{version.number}</span>
                        <span className={styles['when']}>{when}</span>
                        {stands !== null && <StateLozenge size="small" state={stands} />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {listed.state === 'loaded' && listed.next !== null && (
              <button
                type="button"
                role="menuitem"
                className={`${styles['item']} ${styles['older']}`}
                tabIndex={-1}
                aria-disabled={more !== null}
                onClick={() => {
                  if (more === null) setMore(listed.next);
                }}
              >
                {words('document.older-versions')}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
