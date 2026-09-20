import { setListAttributes, type EditorView } from '@alloy-works/editor';
import { useState, type Ref } from 'react';

/** What the stored model calls each numbering, and what an author is shown instead. */
const NUMBERINGS = [
  { format: 'decimal', label: '1, 2, 3' },
  { format: 'alphabetic', label: 'a, b, c' },
  { format: 'roman', label: 'i, ii, iii' },
];

const HINT = 'list-panel-start-hint';
const REFUSAL = 'list-panel-start-refused';

/**
 * The two things that can be wrong with a start, in the author's words.
 *
 * Two sentences rather than one, because they are two complaints: a value that is not a whole
 * number is nothing to do with zero, and telling somebody who typed `1.5` that only a 1, 2, 3 list
 * can start at 0 answers a question they did not ask. Neither is reachable without the model having
 * refused the value, so neither can stand over a list that took it.
 */
const SHAPE = 'A start is a whole number, 0 or more.';
const PAIR = 'Only a 1, 2, 3 list can start at 0. Try 1 or more.';

/** What the panel is about: the innermost counted list the cursor stands in, as `listAt` reads it. */
export interface ListPanelList {
  /** Which list this is, so the boxes know when they are looking at a different one. */
  readonly id: string | null;
  readonly kind: string;
  readonly start: number | null;
  readonly format: string | null;
}

