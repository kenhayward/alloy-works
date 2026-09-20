import {
  conditions,
  listOf,
  number,
  resolve,
  type Contribution,
  type NumberingScheme,
  type OutlineView,
} from '@alloy-works/domain';
import { useId, useMemo } from 'react';

import { nodeLink } from './links.js';
import { nodeName, placeOf, type Names } from './tree.js';

/** What the page knows of each occurrence's contributions, keyed by the occurrence's node. */
export type Known =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly signedOut: boolean }
  | {
      readonly state: 'loaded';
      readonly contributions: ReadonlyMap<string, readonly Contribution[]>;
    };

const NOTHING: ReadonlyMap<string, readonly Contribution[]> = new Map();

/** The lists a document generates, in the order a publication prints them (STR-041). */
const LISTS = [
  { sequence: 'figure', heading: 'Figures' },
  { sequence: 'table', heading: 'Tables' },
  { sequence: 'equation', heading: 'Equations' },
] as const;

export interface GeneratedListsProps {
  readonly document: string;
  readonly outline: OutlineView;
  /**
   * The scheme every entry's label and number comes from: the layout version's this document would
   * be published under (STR-036). `null` where that scheme could not be read, and then there are no
   * lists to show rather than lists a publication would print differently.
   */
  readonly scheme: NumberingScheme | null;
  readonly known: Known;
  readonly names: Names;
  readonly onRetry: () => void;
  /** An entry's link names the address already shown, so following it announces nothing. */
  readonly onArriveAgain?: (() => void) | undefined;
}

/**
 * The list of figures, of tables and of equations, numbered in the page by the same pipeline the
 * service numbers with, over the outline the page holds and each occurrence's contributions as the
 * service last answered them - so a move renumbers every entry before anybody asks the service
 * anything. An occurrence the page has heard nothing about is not known, so every number it could
 * have moved is shown as none rather than guessed (IAM-073), exactly as the numbering route withholds
 * it. Each entry is a link to the occurrence that holds it.
 */
export function GeneratedLists({
  document,
  outline,
  scheme,
  known,
  names,
  onRetry,
  onArriveAgain,
}: GeneratedListsProps) {
  const prefix = useId();
  const contributions = known.state === 'loaded' ? known.contributions : NOTHING;
  const lists = useMemo(() => {
    if (scheme === null) return [];
    const conditioned = conditions(resolve(outline, contributions));
    const numbering = number(conditioned, scheme);
    return LISTS.map((list) => ({
      ...list,
      word: scheme.sequences[list.sequence]?.body.label ?? list.heading,
      entries: listOf(conditioned, numbering, list.sequence),
    }));
  }, [outline, contributions, scheme]);

  // Nothing at all without a scheme: the page says once why, and no entry here could be labelled or
  // numbered without guessing at what a publication would print.
  if (scheme === null) return null;
  if (known.state === 'loading') return <p>Reading the figures, tables and equations...</p>;
  if (known.state === 'failed') {
    return known.signedOut ? (
      <p>You are signed out. Sign in again to see the figures, tables and equations.</p>
    ) : (
      <>
        <p>The figures, tables and equations could not be read.</p>
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      </>
    );
  }
  if (lists.every((list) => list.entries.length === 0)) {
    return <p>This document has no figures, tables or equations.</p>;
  }
  return (
    <>
      {lists.map((list) =>
        list.entries.length === 0 ? null : (
          <section key={list.sequence} aria-labelledby={`${prefix}-${list.sequence}`}>
            <h3 id={`${prefix}-${list.sequence}`}>{list.heading}</h3>
            <ul>
              {list.entries.map((entry) => {
                const holder = placeOf(outline.nodes, entry.node)?.node;
                const shown = [entry.label ?? list.word, entry.caption]
                  .filter((part) => part !== null && part !== '')
                  .join(' ');
                const href = nodeLink(document, entry.node);
                return (
                  <li key={`${entry.node} ${entry.block}`}>
                    <a
                      href={href}
                      onClick={() => {
                        // The node already chosen, or another entry of the same occurrence: the
                        // browser changes nothing and says nothing, so the arrival is asked for.
                        if (window.location.hash === href) onArriveAgain?.();
                      }}
                    >
                      {shown}
                    </a>
                    {holder && <> in {nodeName(holder, names)}</>}
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
    </>
  );
}
