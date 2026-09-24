import { equationAlternative, withAlternative } from '@alloy-works/domain';
import { drawEquation, type EquationAt, type EquationChoice } from '@alloy-works/editor';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import own from './EquationDialog.module.css';
import { Icon } from './Icon.js';
import { latexToMathml } from './latex.js';
import styles from './MarkPrompt.module.css';
import { describeEquation, speechLanguage } from './speech.js';

export interface EquationDialogProps {
  /** The equation it opens on and changes, or null where it places a new one. */
  readonly current: EquationAt | null;
  /** Whether a block equation may stand where a new one would go (`equationPlaceable`). */
  readonly blockPlaceable: boolean;
  /** The component's base language: the one a description is written in, and the one it is in. */
  readonly language: string;
  /**
   * The equation as the author left it; answers why it could not be placed, which the dialog says and
   * stays open for, or null once it has been.
   */
  readonly onDone: (choice: EquationChoice) => string | null;
  readonly onCancel: () => void;
}

/**
 * Whose the words in the description are. The engine's are written again when the equation changes;
 * the author's never are, until they ask (ruling R7). An equation opened with words already stored is
 * `unknown` until its LaTeX first changes, when the engine is asked what it would have said of the
 * equation as it was: the same words are the engine's, anything else the author's.
 */
type Words = 'engine' | 'author' | 'unknown';

/** A language named in words for the sentence saying none can be written in it, or its tag. */
function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/**
 * **The Equation dialog** (equations 1, ruling R8; component-editor.md's Equations): the LaTeX, the
 * equation drawn beneath it as it is typed - by the editor's own drawing, native MathML, the one the
 * surface draws it with - or what is wrong with it, in words; its description; and, for a new one,
 * whether it stands in the line or as a block of its own, a block being offered only where one may
 * stand, and **Numbered** for a block. Opened on an equation selected whole it starts on that
 * equation, and **Change** changes it where it is, of the same kind; otherwise **Insert** places one.
 * Nothing is placed on Cancel, Close or Escape.
 *
 * **The description is written for the author, and is theirs** (ruling R7; CNT-048): the speech rule
 * engine writes it, in the component's base language, whenever the equation changes - never on
 * opening - until the author changes it, after which it is left as they wrote it and **Generate
 * again** writes it anew on asking. Where the engine does not speak the language, the field is left
 * empty and says so, and an equation placed with none is marked _No description_ where it stands.
 * **Insert and Change wait for words still being written**, the button saying so, and place the
 * equation with them once they are, or with none where none could be; a change of the equation or
 * of the description meanwhile is the author's, and waits for Insert again.
 *
 * **An equation stored without LaTeX** - pasted from another component that had none, say - opens with
 * the field empty and a sentence saying that typing replaces it; left empty, the equation is kept as
 * it is, with whatever description and numbering the dialog gives it.
 *
 * Worked by keyboard as the other dialogs are (CNT-077): the focus starts in the LaTeX, `Tab` and
 * `Shift-Tab` wrap inside, `Ctrl-Enter` or `Cmd-Enter` applies - `Enter` alone is a new line, which
 * LaTeX may want - and `Escape` cancels. The page behind is made inert, and the focus put back, by
 * whoever opened it.
 */
