import { useEffect, useRef, useState } from 'react';

import styles from './CtStudioHandOff.module.css';
import { formats, words as say } from '../words/words.js';

/** Where the entry holds the signing key, which is never shown here. */
const KEY_PLACEHOLDER = '<the value of SINK_BRIDGE_KEYS>';

/** The `.env` line CT Studio's bridge reads (docs/design/ct-studio-connect.md, "Hand-off page"). */
export function sinkEntry(sinkId: string, address: string): string {
  return `BRIDGE_SINKS=${JSON.stringify([
    { id: sinkId, url: `${address}/bridge`, key: KEY_PLACEHOLDER },
  ])}`;
}

const when = (at: string) =>
  formats().date(new Date(at), { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * What CT Studio needs, to copy from: the token, shown this once and held only in this page's state,
 * then the steps, each holding what it asks to be copied. Two secrets are named apart throughout: the
 * signing key, the same value as SINK_BRIDGE_KEYS on both sides and never shown here, which goes in
 * CT Studio's `.env` entry; and the token, which goes only in CT Studio's connection. `first` is the
 * first connection, every step; `later` a space after it, the target alone; `token` a new token for
 * the connection CT Studio has.
 */
export function CtStudioHandOff({
  kind,
  secret,
  expiresAt,
  sinkId,
  address,
  identity,
  space,
  bridgeOn,
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
  /** Whether this service runs with a signing key, so the first step finds it rather than makes it. */
  bridgeOn: boolean;
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
    <div className={styles['frame']}>
      <section aria-labelledby="ct-studio-hand-off" className={styles['handOff']}>
        <h2 id="ct-studio-hand-off">{say('admin.what-ct-studio-needs')}</h2>
        {secret !== null && (
          <div>
            <p className={styles['warning']}>{say('admin.copy-the-token-now-it-is-shown-once')}</p>
            <label>
              {say('admin.token')}
              <span className={styles['copyable']}>
                <input
                  ref={field}
                  readOnly
                  value={secret}
                  autoComplete="off"
                  spellCheck={false}
                  className={styles['code']}
                />
                <button type="button" onClick={() => void copy(secret)}>
                  {say('admin.copy-the-token')}
                </button>
              </span>
            </label>
            {expiresAt !== null && (
              <p>{say('admin.the-token-expires-on', { date: when(expiresAt) })}</p>
            )}
          </div>
        )}
        <ol aria-label={say('admin.in-ct-studio')} className={styles['steps']}>
          {kind === 'first' && (
            <>
              <li>
                {bridgeOn
                  ? say('admin.ct-studio-step-key-set')
                  : say('admin.ct-studio-step-key-unset')}
              </li>
              <li>
                {say('admin.ct-studio-step-entry', { placeholder: KEY_PLACEHOLDER })}
                <span className={styles['copyable']}>
                  <textarea
                    readOnly
                    value={entry}
                    aria-label={say('admin.ct-studios-bridge-sinks-entry')}
                    spellCheck={false}
                    className={`${styles['code']} ${styles['entry']}`}
                  />
                  <button type="button" onClick={() => void copy(entry)}>
                    {say('admin.copy-the-entry')}
                  </button>
                </span>
              </li>
              <li>{say('admin.ct-studio-step-certificate', { address })}</li>
              <li>{say('admin.ct-studio-step-connection', { sink: sinkId, identity })}</li>
            </>
          )}
          {kind === 'token' && <li>{say('admin.ct-studio-step-new-token', { sink: sinkId })}</li>}
          {kind !== 'token' && space !== null && (
            <li>{say('admin.ct-studio-step-target', { space: space.name, id: space.id })}</li>
          )}
        </ol>
        <p role="status">{said}</p>
        <div className={styles['actions']}>
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
        </div>
      </section>
    </div>
  );
}
