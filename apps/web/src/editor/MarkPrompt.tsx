import { markSchema, publishedLanguage } from '@alloy-works/domain';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';
import type { MarkCommand } from './press.js';

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
  /** And where Remove found no mark of this kind left to take off, which is a third thing. */
  readonly absent: string;
  /** What Remove does, said before they press it rather than after. */
  readonly removes: string;
  /** The Remove button's name, which says what it takes off. */
  readonly remove: string;
  /** What the mark goes on, said before the selected text it goes on. */
  readonly goesOn: string;
  /**
   * What the author is told about a value the stored model takes and an output cannot carry, or
   * null where there is nothing to say. Not a refusal, so it never stops them: it is said once,
   * before the mark goes in, and pressing OK again with the same value applies it (CNT-152).
   */
  readonly warn?: (value: string) => string | null;
}

/**
 * Whether a language tag is one the content model would take, asked of the model itself rather than
 * restated here. The identifier is a placeholder and nothing is applied: what is being asked is the
 * shape of the tag, and the warning must not stand in front of a refusal - telling an author that a
 * publication cannot carry `klingon` answers a question nobody asked.
 */
const wellFormedTag = (tag: string) =>
  markSchema.safeParse({ type: 'language', id: 'unapplied', tag }).success;

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
    absent: 'There is no link here any more, so there is nothing to take off.',
    removes: 'Remove takes this link off and leaves the text it was on.',
    remove: 'Remove link',
    goesOn: 'The link goes on the selected text,',
  },
  language: {
    title: 'Language',
    fields: [
      { name: 'tag', label: 'Language tag', hint: 'A BCP 47 tag, such as fr, pt-BR or de-AT' },
    ],
    refusal: 'That is not a language tag. Try one like fr or pt-BR.',
    empty: 'Type a language tag, or press Cancel to leave the text as it is.',
    absent: 'There is no language tag here any more, so there is nothing to take off.',
    removes: 'Remove takes this language tag off and leaves the text it was on.',
    remove: 'Remove language tag',
    goesOn: 'The language tag goes on the selected text,',
    warn: (tag) =>
      wellFormedTag(tag) && publishedLanguage(tag) === null
        ? `A publication cannot carry the tag ${tag}. Press OK anyway to use it.`
        : null,
  },
};

/**
 * Said where the command answered no because the text the dialog was opened over is not where it
 * was by the time the author pressed a button. One sentence for both marks, because it is one thing
 * that happened, and it names the remedy: select some text again.
 */
const GONE = 'That text is not there any more. Press Cancel, select some text, and try again.';

/**
 * Why a press came back with nothing done: the value the author typed, the text it was to go on, or
 * the mark it was to come off.
 *
 * The last two are not one case, and telling them apart is not pedantry. Selecting the text again
 * is the remedy for the text having gone and is no remedy at all for the mark having gone, and
 * saying the text is not there while the author is looking straight at it is the editor telling
 * them something they can see is untrue.
 */
export type Refused = 'value' | 'gone' | 'noMark';

