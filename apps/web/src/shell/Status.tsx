import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { Icon } from '../editor/Icon.js';
import styles from './Status.module.css';

/**
 * What a page may tell the status bar: the one notice, kept until the next one replaces it, and the
 * context it stands in, said at the bar's right as separate phrases.
 */
export interface Status {
  readonly say: (notice: string | null) => void;
  readonly describe: (context: readonly string[] | null) => void;
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
  const status = useMemo<Status>(() => ({ say: setNotice, describe: setContext }), []);
  return (
    <StatusContext.Provider value={status}>
      {children}
      <StatusBar notice={notice} context={context} />
    </StatusContext.Provider>
  );
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
}: {
  notice: string | null;
  context: readonly string[] | null;
}) {
  return (
    <footer className={styles['bar']}>
      <p role="status" className={styles['notice']}>
        {notice !== null && isMove(notice) && <Icon name="Move" size={13} />}
        {notice}
      </p>
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
