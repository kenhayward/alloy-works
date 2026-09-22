import { useCallback, useRef, useState } from 'react';
import { Icon } from '../editor/Icon.js';

import styles from './PaneWidth.module.css';

export interface PaneBounds {
  /** Where this browser remembers the width, and beside it (with `.collapsed`) whether it is hidden. */
  readonly storageKey: string;
  readonly min: number;
  readonly max: number;
  readonly initial: number;
}

export interface Pane {
  readonly width: number;
  readonly collapsed: boolean;
  readonly bounds: PaneBounds;
  readonly setWidth: (width: number) => void;
  readonly setCollapsed: (collapsed: boolean) => void;
}

/** A value this browser kept, or nothing: a store that will not answer is one that remembers nothing. */
export function kept(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function keep(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered, which costs the reader one drag next time.
  }
}

const clamp = (value: number, { min, max }: PaneBounds) => Math.min(max, Math.max(min, value));

/**
 * A side pane's width, set by the reader between its bounds, and whether it is hidden to a rail -
 * both remembered by this browser. The README asks for per person; with no preference store in the
 * service yet, per browser is what exists.
 */
export function usePaneWidth(bounds: PaneBounds): Pane {
  const [width, setStoredWidth] = useState(() => {
    const read = Number(kept(bounds.storageKey));
    return Number.isFinite(read) && read > 0 ? clamp(read, bounds) : bounds.initial;
  });
  const [collapsed, setStoredCollapsed] = useState(
    () => kept(`${bounds.storageKey}.collapsed`) === 'true',
  );
  const setWidth = useCallback(
    (next: number) => {
      const bounded = clamp(Math.round(next), bounds);
      setStoredWidth(bounded);
      keep(bounds.storageKey, String(bounded));
    },
    [bounds],
  );
  const setCollapsed = useCallback(
    (next: boolean) => {
      setStoredCollapsed(next);
      keep(`${bounds.storageKey}.collapsed`, String(next));
    },
    [bounds.storageKey],
  );
  return { width, collapsed, bounds, setWidth, setCollapsed };
}

const STEP = 10;

/**
 * The edge between a pane and what is beside it: dragged with the pointer, or moved with the arrow
 * keys, Home and End, as a window splitter is (WAI-ARIA's separator).
 */
export function PaneSeparator({ label, pane }: { label: string; pane: Pane }) {
  const from = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className={styles['separator']}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${label}`}
      aria-valuemin={pane.bounds.min}
      aria-valuemax={pane.bounds.max}
      aria-valuenow={pane.width}
      tabIndex={0}
      onKeyDown={(event) => {
        const next =
          event.key === 'ArrowLeft'
            ? pane.width - STEP
            : event.key === 'ArrowRight'
              ? pane.width + STEP
              : event.key === 'Home'
                ? pane.bounds.min
                : event.key === 'End'
                  ? pane.bounds.max
                  : null;
        if (next === null) return;
        event.preventDefault();
        pane.setWidth(next);
      }}
      onPointerDown={(event) => {
        from.current = { x: event.clientX, width: pane.width };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (from.current) pane.setWidth(from.current.width + event.clientX - from.current.x);
      }}
      onPointerUp={() => {
        from.current = null;
      }}
    />
  );
}

/** Hides a pane to a rail, or shows it again. */
export function PaneToggle({ label, pane }: { label: string; pane: Pane }) {
  const words = pane.collapsed ? `Show the ${label}` : `Hide the ${label}`;
  return (
    <button
      type="button"
      className={styles['toggle']}
      aria-label={words}
      title={words}
      onClick={() => pane.setCollapsed(!pane.collapsed)}
    >
      <Icon name={pane.collapsed ? 'Show pane' : 'Hide pane'} />
    </button>
  );
}
