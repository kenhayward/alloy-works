import type { createApiClient } from '@alloy-works/api-client';
import type { EditorView } from '@alloy-works/editor';
import { useId, useState, type Ref } from 'react';

import styles from './FigurePanel.module.css';
import {
  FigureSettings,
  useFigureSettings,
  type FigureSettingsState,
  type FigureShown,
} from './FigureSettings.js';
import { Icon } from './Icon.js';
import { IconButton } from '../parts/IconButton.js';
import { ImageStyle } from '../theme/StyleChoice.js';

type Client = ReturnType<typeof createApiClient>;

export interface FigurePanelProps {
  readonly view: EditorView;
  /**
   * What the panel is about: the figure the cursor stands in, as `figureAt` reads it, or an inline image
   * selected whole, as `imageAt` does (figures 4, ruling R7). The two are described alike.
   */
  readonly figure: FigureShown;
  /** A figure's panel or an inline image's: its name, and the commands that change it. */
  readonly kind?: 'figure' | 'image';
  readonly enabled: boolean;
  readonly client: Client;
  /** Opens the Figure dialog to give this figure another image. */
  readonly onReplace: () => void;
  /** The panel's own element: a region `F6` moves between while the cursor is in a figure (CNT-077). */
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * The Alt text chip's words (ADR-0055): how the figure's alternative text is given as it is stored,
 * and, where it cannot be published as it is, why. While the image is read, or cannot be, it is
 * "From the image"; the dialog says which.
 */
function alternativeSaid(
  figure: FigureShown,
  { bound, described, kind }: FigureSettingsState,
): { words: string; needed?: string } {
  const held = figure.alternative.kind;
  if (held === 'own') return { words: 'Described here' };
  if (held === 'decorative') return { words: 'Decorative' };
  if (bound) return { words: 'From its data' };
  if (described.state === 'none')
    return {
      words: 'Needed',
      needed: `The image has no description of its own, so this ${kind} cannot be published until it is given one here.`,
    };
  return { words: 'From the image' };
}

/**
 * A figure's settings on the toolbar's second line, in one line that never wraps (ADR-0055): its kind,
 * image style, Numbered, an Alt text chip saying how its alternative text is given, Replace and Delete,
 * and Figure settings, the dialog holding every setting. The chip opens the dialog too. Both share one
 * state, so the two cannot disagree. An inline image's has no Numbered, since an image in a line is
 * never numbered (STR-071). **Rendered only while the cursor is in a figure**, as the table panel is
 * only in a table.
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
  const settings = useFigureSettings({ view, figure, kind, enabled, client });
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const [tipShown, setTipShown] = useState(false);
  const said = alternativeSaid(figure, settings);
  const named = kind === 'figure' ? 'Figure' : 'Image';
  const settingsNamed = `${named} settings`;
  const removeNamed = kind === 'figure' ? 'Delete figure' : 'Delete image';

  return (
    <div ref={ref} role="group" aria-label={named} tabIndex={-1} className={styles['panel']}>
      <span className={styles['kind']}>
        <Icon name={named} size={14} />
        {named}
      </span>
      <ImageStyle
        view={view}
        value={figure.imageStyle}
        target={kind === 'image' ? 'inlineImage' : 'figure'}
        enabled={enabled}
        className={styles['style']}
      />
      {kind === 'figure' && (
        <label className={styles['numbered']}>
          <input
            type="checkbox"
            role="switch"
            className={styles['switch']}
            checked={figure.numbered !== false}
            aria-disabled={!enabled}
            onChange={(event) => settings.number(event.target.checked)}
          />
          Numbered
        </label>
      )}
      <span className={styles['rule']} aria-hidden="true" />
      <span className={styles['chipAnchor']}>
        <button
          type="button"
          className={styles['chip']}
          data-tone={said.needed === undefined ? undefined : 'warn'}
          aria-label={`Alternative text: ${said.words}. Change it`}
          aria-haspopup="dialog"
          {...(said.needed === undefined ? {} : { 'aria-describedby': tipId })}
          onClick={() => setOpen(true)}
          onMouseEnter={() => setTipShown(true)}
          onMouseLeave={() => setTipShown(false)}
          onFocus={() => setTipShown(true)}
          onBlur={() => setTipShown(false)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !tipShown) return;
            event.preventDefault();
            setTipShown(false);
          }}
        >
          {said.needed !== undefined && <Icon name="Needs attention" size={13} />}
          {said.words === 'From its data' && <Icon name="Data" size={13} />}
          <span className={styles['chipLabel']}>Alt text</span>
          <span className={styles['chipWords']}>{said.words}</span>
        </button>
        {said.needed !== undefined && (
          <span id={tipId} role="tooltip" className={styles['tip']} hidden={!tipShown}>
            {said.needed}
          </span>
        )}
      </span>
      <span className={styles['actions']}>
        <IconButton
          label="Replace image"
          className={styles['icon']}
          aria-disabled={!enabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => enabled && onReplace()}
        >
          <Icon name="Replace image" />
        </IconButton>
        <IconButton
          label={removeNamed}
          className={`${styles['icon']} ${styles['delete']}`}
          aria-disabled={!enabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={settings.remove}
        >
          <Icon name="Delete" />
        </IconButton>
      </span>
      <span className={styles['rule']} aria-hidden="true" />
      {/* Opens to read where nothing can be changed, as well as to change. */}
      <button
        type="button"
        className={styles['settings']}
        aria-label={settingsNamed}
        title={settingsNamed}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="Settings" />
        <span className={styles['settingsWords']}>{settingsNamed}</span>
      </button>
      {open && (
        <FigureSettings
          view={view}
          figure={figure}
          settings={settings}
          onReplace={onReplace}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
