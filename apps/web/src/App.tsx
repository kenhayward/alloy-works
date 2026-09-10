import { createComponent } from '@alloy-works/domain';
import { useEffect, useState } from 'react';

import { resolveBridge, type PlatformBridge, type PlatformInfo } from './platform/bridge.js';

// A single component, built through the domain package, so the scaffold proves the whole path:
// domain rules -> renderer -> both deliveries. It is a placeholder for a content store, not a
// decision about one.
const sample = createComponent({
  type: 'topic',
  title: 'Install the printer',
  body: 'Unbox the printer, connect it to power, then run the setup assistant.',
});

interface AppProps {
  bridge?: PlatformBridge;
}

export function App({ bridge = resolveBridge() }: AppProps): React.JSX.Element {
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
      <article>
        <h2>{sample.title}</h2>
        <p>{sample.body}</p>
        <p>
          {sample.type} - version {sample.version}
        </p>
      </article>
    </main>
  );
}
