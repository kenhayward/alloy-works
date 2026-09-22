import {
  blockCommand,
  EDITOR_COMMANDS,
  listAt,
  markThroughout,
  somewhereToPutMark,
  type BlockAction,
  type EditorCommand,
  type EditorView,
} from '@alloy-works/editor';
import { Fragment, useRef, useState, type KeyboardEvent, type Ref } from 'react';

import { Icon } from './Icon.js';
import styles from './EditorToolbar.module.css';

import { pressCommand, type AskForValue, type MarkCommand } from './press.js';

/** The commands a divider follows: the last mark, and the last list action. */
const GROUP_ENDS = new Set(['Language', 'Lift item']);

/**
 * Which kind of list each of the three list buttons reports itself pressed inside, as `listAt`
 * spells it. `nestItem` and `liftItem` are deliberately absent: they move an item a level in one
 * direction and are not toggles, so neither has a state to announce.
 */
const PRESSED_INSIDE: Partial<Record<BlockAction, string>> = {
  bulletedList: 'unordered',
  numberedList: 'ordered',
  definitionList: 'definition',
};

export interface EditorToolbarProps {
  /** Null until the surface has mounted, which is the page's first render. */
  readonly view: EditorView | null;
  readonly enabled: boolean;
  /** Where a mark's identifier comes from; the same source the surface names blocks from. */
  readonly newIdentifier: () => string;
  /** Asked for a value before a prompting command runs; resolves null when the author cancels. */
  readonly prompt: AskForValue;
  /**
   * The author supplied a value and nothing came of it - a target the stored model refuses, or a
   * dialog that failed. Only ever called after they were asked for something, never for a press that
   * simply had nothing to do: the words belong to whoever renders the notice.
   */
  readonly onRefused?: (command: MarkCommand) => void;
  /**
   * The toolbar's own element. It is one of the three regions `F6` moves between (CNT-077), and the
   * view that owns that ring needs to be able to reach it and to ask whether the focus is inside it.
   */
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * The formatting toolbar above the surface: one button per command in the editor's own registry, in
 * the registry's order, so a mark the keyboard can apply is one the toolbar shows and neither can
 * gain a command the other lacks (CNT-077).
 *
 * **One tab stop, not nine.** The toolbar is a single stop in the page's tab order and the arrow
 * keys move within it, which is the ARIA toolbar pattern: an author tabbing from the title to the
 * surface passes one thing, not a row of nine, and `Home` and `End` reach the ends of the row
 * without counting. The row wraps, because a toolbar is a ring rather than a line with two dead ends.
 * Which button is the stop is state; which button a key came from is read off the event's own target,
 * so a burst of keys arriving before React renders again cannot move by the wrong number.
 *
 * **Nine marks and seven block actions**, from that one registry, so a list the keyboard can make is
 * one the toolbar shows. A block button is not a mark button wearing a different label: what it can
 * do depends on where the cursor stands and not on what the selection carries, so its two
 * announcements come from two different places - `listAt` for which kind of list this is, and the
 * command itself for whether pressing it would do anything.
 *
 * **Seven toggles and two dialogs.** A command that applies a mark where it stands carries
 * `aria-pressed`, read from **`markThroughout`** and never from "somewhere in the selection": the
 * commands run `toggleMark` with `removeWhenPresent: false`, so pressing Strong over a half-bold
 * selection makes all of it bold, and a button that called itself pressed because the selection was
 * bold in one place would tell a screen reader the opposite of what pressing it does. A command that
 * asks the author for a value first is **not a toggle at all** and says `aria-haspopup="dialog"`
 * instead: pressing Link never takes a link off, so announcing it as pressed would promise a second
 * press that undoes it. Taking one off is a route inside the dialog.
 *
 * **Unavailable is `aria-disabled`, not `disabled`.** A disabled button is out of the tab order, so a
 * toolbar that disabled its buttons would be one a keyboard could not reach at all while a component
 * is being read - and the view's region ring needs somewhere to land. The button stays reachable and
 * `press` is what refuses to act.
 *
 * **Every block button announces itself as unavailable where the press would do nothing**, and the
 * answer is taken from the command itself rather than reasoned about here:
 * `blockCommand(action, ...)(view.state, undefined)` is the very question the press asks, run with
 * no dispatch, which costs nothing and mints no identifier in any of the five branches. It is
 * **paired with `aria-pressed`, never replaced by it**. `blockCommand('definitionList')` declines
 * inside a definition list - there is no lossless way to unmake one, because a term has no home
 * outside it - so a button reading its state from `listAt` alone would announce itself as available
 * and pressed in the one place pressing it does nothing. That is the same defect this toolbar was
 * fixed for twice, once for the two prompting marks and once for a component being read. The other
 * four decline somewhere too: all three list commands with the cursor in a term, **Nest item** on
 * the first item of a list, **Lift item** at the top level of a definition list.
 *
 * **A dialog announces itself as unavailable where the press would open nothing** (final review,
 * finding 5). `pressCommand` gates a prompting command on `somewhereToPutMark` and answers false, so
 * a caret in plain text opens no dialog at all - the most ordinary caret state there is. Announced
 * as an available button, a screen reader would say "Link, button, has popup dialog" and pressing it
 * would do nothing. The attribute is read from the editor's own predicate, the same one the press is
 * gated on, so the announcement cannot come to mean something different from the behaviour. The
 * seven that apply where they stand are unaffected: each stores a mark for the next keystroke, so a
 * caret is a perfectly good place to press one. **Before the surface has mounted** there is no state
 * to ask, and the two say unavailable for the same reason: a press then opens nothing either.
 *
 * **A press that ends in nothing is reported, never swallowed.** Every one of these commands answers
 * whether it ran. Where the author supplied a value and the answer is no - a target whose scheme the
 * stored model refuses, or a dialog that failed - `onRefused` carries that out to whoever has the
 * words for it. A press with nowhere to put the mark does not get that far: it never opens the dialog
 * in the first place, so there is nothing for the author to have lost.
 *
 * **The selection's answer is read during render, from `view.state`.** ProseMirror's state lives
 * outside React, so this component is only as current as its last render - which is why
 * `ComponentEditor` re-renders on **every** transaction and not only on one that changed the
 * document. Moving the caret changes every one of these answers and changes nothing else.
 *
 * **A value is changed with `applyMarkCommand`, never by toggling again.** `toggleMark` decides by
 * whether the range carries the mark at all and never looks at attributes, so re-applying a link over
 * a range that already has one takes the old link off and puts no new target anywhere. The prompt is
 * opened filled from `markAt`, which answers what the mark says **without its identifier**: a changed
 * value is a new annotation under a new identifier (CNT-004), so there is nothing there to hand back.
 *
 * A press keeps the surface's selection rather than taking the focus from it: a toolbar button that
 * focused itself on `mousedown` would collapse the selection the command is about to act on. Keyboard
 * activation is unaffected, because it sends no `mousedown` at all.
 */
export function EditorToolbar({
  view,
  enabled,
  newIdentifier,
  prompt,
  onRefused,
  ref,
}: EditorToolbarProps) {
  const [tabStop, setTabStop] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const moveTo = (index: number) => {
    const at = (index + EDITOR_COMMANDS.length) % EDITOR_COMMANDS.length;
    setTabStop(at);
    buttons.current[at]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = buttons.current.indexOf(event.target as HTMLButtonElement);
    if (from < 0) return;
    if (event.key === 'ArrowRight') moveTo(from + 1);
    else if (event.key === 'ArrowLeft') moveTo(from - 1);
    else if (event.key === 'Home') moveTo(0);
    else if (event.key === 'End') moveTo(EDITOR_COMMANDS.length - 1);
    else return;
    event.preventDefault();
  };

  /**
   * Whether a press would do nothing, which is what `aria-disabled` says. Asked of the command for
   * a block action, and of the range rule for a mark that prompts; a mark that applies where it
   * stands is always available, because a caret is a perfectly good place to store one for the next
   * keystroke, even before the surface exists.
   */
  const unavailable = (command: EditorCommand): boolean => {
    if (!enabled) return true;
    if (command.kind === 'block') {
      return view === null || !blockCommand(command.action, newIdentifier)(view.state, undefined);
    }
    return command.prompts && !(view !== null && somewhereToPutMark(view.state, command.mark));
  };

  /** What the button says it is: a dialog, a toggle and what it is toggled to, or neither. */
  const announces = (command: EditorCommand) => {
    if (command.kind === 'mark') {
      return command.prompts
        ? { 'aria-haspopup': 'dialog' as const }
        : { 'aria-pressed': view !== null && markThroughout(view.state, command.mark) };
    }
    const inside = PRESSED_INSIDE[command.action];
    if (inside === undefined) return {};
    return { 'aria-pressed': view !== null && listAt(view.state)?.kind === inside };
  };

  const press = (command: EditorCommand) => {
    // An `aria-disabled` button is still focusable and still clickable, which is the point of it
    // being that rather than `disabled`: what it must not do is act.
    if (!enabled || view === null) return;
    // What the press itself does is `press.ts`, shared with the keyboard's own route to these same
    // commands, so a shortcut and a button cannot come to mean two different things (CNT-077).
    pressCommand({ view, command, newIdentifier, prompt, onRefused });
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Formatting"
      className={styles['toolbar']}
      // So the region ring has somewhere to land even if the row were ever empty. One button always
      // carries the roving stop today, so this is the fallback and not the usual landing.
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {EDITOR_COMMANDS.map((command, index) => (
        // The label, not the mark: five rows have no mark at all, and `key={undefined}` on each of
        // them is a duplicate React key - a `console.error`, which the console gate turns into a
        // failure with no obvious cause. The registry's own test proves the labels are unique.
        <Fragment key={command.label}>
          <button
            type="button"
            className={styles['button']}
            // The registry's label is the only name a screen reader gets: the face is an icon.
            aria-label={command.label}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            aria-disabled={unavailable(command)}
            tabIndex={index === tabStop ? 0 : -1}
            // The shortcut spelled out rather than drawn with symbols, for the reason the registry
            // gives: a screen reader says `Mod-,` as punctuation, and a keyboard without a Cmd key has
            // no glyph for it.
            title={`${command.label} (${command.shortcutSaid})`}
            {...announces(command)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => press(command)}
          >
            <Icon name={command.label} />
          </button>
          {GROUP_ENDS.has(command.label) && (
            <span className={styles['divider']} data-divider aria-hidden="true" />
          )}
        </Fragment>
      ))}
    </div>
  );
}
