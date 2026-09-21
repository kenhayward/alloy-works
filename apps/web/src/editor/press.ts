import {
  applyMarkCommand,
  blockCommand,
  markAt,
  somewhereToPutMark,
  toggleMarkCommand,
  type EditorCommand,
  type EditorView,
} from '@alloy-works/editor';

/**
 * A registry row that acts on a mark. Only a mark ever asks the author for a value - a block action
 * takes nothing an author has to type - so everything about prompting, about refusing a value and
 * about the dialog is written in terms of this narrower type rather than guarded at every use.
 */
export type MarkCommand = Extract<EditorCommand, { kind: 'mark' }>;

/** Asked for a value before a prompting command runs; resolves null when the author cancels. */
export type AskForValue = (
  command: MarkCommand,
  current: Record<string, unknown> | null,
) => Promise<Record<string, unknown> | null>;

export interface PressOptions {
  readonly view: EditorView;
  readonly command: EditorCommand;
  /** Where an identifier comes from; the same source the surface names blocks and marks from. */
  readonly newIdentifier: () => string;
  readonly prompt: AskForValue;
  /**
   * The author supplied a value and nothing came of it - a target the stored model refuses, or a
   * dialog that failed. Only ever called after they were asked for something, never for a press that
   * simply had nothing to do: the words belong to whoever renders the notice.
   */
  readonly onRefused?: ((command: MarkCommand) => void) | undefined;
}

/** The same, for the asking half, which is only ever reached with a mark that prompts. */
export interface AskOptions extends Omit<PressOptions, 'command'> {
  readonly command: MarkCommand;
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
 *
 * **A block action answers for itself.** `blockCommand` returns false wherever it would do nothing -
 * unmaking a definition list, nesting the first item of a list, lifting a definition item that has
 * nowhere to go - and that answer is the press's answer, so a shortcut it declined is handed back to
 * the browser and a button that shows it as unavailable is showing the same thing the press does.
 */
export function pressCommand({
  view,
  command,
  newIdentifier,
  prompt,
  onRefused,
}: PressOptions): boolean {
  const dispatch = view.dispatch.bind(view);
  if (command.kind === 'block') {
    return blockCommand(command.action, newIdentifier)(view.state, dispatch);
  }
  if (!command.prompts) {
    return toggleMarkCommand(command.mark, newIdentifier)(view.state, dispatch);
  }
  if (!somewhereToPutMark(view.state, command.mark)) return false;
  askAndApply({ view, command, newIdentifier, prompt, onRefused });
  return true;
}

/**
 * The asking half of a press, without the range gate: ask for a value, put it on, and say so where
 * nothing came of it.
 *
 * Separate from `pressCommand` because **the gate is the first press's job and only the first
 * press's**. Asking it again when a value comes back refused answers about the state as it is now
 * rather than the state the dialog was opened over, so a selection that moved while the author was
 * typing would close the dialog with nothing applied, nothing said, and the author's value gone.
 * Whoever asks again has already been through the gate once; what they need is the dialog back.
 */
export function askAndApply({ view, command, newIdentifier, prompt, onRefused }: AskOptions): void {
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
}
