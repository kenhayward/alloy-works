import { useEffect, useState } from 'react';

import { Workspace } from './editor/Workspace.js';
import { Environment } from './Environment.js';
import { resolveBridge, type PlatformBridge, type PlatformInfo } from './platform/bridge.js';

interface AppProps {
  bridge?: PlatformBridge;
  /** The environment panel, which calls the service; given by tests that are not about it. */
  environment?: React.ReactNode;
  /** The components and the editor, which call the service; given by tests that are not about them. */
  workspace?: React.ReactNode;
}

export function App({
  bridge = resolveBridge(),
  environment = <Environment />,
  workspace = <Workspace />,
}: AppProps): React.JSX.Element {
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);

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
    <main>
      <h1>Alloy Works</h1>
      <p>
        {platform === null
          ? 'Checking which delivery this is...'
          : `Running as ${platform.delivery} on ${platform.runtime}`}
      </p>
      {environment}
      {workspace}
    </main>
  );
}
