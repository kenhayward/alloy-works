import { createApiClient } from '@alloy-works/api-client';
import { useEffect, useMemo, useState } from 'react';

import { ComponentEditor } from './ComponentEditor.js';
import { ComponentList } from './ComponentList.js';

export interface WorkspaceProps {
  /** Given in tests; the browser's own otherwise. */
  readonly fetch?: typeof fetch;
}

const OPEN = /^#\/components\/([0-9a-f-]{36})$/;

/** The address after `#`, followed as it changes: a hash never reaches the service or a reload's path. */
function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const follow = () => setHash(window.location.hash);
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return hash;
}

/**
 * The list of components, or one component open, chosen by the address's hash - so opening one is a
 * link, a reload reopens it, and the renderer's relative asset paths (built for the desktop shell's
 * `file://` fallback) are never put under a deep path.
 */
export function Workspace({ fetch: given }: WorkspaceProps) {
  const origin = window.location.origin;
  const client = useMemo(
    () => createApiClient({ baseUrl: origin, ...(given ? { fetch: given } : {}) }),
    [origin, given],
  );
  const hash = useHash();
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void client.GET('/v1/me').then(({ data }) => {
      if (current && data) setMe(data.id);
    });
    return () => {
      current = false;
    };
  }, [client]);

  if (me === null) return null;
  const opened = OPEN.exec(hash)?.[1];
  if (opened) {
    return (
      <>
        <p>
          <a href="#">Back to components</a>
        </p>
        <ComponentEditor key={opened} componentId={opened} client={client} principalId={me} />
      </>
    );
  }
  return <ComponentList client={client} />;
}
