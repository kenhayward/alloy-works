import type { createApiClient } from '@alloy-works/api-client';
import type { EditorView } from '@alloy-works/editor';
import { useState, type Ref } from 'react';

import styles from './FigurePanel.module.css';
import { FigureSettings, useFigureSettings, type FigureShown } from './FigureSettings.js';
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
 * A figure's settings on the toolbar's second line (ADR-0055): its image style, whether it is
 * numbered, Replace and Delete, and Figure settings, the dialog holding every setting, how its
 * alternative text is given among them. Both share one state, so the two cannot disagree. An inline
 * image's has no Numbered, since an image in a line is never numbered (STR-071). **Rendered only
 * while the cursor is in a figure**, as the table panel is only in a table.
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

  return (
    <div
      ref={ref}
      role="group"
      aria-label={kind === 'figure' ? 'Figure' : 'Image'}
      tabIndex={-1}
      className={styles['panel']}
    >
      <ImageStyle
        view={view}
        value={figure.imageStyle}
        target={kind === 'image' ? 'inlineImage' : 'figure'}
        enabled={enabled}
      />
      {kind === 'figure' && (
        <label>
          <input
            type="checkbox"
            checked={figure.numbered !== false}
            disabled={!enabled}
            onChange={(event) => settings.number(event.target.checked)}
          />
          Numbered
        </label>
      )}
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
        onClick={settings.remove}
      >
        {kind === 'figure' ? 'Delete figure' : 'Delete image'}
      </button>
      {/* Opens to read where nothing can be changed, as well as to change. */}
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {kind === 'figure' ? 'Figure settings' : 'Image settings'}
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
