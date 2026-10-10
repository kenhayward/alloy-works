import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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
}

const StatusContext = createContext<Status | null>(null);

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
  const status = useMemo<Status>(
    () => ({ say: setNotice, describe: setContext, place: setPlace, tools }),
    [tools],
  );
  return (
    <StatusContext.Provider value={status}>
      {children}
      <StatusBar notice={notice} context={context} place={place} toolsRef={setTools} />
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
  return host === null ? <>{children}</> : createPortal(children, host);
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
}: {
  notice: string | null;
  context: readonly string[] | null;
  place?: string | null;
  /** A page's own tools, where the page draws its own bar. */
  tools?: ReactNode;
  /** Where the shell's bar holds the tools pages send it. */
  toolsRef?: (element: HTMLElement | null) => void;
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
