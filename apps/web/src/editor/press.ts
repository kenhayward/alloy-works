import {
  applyMarkCommand,
  markAt,
  somewhereToPutMark,
  toggleMarkCommand,
  type EditorCommand,
  type EditorView,
} from '@alloy-works/editor';

/** Asked for a value before a prompting command runs; resolves null when the author cancels. */
export type AskForValue = (
  command: EditorCommand,
  current: Record<string, unknown> | null,
) => Promise<Record<string, unknown> | null>;

export interface PressOptions {
  readonly view: EditorView;
  readonly command: EditorCommand;
  /** Where a mark's identifier comes from; the same source the surface names blocks from. */
  readonly newIdentifier: () => string;
  readonly prompt: AskForValue;
  /**
   * The author supplied a value and nothing came of it - a target the stored model refuses, or a
   * dialog that failed. Only ever called after they were asked for something, never for a press that
   * simply had nothing to do: the words belong to whoever renders the notice.
   */
  readonly onRefused?: ((command: EditorCommand) => void) | undefined;
}

/**
 * One of the editor's commands, run over a view: the toolbar's press and the keyboard's shortcut
 * alike (CNT-077). It is one function rather than one per surface because the two must not drift -
 * the keyboard would otherwise acquire its own answer to what a dialog opens on, what a refusal is
 * reported as, and what happens to an answer that arrives after the view has gone.
 *
 * **Answers whether the press was taken up**, which is not the same as whether a mark was applied. A
 * command with nowhere to put its mark is not taken up: no dialog opens, because opening one asks
 * the author for a target the command would then drop on the floor, and a shortcut the editor did
 * not take is a key the browser may still have a use for. A dialog that opened is taken up whatever
 * the author does with it, cancelling included.
 *
 * The range rule comes from `somewhereToPutMark` in the editor package, which is the same expression
 * `applyMarkCommand` applies, so a press this admits is refused only over its **value** - and a value
 * the author typed and lost is the one thing they must be told about, which is `onRefused`.
 */
export function pressCommand({
  view,
  command,
  newIdentifier,
  prompt,
  onRefused,
}: PressOptions): boolean {
  if (!command.prompts) {
    return toggleMarkCommand(command.mark, newIdentifier)(view.state, view.dispatch.bind(view));
  }
  if (!somewhereToPutMark(view.state, command.mark)) return false;
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
  return true;
}