export function EquationDialog({
  current,
  blockPlaceable,
  language,
  onDone,
  onCancel,
}: EquationDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const preview = useRef<HTMLDivElement | null>(null);
  const [latex, setLatex] = useState(current?.latex ?? '');
  const [display, setDisplay] = useState<'inline' | 'block'>(current?.display ?? 'inline');
  const [numbered, setNumbered] = useState(current?.display === 'block' && current.numbered);
  const stored = current === null ? null : equationAlternative(current.mathml);
  const [alternative, setAlternative] = useState(stored ?? '');
  const words = useRef<Words>(stored === null ? 'engine' : 'unknown');
  // Whether the author has changed the equation since the dialog opened: until they have, nothing is
  // written for them, so opening an equation never changes its words.
  const [changed, setChanged] = useState(false);
  const [writing, setWriting] = useState(false);
  // Insert or Change was asked for while words were being written: the equation is placed once they
  // are, with them (equations 1's final review, M2).
  const [placing, setPlacing] = useState(false);
  const [unwritten, setUnwritten] = useState(false);
  const [kept, setKept] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // Which request for words is the latest, so an answer to an older one, arriving late, is dropped.
  const asked = useRef(0);
  const spoken = speechLanguage(language) !== null;

  // Temml is quick enough to ask on every keystroke; the answer is the MathML to store, or words.
  const outcome = useMemo(
    () => (latex.trim() === '' ? null : latexToMathml(latex, display)),
    [latex, display],
  );
  const keepsStored = current !== null && current.latex === null && latex.trim() === '';
  const mathml = outcome?.ok ? outcome.mathml : keepsStored ? current.mathml : null;
  const wrong = outcome !== null && !outcome.ok ? outcome.said : null;

  useEffect(() => {
    const box = field.current;
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }, []);

  /** Asks the engine for words for `source`, and puts them in the field if they are still wanted. */
  const write = (source: string) => {
    const ticket = (asked.current += 1);
    setWriting(true);
    setUnwritten(false);
    describeEquation(source, language).then(
      (answer) => {
        if (ticket !== asked.current) return;
        setWriting(false);
        if (words.current === 'engine') setAlternative(answer ?? '');
      },
      () => {
        if (ticket !== asked.current) return;
        setWriting(false);
        setUnwritten(true);
        // Words written for the equation as it was are not words for it now: an equation placed
        // after this is placed with none, and marked so, unless the author writes some.
        if (words.current === 'engine') setAlternative('');
      },
    );
  };

  // Written again as the equation changes, while the words are the engine's; asked first whether they
  // are, for words the equation was opened with.
  useEffect(() => {
    if (!changed || !spoken || outcome === null || !outcome.ok) return;
    const source = outcome.mathml;
    if (words.current === 'author') {
      setKept(true);
      return;
    }
    if (words.current === 'engine') {
      write(source);
      return;
    }
    const before = withAlternative(current!.mathml, null) ?? current!.mathml;
    const ticket = (asked.current += 1);
    // Asking whose the words are is part of writing them: Insert waits for it too.
    setWriting(true);
    describeEquation(before, language).then(
      (answer) => {
        if (words.current === 'unknown') words.current = answer === stored ? 'engine' : 'author';
        if (ticket !== asked.current) return;
        if (words.current === 'engine') {
          write(source);
          return;
        }
        setWriting(false);
        setKept(true);
      },
      () => {
        if (words.current === 'unknown') words.current = 'author';
        if (ticket === asked.current) setWriting(false);
      },
    );
    // `write` and `current` are the render's own; what the effect answers to is the equation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, changed, spoken, language]);

  // The equation drawn as it will be placed, words and numbering included, by the editor's drawing.
  useEffect(() => {
    const box = preview.current;
    if (box === null) return;
    if (mathml === null) {
      box.replaceChildren();
      return;
    }
    const holder = box.ownerDocument.createElement(display === 'block' ? 'div' : 'span');
    holder.className = display === 'block' ? 'aw-equation-block' : 'aw-equation';
    const given = alternative.trim() === '' ? null : alternative.trim();
    drawEquation(
      holder,
      {
        mathml: withAlternative(mathml, given) ?? mathml,
        numbered: display === 'block' && numbered,
      },
      display,
    );
    box.replaceChildren(holder);
  }, [mathml, alternative, display, numbered]);

  const submit = () => {
    if (mathml === null) {
      setSaid(outcome === null ? 'Type the equation in LaTeX.' : null);
      field.current?.focus();
      return;
    }
    // Words still being written are waited for, and placed with the equation once they are, or
    // without them if none could be written: pressed straight after typing, Insert would otherwise
    // place the equation with no description and drop the words the engine wrote a moment later.
    if (writing) {
      setPlacing(true);
      return;
    }
    const given = alternative.trim() === '' ? null : alternative.trim();
    const described = withAlternative(mathml, given);
    if (described === null) {
      setSaid(
        'That description holds a character that cannot be stored. Take it out and try again.',
      );
      return;
    }
    const typed = latex.trim() === '' ? null : latex;
    setSaid(
      onDone(
        display === 'block'
          ? { display, mathml: described, latex: typed, numbered }
          : { display, mathml: described, latex: typed },
      ),
    );
  };

  // Placed as soon as the words it waited for are written. `submit` is the render's own, so it reads
  // the words this render has.
  useEffect(() => {
    if (!placing || writing) return;
    setPlacing(false);
    submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing, writing]);

  /**
   * The stops `Tab` reaches, as the browser takes them: every box and button that is not disabled, and
   * in the radio group only the one checked. The trap wraps at the ends and leaves the browser the rest.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'textarea, input:not([type="radio"]), input[type="radio"]:checked, button',
      ) ?? []),
    ].filter((each) => !(each as HTMLButtonElement).disabled);
    if (stops.length === 0) return;
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? at - 1 : at + 1;
    if (at >= 0 && next >= 0 && next < stops.length) return;
    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
  };

  // A change made while an equation waits to be placed is one the author has not finished: it waits
  // for Insert again.
  const change = () => {
    setChanged(true);
    setSaid(null);
    setPlacing(false);
  };

  const described = [
    wrong === null ? null : `${id}-wrong`,
    keepsStored || (current !== null && current.latex === null) ? `${id}-replaces` : null,
    `${id}-latex-hint`,
  ].filter((each) => each !== null);

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
            submit();
          }}
        >
          {/* The same drawing as the toolbar button that opened it. */}
          <h2 id={`${id}-heading`} className={styles['heading']}>
            <span className={styles['tile']} aria-hidden="true">
              <Icon name="Equation" size={22} />
            </span>
            Equation
          </h2>
          <div className={styles['field']}>
            <label htmlFor={`${id}-latex`}>LaTeX</label>
            <textarea
              id={`${id}-latex`}
              ref={field}
              className={own['latex']}
              rows={3}
              value={latex}
              dir="ltr"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              {...(wrong !== null ? { 'aria-invalid': true } : {})}
              aria-describedby={described.join(' ')}
              onChange={(event) => {
                setLatex(event.target.value);
                change();
              }}
            />
            {/* Directly under the box it is about, above the hint. */}
            {wrong !== null && (
              <p id={`${id}-wrong`} className={styles['complaint']}>
                {wrong}
              </p>
            )}
            {current !== null && current.latex === null && (
              <p id={`${id}-replaces`} className={styles['note']}>
                This equation was stored without its LaTeX. Typing LaTeX here replaces it.
              </p>
            )}
            <span id={`${id}-latex-hint`} className={styles['hint']}>
              Such as \frac{'{a}{b}'} or x^2
            </span>
          </div>
          <div className={own['preview']} role="group" aria-labelledby={`${id}-preview`}>
            <span id={`${id}-preview`} className={own['label']}>
              Preview
            </span>
            <div ref={preview} className={own['drawn']} />
            {mathml === null && wrong === null && (
              <p className={styles['note']}>The equation is drawn here as you type it.</p>
            )}
          </div>
          {current === null && blockPlaceable && (
            <fieldset className={own['group']}>
              <legend>Place as</legend>
              <div className={own['choices']}>
                {(['inline', 'block'] as const).map((kind) => (
                  <label key={kind} className={own['choice']}>
                    <input
                      type="radio"
                      name={`${id}-display`}
                      value={kind}
                      checked={display === kind}
                      onChange={() => {
                        setDisplay(kind);
                        change();
                      }}
                    />
                    {kind === 'inline' ? 'Inline' : 'Block'}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {display === 'block' && (
            <label className={own['choice']}>
              <input
                type="checkbox"
                checked={numbered}
                onChange={(event) => setNumbered(event.target.checked)}
              />
              Numbered
            </label>
          )}
          <div className={styles['field']}>
            <label htmlFor={`${id}-description`}>Description</label>
            <textarea
              id={`${id}-description`}
              rows={2}
              lang={language}
              value={alternative}
              aria-describedby={[
                spoken ? null : `${id}-unspoken`,
                kept ? `${id}-kept` : null,
                `${id}-description-hint`,
              ]
                .filter((each) => each !== null)
                .join(' ')}
              onChange={(event) => {
                words.current = 'author';
                // Anything asked of the engine before this is no longer wanted, and nor is an
                // equation waiting for it: the author is writing the words themselves.
                asked.current += 1;
                setWriting(false);
                setPlacing(false);
                setAlternative(event.target.value);
              }}
            />
            {!spoken && (
              <p id={`${id}-unspoken`} className={styles['warning']}>
                No description can be written for you in {languageName(language)}. Write one
                yourself.
              </p>
            )}
            {kept && (
              <p id={`${id}-kept`} className={styles['note']}>
                The description is yours, so it was not written again. Generate again writes it for
                the equation as it is now.
              </p>
            )}
            {unwritten && (
              <p className={styles['warning']}>
                A description could not be written. Write one yourself.
              </p>
            )}
            <span id={`${id}-description-hint`} className={styles['hint']}>
              What the equation says, for someone who cannot see it.
            </span>
            {spoken && (
              <div className={own['again']}>
                <button
                  type="button"
                  disabled={mathml === null}
                  onClick={() => {
                    if (mathml === null) return;
                    words.current = 'engine';
                    setKept(false);
                    write(withAlternative(mathml, null) ?? mathml);
                  }}
                >
                  Generate again
                </button>
                {writing && <span role="status">Writing a description</span>}
              </div>
            )}
          </div>
          {said !== null && (
            <p role="alert" className={styles['complaint']}>
              {said}
            </p>
          )}
          <div className={styles['footer']}>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary">
              {placing ? 'Writing the description' : current === null ? 'Insert' : 'Change'}
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
