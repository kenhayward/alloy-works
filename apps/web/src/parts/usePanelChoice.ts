import { useEffect, useRef, useState } from 'react';

import { keep, kept } from '../layouts/PaneWidth.js';
import { PANELS, selectionMayTake, type PanelKey } from './panels.js';

const remembered = (storageKey: string): PanelKey =>
  PANELS.find((each) => each.key === kept(storageKey))?.key ?? 'part';

/**
 * The panel chosen beside the text, remembered by this browser as the panes' widths are, each kind of
 * page under its own key. What a selection offers takes the panels while it stands, unless they are in
 * the middle of the Assistant or Threads (ADR-0079), and hands them back as it was (ADR-0075).
 */
export function usePanelChoice(
  storageKey: string,
  selectionHeld: boolean,
): readonly [PanelKey, (next: PanelKey) => void, (next: PanelKey) => void] {
  const [chosen, setChosen] = useState<PanelKey>(() => remembered(storageKey));
  const choose = (next: PanelKey) => {
    setChosen(next);
    // Offered only while a selection stands, so nothing to come back to.
    if (next !== 'selection') keep(storageKey, next);
  };
  const beforeSelection = useRef<PanelKey | null>(null);
  useEffect(() => {
    if (selectionHeld) {
      if (!selectionMayTake(chosen)) return;
      beforeSelection.current = chosen;
      setChosen('selection');
    } else if (chosen === 'selection') {
      setChosen(beforeSelection.current ?? remembered(storageKey));
      beforeSelection.current = null;
    }
    // Told as the selection changes, not as the reader chooses a panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionHeld]);
  // The third shows one for this arrival, not as the reader's choice: an address naming a panel.
  return [chosen, choose, setChosen];
}
