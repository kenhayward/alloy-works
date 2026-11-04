import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../editor/Icon.js';
import styles from './Status.module.css';

/**
 * What a page may tell the status bar: the one notice, kept until the next one replaces it, and the
 * context it stands in, said at the bar's right as separate phrases.
 */
export interface Status {
  readonly say: (notice: string | null) => void;
  readonly describe: (context: readonly string[] | null) => void;
  /** Where the person is within the page, such as "Bound table, column 3 of 11"; never announced. */
  readonly place: (where: string | null) => void;
  /** Where a page's tools stand in the bar, such as the zoom (ADR-0056): null until the bar is drawn. */
  readonly tools: HTMLElement | null;
  /** Where a page's own state stands, at the bar's left before the notice, such as Saved. */
  readonly lead: HTMLElement | null;
}

const StatusContext = createContext<Status | null>(null);

/**
 * Whether the page around is the one shown: the workspace keeps a page it has left mounted and hidden,
 * and a hidden page puts nothing in the bar. Shown wherever nothing says otherwise.
 */
const ShownContext = createContext(true);

/** Where the page around draws what stands over the window; see `PageShown`. */
const LayerContext = createContext<HTMLElement | null>(null);

/**
 * A page the workspace keeps, and **its own layer on the body** for its dialogs (#962): beside the
 * application, as a dialog must stand, and hidden with the page, which a portal to the body itself never
 * is. A dialog there keeps what was typed in it, and its focus comes back with it.
 */
export function PageShown({ value, children }: { value: boolean; children: ReactNode }) {
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const focused = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (layer === null) return undefined;
    const note = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) focused.current = event.target;
    };
    layer.addEventListener('focusin', note);
    return () => layer.removeEventListener('focusin', note);
  }, [layer]);
  useLayoutEffect(() => {
    if (value && layer?.contains(focused.current)) focused.current?.focus();
  }, [value, layer]);
  return (
    <ShownContext.Provider value={value}>
      {createPortal(<div ref={setLayer} hidden={!value} />, document.body)}
      {/* After the layer, so a dialog open from the first is never drawn elsewhere and moved. */}
      {layer !== null && <LayerContext.Provider value={layer}>{children}</LayerContext.Provider>}
    </ShownContext.Provider>
  );
}

/** Whether the page around is the one shown (`PageShown`). */
export function usePageShown(): boolean {
  return useContext(ShownContext);
}

/** Where a dialog is drawn: the page's own layer, or the body where nothing keeps the page. */
export function usePageLayer(): HTMLElement {
  return useContext(LayerContext) ?? document.body;
}

/**
 * **Modal in full**: everything else at the top of the window is inert while `own`'s dialog stands and
 * its page is shown, taken back as it goes or as the page is left, so the next page answers.
 */
export function useInertBehind(own: RefObject<Element | null>, standing = true): void {
  const shown = usePageShown();
  useLayoutEffect(() => {
    if (!standing || !shown) return undefined;
    const mine = own.current?.closest('body > *');
    const others = [...document.body.children].filter(
      (each) => each !== mine && !each.hasAttribute('inert'),
    );
    for (const each of others) each.setAttribute('inert', '');
    return () => {
      for (const each of others) each.removeAttribute('inert');
    };
  }, [own, standing, shown]);
}

/** Whether a dialog stands over the page shown: one on a page kept hidden holds no key back. */
export function modalOpen(): boolean {
  return [...document.querySelectorAll('[aria-modal="true"]')].some(
    (each) => each.closest('[hidden]') === null,
  );
}

/**
 * The status bar's owner, in the application shell (interface slice 15): one live region for the
 * whole application, so a notice is announced once however many parts of a page have something to
 * say. The bar is placed by whoever renders the provider, with `StatusBar` reading its state.
 */
export function StatusProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [context, setContext] = useState<readonly string[] | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [tools, setTools] = useState<HTMLElement | null>(null);
  const [lead, setLead] = useState<HTMLElement | null>(null);
  const status = useMemo<Status>(
    () => ({ say: setNotice, describe: setContext, place: setPlace, tools, lead }),
    [tools, lead],
  );
  return (
    <StatusContext.Provider value={status}>
      {children}
      <StatusBar
        notice={notice}
        context={context}
        place={place}
        toolsRef={setTools}
        leadRef={setLead}
      />
    </StatusContext.Provider>
  );
}

/**
 * A page's tools, drawn in the status bar at its right, before the context (ADR-0056): through a
 * portal, so they keep the page's own context, such as its zoom. Where there is no shell's bar they
 * stand where they are, and a page drawing its own bar passes them to it as `tools`.
 */
export function StatusTools({ children }: { children: ReactNode }) {
  const host = useStatus()?.tools ?? null;
  const shown = usePageShown();
  if (host === null) return <>{children}</>;
  return shown ? createPortal(children, host) : null;
}

/** A page's own state, such as whether its text is saved, at the bar's left; where it is otherwise. */
export function StatusLead({ children }: { children: ReactNode }) {
  const host = useStatus()?.lead ?? null;
  const shown = usePageShown();
  if (host === null) return <>{children}</>;
  return shown ? createPortal(children, host) : null;
}

/**
 * The status bar a page speaks through, or null outside the application shell - a page rendered on
 * its own, as every page test renders one - which then draws a `StatusBar` of its own, so what it
 * says is found in the same markup either way.
 */
export function useStatus(): Status | null {
  return useContext(StatusContext);
}

/** A notice about a move, which the bar marks with the move glyph. */
const isMove = (notice: string) => notice.startsWith('Moved ');

/**
 * The bar along the foot of the page: at the left the `role="status"` notice, a move marked with its
 * glyph; at the right the context, such as how many sections and components a document holds and
 * which version of it this is.
 */
export function StatusBar({
  notice,
  context,
  place = null,
  tools,
  toolsRef,
  leadRef,
}: {
  notice: string | null;
  context: readonly string[] | null;
  place?: string | null;
  /** A page's own tools, where the page draws its own bar. */
  tools?: ReactNode;
  /** Where the shell's bar holds the tools pages send it. */
  toolsRef?: (element: HTMLElement | null) => void;
  /** Where the shell's bar holds a page's own state. */
  leadRef?: (element: HTMLElement | null) => void;
}) {
  // How tall the bar stands over the window's foot, one line or wrapped to two, told to the page as
  // `--status-height`: what the window scrolls to stops above it, and the outline pane stuck beside
  // the text ends above it (issue #336).
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    if (element === null) return undefined;
    const root = document.documentElement;
    const measure = () =>
      root.style.setProperty('--status-height', `${element.getBoundingClientRect().height}px`);
    measure();
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resized?.observe(element);
    return () => {
      resized?.disconnect();
      root.style.removeProperty('--status-height');
    };
  }, []);
  return (
    <footer ref={bar} className={styles['bar']}>
      <div ref={leadRef} className={styles['lead']} />
      <p role="status" className={styles['notice']}>
        {notice !== null && isMove(notice) && <Icon name="Move" size={13} />}
        {notice}
      </p>
      {place !== null && <p className={styles['place']}>{place}</p>}
      <div ref={toolsRef} className={styles['tools']}>
        {tools}
      </div>
      {context !== null && context.length > 0 && (
        <p className={styles['context']}>
          {context.map((phrase, index) => (
            <span key={phrase}>
              {index > 0 && <span aria-hidden="true"> {'·'} </span>}
              <span>{phrase}</span>
            </span>
          ))}
        </p>
      )}
    </footer>
  );
}