export interface ListPanelProps {
  readonly view: EditorView;
  readonly list: ListPanelList;
  readonly enabled: boolean;
  /**
   * The panel's own element. It is one of the regions `F6` moves between (CNT-077), and the view
   * that owns that ring needs to be able to reach it and to ask whether the focus is inside it.
   */
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * What a counted list carries beside its items: which kind it is, where it starts counting and what
 * its markers look like (component-editor.md; CNT-153, which carries the start rule).
 *
 * **It is rendered only while the cursor stands in a counted list, and never for a definition one.**
 * A definition list carries no start and no numbering - the editor holds it as its own node type,
 * and `setListAttributes` refuses all three over one - and its kind is the button that made it. So
 * there is nothing for a panel to hold, and the absence is the honest answer rather than an empty
 * box. The **Start at** and **Numbering** fields go the same way inside the panel: neither has
 * anything to say about a bulleted list and `setListAttributes` refuses both over one, so each is
 * removed from the accessibility tree rather than left there disabled. A control that announces
 * itself as available and does nothing when it is used is the defect this editor has now been fixed
 * for three times.
 *
 * **Every change is merged onto what the list already carries and judged whole**, which is
 * `setListAttributes`' own doing and the reason the refusal below can arrive from the **Numbering**
 * field as well as from **Start at**: an author who sets a start of 0 on a 1, 2, 3 list and then
 * asks for letters has made the pair wrong without touching the number. Told here, at the moment
 * they ask, it is a sentence beside the field; left to the save, it is the fixed message a refused
 * iteration carries, which names nothing.
 *
 * **The start box holds what was typed, not what the list holds**, for the reason the header's title
 * and language fields do: a box bound straight to the model cannot be half-way to a number. It gives
 * way when the document's own value differs from the one this field last heard, which happens
 * exactly when something other than this field changed it - an undo, a version cut, a refused claim
 * putting the surface back - **and when the cursor moves to a different list**. A refused value
 * therefore stays on screen beside the sentence explaining it, rather than vanishing as the author
 * reads about it, and never follows them out of the list it was about.
 *
 * **Which list, by its identifier, and not by what it holds.** Two lists carrying neither a start
 * nor a numbering are the same three values twice, so a box comparing only those would carry a
 * refused `0` - and the sentence under it, and `aria-invalid` - from a lettered list to the 1, 2, 3
 * list beside it, where all three are untrue. That is the defect this whole task exists to prevent,
 * in its announcement half, so the panel asks which list rather than what it says.
 *
 * **The box never disagrees with the model in silence.** Every keystroke either reaches
 * `setListAttributes` or gets a sentence saying why it did not, and there is no third way out: a
 * guard that returned early left `1.5` on screen with the document holding `1`, and `-1` clearing a
 * start the author had set, with nothing on the page admitting either.
 */
export function ListPanel({ view, list, enabled, ref }: ListPanelProps) {
  const numbered = list.kind === 'ordered';
  const held = list.start === null ? '' : String(list.start);
  const [start, setStart] = useState({ typed: held, inModel: held, of: list.id });
  const [refused, setRefused] = useState<string | null>(null);

  // Adjusting state during render, the way React documents it for state derived from a prop, and by
  // value rather than by counting renders: `<StrictMode>` renders twice, and anything keeping its
  // bearings by a render count behaves differently there (see `ComponentHeader`).
  if (held !== start.inModel || list.id !== start.of) {
    setStart({ typed: held, inModel: held, of: list.id });
    setRefused(null);
  }

  /** Asks the editor for a change, and answers whether it was taken. */
  const ask = (attrs: Record<string, unknown>): boolean =>
    setListAttributes(attrs)(view.state, view.dispatch.bind(view));

  return (
    <div ref={ref} role="group" aria-label="List" tabIndex={-1}>
      <label>
        Kind
        <select
          value={list.kind}
          disabled={!enabled}
          onChange={(event) => {
            // The answer is read rather than dropped, as the other two fields' are. No refusal is
            // reachable through this field - the panel offers only the two kinds
            // `setListAttributes` takes, and it is rendered only over a list that takes them - so
            // the false branch is a documented invariant: a change that did not happen must not
            // clear a sentence about the list as it still stands. Leaving `ordered` does clear it,
            // because the start and the numbering go with it and nothing refused is true any more.
            if (ask({ kind: event.target.value === 'ordered' ? 'ordered' : 'unordered' })) {
              setRefused(null);
            }
          }}
        >
          <option value="unordered">Bulleted</option>
          <option value="ordered">Numbered</option>
        </select>
      </label>
      {numbered && (
        <>
          <label>
            Start at
            <input
              type="number"
              min={0}
              step={1}
              value={start.typed}
              disabled={!enabled}
              aria-describedby={refused === null ? HINT : `${HINT} ${REFUSAL}`}
              aria-invalid={refused !== null}
              onChange={(event) => {
                const typed = event.target.value;
                setStart((previous) => ({ ...previous, typed }));
                const value = typed.trim() === '' ? null : Number(typed);
                // An empty box is the author having said no start, which is a thing a list may
                // hold and is offered to the model as null. Anything else that is not a whole
                // number 0 or more is not offered at all - there is nothing sensible to offer,
                // and `-1` handed over as a start would be refused in a way that reads as a
                // complaint about zero - so it gets the sentence that is actually about it.
                // What it must not do is nothing: the box keeps what was typed, so silence here
                // leaves the box and the document disagreeing with the page admitting neither.
                const wellFormed =
                  value === null ||
                  (Number.isInteger(value) &&
                    value >= 0 &&
                    !event.target.validity.badInput &&
                    !event.target.validity.stepMismatch &&
                    !event.target.validity.rangeUnderflow);
                if (!wellFormed) {
                  setRefused(SHAPE);
                  return;
                }
                setRefused(ask({ start: value }) ? null : PAIR);
              }}
            />
          </label>
          <p id={HINT}>The number the first item takes</p>
          {refused !== null && (
            <p id={REFUSAL} role="alert">
              {refused}
            </p>
          )}
          <label>
            Numbering
            <select
              value={list.format ?? 'decimal'}
              disabled={!enabled}
              // The start and the numbering are judged together, so this field refuses for the
              // pair's reason and never for the start's own shape: what is already in the list is
              // a number the model took.
              onChange={(event) => setRefused(ask({ format: event.target.value }) ? null : PAIR)}
            >
              {NUMBERINGS.map((numbering) => (
                <option key={numbering.format} value={numbering.format}>
                  {numbering.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}
