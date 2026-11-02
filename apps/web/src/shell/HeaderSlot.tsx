import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { usePageShown } from './Status.js';

type SlotName = 'lead' | 'lifecycle' | 'tools';
type Hosts = Partial<Record<SlotName, HTMLElement | null>>;

interface HeaderHosts {
  readonly hosts: Hosts;
  readonly set: (name: SlotName, element: HTMLElement | null) => void;
}

const HostsContext = createContext<HeaderHosts | null>(null);

/** The header's places a page may draw in (ADR-0075), around the header and the workspace both. */
export function HeaderHostsProvider({ children }: { children: ReactNode }) {
  const [hosts, setHosts] = useState<Hosts>({});
  // Kept the same as the hosts change: the header's refs take it, and a ref that changed lets go of its
  // element, which would change the hosts again.
  const set = useCallback<HeaderHosts['set']>(
    (name, element) =>
      setHosts((was) => (was[name] === element ? was : { ...was, [name]: element })),
    [],
  );
  const value = useMemo<HeaderHosts>(() => ({ hosts, set }), [hosts, set]);
  return <HostsContext.Provider value={value}>{children}</HostsContext.Provider>;
}

/** The ref a place in the header takes; nothing outside the application shell. */
export function useHeaderHost(name: SlotName): (element: HTMLElement | null) => void {
  const set = useContext(HostsContext)?.set;
  return useMemo(() => (element) => set?.(name, element), [set, name]);
}

/**
 * A page's own part of the header, as `StatusLead` is of the status bar: drawn there while the page is
 * the one shown, and nothing while it is kept hidden; in place outside the application shell, as a page
 * under test stands.
 */
export function HeaderSlot({ name, children }: { name: SlotName; children: ReactNode }) {
  const hosts = useContext(HostsContext);
  const shown = usePageShown();
  const host = hosts?.hosts[name] ?? null;
  if (hosts === null) return <>{children}</>;
  return shown && host !== null ? createPortal(children, host) : null;
}
