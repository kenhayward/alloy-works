import { useEffect, useState } from 'react';

import type { ConnectRefusal, PlatformBridge } from '../platform/bridge.js';
import { useWords } from '../words/words.js';
import styles from './Connect.module.css';

/** The words of each refusal, by its reason. */
const REFUSED = {
  malformed: 'connect.refused.malformed',
  scheme: 'connect.refused.scheme',
  insecure: 'connect.refused.insecure',
  credentials: 'connect.refused.credentials',
  unreachable: 'connect.refused.unreachable',
  'no-environment': 'connect.refused.no-environment',
  'not-alloy-works': 'connect.refused.not-alloy-works',
} as const satisfies Record<ConnectRefusal, string>;

/**
 * The desktop's Connect to screen (the DR plan, DR-B; ADM-051): which environment the app uses, asked
 * on its first start, from the tray, and when the last one did not answer. The renderer from disk,
 * before any environment, so it stands alone and calls no service; the shell checks the address.
 */
export function Connect({
  connectTo,
  connectedTo,
  unreachable,
}: {
  connectTo: NonNullable<PlatformBridge['connectTo']>;
  connectedTo: string | undefined;
  unreachable: boolean;
}): React.JSX.Element {
  const { words } = useWords();
  const [address, setAddress] = useState('');
  const [state, setState] = useState<
    | { kind: 'asking' }
    | { kind: 'connecting'; origin: string | null }
    | { kind: 'refused'; reason: ConnectRefusal }
  >({ kind: 'asking' });

  // The address now in use, offered again, once the shell has said it.
  useEffect(() => {
    if (connectedTo !== undefined) setAddress((typed) => (typed === '' ? connectedTo : typed));
  }, [connectedTo]);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ kind: 'connecting', origin: null });
    let result: Awaited<ReturnType<typeof connectTo>>;
    try {
      result = await connectTo(address);
    } catch {
      // The shell could not be asked, or refused the asking: as good as no answer.
      result = { kind: 'refused', reason: 'unreachable' };
    }
    setState(
      result.kind === 'connected'
        ? { kind: 'connecting', origin: result.origin }
        : { kind: 'refused', reason: result.reason },
    );
  };

  const said =
    state.kind === 'refused'
      ? words(REFUSED[state.reason])
      : state.kind === 'asking' && unreachable && connectedTo !== undefined
        ? words('connect.unreachable', { address: connectedTo })
        : null;

  return (
    <main className={styles['connect']} data-app-region>
      <form className={styles['card']} onSubmit={(event) => void connect(event)}>
        <h1>{words('connect.title')}</h1>
        <p>{words('connect.lead')}</p>
        <label htmlFor="connect-address">{words('connect.address')}</label>
        <input
          id="connect-address"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          aria-describedby={said === null ? undefined : 'connect-said'}
        />
        {said !== null && (
          <p id="connect-said" role="alert" className={styles['refused']}>
            {said}
          </p>
        )}
        {state.kind === 'connecting' && state.origin !== null && (
          <p role="status">{words('connect.connecting', { address: state.origin })}</p>
        )}
        <button
          type="submit"
          className="primary"
          disabled={address.trim() === '' || state.kind === 'connecting'}
        >
          {words('connect.connect')}
        </button>
      </form>
    </main>
  );
}
