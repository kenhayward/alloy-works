import {
  applyMarkCommand,
  EDITOR_COMMANDS,
  markAt,
  markThroughout,
  toggleMarkCommand,
  type EditorCommand,
  type EditorView,
} from '@alloy-works/editor';
import { useRef, useState, type KeyboardEvent } from 'react';

export interface EditorToolbarProps {
  /** Null until the surface has mounted, which is the page's first render. */
  readonly view: EditorView | null;
  readonly enabled: boolean;
  /** Where a mark's identifier comes from; the same source the surface names blocks from. */
  readonly newIdentifier: () => string;
  /** Asked for a value before a prompting command runs; resolves null when the author cancels. */
  readonly prompt: (
    command: EditorCommand,
    current: Record<string, unknown> | null,
  ) => Promise<Record<string, unknown> | null>;
  /**
   * The author supplied a value and nothing came of it - a target the stored model refuses, or a
   * dialog that failed. Only ever called after they were asked for something, never for a press that
   * simply had nothing to do: the words belong to whoever renders the notice.
   */
  readonly onRefused?: (command: EditorCommand) => void;
}

/**
 * Whether there is anywhere to put this mark: something selected to put it over, or a cursor inside
 * a mark of that type, which `applyMarkCommand` expands to the whole of.
 *
 * Running the command itself with no attributes would be the better question to ask, and it cannot
 * be asked: a `hyperlink` has no valid form without an `href` and a `language` none without a `tag`,
 * so a dry run with nothing in it answers false for exactly the two commands that prompt. What is
 * restated here is therefore only the command's **range** rule, not its validation, which stays the
 * one thing `markSchema` decides.
 */
const somewhereToPutIt = (view: EditorView, mark: string) =>
  !view.state.selection.empty || markAt(view.state, mark) !== null;

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

  const press = (command: EditorCommand) => {
    // An `aria-disabled` button is still focusable and still clickable, which is the point of it
    // being that rather than `disabled`: what it must not do is act.
    if (!enabled || view === null) return;
    if (!command.prompts) {
      toggleMarkCommand(command.mark, newIdentifier)(view.state, view.dispatch.bind(view));
      return;
    }
    if (!somewhereToPutIt(view, command.mark)) return;
    prompt(command, markAt(view.state, command.mark))
      .then((answer) => {
        if (answer === null) return;
        // The surface can be gone by the time a dialog is answered - the session torn down, the page
        // left. Dispatching into a destroyed view throws, which the catch below would then report as
        // a refusal of a target that was perfectly good.
        if (view.isDestroyed) return;
        // Read again rather than closed over: the author had the dialog open, and the state they
        // left behind is the one the mark goes onto.
        const applied = applyMarkCommand(
          command.mark,
          newIdentifier,
          answer,
        )(view.state, view.dispatch.bind(view));
        if (!applied) onRefused?.(command);
      })
      .catch(() => {
        // A dialog that fell over is a press that ended in nothing, which is the same thing the
        // author needs telling about as a value the model refused. Silence is what this reports
        // instead of, and an unhandled rejection is what it reports instead of too.
        onRefused?.(command);
      });
  };

  return (
    <div role="toolbar" aria-label="Formatting" onKeyDown={onKeyDown}>
      {EDITOR_COMMANDS.map((command, index) => (
        <button
          key={command.mark}
          type="button"
          ref={(element) => {
            buttons.current[index] = element;
          }}
          aria-disabled={!enabled}
          tabIndex={index === tabStop ? 0 : -1}
          // Spelled out rather than drawn with symbols, for the reason the registry gives: a screen
          // reader says `Mod-,` as punctuation, and a keyboard without a Cmd key has no glyph for it.
          title={command.shortcutSaid}
          {...(command.prompts
            ? { 'aria-haspopup': 'dialog' as const }
            : { 'aria-pressed': view !== null && markThroughout(view.state, command.mark) })}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => press(command)}
        >
          {command.label}
        </button>
      ))}
    </div>
  );
}
