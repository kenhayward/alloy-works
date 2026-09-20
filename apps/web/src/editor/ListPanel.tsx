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

/** What the panel is about: the innermost counted list the cursor stands in, as `listAt` reads it. */
export interface ListPanelList {
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
 * its markers look like (component-editor.md; CNT-119's replacement for the start rule).
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
 * way only when the document's own value differs from the one this field last heard, which happens
 * exactly when something other than this field changed it - an undo, a version cut, the cursor
 * moving to another list. A refused value therefore stays on screen beside the sentence explaining
 * it, rather than vanishing as the author reads about it. A box on its way somewhere - empty, or
 * holding something that is not a whole number yet - reaches the document as no start at all or not
 * at all, and says nothing either way.
 */
export function ListPanel({ view, list, enabled, ref }: ListPanelProps) {
  const numbered = list.kind === 'ordered';
  const held = list.start === null ? '' : String(list.start);
  const [start, setStart] = useState({ typed: held, inModel: held });
  const [refused, setRefused] = useState(false);

  // Adjusting state during render, the way React documents it for state derived from a prop, and by
  // value rather than by counting renders: `<StrictMode>` renders twice, and anything keeping its
  // bearings by a render count behaves differently there (see `ComponentHeader`).
  if (held !== start.inModel) {
    setStart({ typed: held, inModel: held });
    setRefused(false);
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
            // Leaving `ordered` clears the start and the numbering with it, so whatever was refused
            // about the pair is no longer true of anything.
            setRefused(false);
            ask({ kind: event.target.value === 'ordered' ? 'ordered' : 'unordered' });
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
              aria-describedby={refused ? `${HINT} ${REFUSAL}` : HINT}
              aria-invalid={refused}
              onChange={(event) => {
                const typed = event.target.value;
                setStart((previous) => ({ ...previous, typed }));
                const value = typed.trim() === '' ? null : Number(typed);
                if (value !== null && !(Number.isInteger(value) && value >= 0)) {
                  // A box on its way to a number is not a refusal: there is nothing to explain
                  // yet, and the only sentence this panel has is about a pair the model refuses.
                  setRefused(false);
                  return;
                }
                setRefused(!ask({ start: value }));
              }}
            />
          </label>
          <p id={HINT}>The number the first item takes</p>
          {refused && (
            <p id={REFUSAL} role="alert">
              Only a 1, 2, 3 list can start at 0. Try 1 or more.
            </p>
          )}
          <label>
            Numbering
            <select
              value={list.format ?? 'decimal'}
              disabled={!enabled}
              onChange={(event) => setRefused(!ask({ format: event.target.value }))}
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
