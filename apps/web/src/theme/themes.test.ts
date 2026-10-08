import { describe, expect, it } from 'vitest';

import {
  createThemeStore,
  readThemeChoice,
  resolveTheme,
  THEME_CHOICES,
  THEME_KEY,
  THEMES,
} from './themes.js';

/** A storage holding `held`, or one whose every call throws, as a blocked one does. */
function storage(held: Record<string, string> = {}, blocked = false): Storage {
  const items = new Map(Object.entries(held));
  const guard = () => {
    if (blocked) throw new DOMException('blocked', 'SecurityError');
  };
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => (guard(), items.get(key) ?? null),
    setItem: (key, value) => (guard(), void items.set(key, value)),
    removeItem: (key) => void items.delete(key),
  };
}

/** The system's light or dark preference, which a test changes as the person's system would. */
function system(dark: boolean) {
  const listeners = new Set<() => void>();
  return {
    get matches() {
      return dark;
    },
    addEventListener: (_type: 'change', listener: () => void) => void listeners.add(listener),
    change(to: boolean) {
      dark = to;
      for (const listener of listeners) listener();
    },
  };
}

describe('the themes', () => {
  it('are Light and Dark, chosen as Light, Dark or Auto', () => {
    expect(THEMES).toEqual(['light', 'dark']);
    expect(THEME_CHOICES).toEqual(['light', 'dark', 'auto']);
  });

  it('remembers a choice, and is Auto where none is kept, the kept one is not a choice, or storage is blocked', () => {
    expect(readThemeChoice(storage({ [THEME_KEY]: 'dark' }))).toBe('dark');
    expect(readThemeChoice(storage())).toBe('auto');
    expect(readThemeChoice(storage({ [THEME_KEY]: 'sepia' }))).toBe('auto');
    expect(readThemeChoice(storage({ [THEME_KEY]: 'dark' }, true))).toBe('auto');
    expect(readThemeChoice(undefined)).toBe('auto');
  });

  it('resolves Auto by the system, and a named theme as itself', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('applies the kept choice at once, and Auto follows the system as it changes', () => {
    const root = document.createElement('html');
    const preference = system(true);
    const store = createThemeStore({ storage: storage(), system: preference, root });

    expect(store.choice()).toBe('auto');
    expect(root.dataset['theme']).toBe('dark');
    preference.change(false);
    expect(root.dataset['theme']).toBe('light');
  });

  it('keeps a named choice, applies it, tells who listens, and stops following the system', () => {
    const root = document.createElement('html');
    const preference = system(false);
    const kept = storage();
    const store = createThemeStore({ storage: kept, system: preference, root });
    const heard: string[] = [];
    store.subscribe(() => heard.push(store.choice()));

    store.choose('dark');
    preference.change(false);

    expect(root.dataset['theme']).toBe('dark');
    expect(kept.getItem(THEME_KEY)).toBe('dark');
    expect(heard).toEqual(['dark']);
  });

  it('still applies a choice where it cannot be kept, and where there is no system preference', () => {
    const root = document.createElement('html');
    const store = createThemeStore({ storage: storage({}, true), system: undefined, root });

    expect(root.dataset['theme']).toBe('light');
    store.choose('dark');
    expect(root.dataset['theme']).toBe('dark');
  });
});
