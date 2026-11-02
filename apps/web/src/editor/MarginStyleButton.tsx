import { paragraphsAt, type EditorView } from '@alloy-works/editor';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import { Flyout, type MenuEntry } from '../parts/MenuBar.js';
import { words } from '../words/words.js';
import styles from './MarginStyleButton.module.css';

/**
 * The current paragraph's label as a button that opens the style list (ADR-0075), standing over the
 * label in the margin. Placed from where the paragraph is drawn, again at each render, which the editor
 * makes for every transaction. Nothing where a label would not show, below the zoom or turned off.
 */
export function MarginStyleButton({
  view,
  entries,
}: {
  view: EditorView;
  entries: readonly MenuEntry[];
}) {
  const own = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<CSSProperties | null>(null);
  const [first] = paragraphsAt(view.state);
  const chosen = entries.find((entry) => entry.kind === 'item' && entry.checked === true);
  useLayoutEffect(() => {
    const parent = own.current?.parentElement;
    if (first === undefined || !parent) return setAt(null);
    const drawn = view.domAtPos(first.pos + 1).node;
    const block = (drawn instanceof Element ? drawn : drawn.parentElement)?.closest('p');
    if (!block || block.closest('.aw-labels') === null || block.closest('li, td, th') !== null) {
      return setAt(null);
    }
    const rect = block.getBoundingClientRect();
    const box = parent.getBoundingClientRect();
    const rtl = getComputedStyle(block).direction === 'rtl';
    const end = (rtl ? rect.right - box.left : box.right - rect.left) + 4;
    const next = `${rect.top - box.top}|${end}`;
    setAt((was) =>
      was !== null && `${String(was.top)}|${String(was.insetInlineEnd)}` === next
        ? was
        : { top: rect.top - box.top, insetInlineEnd: end },
    );
    return undefined;
  });
  const name = chosen?.kind === 'item' ? chosen.label : words('theme.several-styles');
  return (
    <div
      ref={own}
      className={styles['holder']}
      style={at ?? { display: 'none' }}
      data-margin-style=""
      title={name}
    >
      <Flyout
        label={words('menu.paragraph-style')}
        entries={entries}
        className={styles['button'] ?? ''}
      >
        <span className={styles['name']} data-content>
          {name}
        </span>
        <span aria-hidden="true">▾</span>
      </Flyout>
    </div>
  );
}
