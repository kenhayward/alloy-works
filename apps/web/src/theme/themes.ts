import { useSyncExternalStore } from 'react';

/**
 * The themes the interface can be shown in, each a `[data-theme]` block of colour tokens in
 * tokens.css; colours.test.ts fails the build if the two lists disagree or a block misses a token.
 * A person chooses one of them or Auto, which follows the system (ADR-0046).
 */
export const THEMES = ['light', 'dark'] as const;
export const THEME_CHOICES = ['light', 'dark', 'auto'] as const;

export type ThemeName = (typeof THEMES)[number];
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** Where the choice is kept: per device, as the panes' widths are (LG-B). */
export const THEME_KEY = 'alloy-works:theme';

/** The kept choice; Auto where none is kept, the kept one is not a choice, or storage is blocked. */
export function readThemeChoice(storage: Storage | undefined): ThemeChoice {
  try {
    const kept = storage?.getItem(THEME_KEY);
    return THEME_CHOICES.find((choice) => choice === kept) ?? 'auto';
  } catch {
    return 'auto';
  }
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ThemeName {
  return choice === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : choice;
}

/** Shows the interface in a theme, by naming it on the root element the tokens are scoped to. */
export function applyTheme(name: ThemeName, root: HTMLElement = document.documentElement): void {
  root.dataset['theme'] = name;
}

/** The system's dark preference, as `matchMedia` answers it. */
export interface SystemPreference {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
}

export interface ThemeStore {
  choice(): ThemeChoice;
  choose(choice: ThemeChoice): void;
  subscribe(listener: () => void): () => void;
}

/** Applies the kept choice at once, keeps Auto following the system, and applies each new choice. */
export function createThemeStore({
  storage,
  system,
  root,
}: {
  storage: Storage | undefined;
  system: SystemPreference | undefined;
  root: HTMLElement;
}): ThemeStore {
  let current = readThemeChoice(storage);
  const listeners = new Set<() => void>();
  const apply = () => applyTheme(resolveTheme(current, system?.matches ?? false), root);
  system?.addEventListener('change', () => {
    if (current === 'auto') apply();
  });
  apply();
  return {
    choice: () => current,
    choose(choice) {
      current = choice;
      try {
        storage?.setItem(THEME_KEY, choice);
      } catch {
        // Not kept, as in a private window; still applied for as long as the page is open.
      }
      apply();
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let shared: ThemeStore | undefined;

/** The page's one store, made from the window the first time it is asked for. */
export function themeStore(): ThemeStore {
  if (shared === undefined) {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      storage = undefined;
    }
    shared = createThemeStore({
      storage,
      system:
        typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-color-scheme: dark)')
          : undefined,
      root: document.documentElement,
    });
  }
  return shared;
}

/** The person's choice, and a way to change it, for a component. */
export function useThemeChoice(): readonly [ThemeChoice, (choice: ThemeChoice) => void] {
  const store = themeStore();
  const choice = useSyncExternalStore(store.subscribe, store.choice);
  return [choice, store.choose];
}
