import type { EditorCommand } from '@alloy-works/editor';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

interface Field {
  /** The attribute this box fills in, as the stored mark spells it. */
  readonly name: string;
  readonly label: string;
  /** What a good value looks like, said under the box as a hint and never as a rule. */
  readonly hint?: string;
}

interface Shape {
  readonly title: string;
  readonly fields: readonly Field[];
  /** What the author is told where the stored model would not take what they typed. */
  readonly refusal: string;
  /** What they are told instead where they typed nothing at all, which is not the same thing. */
  readonly empty: string;
  /** What Remove does, said before they press it rather than after. */
  readonly removes: string;
}

/**
 * The two marks whose value only the author can supply, and the words each one is asked for in.
 *
 * The refusal is **one sentence per mark rather than one per rule**, because the rule that refused
 * is `markSchema`'s and the editor does not take it apart: what the author needs is what a value it
 * would take looks like, which is what the hint already says. An empty box is the exception, because
 * nothing was refused there and saying a scheme is wrong would be inventing a complaint.
 *
 * The language hint's examples are tags the product's outputs can carry. A tag it cannot - a script
 * subtag, or a region that is not two letters - is storable and is what the author is warned about
 * separately, so offering one here as the model to copy would be recommending the thing the next
 * sentence they read complains about.
 */
const SHAPES: Record<string, Shape> = {
  hyperlink: {
    title: 'Link',
    fields: [
      { name: 'href', label: 'Address', hint: 'An address beginning http:, https: or mailto:' },
      { name: 'title', label: 'Title (optional)' },
    ],
    refusal: 'That address must begin http:, https: or mailto:.',
    empty: 'Type an address, or press Cancel to leave the text as it is.',
    removes: 'Remove takes this link off and leaves the text it was on.',
  },
  language: {
    title: 'Language',
    fields: [
      { name: 'tag', label: 'Language tag', hint: 'A BCP 47 tag, such as fr, pt-BR or de-AT' },
    ],
    refusal: 'That is not a language tag. Try one like fr or pt-BR.',
    empty: 'Type a language tag, or press Cancel to leave the text as it is.',
    removes: 'Remove takes this language tag off and leaves the text it was on.',
  },
};

/**
 * Said where the command answered no for a reason that is not the value at all: the text the dialog
 * was opened over is not where it was by the time the author pressed a button. One sentence for both
 * marks, and for applying and removing alike, because it is one thing that happened.
 */
const GONE = 'That text is not there any more. Press Cancel, select some text, and try again.';

/** Why a press came back with nothing done: the value, or the text it was to go on. */
export type Refused = 'value' | 'gone';

export interface MarkPromptProps {
  readonly command: EditorCommand;
  /**
   * What to put in the boxes: what the mark there says today, or what the author typed and had
   * refused. Null opens them empty.
   */
  readonly values: Record<string, unknown> | null;
  /** Why the last press came back with nothing done, or null where none has. */
  readonly refused: Refused | null;
  /** Whether there is a mark of this type there to take off. */
  readonly removable: boolean;
  readonly onApply: (values: Record<string, string>) => void;
  readonly onRemove: () => void;
  readonly onCancel: () => void;
}

/**
 * The dialog that asks for a link's target or a run's language, and the one place a mark of either
 * kind is taken off again.
 *
 * **It says what was refused, where the author typed it.** A value the stored model would not take
 * comes back here with the value still in the box rather than as a notice somewhere else on the
 * page: the author is looking at this dialog, and a press that ended in nothing is the one thing
 * they must not be left to discover for themselves.
 *
 * **Removing is a route inside it, not a second press of the button that opened it.** Link and
 * Language open a dialog rather than toggling, so there is no second press to take one off with;
 * Remove is offered only where there is something there to remove, and says what it will do before
 * it is pressed rather than after.
 *
 * The keyboard cannot leave while it is open, which is half of what `aria-modal` promises: focus
 * starts in the first box, `Tab` and `Shift-Tab` wrap inside, and `Escape` cancels. The other half
 * is the page behind it, which whoever opened it makes inert. Where focus goes afterwards is theirs
 * too, because only they know what it was opened from.
 *
 * It is a form, so `Enter` in a box applies: that is the most ordinary gesture there is in a dialog
 * with one box in it, and reaching for Apply with the mouse or the Tab key is not a price worth
 * charging for it.
 */
export function MarkPrompt({
  command,
  values,
  refused,
  removable,
  onApply,
  onRemove,
  onCancel,
}: MarkPromptProps) {
  const shape = SHAPES[command.mark];
  const dialog = useRef<HTMLDivElement | null>(null);
  const first = useRef<HTMLInputElement | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (shape?.fields ?? []).map((field) => {
        const value = values?.[field.name];
        return [field.name, typeof value === 'string' ? value : ''];
      }),
    ),
  );

  useEffect(() => first.current?.focus(), []);

  if (shape === undefined) return null;
  const id = (part: string) => `mark-prompt-${command.mark}-${part}`;
  // What was refused, never what is in the box now: the complaint is about the press that was made,
  // and a box being typed into again has not been answered yet.
  const nothingTyped =
    String(values?.[shape.fields[0]!.name] ?? '').trim() === '' && refused === 'value';
  const complaint =
    refused === null
      ? null
      : refused === 'gone'
        ? GONE
        : nothingTyped
          ? shape.empty
          : shape.refusal;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const inside = [...(dialog.current?.querySelectorAll<HTMLElement>('input, button') ?? [])];
    if (inside.length === 0) return;
    const at = inside.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? at - 1 : at + 1;
    // Inside the dialog either way, so the browser's own Tab lands where it should be left to.
    if (at >= 0 && next >= 0 && next < inside.length) return;
    event.preventDefault();
    inside[event.shiftKey ? inside.length - 1 : 0]?.focus();
  };

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={id('heading')}
      onKeyDown={onKeyDown}
    >
      <h3 id={id('heading')}>{shape.title}</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(typed);
        }}
      >
        {shape.fields.map((field, index) => (
          <p key={field.name}>
            <label htmlFor={id(`field-${field.name}`)}>{field.label}</label>
            <input
              id={id(`field-${field.name}`)}
              ref={index === 0 ? first : undefined}
              type="text"
              value={typed[field.name] ?? ''}
              {...(index === 0 && complaint !== null ? { 'aria-invalid': true } : {})}
              aria-describedby={
                [
                  // The complaint first: what went wrong is read before what a good value looks
                  // like, rather than after it.
                  index === 0 && complaint !== null ? id('complaint') : null,
                  field.hint === undefined ? null : id(`hint-${field.name}`),
                ]
                  .filter((each) => each !== null)
                  .join(' ') || undefined
              }
              onChange={(event) =>
                setTyped((before) => ({ ...before, [field.name]: event.target.value }))
              }
            />
            {field.hint !== undefined && <span id={id(`hint-${field.name}`)}>{field.hint}</span>}
          </p>
        ))}
        {complaint !== null && (
          <p id={id('complaint')} role="alert">
            {complaint}
          </p>
        )}
        {removable && <p id={id('removes')}>{shape.removes}</p>}
        <button type="submit">Apply</button>
        {removable && (
          <button type="button" aria-describedby={id('removes')} onClick={onRemove}>
            Remove
          </button>
        )}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </div>
  );
}
