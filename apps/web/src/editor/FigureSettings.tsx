import type { createApiClient } from '@alloy-works/api-client';
import type { Alternative } from '@alloy-works/domain';
import {
  deleteFigure,
  deleteImage,
  setFigureAlternative,
  setFigureNumbered,
  setImageAlternative,
  type EditorView,
} from '@alloy-works/editor';
import { useEffect, useId, useRef, useState } from 'react';

import styles from './FigureSettings.module.css';
import { Icon } from './Icon.js';
import { Modal } from '../layouts/Modal.js';
import { ImageStyle } from '../theme/StyleChoice.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * What the figure's line and its settings show of it: the figure the cursor stands in, as `figureAt`
 * reads it, or an inline image selected whole, as `imageAt` does (figures 4, ruling R7).
 */
export interface FigureShown {
  readonly pos: number;
  /** The asset version it shows, or null where a binding gives its image (the B6 plan, B6-A). */
  readonly asset: string | null;
  readonly imageStyle: string;
  readonly alternative: Alternative;
  /** A figure's, as `figureAt` reads it; an inline image takes no number, and has none. */
  readonly numbered?: boolean;
}

/** The image's own description as it is said: the text and its language, none, or unknown. */
export type Described =
  | { readonly state: 'reading' }
  | { readonly state: 'described'; readonly text: string; readonly language: string }
  | { readonly state: 'none' }
  | { readonly state: 'unknown' };

/**
 * A figure's settings and the commands that change them, held once for its line and its Figure
 * settings dialog so the two cannot disagree (ADR-0055). How its alternative text is given (figures 2,
 * ruling R5): the image's own description, which is read here; the figure's own, in the component's
 * language; or decorative. Its own text that says nothing is not stored - the state stays as it was
 * until something is typed, and an emptied field gives the figure back what it had.
 */
export function useFigureSettings({
  view,
  figure,
  kind,
  enabled,
  client,
}: {
  view: EditorView;
  figure: FigureShown;
  kind: 'figure' | 'image';
  enabled: boolean;
  client: Client;
}) {
  const setAlternative = kind === 'figure' ? setFigureAlternative : setImageAlternative;
  const [choice, setChoice] = useState<Alternative['kind']>(figure.alternative.kind);
  const [own, setOwn] = useState(figure.alternative.kind === 'own' ? figure.alternative.text : '');
  const [described, setDescribed] = useState<Described>({ state: 'reading' });
  // What was last set here, so its own step is not echoed back: the field holds what is typed, and
  // an emptied field holds nothing while the figure keeps what it had.
  const sent = useRef<Alternative | null>(null);
  // What the figure held before its own text was begun here: what an emptied field gives it back.
  const before = useRef<Alternative>(figure.alternative);

  // The figure can change underneath - an undo, or its image replaced - and this follows what it
  // holds. Another figure is another panel: the page keys it by the figure.
  useEffect(() => {
    const held = figure.alternative;
    // Recognised once, and forgotten: a redo gives the figure back this very value, and this must
    // follow that as it follows any other change (figures 2, re-review).
    if (held === sent.current) {
      sent.current = null;
      return;
    }
    setChoice(held.kind);
    if (held.kind === 'own') setOwn(held.text);
  }, [figure.alternative]);

  const asset = figure.asset;
  // A bound figure is described by its definition's column or is decorative, never by its own text
  // (B6-C), and has no asset of its own to read a description from.
  const bound = asset === null;

  useEffect(() => {
    if (asset === null) return undefined;
    let current = true;
    setDescribed({ state: 'reading' });
    void client
      .GET('/v1/asset-versions/{id}', { params: { path: { id: asset } } })
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
  }, [client, asset]);

  const apply = (alternative: Alternative) => {
    // Nothing to set where the figure holds this already, and nothing the effect would hear about.
    if (!enabled || alternative === figure.alternative) return;
    const set = setAlternative(alternative);
    if (!set(view.state)) return;
    sent.current = alternative;
    set(view.state, view.dispatch);
  };

  return {
    kind,
    enabled,
    bound,
    choice,
    own,
    described,
    choose: (chosen: Alternative['kind']) => {
      if (!enabled) return;
      setChoice(chosen);
      if (chosen === 'inherited' || chosen === 'decorative') apply({ kind: chosen });
      else {
        before.current = figure.alternative;
        if (own.trim() !== '') apply({ kind: 'own', text: own });
      }
    },
    type: (text: string) => {
      setOwn(text);
      // Every keystroke is the figure's, until the field says nothing: then the figure goes back to
      // what it had, rather than keeping the last letter left in it (figures 2, final review).
      apply(text.trim() !== '' ? { kind: 'own', text } : before.current);
    },
    number: (numbered: boolean) => {
      if (enabled) setFigureNumbered(numbered)(view.state, view.dispatch);
    },
    remove: () => {
      if (enabled) (kind === 'figure' ? deleteFigure : deleteImage)(view.state, view.dispatch);
    },
  };
}

