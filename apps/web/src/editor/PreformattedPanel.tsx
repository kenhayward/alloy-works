import { isLanguageLabel } from '@alloy-works/domain';
import { setPreformattedLanguage, type EditorView } from '@alloy-works/editor';
import { useState, type Ref } from 'react';

const HINT = 'preformatted-panel-label-hint';
const REFUSAL = 'preformatted-panel-label-refused';

/** Said under the field, always, so the rule is known before it is broken. */
const HINT_TEXT =
  'Letters, digits and + # . _ - only, up to 32 characters. Leave it empty for none.';
/** Said instead of applying a label the content model would refuse. */
const REFUSED_TEXT = 'A language label is letters, digits and + # . _ - only, up to 32 characters.';

/** What the panel is about: the preformatted block the cursor stands in, as `preformattedAt` reads it. */
export interface PreformattedPanelBlock {
  readonly language: string | null;
  readonly pos: number;
}

export interface PreformattedPanelProps {
  readonly view: EditorView;
  readonly block: PreformattedPanelBlock;
  readonly enabled: boolean;
  /** The panel's own element: one of the regions `F6` moves between (CNT-077), as the list panel is. */
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * What a preformatted block carries beside its text: an optional language label (CNT-018; editor 5,
 * decision Q). Rendered only while the cursor stands in a preformatted block, exactly as the list
 * panel comes and goes with a list.
 *
 * **The field holds what was typed, and applies it on leaving or on Enter**, never per keystroke: a
 * label half-way through being typed is not a token, and a panel that refused every keystroke
 * would say so at `c` of `c++`. It gives way when the block's own label changes under it - an undo,
 * or the cursor moving to another block - for the reason the list panel's start box does.
 *
 * **A label the model would refuse is never applied**, and the sentence saying why stands beside the
 * field instead: left to the save, it would be the fixed message a refused iteration carries, which
 * names nothing. Emptying the field clears the label.
 */
export function PreformattedPanel({ view, block, enabled, ref }: PreformattedPanelProps) {
  const held = block.language ?? '';
  const [label, setLabel] = useState({ typed: held, inModel: held, at: block.pos });
  const [refused, setRefused] = useState(false);

  if (held !== label.inModel || block.pos !== label.at) {
    setLabel({ typed: held, inModel: held, at: block.pos });
    setRefused(false);
  }

  const apply = () => {
    const typed = label.typed.trim();
    if (typed !== '' && !isLanguageLabel(typed)) {
      setRefused(true);
      return;
    }
    setRefused(false);
    if ((typed === '' ? null : typed) === block.language) return;
    setPreformattedLanguage(typed === '' ? null : typed)(view.state, view.dispatch.bind(view));
  };

  return (
    <div ref={ref} role="group" aria-label="Preformatted text" tabIndex={-1}>
      <label>
        Language label
        <input
          type="text"
          value={label.typed}
          disabled={!enabled}
          aria-invalid={refused}
          aria-describedby={refused ? `${HINT} ${REFUSAL}` : HINT}
          onChange={(event) => setLabel({ ...label, typed: event.target.value })}
          onBlur={apply}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            }
          }}
        />
      </label>
      <p id={HINT}>{HINT_TEXT}</p>
      {refused && (
        <p id={REFUSAL} role="alert">
          {REFUSED_TEXT}
        </p>
      )}
    </div>
  );
}
