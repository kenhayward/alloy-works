import type { createApiClient } from '@alloy-works/api-client';
import type { Alternative } from '@alloy-works/domain';
import {
  deleteFigure,
  deleteImage,
  setFigureAlternative,
  setImageAlternative,
  type EditorView,
} from '@alloy-works/editor';
import { useEffect, useId, useRef, useState, type Ref } from 'react';

import styles from './FigurePanel.module.css';

type Client = ReturnType<typeof createApiClient>;

export interface FigurePanelProps {
  readonly view: EditorView;
  /**
   * What the panel is about: the figure the cursor stands in, as `figureAt` reads it, or an inline image
   * selected whole, as `imageAt` does (figures 4, ruling R7). The two are described alike.
   */
  readonly figure: {
    readonly pos: number;
    readonly asset: string;
    readonly alternative: Alternative;
  };
  /** A figure's panel or an inline image's: its name, and the commands that change it. */
  readonly kind?: 'figure' | 'image';
  readonly enabled: boolean;
  readonly client: Client;
  /** Opens the Figure dialog to give this figure another image. */
  readonly onReplace: () => void;
  /** The panel's own element: a region `F6` moves between while the cursor is in a figure (CNT-077). */
  readonly ref?: Ref<HTMLDivElement>;
}

/** The image's own description as the panel says it: the text and its language, none, or unknown. */
type Described =
  | { readonly state: 'reading' }
  | { readonly state: 'described'; readonly text: string; readonly language: string }
  | { readonly state: 'none' }
  | { readonly state: 'unknown' };

/**
 * How a figure's alternative text is given, and what can be done to its image (figures 2, ruling
 * R5): the image's own description, which the panel reads and shows; the figure's own, in the
 * component's language; or decorative. Its own text that says nothing is not stored - the state stays
 * as it was until something is typed. **Rendered only while the cursor is in a figure**, as the table
 * panel is only in a table.
 */
export function FigurePanel({
  view,
  figure,
  kind = 'figure',
  enabled,
  client,
  onReplace,
  ref,
}: FigurePanelProps) {
  const named = kind === 'figure' ? 'Figure' : 'Image';
  const setAlternative = kind === 'figure' ? setFigureAlternative : setImageAlternative;
  const remove = kind === 'figure' ? deleteFigure : deleteImage;
  const id = useId();
  const [choice, setChoice] = useState<Alternative['kind']>(figure.alternative.kind);
  const [own, setOwn] = useState(figure.alternative.kind === 'own' ? figure.alternative.text : '');
  const [described, setDescribed] = useState<Described>({ state: 'reading' });
  // What the panel itself last set, so its own step is not echoed back into it: the field holds what
  // is typed, and an emptied field holds nothing while the figure keeps what it had.
  const sent = useRef<Alternative | null>(null);
  // What the figure held before its own text was begun here: what an emptied field gives it back.
  const before = useRef<Alternative>(figure.alternative);

  // The figure can change under the panel - an undo, or its image replaced - and the panel follows
  // what it holds. Another figure is another panel: the page keys it by the figure.
  useEffect(() => {
    const held = figure.alternative;
    // Recognised once, and forgotten: a redo gives the figure back this very value, and the panel
    // must follow that as it follows any other change (figures 2, re-review).
    if (held === sent.current) {
      sent.current = null;
      return;
    }
    setChoice(held.kind);
    if (held.kind === 'own') setOwn(held.text);
  }, [figure.alternative]);

  useEffect(() => {
    let current = true;
    setDescribed({ state: 'reading' });
    void client
      .GET('/v1/asset-versions/{id}', { params: { path: { id: figure.asset } } })
      .then(({ data }) => {
        if (!current) return;
        if (!data) setDescribed({ state: 'unknown' });
        else if (data.alternative === null) setDescribed({ state: 'none' });
        else setDescribed({ state: 'described', ...data.alternative });
      })
      .catch(() => current && setDescribed({ state: 'unknown' }));
    return () => {
      current = false;
    };
  }, [client, figure.asset]);

  const apply = (alternative: Alternative) => {
    // Nothing to set where the figure holds this already, and nothing the effect would hear about.
    if (!enabled || alternative === figure.alternative) return;
    const set = setAlternative(alternative);
    if (!set(view.state)) return;
    sent.current = alternative;
    set(view.state, view.dispatch);
  };

  const choose = (kind: Alternative['kind']) => {
    setChoice(kind);
    if (kind === 'inherited' || kind === 'decorative') apply({ kind });
    else {
      before.current = figure.alternative;
      if (own.trim() !== '') apply({ kind: 'own', text: own });
    }
  };

  const type = (text: string) => {
    setOwn(text);
    // Every keystroke is the figure's, until the field says nothing: then the figure goes back to
    // what it had, rather than keeping the last letter left in it (figures 2, final review).
    apply(text.trim() !== '' ? { kind: 'own', text } : before.current);
  };

  return (
    <div ref={ref} role="group" aria-label={named} tabIndex={-1} className={styles['panel']}>
      <fieldset disabled={!enabled}>
        <legend>Alternative text</legend>
        <label>
          <input
            type="radio"
            name={`${id}-alternative`}
            checked={choice === 'inherited'}
            onChange={() => choose('inherited')}
          />
          Use the image&apos;s description
        </label>
        <p className={styles['note']}>
          {described.state === 'described'
            ? `${described.text} (${described.language})`
            : described.state === 'none'
              ? `The image has no description of its own, so this ${kind} cannot be published until it is given one here.`
              : described.state === 'unknown'
                ? 'The image cannot be read, so its description cannot be shown.'
                : 'Reading the image'}
        </p>
        <label>
          <input
            type="radio"
            name={`${id}-alternative`}
            checked={choice === 'own'}
            onChange={() => choose('own')}
          />
          Describe it here
        </label>
        {choice === 'own' && (
          <label>
            Its own description
            <textarea value={own} onChange={(event) => type(event.target.value)} />
          </label>
        )}
        {choice === 'own' && own.trim() === '' && (
          <p className={styles['note']}>
            Until something is typed here, the {kind} keeps what it had.
          </p>
        )}
        <label>
          <input
            type="radio"
            name={`${id}-alternative`}
            checked={choice === 'decorative'}
            onChange={() => choose('decorative')}
          />
          Decorative
        </label>
      </fieldset>
      <button
        type="button"
        aria-disabled={!enabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => enabled && onReplace()}
      >
        Replace image
      </button>
      <button
        type="button"
        aria-disabled={!enabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => enabled && remove(view.state, view.dispatch)}
      >
        {kind === 'figure' ? 'Delete figure' : 'Delete image'}
      </button>
    </div>
  );
}
