import { useCallback, useSyncExternalStore } from 'react';

const STORE = 'alloy-works.style-labels';
const listeners = new Set<() => void>();

/** Below this zoom a sheet's margin holds no label worth reading, and none is shown (ADR-0075). */
export const LABELS_FROM = 0.75;

const readOn = (): boolean => {
  try {
    return window.localStorage.getItem(STORE) !== 'off';
  } catch {
    return true;
  }
};

/** Whether paragraph styles show in the sheet's margin, kept on this device; View turns them off. */
export function useStyleLabels(): readonly [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore((changed) => {
    listeners.add(changed);
    return () => listeners.delete(changed);
  }, readOn);
  const set = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORE, next ? 'on' : 'off');
    } catch {
      // Kept for nobody, then.
    }
    listeners.forEach((each) => each());
  }, []);
  return [on, set];
}
