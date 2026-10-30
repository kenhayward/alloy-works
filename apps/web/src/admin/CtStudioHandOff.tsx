import { useEffect, useRef, useState } from 'react';

import styles from '../account/Tokens.module.css';
import { formats, words as say } from '../words/words.js';

/** The `.env` line CT Studio's bridge reads (docs/design/ct-studio-connect.md, "Hand-off page"). */
export function sinkEntry(sinkId: string, address: string): string {
  return `BRIDGE_SINKS=${JSON.stringify([
    { id: sinkId, url: `${address}/bridge`, key: '<the value of SINK_BRIDGE_KEYS>' },
  ])}`;
}

const when = (at: string) =>
  formats().date(new Date(at), { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * What CT Studio needs, to copy from: the token, shown this once and held only in this page's state;
 * the `.env` entry, the key a placeholder, since the signing key is a deployment secret; and the steps.
 * `first` is the first connection, all four steps; `later` a space after it, the target alone; `token`
 * a new token for the connection CT Studio has.
 */
export function CtStudioHandOff({
  kind,
  secret,
  expiresAt,
  sinkId,
  address,
  identity,
  space,
  onRevokeOld,
  onDone,
}: {
  kind: 'first' | 'later' | 'token';
  secret: string | null;
  expiresAt: string | null;
  sinkId: string;
  address: string;
  identity: string;
  space: { readonly id: string; readonly name: string } | null;
  onRevokeOld?: () => Promise<void>;
  onDone: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState('');

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setSaid(say('admin.copied'));
    } catch {
      setSaid(say('admin.select-it-and-copy-it-yourself'));
    }
  }

  const entry = sinkEntry(sinkId, address);
  return (
    <section aria-labelledby="ct-studio-hand-off">
      <h2 id="ct-studio-hand-off">{say('admin.what-ct-studio-needs')}</h2>
      {secret !== null && (
        <>
          <p className={styles['warning']}>{say('admin.copy-the-token-now-it-is-shown-once')}</p>
          <label className={styles['secret']}>
            {say('admin.token')}
            <input
              ref={field}
              readOnly
              value={secret}
              autoComplete="off"
              spellCheck={false}
              className={styles['code']}
            />
          </label>
          {expiresAt !== null && (
            <p>{say('admin.the-token-expires-on', { date: when(expiresAt) })}</p>
          )}
          <button type="button" onClick={() => void copy(secret)}>
            {say('admin.copy-the-token')}
          </button>
        </>
      )}
      {kind === 'first' && (
        <>
          <pre className={styles['code']}>{entry}</pre>
          <button type="button" onClick={() => void copy(entry)}>
            {say('admin.copy-the-entry')}
          </button>
        </>
      )}
      <ol aria-label={say('admin.in-ct-studio')}>
        {kind === 'first' && (
          <>
            <li>{say('admin.ct-studio-step-env')}</li>
            <li>{say('admin.ct-studio-step-certificate')}</li>
          </>
        )}
        {kind !== 'later' && (
          <li>{say('admin.ct-studio-step-connection', { sink: sinkId, identity })}</li>
        )}
        {kind !== 'token' && space !== null && (
          <li>{say('admin.ct-studio-step-target', { space: space.name, id: space.id })}</li>
        )}
      </ol>
      <p role="status">{said}</p>
      {onRevokeOld !== undefined && (
        <button
          type="button"
          onClick={() =>
            void onRevokeOld().then(
              () => setSaid(say('admin.the-old-token-is-revoked')),
              () => setSaid(say('admin.the-old-token-could-not-be-revoked')),
            )
          }
        >
          {say('admin.revoke-the-old-token')}
        </button>
      )}
      <button type="button" className="primary" onClick={onDone}>
        {say('admin.done')}
      </button>
    </section>
  );
}
