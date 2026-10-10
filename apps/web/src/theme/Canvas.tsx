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
import { Icon } from '../editor/Icon.js';
import { IconButton } from '../parts/IconButton.js';
import { Notice } from '../states/Notice.js';

/** Points to CSS pixels: a CSS inch is 96 pixels and 72 points. */
const PX_PER_PT = 96 / 72;

/** The sheet's interface margin either side of the measure, in CSS pixels at 100% (ADR-0056). */
export const SHEET_MARGIN = 70;

/**
 * The zoom at Fit: what sets the measure, and on a sheet its margins too, across `room` CSS pixels;
 * the printed size where there is no room to measure.
 */
export function fitZoom(room: number, measure: number, sheet: boolean): number {
  if (room <= 0) return 1;
  return room / (measure * PX_PER_PT + (sheet ? 2 * SHEET_MARGIN : 0));
}

/**
 * What makes an element the paper a component's text is set on (themes.md, "The theme in the editor"):
 * `.aw-canvas`, under which the theme's rules apply (STY-058), and the layout's measure and the zoom as
 * `--aw-measure` and `--aw-zoom`, which every length the theme writes is multiplied by (CNT-115, ET-E).
 * Nothing until a presentation is ready, so the text is set as it was rather than in half a theme. At
 * Fit, the zoom is whatever sets the measure across the room `room` measures, and the printed size
 * where it cannot be measured. A `sheet` is the paper as a page on a desk (ADR-0056): `.aw-sheet`
 * too, its margins scaling with the zoom, and at Fit the room is its desk's, the element's parent.
 */
export function useCanvas(
  room: (element: HTMLElement) => number,
  given?: RefObject<HTMLDivElement | null>,
  sheet = false,
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
    const refit = () => setFitted(fitZoom(room(element), measure, sheet));
    refit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(refit);
    // A sheet is as wide as its zoom makes it: its desk is what the window resizes.
    observer.observe(sheet ? (element.parentElement ?? element) : element);
    return () => observer.disconnect();
  }, [fit, measure, room, ref, sheet]);

  if (!ready || !zooming) return { ref, className: undefined, style: undefined };
  const zoom = zooming.zoom === 'fit' ? fitted : zooming.zoom;
  return {
    ref,
    className: sheet ? 'aw-canvas aw-sheet' : 'aw-canvas',
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
 * A desk scrolls sideways where it is narrower than its sheet, and a region that scrolls must take the
 * keyboard (WCAG 2.1.1, axe's scrollable-region-focusable): a tab stop while it scrolls, none while not.
 */
export function keepReachable(desk: HTMLElement): void {
  if (desk.scrollWidth > desk.clientWidth) desk.tabIndex = 0;
  else desk.removeAttribute('tabindex');
}

/** Keeps a desk reachable by the keyboard as it, or its sheet, changes size. */
export function useReachableDesk(desk: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = desk.current;
    if (!element) return undefined;
    const check = () => keepReachable(element);
    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(check);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  });
}

/** The room a sheet has: its desk's, inside the desk's padding, less the sheet's 1px edges (ADR-0056). */
export const deskRoom = (element: HTMLElement): number => Math.max(0, parentRoom(element) - 2);

/**
 * The paper a component's editing surface stands on: on its own, a sheet on a desk (ADR-0056); open
 * in place, the document's sheet already is the paper, and this is only the measure's holder. The
 * elements are always rendered, whether or not the presentation has arrived, so the surface
 * ProseMirror is mounted in is never remounted when it does.
 */
export function Canvas({ children, sheet = false }: { children: ReactNode; sheet?: boolean }) {
  const { ref, className, style } = useCanvas(sheet ? deskRoom : surfaceRoom, undefined, sheet);
  const desk = useRef<HTMLDivElement>(null);
  useReachableDesk(desk);
  useStyledImages(ref);
  const paper = (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
  return sheet ? (
    <div ref={desk} className="aw-desk">
      {paper}
    </div>
  ) : (
    paper
  );
}

const LABELS: Record<string, string> = { fit: 'Fit' };

const percent = (zoom: number) => `${Math.round(zoom * 100)}%`;

/**
 * How large a reader sees a page's text, at the status bar's right (ADR-0056): Zoom out, a slider and
 * Zoom in stepping through the levels, and the level itself as a menu, which holds Fit too. At Fit the
 * slider and the steps start from the printed size.
 */
export function ZoomControl() {
  const presentation = usePresentation();
  const zooming = useZoom();
  if (presentation?.state !== 'ready' || !zooming) return null;
  const at = Math.max(0, ZOOMS.indexOf(zooming.zoom === 'fit' ? 1 : zooming.zoom));
  const step = (to: number) => {
    const level = ZOOMS[to];
    if (level !== undefined) zooming.setZoom(level);
  };
  return (
    <div className="aw-zoom" role="group" aria-label="Zoom controls">
      <IconButton label="Zoom out" aria-disabled={at === 0} onClick={() => step(at - 1)}>
        <Icon name="Zoom out" size={14} />
      </IconButton>
      <input
        type="range"
        aria-label="Zoom level"
        min={0}
        max={ZOOMS.length - 1}
        step={1}
        value={at}
        aria-valuetext={percent(ZOOMS[at] ?? 1)}
        onChange={(event) => step(Number(event.target.value))}
      />
      <IconButton
        label="Zoom in"
        aria-disabled={at === ZOOMS.length - 1}
        onClick={() => step(at + 1)}
      >
        <Icon name="Zoom in" size={14} />
      </IconButton>
      <select
        aria-label="Zoom"
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
            {LABELS[String(each)] ?? percent(each as number)}
          </option>
        ))}
      </select>
    </div>
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
