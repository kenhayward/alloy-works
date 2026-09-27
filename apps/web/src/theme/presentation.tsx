import type { createApiClient, PresentationView } from '@alloy-works/api-client';
import { projectCss, projectFontFaces, readTheme, type ResolvedTheme } from '@alloy-works/domain';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { faceUrl } from './faces.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * The theme and layout a page's text is set in (themes.md, "The theme in the editor"): the theme read
 * by `readTheme`, the reader the publisher reads it by (STY-035, ET-B); the two lengths of the layout's
 * page an image style is a share of; and the typefaces the renderer holds none of, by family, which the
 * editor shows rather than hides (STY-070).
 */
export type Presentation =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | {
      readonly state: 'ready';
      readonly theme: ResolvedTheme;
      readonly frame: PresentationView['frame'];
      readonly unheld: readonly string[];
    };

const PresentationContext = createContext<Presentation | null>(null);

/** The zooms a reader chooses between (ET-E): a share of the printed size, or the column's width. */
export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type Zoom = (typeof ZOOMS)[number] | 'fit';

const ZOOM_KEY = 'alloy-works.zoom';

/** The zoom this reader chose last, kept in this browser as a convenience; the printed size if none. */
function keptZoom(): Zoom {
  try {
    const kept = window.localStorage.getItem(ZOOM_KEY);
    if (kept === 'fit') return 'fit';
    const found = ZOOMS.find((each) => String(each) === kept);
    return found ?? 1;
  } catch {
    return 1;
  }
}

/**
 * The canvas's own rules, beside the theme's: the text is the layout's measure wide, times the zoom
 * (CNT-115), whether the canvas holds the text - the editing surface - or is the text itself - a
 * document's read text; and a column narrower than that scrolls sideways rather than setting shorter
 * lines than the page will. The layout's, not the theme's, so written here rather than projected.
 */
const CANVAS_CSS =
  '.aw-canvas { overflow-x: auto; }\n' +
  '.aw-canvas .aw-text, .aw-canvas.aw-text { box-sizing: content-box; ' +
  'width: calc(var(--aw-measure) * var(--aw-zoom)); max-width: none; }\n';

const ZoomContext = createContext<{ zoom: Zoom; setZoom: (zoom: Zoom) => void } | null>(null);

/**
 * Reads the presentation a page is set in - the environment's, or with `document` that document's, as
 * a publish would take them (ET-A) - and declares the theme's faces from the renderer's own copy of the
 * pinned files (STY-039, ET-C). Whatever it holds, its children render: a presentation that has not
 * arrived, or cannot be read, leaves the text as it was, and says which.
 */
export function PresentationProvider({
  client,
  document,
  children,
}: {
  client: Client;
  document?: string;
  children: ReactNode;
}) {
  const [presentation, setPresentation] = useState<Presentation>({ state: 'loading' });
  const [faces, setFaces] = useState('');
  const [zoom, setZoomState] = useState<Zoom>(keptZoom);
  const setZoom = useCallback((next: Zoom) => {
    setZoomState(next);
    try {
      window.localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // Storage refused: the zoom holds for this page and is not kept.
    }
  }, []);
  const zooming = useMemo(() => ({ zoom, setZoom }), [zoom, setZoom]);

  useEffect(() => {
    let live = true;
    setPresentation({ state: 'loading' });
    const asked =
      document === undefined
        ? client.GET('/v1/presentation')
        : client.GET('/v1/documents/{id}/presentation', { params: { path: { id: document } } });
    asked.then(
      ({ data }) => {
        if (!live) return;
        const read =
          data &&
          readTheme(
            data.theme.content,
            new Map(data.theme.catalogues.map((each) => [each.versionId, each.content])),
          );
        if (!data || !read || !read.ok) {
          setFaces('');
          setPresentation({ state: 'failed' });
          return;
        }
        const projected = projectFontFaces(read.theme, faceUrl);
        // The faces, then the theme's own rules, which name them (STY-058).
        setFaces(projected.css + CANVAS_CSS + projectCss(read.theme));
        setPresentation({
          state: 'ready',
          theme: read.theme,
          frame: data.frame,
          unheld: projected.unheld,
        });
      },
      () => {
        if (!live) return;
        setFaces('');
        setPresentation({ state: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [client, document]);

  return (
    <PresentationContext.Provider value={presentation}>
      <ZoomContext.Provider value={zooming}>
        {faces !== '' && <style data-aw-faces="">{faces}</style>}
        {children}
      </ZoomContext.Provider>
    </PresentationContext.Provider>
  );
}

/** The presentation a page is set in, or null outside any provider, where text is set as it was. */
export function usePresentation(): Presentation | null {
  return useContext(PresentationContext);
}

/** The zoom a page's text is set at, and how a reader changes it; null outside any provider. */
export function useZoom(): { zoom: Zoom; setZoom: (zoom: Zoom) => void } | null {
  return useContext(ZoomContext);
}
