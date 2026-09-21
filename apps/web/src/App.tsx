import { useEffect, useState } from 'react';

import styles from './App.module.css';
import { Workspace } from './editor/Workspace.js';
import { Environment } from './Environment.js';
import { resolveBridge, type PlatformBridge, type PlatformInfo } from './platform/bridge.js';
import { Header } from './shell/Header.js';
import { moduleOf } from './shell/moduleOf.js';

interface AppProps {
  bridge?: PlatformBridge;
  /** The environment panel, which calls the service; given by tests that are not about it. */
  environment?: React.ReactNode;
  /** The components and the editor, which call the service; given by tests that are not about them. */
  workspace?: React.ReactNode;
}

/** The address after `#`, followed as it changes. */
function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const follow = () => setHash(window.location.hash);
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return hash;
}

/** The addresses that show the components list, under which the scaffolding's panel still sits. */
const LIST = new Set(['', '#', '#/']);

export function App({
  bridge = resolveBridge(),
  environment = <Environment />,
  workspace = <Workspace />,
}: AppProps): React.JSX.Element {
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const hash = useHash();

  useEffect(() => {
    let current = true;
    void bridge.getPlatformInfo().then((info) => {
      if (current) setPlatform(info);
    });
    return () => {
      current = false;
    };
  }, [bridge]);

  return (
    <>
      <Header module={moduleOf(hash)} />
      <main className={styles['page']}>
        {workspace}
        {LIST.has(hash) && (
          <aside className={styles['scaffolding']}>
            {environment}
            <p>
              {platform === null
                ? 'Checking which delivery this is...'
                : `Running as ${platform.delivery} on ${platform.runtime}`}
            </p>
          </aside>
        )}
      </main>
    </>
  );
}
