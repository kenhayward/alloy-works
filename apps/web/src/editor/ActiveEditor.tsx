import { createContext, useContext, useEffect, useRef, type RefObject } from 'react';

import type { CommandState, StyleItem } from '../shell/commands/menus.js';

/** What the menus ask of the component being edited, read as a menu opens. */
export interface ActiveEditorHandle {
  /** How an `editor.` command, `undo` or `redo` stands, by the registry's id. */
  readonly state: (id: string) => CommandState | undefined;
  readonly styles: () => readonly StyleItem[];
}

/**
 * Where the one component being edited tells the page's menus it is (ADR-0075): open in place, or
 * Review's draft; at most one mounts. A ref, read when a menu opens, so that a keystroke re-renders no
 * menu (CNT-179).
 */
export const ActiveEditorContext = createContext<RefObject<ActiveEditorHandle | null> | null>(null);

/**
 * A component editor's half: what it publishes while it is mounted, which it sets on what this returns
 * every render, past its early returns.
 */
export function usePublishActiveEditor(): { current: ActiveEditorHandle } {
  const slot = useContext(ActiveEditorContext);
  const latest = useRef<ActiveEditorHandle>({ state: () => undefined, styles: () => [] });
  useEffect(() => {
    if (slot === null) return undefined;
    const published: ActiveEditorHandle = {
      state: (id) => latest.current.state(id),
      styles: () => latest.current.styles(),
    };
    slot.current = published;
    return () => {
      if (slot.current === published) slot.current = null;
    };
  }, [slot]);
  return latest;
}

/** Where a component open in place keeps what its selection offers: a tab of the panels (ADR-0075). */
export const InPlaceSettings = createContext<{
  readonly host: HTMLElement | null;
  readonly onHeld: (held: boolean) => void;
  /** The dock's **Comment**: to Review, to write a thread. */
  readonly onComment?: () => void;
} | null>(null);
