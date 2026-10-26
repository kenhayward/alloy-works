import type { ReferenceViewNode } from '@alloy-works/domain';
import { useEffect, useRef, useState } from 'react';

import styles from './DocumentText.module.css';
import { formats, words } from '../words/words.js';

/** One version of a component, as the list offers it: its id, its number, and when it was made. */
export interface OfferedVersion {
  readonly id: string;
  readonly number: string;
  readonly createdAt: string;
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

/** When a version was made, as the list says it. */
const madeOn = (iso: string) =>
  formats().date(new Date(iso), { day: 'numeric', month: 'long', year: 'numeric' });

type Listed =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | {
      readonly state: 'loaded';
      readonly items: readonly OfferedVersion[];
      readonly next: string | null;
    };

/**
 * The label's version as a button, and the list it opens (document-view.md, "Versions"; CNT-158):
 * **Always the latest**, then each version of the component, newest first, with its number and when it
 * was made, the one the reference stands at now checked. The arrow keys, Home and End move through it;
 * Escape closes it with the focus back on the button, as the focus leaving it does. Choosing one sets
 * the reference's mode through the outline's own act, and the label then says what it resolves to.
 */
export function VersionChoice({
  node,
  component,
  name,
  said,
  choosing,
}: {
  node: ReferenceViewNode;
  component: string;
  name: string;
  said: string;
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

  return (
    <span
      className={styles['versionHolder']}
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
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className={styles['version']}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={words('document.choose-the-version-of', { said, name })}
        onClick={() => setOpen((was) => !was)}
      >
        {said}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={words('document.versions-of', { name })}
          aria-busy={listed.state === 'loading' || more !== null}
          className={styles['versions']}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={checked({ kind: 'latest' })}
            tabIndex={-1}
            onClick={() => void pick({ kind: 'latest' })}
          >
            {words('document.always-the-latest')}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={checked({ kind: 'approved' })}
            tabIndex={-1}
            onClick={() => void pick({ kind: 'approved' })}
          >
            {words('document.always-the-latest-approved-revision')}
          </button>
          {listed.state === 'loading' && (
            <p className={styles['versionsSaid']}>{words('document.reading-the-versions')}</p>
          )}
          {listed.state === 'failed' && (
            <>
              <p className={styles['versionsSaid']}>
                {words('document.the-versions-could-not-be')}
              </p>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  // The focus waits on Always the latest while the list is read again, and goes
                  // into it once it has been.
                  items()[0]?.focus();
                  focused.current = false;
                  setAttempt((count) => count + 1);
                }}
              >
                {words('document.try-again')}
              </button>
            </>
          )}
          {listed.state === 'loaded' &&
            listed.items.map((version) => (
              <button
                key={version.id}
                type="button"
                role="menuitemradio"
                aria-checked={checked({ kind: 'pinned', version: version.id })}
                tabIndex={-1}
                onClick={() => void pick({ kind: 'pinned', version: version.id })}
              >
                {words('document.version-made-on', {
                  number: version.number,
                  when: madeOn(version.createdAt),
                })}
              </button>
            ))}
          {listed.state === 'loaded' && listed.next !== null && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={more !== null}
              onClick={() => {
                if (more === null) setMore(listed.next);
              }}
            >
              {words('document.older-versions')}
            </button>
          )}
        </div>
      )}
    </span>
  );
}
