import { useEffect, useState } from 'react';

import styles from './App.module.css';
import { Workspace } from './editor/Workspace.js';
import { Environment } from './Environment.js';
import { resolveBridge, type PlatformBridge, type PlatformInfo } from './platform/bridge.js';
import { CommandPalette, useCommandKey } from './shell/CommandPalette.js';
import { Header } from './shell/Header.js';
import { AboutContext } from './shell/about.js';
import { moduleOf } from './shell/moduleOf.js';
import { Rail } from './shell/Rail.js';
import { RegionKeys } from './shell/regions.js';
import { StatusProvider } from './shell/Status.js';
import { localeDataVersion } from './words/locale-data.js';
import { useWords } from './words/words.js';

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

export function App({
  bridge = resolveBridge(),
  environment = <Environment />,
  workspace = <Workspace />,
}: AppProps): React.JSX.Element {
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const hash = useHash();
  const [searching, setSearching] = useCommandKey();
  const { words } = useWords();

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
    // The status bar's owner: one live region for the application, at the foot of every page
    // (interface slice 15). The provider draws the bar after what it holds.
    <StatusProvider>
      {/* The scaffolding's environment panel and the delivery line live in Administration's About
          (interface slice 12), a page since ADR-0049. */}
      <AboutContext.Provider
        value={
          <div className={styles['scaffolding']}>
            {environment}
            <p>
              {platform === null
                ? words('app.delivery.checking')
                : words('app.delivery', { delivery: platform.delivery, runtime: platform.runtime })}
            </p>
            <p>{words('app.localeData', { version: localeDataVersion() })}</p>
            {/* A tab's own orderings are the browser's collation, said so (LOC-044). */}
            <p>{words('app.browser-collation')}</p>
          </div>
        }
      >
        <Header onSearch={() => setSearching(true)} />
        <div className={styles['frame']}>
          <Rail module={moduleOf(hash)} />
          <main className={styles['page']} data-app-region>
            {workspace}
          </main>
        </div>
        {searching && <CommandPalette onClose={() => setSearching(false)} />}
        <RegionKeys />
      </AboutContext.Provider>
    </StatusProvider>
  );
}
