import type { MenuCommandItem, MenuEntry, MenuSpec } from '../../parts/MenuBar.js';
import { words, type WordKey } from '../../words/words.js';
import { ariaKeyShortcuts, chordSaid, commandOf, editorCommandId } from './registry.js';

export { editorCommandId };

/** What the page says of a command now: whether it may run, whether it is checked, and how. */
export interface CommandState {
  readonly enabled: boolean;
  readonly checked?: boolean;
  /** Where the words change with the state: Unarchive for Archive. */
  readonly said?: string;
  readonly run: () => void;
}

/** A lifecycle act the page offers, its name the workflow's. */
export interface LifecycleItem {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly run: () => void;
}

/** A paragraph style offered where the selection stands (`paragraphChoices`, CNT-094). */
export interface StyleItem {
  readonly value: string;
  readonly label: string;
  /** The style's own name, which `label` adds to where it is the place's default. */
  readonly name?: string;
  readonly checked: boolean;
  readonly run: () => void;
}

export interface MenuExtras {
  readonly lifecycle?: readonly LifecycleItem[];
  readonly styles?: readonly StyleItem[];
}

type Row = string | { readonly toggle: string } | { readonly radio: string };

const ed = (label: string): string => editorCommandId(label);

const item = (
  row: Row,
  stateOf: (id: string) => CommandState,
  danger = false,
): MenuCommandItem => {
  const id = typeof row === 'string' ? row : 'toggle' in row ? row.toggle : row.radio;
  const command = commandOf(id);
  const state = stateOf(id);
  return {
    kind: 'item',
    key: id,
    label: state.said ?? command.said(),
    enabled: state.enabled,
    run: state.run,
    ...(command.icon === undefined ? {} : { icon: command.icon }),
    ...(command.chord === undefined
      ? {}
      : { keys: chordSaid(command.chord), ariaKeys: ariaKeyShortcuts(command.chord) }),
    ...(typeof row === 'string'
      ? {}
      : {
          role: 'toggle' in row ? ('menuitemcheckbox' as const) : ('menuitemradio' as const),
          checked: state.checked === true,
        }),
    ...(danger ? { danger: true } : {}),
  };
};

/** Groups of rows, a divider between each. */
const grouped = (
  groups: readonly (readonly MenuEntry[])[],
): readonly MenuEntry[] =>
  groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      index === 0 ? group : [{ kind: 'divider' as const, key: `divider-${index}` }, ...group],
    );

const menu = (
  key: string,
  word: WordKey,
  letter: string,
  groups: readonly (readonly MenuEntry[])[],
): MenuSpec => ({ key, label: words(word), letter, entries: grouped(groups) });

/**
 * The document's seven menus (ADR-0075), as data: every item a view of a registered command. What cannot
 * apply stays, `aria-disabled`. The lifecycle's acts and the paragraph styles are the page's to give.
 */
export function buildMenus(
  stateOf: (id: string) => CommandState,
  { lifecycle = [], styles = [] }: MenuExtras = {},
): readonly MenuSpec[] {
  const rows = (...each: readonly Row[]) => each.map((row) => item(row, stateOf));
  const lifecycleRows: readonly MenuEntry[] = lifecycle.map((act) => ({
    kind: 'item',
    key: act.key,
    label: act.label,
    enabled: act.enabled,
    content: true,
    run: act.run,
  }));
  const paragraphStyle: MenuEntry = {
    kind: 'submenu',
    key: 'paragraph-style',
    label: words('menu.paragraph-style'),
    enabled: styles.length > 0,
    entries: grouped([
      styles.map(
        (style): MenuEntry => ({
          kind: 'item',
          key: `style.${style.value}`,
          label: style.label,
          role: 'menuitemradio',
          checked: style.checked,
          enabled: true,
          // A style's name is the theme's; only the default is the interface's.
          content: style.value !== 'body',
          run: style.run,
        }),
      ),
      rows('manage-styles'),
    ]),
  };
  return [
    menu('document', 'menu.document', 'D', [
      lifecycleRows,
      rows('preview', 'save-version', 'history'),
      rows('dates', 'scope', 'relationships', 'access'),
      rows('hold', 'archive'),
      [item('delete', stateOf, true)],
    ]),
    menu('edit', 'menu.edit', 'E', [rows('undo', 'redo'), rows('search')]),
    menu('view', 'menu.view', 'V', [
      rows({ radio: 'mode.reading' }, { radio: 'mode.review' }, { radio: 'mode.authoring' }),
      rows(
        { toggle: 'panel.contents' },
        { toggle: 'panel.baselines' },
        { toggle: 'panel.data' },
        { toggle: 'assistant' },
      ),
      rows({ toggle: 'boundaries' }, { toggle: 'style-labels' }, { toggle: 'pages' }),
      rows('zoom-in', 'zoom-out', 'fit'),
    ]),
    menu('insert', 'menu.insert', 'I', [
      rows(ed('Table'), ed('Figure'), ed('Image'), ed('Symbols')),
      rows(
        ed('Equation'),
        ed('Footnote'),
        ed('Reference'),
        ed('Cite'),
        ed('Index entry'),
        ed('Variable'),
        ed('Value'),
        ed('Condition'),
        ed('Message form'),
      ),
      rows(ed('Link'), 'comment', ed('Paste as Markdown')),
    ]),
    menu('format', 'menu.format', 'F', [
      rows(
        ed('Strong'),
        ed('Emphasis'),
        ed('Underline'),
        ed('Subscript'),
        ed('Superscript'),
        ed('Inline code'),
        ed('Quoted phrase'),
      ),
      [
        paragraphStyle,
        ...rows(
          ed('Bulleted list'),
          ed('Numbered list'),
          ed('Definition list'),
          ed('Nest item'),
          ed('Lift item'),
          ed('Quotation'),
          ed('Preformatted text'),
        ),
      ],
      rows(ed('Term'), ed('Language')),
    ]),
    menu('review', 'menu.review', 'R', [
      rows('comment'),
      rows('history'),
      rows('assistant'),
    ]),
    menu('help', 'menu.help', 'H', [rows('shortcuts', 'whats-new')]),
  ];
}