export interface MarkPromptProps {
  /** Only ever a mark: a block action takes nothing an author has to type. */
  readonly command: MarkCommand;
  /**
   * What to put in the boxes: what the mark there says today, or what the author typed and had
   * refused. Null opens them empty.
   */
  readonly values: Record<string, unknown> | null;
  /** Why the last press came back with nothing done, or null where none has. */
  readonly refused: Refused | null;
  /** Whether there is a mark of this type there to take off. */
  readonly removable: boolean;
  /**
   * The text the mark will go on, as it was when the dialog opened, or null where there is none to
   * show: a caret, or a selection across blocks. Captured rather than read from the view, because the
   * selection moving out from under the dialog is exactly what a refusal of `gone` is about.
   */
  readonly selected?: string | null;
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
 * with one box in it, and reaching for OK with the mouse or the Tab key is not a price worth
 * charging for it.
 *
 * **A value an output cannot carry is warned about here, before it is applied** (CNT-152). It is not
 * a refusal - the content model takes any well-formed language tag - so the warning names the tag
 * and gets out of the way: the button becomes **Apply anyway** and a press of it applies the value,
 * while a keystroke in the box takes the warning back and earns a fresh one if the new value needs
 * it. The button is renamed rather than left saying Apply because an alert is heard once, in the
 * instant it fires, and a name is heard on every focus: one button that means two things under one
 * name is a button a screen reader user cannot tell apart from the press before. Warning at the
 * time is the whole point of it, because the alternative is a component that looks right until a
 * publish somebody else asked for is refused, with the work long since done.
 */
export function MarkPrompt({
  command,
  values,
  refused,
  removable,
  selected = null,
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
  // The value Apply was pressed over and warned about, and nothing longer lived than that: one
  // press of one value **as typed**. Any keystroke in the box clears it, so it can never stand over
  // a value the author has not pressed Apply on - a tag warned about, corrected, and typed again is
  // a value nobody has answered for, and applying it with nothing said would be the warning being
  // spent by somebody who never read it.
  const [warnedAbout, setWarnedAbout] = useState<string | null>(null);

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
        : refused === 'noMark'
          ? shape.absent
          : nothingTyped
            ? shape.empty
            : shape.refusal;
  // Asked of what is in the box, because a warning is about the value the author is looking at and
  // about to apply, where a complaint is about a press that has already been made and answered.
  const inFirst = typed[shape.fields[0]!.name] ?? '';
  const warning = warnedAbout === inFirst ? (shape.warn?.(inFirst) ?? null) : null;
  // The button that is about to do something else is called something else. An alert is heard once,
  // in the instant it fires; an accessible name is heard on every focus, which is what a user who
  // tabbed to this button and is deciding whether to press it again actually has.
  const applies = warning === null ? 'OK' : 'OK anyway';

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

  // One line of the selection at most: a long one is cut short rather than growing the dialog.
  const shown =
    selected === null || selected.trim() === ''
      ? null
      : selected.length > 40
        ? `${selected.slice(0, 40).trimEnd()}\u2026`
        : selected;

  // The app's modal shell - the scrim, the surface 40px from the top, the close button - worn rather
  // than mounted: `Modal` would bring a second dialog role and a second focus trap, and this one
  // already has both (interface slice 14).
  return (
    <div className={shell['scrim']}>
      <div
        ref={dialog}
        className={shell['dialog']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id('heading')}
        onKeyDown={onKeyDown}
      >
        <form
          className={styles['form']}
          onSubmit={(event) => {
            event.preventDefault();
            // Raised rather than applied, once, for this value: the author reads it and presses
            // again if they meant it. Raising it a second time for a value already warned about
            // would make OK a button that never applies.
            if (warning === null && (shape.warn?.(inFirst) ?? null) !== null) {
              setWarnedAbout(inFirst);
              return;
            }
            onApply(typed);
          }}
        >
          {/* The same drawing as the toolbar button that opened it, so the dialog visibly belongs
              to that button. */}
          <h2 id={id('heading')} className={styles['heading']}>
            <span className={styles['tile']} aria-hidden="true">
              <Icon name={command.label} size={22} />
            </span>
            {shape.title}
          </h2>
          {shape.fields.map((field, index) => (
            <div key={field.name} className={styles['field']}>
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
                    index === 0 && warning !== null ? id('warning') : null,
                    field.hint === undefined ? null : id(`hint-${field.name}`),
                  ]
                    .filter((each) => each !== null)
                    .join(' ') || undefined
                }
                onChange={(event) => {
                  setTyped((before) => ({ ...before, [field.name]: event.target.value }));
                  // Every keystroke, not only one that changes the first box: a warning is answered
                  // by a press and by nothing else, and the value it was raised over is gone the
                  // moment the author starts typing over it.
                  setWarnedAbout(null);
                }}
              />
              {/* Directly under the box it is about, above the hint. */}
              {index === 0 && complaint !== null && (
                <p id={id('complaint')} className={styles['complaint']} role="alert">
                  {complaint}
                </p>
              )}
              {index === 0 && warning !== null && (
                <p id={id('warning')} className={styles['warning']} role="alert">
                  {warning}
                </p>
              )}
              {field.hint !== undefined && (
                <span id={id(`hint-${field.name}`)} className={styles['hint']}>
                  {field.hint}
                </span>
              )}
            </div>
          ))}
          {shown !== null && (
            <p className={styles['note']}>
              {shape.goesOn} <mark className={styles['selected']}>{shown}</mark>.
            </p>
          )}
          {removable && (
            <p id={id('removes')} className={styles['note']}>
              {shape.removes}
            </p>
          )}
          {/* One row: Cancel, and the destructive act beside it, at the left, so taking a mark off
              can never be mistaken for the primary at the right. */}
          <div className={styles['footer']}>
            <span className={styles['left']}>
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
              {removable && (
                <button
                  type="button"
                  className="danger"
                  aria-describedby={id('removes')}
                  onClick={onRemove}
                >
                  {shape.remove}
                </button>
              )}
            </span>
            <button
              type="submit"
              className="primary"
              {...(warning !== null ? { 'aria-describedby': id('warning') } : {})}
            >
              {applies}
            </button>
          </div>
        </form>
        <button
          type="button"
          className={shell['close']}
          aria-label="Close"
          title="Close"
          onClick={onCancel}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
    </div>
  );
}
