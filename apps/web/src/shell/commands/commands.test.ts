import { EDITOR_COMMANDS } from '@alloy-works/editor';
import { describe, expect, it, vi } from 'vitest';

import type { MenuCommandItem, MenuEntry } from '../../parts/MenuBar.js';
import { buildMenus, editorCommandId, type CommandState } from './menus.js';
import {
  ariaKeyShortcuts,
  chordSaid,
  COMMANDS,
  commandOf,
  goToTargets,
  RESERVED_CHORDS,
} from './registry.js';

const flat = (entries: readonly MenuEntry[]): MenuCommandItem[] =>
  entries.flatMap((entry) =>
    entry.kind === 'item' ? [entry] : entry.kind === 'submenu' ? flat(entry.entries) : [],
  );

const allOn = (): CommandState => ({ enabled: true, run: () => undefined });

describe('the command registry', () => {
  it('holds every key the page and the editor answer to, moved keys failing here', () => {
    const chords = Object.fromEntries(
      COMMANDS.filter((each) => each.chord !== undefined).map((each) => [each.id, each.chord]),
    );
    expect(chords).toEqual({
      'editor.Strong': 'Mod-b',
      'editor.Emphasis': 'Mod-i',
      'editor.Underline': 'Mod-u',
      'editor.Subscript': 'Mod-,',
      'editor.Superscript': 'Mod-.',
      'editor.Inline code': 'Mod-e',
      'editor.Quoted phrase': 'Mod-Shift-q',
      'editor.Link': 'Mod-k',
      'editor.Language': 'Mod-Shift-l',
      'editor.Term': 'Mod-Alt-g',
      'editor.Bulleted list': 'Mod-Shift-8',
      'editor.Numbered list': 'Mod-Shift-7',
      'editor.Definition list': 'Mod-Shift-9',
      'editor.Nest item': 'Mod-]',
      'editor.Lift item': 'Mod-[',
      'editor.Quotation': 'Mod-Shift-.',
      'editor.Preformatted text': 'Mod-Shift-,',
      'editor.Table': 'Mod-Shift-0',
      'editor.Footnote': 'Mod-Alt-f',
      'editor.Reference': 'Mod-Alt-x',
      'editor.Cite': 'Mod-Shift-2',
      'editor.Index entry': 'Mod-Shift-1',
      'editor.Value': 'Mod-Shift-6',
      'editor.Variable': 'Mod-Alt-v',
      'editor.Message form': 'Mod-Alt-p',
      'editor.Condition': 'Mod-Alt-o',
      'editor.Equation': 'Mod-Shift-e',
      'editor.Symbols': 'Mod-Shift-m',
      undo: 'Mod-z',
      redo: 'Mod-y',
      search: 'Mod-k',
      assistant: 'Mod-j',
      'zoom-in': 'Mod-Alt-=',
      'zoom-out': 'Mod-Alt--',
    });
  });

  it('gives no two commands in a scope one chord, and overlaps scopes only for Link and Search', () => {
    const seen = new Map<string, string[]>();
    for (const each of COMMANDS) {
      if (each.chord !== undefined) seen.set(each.chord, [...(seen.get(each.chord) ?? []), each.id]);
    }
    const shared = [...seen.values()].filter((ids) => ids.length > 1);
    expect(shared).toEqual([['editor.Link', 'search']]);
    expect(commandOf('editor.Link').scope).not.toBe(commandOf('search').scope);
  });

  it('binds none of the chords a browser, a desktop or a layout takes', () => {
    for (const each of COMMANDS) {
      if (each.chord !== undefined) expect(RESERVED_CHORDS).not.toContain(each.chord);
    }
  });

  it('says a chord in words and as aria-keyshortcuts', () => {
    expect(chordSaid('Mod-Shift-8', false)).toBe('Ctrl Shift 8');
    expect(chordSaid('Mod-Alt-g', true)).toBe('Cmd Option G');
    expect(chordSaid('Mod-,', false)).toBe('Ctrl ,');
    expect(ariaKeyShortcuts('Mod-Shift-8', false)).toBe('Control+Shift+8');
    expect(ariaKeyShortcuts('Mod-Alt-g', true)).toBe('Meta+Alt+G');
  });

  it('names a go-to letter for every place on the rail, and no two alike', () => {
    const letters = goToTargets().map((each) => each.letter);
    expect(letters).toEqual(['h', 'c', 'd', 't', 'p', 'b', 'e', 'i', 'v', 'u', 'a']);
    expect(new Set(letters).size).toBe(letters.length);
  });
});

describe('the menus', () => {
  it('CNT-077 reach every command in the editor registry', () => {
    const items = buildMenus(allOn).flatMap((menu) => flat(menu.entries));
    for (const command of EDITOR_COMMANDS) {
      expect(items.map((item) => item.key)).toContain(editorCommandId(command.label));
    }
  });

  it('CNT-188 say each command\'s keys from the registry, in words and for assistive technology', () => {
    const items = buildMenus(allOn).flatMap((menu) => flat(menu.entries));
    const bold = items.find((item) => item.key === 'editor.Strong')!;
    expect(bold.keys).toBe(chordSaid('Mod-b', false));
    expect(bold.ariaKeys).toBe(ariaKeyShortcuts('Mod-b', false));
    expect(items.find((item) => item.key === 'history')!.keys).toBeUndefined();
  });

  it('keep what cannot apply, aria-disabled, and never drop it', () => {
    const items = buildMenus(() => ({ enabled: false, run: () => undefined })).flatMap((menu) =>
      flat(menu.entries),
    );
    expect(items.find((item) => item.key === 'delete')!.enabled).toBe(false);
  });

  it('lead Document with the lifecycle the page gives, and put Delete last in danger', () => {
    const run = vi.fn();
    const [document] = buildMenus(allOn, {
      lifecycle: [{ key: 'submit', label: 'Submit', enabled: true, run }],
    });
    const items = flat(document!.entries);
    expect(items[0]!.key).toBe('submit');
    expect(items[0]!.content).toBe(true);
    expect(items.at(-1)!.key).toBe('delete');
    expect(items.at(-1)!.danger).toBe(true);
  });

  it('list only the paragraph styles the page gives in Format', () => {
    const menus = buildMenus(allOn, {
      styles: [{ value: 'body', label: 'Body (default)', checked: true, run: () => undefined }],
    });
    const format = menus.find((menu) => menu.key === 'format')!;
    const submenu = format.entries.find(
      (entry) => entry.kind === 'submenu' && entry.key === 'paragraph-style',
    );
    expect(submenu).toBeDefined();
    const inside = flat(submenu!.kind === 'submenu' ? submenu!.entries : []).filter(
      (each) => each.role === 'menuitemradio',
    );
    expect(inside.map((item) => item.label)).toEqual(['Body (default)']);
    expect(inside[0]!.role).toBe('menuitemradio');
  });
});