export type FigureSettingsState = ReturnType<typeof useFigureSettings>;

/** The note under "Use the image's description": the description, or why there is none to show. */
function inheritedNote({ bound, described, kind }: FigureSettingsState): string {
  if (bound)
    return 'Each document shows the description its row holds in the column its query definition names.';
  if (described.state === 'described') return `${described.text} (${described.language})`;
  if (described.state === 'none')
    return `The image has no description of its own, so this ${kind} cannot be published until it is given one here.`;
  if (described.state === 'unknown')
    return 'The image cannot be read, so its description cannot be shown.';
  return 'Reading the image';
}

/**
 * Figure settings (ADR-0055): every setting of a figure or an inline image, changed as it is made,
 * exactly as on its line; there is no Cancel, and Done, Close or Escape close it. Opened where the
 * figure cannot be changed, it is there to read: every control disabled, Close for Done, and no
 * Replace or Delete. The focus starts on the alternative chosen.
 */
export function FigureSettings({
  view,
  figure,
  settings,
  onReplace,
  onClose,
}: {
  view: EditorView;
  figure: FigureShown;
  settings: FigureSettingsState;
  onReplace: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const { kind, enabled, bound, choice, own } = settings;
  const named = kind === 'figure' ? 'Figure settings' : 'Image settings';
  const card = (chosen: Alternative['kind'], label: React.ReactNode, note?: React.ReactNode) => (
    <div className={styles['card']} data-chosen={choice === chosen}>
      <label>
        <input
          type="radio"
          name={`${id}-alternative`}
          checked={choice === chosen}
          disabled={!enabled}
          {...(enabled && choice === chosen ? { 'data-autofocus': true } : {})}
          onChange={() => settings.choose(chosen)}
        />
        {label}
      </label>
      {note}
    </div>
  );

  return (
    <Modal labelledBy={`${id}-title`} size="narrow" onClose={onClose}>
      <div className={styles['title']}>
        <span className={styles['tile']} aria-hidden="true">
          <Icon name={kind === 'figure' ? 'Figure' : 'Image'} />
        </span>
        <h2 id={`${id}-title`}>{named}</h2>
      </div>
      <div className={styles['fields']}>
        <ImageStyle
          view={view}
          value={figure.imageStyle}
          target={kind === 'image' ? 'inlineImage' : 'figure'}
          enabled={enabled}
        />
        {kind === 'figure' && (
          <label>
            Numbered
            <input
              type="checkbox"
              role="switch"
              className={styles['switch']}
              checked={figure.numbered !== false}
              disabled={!enabled}
              onChange={(event) => settings.number(event.target.checked)}
            />
          </label>
        )}
      </div>
      <fieldset className={styles['alternatives']}>
        <legend>Alternative text</legend>
        {card(
          'inherited',
          bound ? 'Use the description its data gives' : <>Use the image&apos;s description</>,
          <p
            className={styles['note']}
            data-tone={!bound && settings.described.state === 'none' ? 'warn' : undefined}
          >
            {inheritedNote(settings)}
          </p>,
        )}
        {!bound &&
          card(
            'own',
            'Describe it here',
            choice === 'own' && (
              <>
                <label className={styles['own']}>
                  Its own description
                  <textarea
                    value={own}
                    disabled={!enabled}
                    onChange={(event) => settings.type(event.target.value)}
                  />
                </label>
                {own.trim() === '' && (
                  <p className={styles['note']}>
                    Until something is typed here, the {kind} keeps what it had.
                  </p>
                )}
              </>
            ),
          )}
        {card('decorative', 'Decorative')}
      </fieldset>
      <div className={styles['footer']}>
        {enabled ? (
          <>
            <button
              type="button"
              onClick={() => {
                onClose();
                onReplace();
              }}
            >
              <Icon name="Replace image" />
              Replace image
            </button>
            <button
              type="button"
              className={styles['delete']}
              onClick={() => {
                settings.remove();
                // The figure is gone, and with it what opened this: the text has the focus back.
                view.focus();
              }}
            >
              <Icon name="Delete" />
              {kind === 'figure' ? 'Delete figure' : 'Delete image'}
            </button>
            <button type="button" className={`primary ${styles['end']}`} onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <button type="button" className={styles['end']} data-autofocus onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </Modal>
  );
}
