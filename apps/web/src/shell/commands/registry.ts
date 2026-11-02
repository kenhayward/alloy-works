import { EDITOR_COMMANDS } from '@alloy-works/editor';

import { words, type WordKey } from '../../words/words.js';

export type CommandScope = 'global' | 'page' | 'editor';

/**
 * One thing the application can be asked to do, registered once with its words, icon and key
 * (ADR-0076; CNT-188). A menu's item and a dock button's tooltip are views of it. A key here is a
 * `prosemirror-keymap` key, the notation the editor's registry uses.
 */
export interface AppCommand {
  readonly id: string;
  readonly scope: CommandScope;
  readonly icon?: string;
  readonly chord?: string;
  readonly said: () => string;
}

const page = (
  id: string,
  word: WordKey,
  icon?: string,
  chord?: string,
  scope: CommandScope = 'page',
): AppCommand => ({
  id,
  scope,
  said: () => words(word),
  ...(icon === undefined ? {} : { icon }),
  ...(chord === undefined ? {} : { chord }),
});

/** The id of an editor command's row, by its stable English label. */
export const editorCommandId = (label: string): string => `editor.${label}`;

export const COMMANDS: readonly AppCommand[] = [
  ...EDITOR_COMMANDS.map((command): AppCommand => ({
    id: editorCommandId(command.label),
    scope: 'editor',
    icon: command.label,
    chord: command.shortcut,
    said: () => command.said,
  })),
  // Not rows of the editor's registry: the page's, opening a dialog or reading the clipboard.
  page('editor.Figure', 'editor.figure', 'Figure', undefined, 'editor'),
  page('editor.Image', 'editor.image', 'Image', undefined, 'editor'),
  page(
    'editor.Paste as Markdown',
    'editor.paste-as-markdown',
    'Paste as Markdown',
    undefined,
    'editor',
  ),
  page('undo', 'menu.undo', undefined, 'Mod-z', 'editor'),
  page('redo', 'menu.redo', undefined, 'Mod-y', 'editor'),
  page('search', 'menu.search', undefined, 'Mod-k', 'global'),
  page('preview', 'publishing.preview', 'Preview'),
  page('save-version', 'menu.save-version', undefined),
  page('history', 'menu.history', 'Versions'),
  page('dates', 'menu.dates'),
  page('scope', 'menu.effective-for'),
  page('language', 'document.language', 'Language'),
  page('relationships', 'reuse.relationships'),
  page('access', 'access.manage-access', 'Manage access'),
  page('hold', 'menu.place-a-hold'),
  page('archive', 'lifecycle.archive'),
  page('delete', 'menu.delete'),
  page('mode.reading', 'document.reading', 'Reading'),
  page('mode.review', 'menu.review', 'Review'),
  page('mode.authoring', 'menu.authoring', 'Authoring'),
  page('panel.contents', 'document.contents', 'Contents'),
  page('panel.baselines', 'document.baselines', 'Keep'),
  page('panel.data', 'document.data', 'Value'),
  page('assistant', 'menu.assistant', 'Assistant', 'Mod-j'),
  page('boundaries', 'document.show-boundaries', 'Show boundaries'),
  page('style-labels', 'menu.style-labels'),
  page('pages', 'publishing.pages-as-you-edit'),
  page('zoom-in', 'menu.zoom-in', undefined, 'Mod-Alt-='),
  page('zoom-out', 'menu.zoom-out', undefined, 'Mod-Alt--'),
  page('fit', 'menu.fit-to-width'),
  page('comment', 'menu.comment', 'Threads'),
  page('manage-styles', 'menu.manage-styles'),
  page('shortcuts', 'menu.keyboard-shortcuts', undefined, undefined, 'global'),
  page('whats-new', 'menu.whats-new', undefined, undefined, 'global'),
];

export const commandOf = (id: string): AppCommand => {
  const found = COMMANDS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`No command ${id}`);
  return found;
};

/**
 * Keys the registry may never bind (ADR-0076): a browser's and a desktop's that a page cannot have,
 * `Ctrl Alt` and a letter a desktop or Developer Tools owns, and the keys the handoff drew that the
 * editor's commands have reasons for. A literal, so a new key is weighed against it.
 */
export const RESERVED_CHORDS: readonly string[] = [
  'Mod-n',
  'Mod-t',
  'Mod-w',
  'Mod-Shift-n',
  'Mod-Shift-t',
  'Mod-Shift-w',
  'Mod-Tab',
  'Mod-=',
  'Mod-Shift-=',
  'Mod--',
  'Mod-Alt-c',
  'Mod-Alt-h',
  'Mod-Alt-i',
  'Mod-Alt-k',
  'Mod-Alt-m',
  'Mod-Alt-t',
  'Mod-Alt-e',
  'Mod-Alt-0',
  'Mod-Alt-1',
  'Mod-Alt-2',
  'Mod-Alt-3',
  'Mod-Shift-b',
  'Mod-s',
  'Mod-/',
];

export const isApple = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform);

const parts = (chord: string): readonly string[] => {
  // The key itself may be a hyphen, as in `Mod-Alt--`.
  const hyphen = chord.endsWith('--');
  const pieces = chord.split('-').filter(Boolean);
  return hyphen ? [...pieces, '-'] : pieces;
};

const shown = (piece: string): string => (piece.length === 1 ? piece.toUpperCase() : piece);

/** A chord as a menu or a tooltip says it (`Ctrl Shift 8`), the platform's names for its modifiers. */
export function chordSaid(chord: string, apple: boolean = isApple()): string {
  return parts(chord)
    .map((piece) => {
      if (piece === 'Mod') return apple ? 'Cmd' : 'Ctrl';
      if (piece === 'Alt') return apple ? 'Option' : 'Alt';
      return shown(piece);
    })
    .join(' ');
}

/** A chord as `aria-keyshortcuts` spells it. */
export function ariaKeyShortcuts(chord: string, apple: boolean = isApple()): string {
  return parts(chord)
    .map((piece) => {
      if (piece === 'Mod') return apple ? 'Meta' : 'Control';
      return shown(piece);
    })
    .join('+');
}

/** Each place on the rail and its go-to letter, `G` then the letter (CNT-189), in the rail's order. */
export const goToTargets = (): readonly { readonly letter: string; readonly href: string }[] => [
  { letter: 'h', href: '#/' },
  { letter: 'c', href: '#/components' },
  { letter: 'd', href: '#/documents' },
  { letter: 't', href: '#/templates' },
  { letter: 'p', href: '#/prompts' },
  { letter: 'b', href: '#/bibliography' },
  { letter: 'e', href: '#/terms' },
  { letter: 'i', href: '#/images' },
  { letter: 'v', href: '#/conversations' },
  { letter: 'u', href: '#/publications' },
  { letter: 'a', href: '#/admin/overview' },
];
