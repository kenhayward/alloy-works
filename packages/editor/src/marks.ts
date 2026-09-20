import { markSchema } from '@alloy-works/domain';
import { toggleMark } from 'prosemirror-commands';
import type { Mark as EditorMark, MarkType } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';

import { editorSchema } from './schema.js';

/**
 * One editing action over a mark, as both the toolbar and the keymap read it.
 *
 * There is one registry rather than a list per surface, because CNT-077 asks that every editing
 * action be reachable from the keyboard alone: a button somebody added without a shortcut, or a
 * shortcut nobody can see the name of, is the failure that rule exists to prevent, and neither is
 * possible when the button and the binding are the same row.
 */
export interface EditorCommand {
  /** The mark type's name, as `editorSchema.marks` and the stored model both spell it. */
  readonly mark: string;
  /** The toolbar's and the keymap's one label. */
  readonly label: string;
  /** A `prosemirror-keymap` key, e.g. `Mod-i`. */
  readonly shortcut: string;
  /**
   * What the button's tooltip says. Spelled out rather than drawn with symbols, because a screen
   * reader says `Mod-,` as punctuation and a keyboard without a Cmd key has no glyph for it.
   */
  readonly shortcutSaid: string;
  /** Whether the author must supply a value first, which only the renderer can ask for. */
  readonly prompts: boolean;
}

/** The registry, in the order the toolbar shows it. */
export const EDITOR_COMMANDS: readonly EditorCommand[] = [
  {
    mark: 'strong',
    label: 'Strong',
    shortcut: 'Mod-b',
    shortcutSaid: 'Ctrl or Cmd and B',
    prompts: false,
  },
  {
    mark: 'emphasis',
    label: 'Emphasis',
    shortcut: 'Mod-i',
    shortcutSaid: 'Ctrl or Cmd and I',
    prompts: false,
  },
  {
    mark: 'underline',
    label: 'Underline',
    shortcut: 'Mod-u',
    shortcutSaid: 'Ctrl or Cmd and U',
    prompts: false,
  },
  {
    mark: 'subscript',
    label: 'Subscript',
    shortcut: 'Mod-,',
    shortcutSaid: 'Ctrl or Cmd and comma',
    prompts: false,
  },
  {
    mark: 'superscript',
    label: 'Superscript',
    shortcut: 'Mod-.',
    shortcutSaid: 'Ctrl or Cmd and full stop',
    prompts: false,
  },
  {
    mark: 'inlineCode',
    label: 'Inline code',
    shortcut: 'Mod-e',
    shortcutSaid: 'Ctrl or Cmd and E',
    prompts: false,
  },
  {
    mark: 'quotedPhrase',
    label: 'Quoted phrase',
    shortcut: 'Mod-Shift-q',
    shortcutSaid: 'Ctrl or Cmd, Shift and Q',
    prompts: false,
  },
  {
    mark: 'hyperlink',
    label: 'Link',
    shortcut: 'Mod-k',
    shortcutSaid: 'Ctrl or Cmd and K',
    prompts: true,
  },
  {
    mark: 'language',
    label: 'Language',
    shortcut: 'Mod-Shift-l',
    shortcutSaid: 'Ctrl or Cmd, Shift and L',
    prompts: true,
  },
];

/**
 * The attributes a mark would carry, once the stored model has accepted the whole of it, or nothing
 * where it would not.
 *
 * **The candidate is checked by `markSchema` itself, never by a rule restated here.** One route
 * covers the scheme allowlist (CNT-127), the BCP 47 shape (CNT-140) and every member a mark the
 * schema gains later requires, and it is the same code the service runs again on the way to storage,
 * so nothing the editor applies can fail at save with a message written for a programmer.
 *
 * An attribute with no value - null, absent, or the empty string somebody left a box at - is **no
 * attribute**, and the schema then decides whether the mark could do without it. A `hyperlink`'s
 * `title` can, so an empty title box makes a link with no title rather than a link the stored model
 * refuses; an `href` cannot, so an empty target box makes no link at all. The editor spells "no
 * title" as null, which is what the mapping writes back out as absence.
 */
function accepted(
  mark: string,
  id: string,
  attrs: Record<string, unknown>,
): Record<string, unknown> | null {
  const candidate: Record<string, unknown> = { type: mark, id };
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined && value !== '') candidate[name] = value;
  }
  const parsed = markSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const members: Record<string, unknown> = { ...parsed.data };
  delete members.type;
  return members;
}

/**
 * Applies a mark over the selection, or takes it off where the selection carries it throughout.
 *
 * **Every call mints a fresh identifier**, which is what makes a second application of one mark a
 * second annotation (CNT-004): `addMark` replaces an overlapping mark of the same type, so marking a
 * phrase inside a phrase leaves one annotation under the newer identifier rather than two spellings
 * of one. Only an edit that splits a run the author already marked keeps an identifier, because
 * nothing there changed. Changing a link's target is a new annotation for the same reason, and the
 * command that edits one says so by taking this route rather than reusing what it read.
 *
 * `removeWhenPresent: false` is deliberate: pressing Strong over a selection that is half bold makes
 * all of it bold, which is what every editor an author has used does, rather than clearing the half
 * that was.
 */
