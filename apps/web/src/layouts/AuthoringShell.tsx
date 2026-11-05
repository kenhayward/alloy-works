import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { dockRoom } from '../structure/dockRoom.js';

import styles from './AuthoringShell.module.css';

/**
 * The page on a desk that a document and a component's own page both stand on (ADR-0085): layout
 * alone, each page keeping its own state. Composed rather than given slots, so that each part's place
 * in the page, and so the keyboard's order through it, reads where it is used.
 */
export function ShellPage({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <article aria-labelledby={labelledBy} className={styles['page']} data-desk-page="">
      {children}
    </article>
  );
}

/** The columns: the start pane, the text, a preview where one is open, and the panels. */
export function ShellLayout({
  startCollapsed,
  panelsCollapsed,
  previewing = false,
  startWidth,
  panelsWidth,
  children,
}: {
  startCollapsed: boolean;
  panelsCollapsed: boolean;
  previewing?: boolean;
  startWidth: number;
  panelsWidth: number;
  children: ReactNode;
}) {
  return (
    <div
      className={styles['layout']}
      data-collapsed={startCollapsed}
      data-dock-collapsed={panelsCollapsed}
      // A preview takes a column of its own beside the text, which narrows to make room for it.
      data-previewing={previewing}
      style={
        {
          '--outline-width': `${startWidth}px`,
          '--dock-panel': `${panelsWidth}px`,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

/** The side dock (ADR-0075), floating on the desk. */
export function ShellSideDock({ children }: { children: ReactNode }) {
  return (
    <div className={styles['sideDock']} data-side-dock="">
      {children}
    </div>
  );
}

/** The panels beside the text and the rail they are chosen from (ADR-0074), kept while hidden. */
export function ShellPanels({
  areaRef,
  label,
  hidden,
  rail,
  children,
}: {
  areaRef?: Ref<HTMLDivElement>;
  label: string;
  hidden: boolean;
  rail: ReactNode;
  children: ReactNode;
}) {
  return (
    <div ref={areaRef} className={styles['dockArea']} data-dock-area="">
      <aside className={styles['dock']} aria-label={label} hidden={hidden}>
        {children}
      </aside>
      {rail}
    </div>
  );
}

/** The edge sizing the start pane. */
export function ShellStartEdge({ children }: { children: ReactNode }) {
  return <div className={styles['separator']}>{children}</div>;
}

/** The edge sizing the panels, just before them, whatever stands between. */
export function ShellPanelsEdge({ children }: { children: ReactNode }) {
  return <div className={styles['dockSeparator']}>{children}</div>;
}

/** The desk the text stands on. */
export function ShellText({
  textRef,
  desk = true,
  children,
}: {
  textRef?: Ref<HTMLDivElement>;
  /** Whether this is the desk, or what stands in it brings its own, as a lone component's sheet does. */
  desk?: boolean;
  children: ReactNode;
}) {
  return (
    <div ref={textRef} className={desk ? `${styles['text']} aw-desk` : styles['text']}>
      {children}
    </div>
  );
}

/**
 * The panels given the room from where they stand to above the status bar, as the page scrolls them
 * up to their sticky top, the window resizes or the status bar wraps (issue #878). The ref to give
 * `ShellPanels`.
 */
export function useDockRoom(): (area: HTMLDivElement | null) => void {
  const [dockArea, setDockArea] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (dockArea === null) return undefined;
    const root = window.document.documentElement;
    const fit = () => {
      if (getComputedStyle(dockArea).position !== 'sticky') {
        dockArea.style.removeProperty('--dock-room');
        return;
      }
      const room = dockRoom({
        top: dockArea.getBoundingClientRect().top,
        viewport: window.innerHeight,
        status: parseFloat(getComputedStyle(root).getPropertyValue('--status-height')) || 0,
        gap: 12,
      });
      dockArea.style.setProperty('--dock-room', `${room}px`);
    };
    fit();
    window.addEventListener('scroll', fit, { passive: true });
    window.addEventListener('resize', fit);
    const watched = new MutationObserver(fit);
    watched.observe(root, { attributes: true, attributeFilter: ['style'] });
    return () => {
      window.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
      watched.disconnect();
    };
  }, [dockArea]);
  return setDockArea;
}

/** A side dock's own: a toggle, a rule, and a preview's place beside the text. */
export const shellClass = {
  dockToggle: styles['dockToggle'],
  preview: styles['preview'],
  dockHeading: styles['dockHeading'],
  dockBody: styles['dockBody'],
};
