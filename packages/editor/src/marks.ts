import { markSchema } from '@alloy-works/domain';
import { toggleMark } from 'prosemirror-commands';
import type { Mark as EditorMark, MarkType, Node } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';

import { blockCommand, type BlockAction } from './blocks.js';
import { editorSchema } from './schema.js';

/** What every row of the registry says, whatever it acts on. */
interface CommandBase {
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

/**
 * One editing action, as the toolbar and the keymap both read it: a mark over the selection, or a
 * block action over where the cursor stands.
 *
 * There is one registry rather than a list per surface, because CNT-077 asks that every editing
 * action be reachable from the keyboard alone: a button somebody added without a shortcut, or a
 * shortcut nobody can see the name of, is the failure that rule exists to prevent, and neither is
 * possible when the button and the binding are the same row.
 *
 * **One union rather than two registries**, so that invariant stays one assertion over one list. Two
 * lists would each be well formed on their own while sharing a shortcut between them, and the test
 * that would have caught it would have to be written a third time to see both.
 */
export type EditorCommand =
  | (CommandBase & {
      readonly kind: 'mark';
      /** The mark type's name, as `editorSchema.marks` and the stored model both spell it. */
      readonly mark: string;
    })
  | (CommandBase & {
      readonly kind: 'block';
      /** The action `blockCommand` answers to. */
      readonly action: BlockAction;
    });

/** The registry, in the order the toolbar shows it. */
export const EDITOR_COMMANDS: readonly EditorCommand[] = [
  {
    kind: 'mark',
    mark: 'strong',
    label: 'Strong',
    shortcut: 'Mod-b',
    shortcutSaid: 'Ctrl or Cmd and B',
    prompts: false,
  },
  {
    kind: 'mark',
    mark: 'emphasis',
    label: 'Emphasis',
    shortcut: 'Mod-i',
    shortcutSaid: 'Ctrl or Cmd and I',
    prompts: false,
  },
  {
    kind: 'mark',
    mark: 'underline',
    label: 'Underline',
    shortcut: 'Mod-u',
    shortcutSaid: 'Ctrl or Cmd and U',
    prompts: false,
  },
  {
    kind: 'mark',
    mark: 'subscript',
    label: 'Subscript',
    shortcut: 'Mod-,',
    shortcutSaid: 'Ctrl or Cmd and comma',
    prompts: false,
  },
  {
    kind: 'mark',
    mark: 'superscript',
    label: 'Superscript',
    shortcut: 'Mod-.',
    shortcutSaid: 'Ctrl or Cmd and full stop',
    prompts: false,
  },
  {
    kind: 'mark',
    mark: 'inlineCode',
    label: 'Inline code',
    shortcut: 'Mod-e',
    shortcutSaid: 'Ctrl or Cmd and E',
    prompts: false,
  },
  {
    kind: 'mark',
    mark: 'quotedPhrase',
    label: 'Quoted phrase',
    shortcut: 'Mod-Shift-q',
    shortcutSaid: 'Ctrl or Cmd, Shift and Q',
    prompts: false,
  },
  {
    kind: 'mark',
    mark: 'hyperlink',
    label: 'Link',
    shortcut: 'Mod-k',
    shortcutSaid: 'Ctrl or Cmd and K',
    prompts: true,
  },
  {
    kind: 'mark',
    mark: 'language',
    label: 'Language',
    shortcut: 'Mod-Shift-l',
    shortcutSaid: 'Ctrl or Cmd, Shift and L',
    prompts: true,
  },
  // The block actions, after the nine marks. None of them prompts: nothing about making a list
  // is a value only the author can give, and a list's start and numbering are set over a list that
  // already exists, in the renderer's own list panel, rather than asked for before one is made.
  {
    kind: 'block',
    action: 'bulletedList',
    label: 'Bulleted list',
    shortcut: 'Mod-Shift-8',
    shortcutSaid: 'Ctrl or Cmd, Shift and 8',
    prompts: false,
  },
  {
    kind: 'block',
    action: 'numberedList',
    label: 'Numbered list',
    shortcut: 'Mod-Shift-7',
    shortcutSaid: 'Ctrl or Cmd, Shift and 7',
    prompts: false,
  },
  {
    kind: 'block',
    action: 'definitionList',
    label: 'Definition list',
    shortcut: 'Mod-Shift-9',
    shortcutSaid: 'Ctrl or Cmd, Shift and 9',
    prompts: false,
  },
  {
    kind: 'block',
    action: 'nestItem',
    label: 'Nest item',
    shortcut: 'Mod-]',
    shortcutSaid: 'Ctrl or Cmd and right square bracket',
    prompts: false,
  },
  {
    kind: 'block',
    action: 'liftItem',
    label: 'Lift item',
    shortcut: 'Mod-[',
    shortcutSaid: 'Ctrl or Cmd and left square bracket',
    prompts: false,
  },
  // Editor 5's two, decision J. Punctuation rather than letters: Ctrl-Shift-B, -C, -E, -K and -U
  // each belong to a browser, a developer tool or an input method on at least one platform, and
  // Ctrl-Alt is AltGr on Windows.
  {
    kind: 'block',
    action: 'quotation',
    label: 'Quotation',
    shortcut: 'Mod-Shift-.',
    shortcutSaid: 'Ctrl or Cmd, Shift and full stop',
    prompts: false,
  },
  {
    kind: 'block',
    action: 'preformatted',
    label: 'Preformatted text',
    shortcut: 'Mod-Shift-,',
    shortcutSaid: 'Ctrl or Cmd, Shift and comma',
    prompts: false,
  },
  {
    kind: 'block',
    action: 'table',
    label: 'Table',
    // The next of the list family's digits: no browser and no platform takes it.
    shortcut: 'Mod-Shift-0',
    shortcutSaid: 'Ctrl or Cmd, Shift and 0',
    prompts: false,
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
 * An attribute with no value - null, absent, or a box left at nothing but spaces - is **no
 * attribute**, and the schema then decides whether the mark could do without it. A `hyperlink`'s
 * `title` can, so an empty title box makes a link with no title rather than a link the stored model
 * refuses; an `href` cannot, so an empty target box makes no link at all. The editor spells "no
 * title" as null, which is what the mapping writes back out as absence. A value with something in
 * it is kept exactly as it was typed, spaces and all: a box with nothing in it is the author having
 * said nothing, and trimming what they did say is editing it.
 *
 * **The type and the identifier are written last, so neither can be handed in.** A caller naming the
 * annotation would make one identifier name two of them, which the content model refuses (CNT-004);
 * a caller naming the type would validate one mark and create another, which reaches a keystroke
 * handler as a thrown `RangeError` rather than as a refusal.
 */
function accepted(
  mark: string,
  id: string,
  attrs: Record<string, unknown>,
): Record<string, unknown> | null {
  const candidate: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    candidate[name] = value;
  }
  candidate.type = mark;
  candidate.id = id;
  const parsed = markSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const members: Record<string, unknown> = { ...parsed.data };
  delete members.type;
  return members;
}

/**
 * Every contiguous span of one mark type in the document, in order: the ranges over which one
 * annotation runs without a break in the text.
 *
 * Two runs belong to one span when they carry the same mark and **nothing an author could read**
 * lies between them (CNT-004). That is deliberately not position adjacency: a paragraph break costs
 * two positions, so an annotation the author split with Enter would otherwise read as two, and
 * marking a selection that crosses a break - one gesture - would come out as two annotations. It
 * also joins across an inline node that is not text, which is the same answer for the same reason:
 * an emphasis over a phrase holding an equation is one annotation, not two.
 *
 * **This is the same predicate the content model holds**: `claimRange` in
 * `packages/domain/src/content/model/document.ts` closes an identifier on a text run that does not
 * carry it and on nothing else, so what the editor calls one annotation is what the stored model
 * calls one range. The two are written apart because neither package may import the other's world,
 * and they must be changed together. Exported for `annotationsInOnePiece` in `state.ts`, which is
 * what keeps the editor unable to produce what that rule refuses; not part of the package's surface.
 */
export function spansOf(
  doc: Node,
  type: MarkType,
): { mark: EditorMark; from: number; to: number }[] {
  const spans: { mark: EditorMark; from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((carried) => carried.type === type);
    if (mark === undefined) return;
    const last = spans[spans.length - 1];
    if (last !== undefined && last.mark.eq(mark) && doc.textBetween(last.to, pos) === '')
      last.to = pos + node.nodeSize;
    else spans.push({ mark, from: pos, to: pos + node.nodeSize });
  });
  return spans;
}

/**
 * Applies a mark over the selection, or takes it off where the selection carries it throughout.
 *
 * **Every call mints a fresh identifier**, which is what makes a second application of one mark a
 * second annotation (CNT-004): `addMark` replaces an overlapping mark of the same type, so marking a
 * phrase inside a phrase leaves one annotation under the newer identifier rather than two spellings
 * of one. Only an edit that splits a run the author already marked keeps an identifier, because
 * nothing there changed.
 *
 * **This is not the way to change what a mark says.** `toggleMark` decides by whether the range
 * carries the mark at all and never reads its attributes, so running it over a range that already
 * carries one takes that mark off and the new target is never applied. `applyMarkCommand` is the
 * command for that.
 *
 * `removeWhenPresent: false` is deliberate: pressing Strong over a selection that is half bold makes
 * all of it bold, which is what every editor an author has used does, rather than clearing the half
 * that was.
 *
 * **Pressing it over the middle of an annotation leaves the text either side in two pieces**, and
 * the command does nothing about that: `annotationsInOnePiece` in `state.ts` gives the later pieces
 * identifiers of their own, after this transaction as after any other.
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
 * Changes what a mark says over the selection, or over the whole annotation a cursor sits inside -
 * a link's target and title, a run's language - and applies it where there is none there yet.
 *
 * The mark that comes out is a **new annotation**: the old one is taken off the range and one with a
 * fresh identifier put on, rather than the old one edited in place. An annotation is a thing an
 * author accepted, commented on or conditioned; what it says is part of what it is, so a target
 * changed under the same identifier would silently re-point somebody else's decision (CNT-004).
 *
 * False, and a no-op, where the value is one the stored model would refuse, and where a cursor sits
 * in no annotation of that type and has selected nothing to put one over.
 *
 * Changing what a mark says in the middle of an annotation leaves the old one in two pieces;
 * `annotationsInOnePiece` in `state.ts` names the later one, as it does for any other split.
 */
export function applyMarkCommand(
  mark: string,
  newIdentifier: () => string,
  attrs: Record<string, unknown> = {},
): Command {
  return (state, dispatch) => {
    const type = editorSchema.marks[mark];
    if (type === undefined) return false;
    const members = accepted(mark, newIdentifier(), attrs);
    if (members === null) return false;
    const range = rangeToMark(state, type);
    if (range === null) return false;
    if (dispatch) {
      const tr = state.tr.removeMark(range.from, range.to, type);
      tr.addMark(range.from, range.to, type.create(members));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * The range a mark would be applied over: the selection where there is one, and otherwise the whole
 * of the annotation of that type a cursor sits inside. Null where that comes to nothing, which is
 * the one thing `applyMarkCommand` refuses for a reason that is not about the value.
 */
function rangeToMark(state: EditorState, type: MarkType): { from: number; to: number } | null {
  const { from, to, empty } = state.selection;
  const range = empty ? annotationAt(state, type) : { from, to };
  return range === null || range.from === range.to ? null : range;
}

/**
 * Whether there is anywhere to put this mark: something selected to put it over, or a cursor inside
 * an annotation of that type, which `applyMarkCommand` expands to the whole of.
 *
 * This is the question a toolbar asks **before** it opens a dialog, so that an author is never asked
 * for a target the command would then drop on the floor. Asking it by running the command with
 * nothing in it would be the better question and cannot be asked: a `hyperlink` has no valid form
 * without an `href` and a `language` none without a `tag`, so a dry run answers false for exactly
 * the two commands that prompt - and it would burn an identifier from the shared sequence on every
 * press besides.
 *
 * It is exported so that there is **one** copy of the range rule rather than one here and one
 * restated in a renderer. The drift that hurts is a widening: the day `language` applies at a bare
 * cursor as a stored mark, a toolbar holding its own rule would refuse to open a dialog for a press
 * the command would have honoured, and that press is silent again.
 *
 * It says nothing about the **value**, which only `markSchema` decides (CNT-127, CNT-140): a press
 * this admits can still be refused once the author has typed something, and that refusal is one they
 * are told about.
 */
export function somewhereToPutMark(state: EditorState, mark: string): boolean {
  const type = editorSchema.marks[mark];
  if (type === undefined) return false;
  return rangeToMark(state, type) !== null;
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
 *
 * Taking the middle out of an annotation leaves the text either side of the hole two separated
 * pieces of it, and the far piece becomes one of its own - but **not here**. The command has no
 * identifier source, because it needs none: `annotationAt` sees only the block the cursor is in, so
 * a piece two paragraphs away is a piece this command never knew about. The repair belongs where it
 * can see the whole document, which is `annotationsInOnePiece` in `state.ts`.
 */
export function removeMarkCommand(mark: string): Command {
  return (state, dispatch) => {
    const type = editorSchema.marks[mark];
    if (type === undefined) return false;
    const range = annotationAt(state, type);
    if (range === null) return false;
    if (dispatch) dispatch(state.tr.removeMark(range.from, range.to, type));
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
 *
 * **The identifier is not among what comes back.** Nothing needs it, and a prompt handed one would
 * naturally send it back with the changed value, which is the one thing a change must not do
 * (CNT-004, and `applyMarkCommand` above).
 */
export function markAt(state: EditorState, mark: string): Record<string, unknown> | null {
  const type = editorSchema.marks[mark];
  if (type === undefined) return null;
  const found = markIn(state, type);
  if (found === undefined) return null;
  const said: Record<string, unknown> = { ...found.attrs };
  delete said.id;
  return said;
}

/**
 * Whether the selection carries a mark **throughout**, which is what a toolbar button reports as
 * pressed.
 *
 * Throughout, rather than anywhere: `removeWhenPresent: false` means that pressing the button over a
 * half-marked selection marks the rest of it, so a button that said it was already pressed would
 * tell a screen reader the opposite of what pressing it does. It is named for the answer it gives
 * rather than for what a toolbar does with it, so that nobody reads `markActive` as the usual
 * `rangeHasMark` idiom and quietly makes it one.
 */
export function markThroughout(state: EditorState, mark: string): boolean {
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
 * **Every row, not every mark.** A registry that declared five block shortcuts and bound none of
 * them would leave CNT-077 failing while the test that cites it passed, because a row's shortcut is
 * a string until something reads it: the registry earns its keep only where one loop binds all of
 * it. That is also why `Mod-]` and `Mod-[` are written here and nowhere else - `state.ts` binds
 * `Tab` and `Shift-Tab` literally, and those two deliberately have no row.
 *
 * The two commands that need a value from the author are bound to one that **asks the renderer**,
 * because a value can only be typed into something the editor does not own. It reports the key
 * handled exactly when a renderer is listening: returning true with nobody there would swallow the
 * key and leave the author pressing it at nothing, and returning true from the editor when the
 * dialog is what handled it would be a claim this package cannot make.
 */
export function commandKeymap(
  newIdentifier: () => string,
  onPrompt?: (mark: string) => boolean,
): Record<string, Command> {
  const bound: Record<string, Command> = {};
  for (const command of EDITOR_COMMANDS) {
    if (command.kind === 'block') {
      bound[command.shortcut] = blockCommand(command.action, newIdentifier);
    } else {
      bound[command.shortcut] = command.prompts
        ? () => onPrompt?.(command.mark) ?? false
        : toggleMarkCommand(command.mark, newIdentifier);
    }
  }
  return bound;
}
