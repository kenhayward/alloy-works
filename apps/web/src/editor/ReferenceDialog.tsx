import type { CrossReferenceDisplay } from '@alloy-works/domain';
import type { ReferenceChoice } from '@alloy-works/editor';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';
import own from './ReferenceDialog.module.css';
import { FORM_WORDS, type ReferenceOption } from './referenceChoices.js';

export interface ReferenceDialogProps {
  /** What may be referred to, in the order the author reads it (`referenceOptions`). */
  readonly options: readonly ReferenceOption[];
  /** Whether the component is being edited in a document, which is what an empty list is about. */
  readonly inDocument: boolean;
  /** The reference it opens on and changes, or null where it places a new one. */
  readonly current: { readonly key: string; readonly display: CrossReferenceDisplay } | null;
  /**
   * The target and form chosen; answers why it could not be placed, which the dialog says and stays
   * open for, or null once it has been.
   */
  readonly onDone: (choice: ReferenceChoice) => string | null;
  readonly onCancel: () => void;
}

/** The form a target opens on: its number where it has one, as a reference most often shows. */
const firstForm = (option: ReferenceOption | undefined): CrossReferenceDisplay =>
  option === undefined || option.forms.includes('number') ? 'number' : option.forms[0]!;

/**
 * **The Reference dialog** (cross-references 1, ruling R11; structure.md's XR-A): what may be referred
 * to, each named as a reader will see it; the forms the one chosen has, in plain words; and a line
 * saying what the reference will show. Opened on a reference selected whole it starts on that
 * reference's target and form and **Change** changes it; otherwise **Insert** places one at the cursor.
 * Nothing is placed on Cancel, Close or Escape.
 *
 * Worked by keyboard as the link dialog is (CNT-077): the focus starts on the target chosen, the
 * arrow keys move within each group as a radio group's do, `Tab` and `Shift-Tab` wrap inside the
 * dialog, `Enter` applies and `Escape` cancels. The page behind is made inert, and the focus put back,
 * by whoever opened it.
 *
 * **Two groups of radio buttons rather than a list box**: each is a native control a screen reader
 * and a keyboard already know, and a form whose target is chosen and whose form is chosen is two
 * questions, each with one answer. The line saying what it will show is a polite live region, so it
 * is heard as the choices change, and it describes the button that applies them.
 */
export function ReferenceDialog({
  options,
  inDocument,
  current,
  onDone,
  onCancel,
}: ReferenceDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const first = useRef<HTMLInputElement | null>(null);
  const [chosen, setChosen] = useState<string | null>(() =>
    current !== null && options.some((each) => each.key === current.key)
      ? current.key
      : (options[0]?.key ?? null),
  );
  const option = options.find((each) => each.key === chosen);
  const [display, setDisplay] = useState<CrossReferenceDisplay>(() =>
    current !== null && option?.key === current.key && option.forms.includes(current.display)
      ? current.display
      : firstForm(option),
  );
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    // On the target chosen, which is the radio a Tab into the group would reach; on Cancel where
    // there is nothing to choose.
    (first.current ?? dialog.current?.querySelector<HTMLElement>('button'))?.focus();
  }, []);

  const choose = (key: string) => {
    setChosen(key);
    const next = options.find((each) => each.key === key);
    // The form stays where the target chosen next has it too, so choosing again changes one thing.
    if (next !== undefined && !next.forms.includes(display)) setDisplay(firstForm(next));
  };

  /**
   * The stops `Tab` reaches, as the browser takes them: every button, and in each radio group only
   * the one checked. The trap wraps at the ends and leaves the browser the rest.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [
      ...(dialog.current?.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        'input[type="radio"]:checked, button',
      ) ?? []),
    ];
    if (stops.length === 0) return;
    const at = stops.indexOf(document.activeElement as HTMLInputElement);
    const next = event.shiftKey ? at - 1 : at + 1;
    if (at >= 0 && next >= 0 && next < stops.length) return;
    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
  };

  const shows = option?.shows(display) ?? null;

  return (
    <div className={shell['scrim']}>
      <div
        ref={dialog}
        className={shell['dialog']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        onKeyDown={onKeyDown}
      >
        <form
          className={styles['form']}
          onSubmit={(event) => {
            event.preventDefault();
            if (option === undefined) return;
            setSaid(onDone({ target: option.target, display }));
          }}
        >
          {/* The same drawing as the toolbar button that opened it. */}
          <h2 id={`${id}-heading`} className={styles['heading']}>
            <span className={styles['tile']} aria-hidden="true">
              <Icon name="Reference" size={22} />
            </span>
            Reference
          </h2>
          {options.length === 0 ? (
            <p className={styles['note']}>
              {inDocument
                ? 'Nothing in this document can be referred to yet.'
                : 'Nothing in this component can be referred to yet.'}
            </p>
          ) : (
            <>
              <fieldset className={own['group']}>
                <legend>Refer to</legend>
                <div className={own['targets']}>
                  {options.map((each) => (
                    <label key={each.key} className={own['choice']}>
                      <input
                        ref={each.key === chosen ? first : undefined}
                        type="radio"
                        name={`${id}-target`}
                        value={each.key}
                        checked={each.key === chosen}
                        onChange={() => choose(each.key)}
                      />
                      {each.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              {option !== undefined && (
                <fieldset className={own['group']}>
                  <legend>Show as</legend>
                  <div className={own['forms']}>
                    {option.forms.map((form) => (
                      <label key={form} className={own['choice']}>
                        <input
                          type="radio"
                          name={`${id}-form`}
                          value={form}
                          checked={form === display}
                          onChange={() => setDisplay(form)}
                        />
                        {FORM_WORDS[form]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {shows !== null && (
                <p id={`${id}-shows`} className={styles['note']} aria-live="polite">
                  It will show: <strong className={own['shows']}>{shows}</strong>
                </p>
              )}
            </>
          )}
          {said !== null && (
            <p role="alert" className={styles['complaint']}>
              {said}
            </p>
          )}
          <div className={styles['footer']}>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            {option !== undefined && (
              <button type="submit" className="primary" aria-describedby={`${id}-shows`}>
                {current === null ? 'Insert' : 'Change'}
              </button>
            )}
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