export function toggleMarkCommand(
  mark: string,
  newIdentifier: () => string,
  attrs: Record<string, unknown> = {},
): Command {
  return (state, dispatch, view) => {
    const type = editorSchema.marks[mark];
    if (type === undefined) return false;
    const members = accepted(mark, newIdentifier(), attrs);
    if (members === null) return false;
    return toggleMark(type, members, { removeWhenPresent: false })(state, dispatch, view);
  };
}

/**
 * The whole of the one annotation a cursor sits inside, or the selection where there is one.
 *
 * A cursor expands to every adjacent run carrying **the same mark** - the same identifier and the
 * same attributes, which is what `Mark.eq` compares - so taking a link off from inside it takes off
 * all of it, including the parts an edit split away (CNT-004). It stops at the annotation beside it,
 * which is a different mark under a different identifier and somebody else's decision.
 */
function annotationAt(state: EditorState, type: MarkType): { from: number; to: number } | null {
  const { $from, from, to, empty } = state.selection;
  if (!empty) return state.doc.rangeHasMark(from, to, type) ? { from, to } : null;
  const found = (state.storedMarks ?? $from.marks()).find((mark) => mark.type === type);
  if (found === undefined) return null;
  const spans: { from: number; to: number }[] = [];
  let offset = $from.start();
  $from.parent.forEach((child) => {
    const childFrom = offset;
    offset += child.nodeSize;
    if (!found.isInSet(child.marks)) return;
    const last = spans[spans.length - 1];
    if (last !== undefined && last.to === childFrom) last.to = offset;
    else spans.push({ from: childFrom, to: offset });
  });
  return spans.find((span) => span.from <= $from.pos && $from.pos <= span.to) ?? null;
}

/**
 * Takes a mark off: the selected text, or the whole annotation a cursor sits inside. A no-op, and
 * false, where there is nothing of that type to take off - so a toolbar can offer it without first
 * asking what is there.
 */
export function removeMarkCommand(mark: string): Command {
  return (state, dispatch) => {
    const type = editorSchema.marks[mark];
    if (type === undefined) return false;
    const range = annotationAt(state, type);
    if (range === null) return false;
    dispatch?.(state.tr.removeMark(range.from, range.to, type));
    return true;
  };
}

/** The first mark of that type the selection touches, or at the cursor. */
function markIn(state: EditorState, type: MarkType): EditorMark | undefined {
  const { $from, from, to, empty } = state.selection;
  if (empty) return (state.storedMarks ?? $from.marks()).find((mark) => mark.type === type);
  let found: EditorMark | undefined;
  state.doc.nodesBetween(from, to, (node) => {
    found ??= node.marks.find((mark) => mark.type === type);
  });
  return found;
}

/**
 * What a mark the selection already carries says, so a prompt opens filled with it rather than
 * empty - editing a link means seeing its target, not typing it again. Null where the selection
 * carries no mark of that type.
 */
export function markAt(state: EditorState, mark: string): Record<string, unknown> | null {
  const type = editorSchema.marks[mark];
  if (type === undefined) return null;
  const found = markIn(state, type);
  return found === undefined ? null : { ...found.attrs };
}

/**
 * Whether the selection carries a mark **throughout**, which is what a toolbar button reports as
 * pressed.
 *
 * Throughout, rather than anywhere: `removeWhenPresent: false` means that pressing the button over a
 * half-marked selection marks the rest of it, so a button that said it was already pressed would
 * tell a screen reader the opposite of what pressing it does.
 */
export function markActive(state: EditorState, mark: string): boolean {
  const type = editorSchema.marks[mark];
  if (type === undefined) return false;
  const { $from, from, to, empty } = state.selection;
  if (empty) return type.isInSet(state.storedMarks ?? $from.marks()) !== undefined;
  let carried = false;
  let missing = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    if (type.isInSet(node.marks)) carried = true;
    else missing = true;
  });
  return carried && !missing;
}

/**
 * The registry as `prosemirror-keymap` takes it, so the keyboard and the toolbar cannot drift.
 *
 * The two commands that need a value from the author are bound to one that **asks the renderer**,
 * because a value can only be typed into something the editor does not own. It reports the key
 * handled exactly when a renderer is listening: returning true with nobody there would swallow the
 * key and leave the author pressing it at nothing, and returning true from the editor when the
 * dialog is what handled it would be a claim this package cannot make.
 */
export function markKeymap(
  newIdentifier: () => string,
  onPrompt?: (mark: string) => boolean,
): Record<string, Command> {
  const bound: Record<string, Command> = {};
  for (const command of EDITOR_COMMANDS) {
    bound[command.shortcut] = command.prompts
      ? () => onPrompt?.(command.mark) ?? false
      : toggleMarkCommand(command.mark, newIdentifier);
  }
  return bound;
}
