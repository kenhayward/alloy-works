import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { useStyledImages } from './images.js';
import { usePresentation, useZoom, ZOOMS, type Zoom } from './presentation.js';
import { Notice } from '../states/Notice.js';

/** Points to CSS pixels: a CSS inch is 96 pixels and 72 points. */
const PX_PER_PT = 96 / 72;

/**
 * What makes an element the paper a component's text is set on (themes.md, "The theme in the editor"):
 * `.aw-canvas`, under which the theme's rules apply (STY-058), and the layout's measure and the zoom as
 * `--aw-measure` and `--aw-zoom`, which every length the theme writes is multiplied by (CNT-115, ET-E).
 * Nothing until a presentation is ready, so the text is set as it was rather than in half a theme. At
 * Fit, the zoom is whatever sets the measure across the room `room` measures, and the printed size
 * where it cannot be measured.
 */
export function useCanvas(
  room: (element: HTMLElement) => number,
  given?: RefObject<HTMLDivElement | null>,
): {
  ref: RefObject<HTMLDivElement | null>;
  className: string | undefined;
  style: CSSProperties | undefined;
} {
  const presentation = usePresentation();
  const zooming = useZoom();
  const own = useRef<HTMLDivElement | null>(null);
  const ref = given ?? own;
  const [fitted, setFitted] = useState(1);
  const ready = presentation?.state === 'ready' ? presentation : null;
  const measure = ready?.frame.measure;
  const fit = zooming?.zoom === 'fit';

  useLayoutEffect(() => {
    const element = ref.current;
    if (!fit || measure === undefined || !element) return undefined;
    const refit = () => {
      const width = room(element);
      setFitted(width > 0 ? width / (measure * PX_PER_PT) : 1);
    };
    refit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(refit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit, measure, room, ref]);

  if (!ready || !zooming) return { ref, className: undefined, style: undefined };
  const zoom = zooming.zoom === 'fit' ? fitted : zooming.zoom;
  return {
    ref,
    className: 'aw-canvas',
    style: {
      '--aw-measure': `${ready.frame.measure}pt`,
      '--aw-zoom': String(Number(zoom.toFixed(4))),
    } as CSSProperties,
  };
}

/** The room inside an element's own padding, which is what the measure is set across there. */
export function innerWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return (
    element.clientWidth -
    (parseFloat(style.paddingLeft) || 0) -
    (parseFloat(style.paddingRight) || 0)
  );
}

/** The room a text that is its own canvas has: its parent's, inside the parent's padding. */
export const parentRoom = (element: HTMLElement): number =>
  element.parentElement ? innerWidth(element.parentElement) : 0;

// The room the surface's own padding leaves, inside the canvas that holds it.
const surfaceRoom = (canvas: HTMLElement) => {
  const surface = canvas.firstElementChild;
  return surface instanceof HTMLElement ? innerWidth(surface) : innerWidth(canvas);
};

/**
 * The paper a component's editing surface stands on. The element is always rendered, whether or not
 * the presentation has arrived, so the surface ProseMirror is mounted in is never remounted when it
 * does.
 */
export function Canvas({ children }: { children: ReactNode }) {
  const { ref, className, style } = useCanvas(surfaceRoom);
  useStyledImages(ref);
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

const LABELS: Record<string, string> = { fit: 'Fit' };

/** How large a reader sees a page's text: at a share of its printed size, or across the column. */
export function ZoomControl() {
  const presentation = usePresentation();
  const zooming = useZoom();
  if (presentation?.state !== 'ready' || !zooming) return null;
  return (
    <label className="aw-zoom">
      Zoom{' '}
      <select
        value={String(zooming.zoom)}
        onChange={(event) => {
          const chosen = event.target.value;
          zooming.setZoom(
            chosen === 'fit' ? 'fit' : (ZOOMS.find((each) => String(each) === chosen) ?? 1),
          );
        }}
      >
        {[...ZOOMS, 'fit' as const].map((each: Zoom) => (
          <option key={each} value={String(each)}>
            {LABELS[String(each)] ?? `${Math.round((each as number) * 100)}%`}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The typefaces of the theme the renderer holds none of, said where the text is (STY-070, ET-I): their
 * text is set in the application's own face meanwhile, and says so rather than passing for the page.
 */
export function UnheldFaces() {
  const presentation = usePresentation();
  if (presentation?.state !== 'ready' || presentation.unheld.length === 0) return null;
  return (
    <Notice tone="failed">
      <p>
        {presentation.unheld.length === 1 ? 'The typeface ' : 'The typefaces '}
        {presentation.unheld.join(', ')}
        {presentation.unheld.length === 1 ? ' is' : ' are'} not available here, so the text set in{' '}
        {presentation.unheld.length === 1 ? 'it' : 'them'} is shown in the application's own face.
      </p>
    </Notice>
  );
}
