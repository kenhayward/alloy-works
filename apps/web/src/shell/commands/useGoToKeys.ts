import { useCallback, useEffect, useSyncExternalStore } from 'react';

const STORE = 'alloy-works.go-to-keys';
const WAIT_MS = 1500;
const listeners = new Set<() => void>();

const readOn = (): boolean => {
  try {
    return window.localStorage.getItem(STORE) !== 'off';
  } catch {
    return true;
  }
};

/** Whether `G` then a letter goes anywhere, kept on this device; turned off from the account menu. */
export function useGoToKeysOn(): readonly [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore((changed) => {
    listeners.add(changed);
    return () => listeners.delete(changed);
  }, readOn);
  const set = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORE, next ? 'on' : 'off');
    } catch {
      // Kept for nobody, then: the keys stay as they were.
    }
    listeners.forEach((each) => each());
  }, []);
  return [on, set];
}

/** Where a printable key is the place's own: text, a tree, a list that is typed into, a menu. */
const TAKEN =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="tree"], [role="listbox"], [role="grid"], [role="menu"], [role="menubar"], [role="combobox"], [role="dialog"], [aria-modal="true"]';

/**
 * `G` then a letter goes to a place on the rail (CNT-189), through the rail's own link so it goes where
 * that would. Single printable keys, so they can be turned off, and never act where the focus is
 * somewhere a key means something of its own.
 */
export function useGoToKeys(): void {
  const [on] = useGoToKeysOn();
  useEffect(() => {
    if (!on) return;
    let waiting: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      if (waiting !== null) clearTimeout(waiting);
      waiting = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const from = event.target instanceof Element ? event.target : null;
      if (from?.closest(TAKEN) || document.querySelector('[aria-modal="true"]') !== null) {
        stop();
        return;
      }
      const key = event.key.toLowerCase();
      if (waiting === null) {
        if (key === 'g') waiting = setTimeout(stop, WAIT_MS);
        return;
      }
      stop();
      const link = document.querySelector<HTMLElement>(`a[data-go-to="${CSS.escape(key)}"]`);
      if (link === null) return;
      event.preventDefault();
      link.click();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      stop();
      window.removeEventListener('keydown', onKey);
    };
  }, [on]);
}
