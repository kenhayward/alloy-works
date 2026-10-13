import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useRef, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import styles from './Erase.module.css';

type Client = ReturnType<typeof createApiClient>;

/** A reason erasing is refused, as the service lists it (the ER plan, ER-C). */
interface ErasureRefusal {
  readonly code: string;
  readonly grants?: number | undefined;
}

interface Erasure {
  readonly person: { readonly invited: boolean };
  readonly erases: {
    readonly sessions: number;
    readonly tokens: number;
    readonly memberships: number;
    readonly invitation: boolean;
    readonly labels: number;
  };
  readonly remains: { readonly events: number };
  readonly refusals: readonly ErasureRefusal[];
}

const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Why they may not be erased yet, in words. */
export function erasureRefusalWords(refusal: ErasureRefusal): string {
  switch (refusal.code) {
    case 'granted':
      return refusal.grants === 1
        ? '1 grant names them: remove their access first.'
        : `${refusal.grants ?? 'Some'} grants name them: remove their access first.`;
    case 'self':
      return 'You cannot erase yourself.';
    case 'service':
      return 'A service is not a person, and is not erased.';
    default:
      return 'Something refuses it.';
  }
}

/** What goes, each where there is any. */
function goes(erasure: Erasure): string[] {
  const { erases } = erasure;
  return [
    'Their name, which becomes "Erased person" everywhere it is shown, and their address',
    `${counted(erases.labels, 'audit log label naming them', 'audit log labels naming them')}, each replaced by a fixed word, with those this erasure records`,
    ...(erases.sessions > 0 ? [`${counted(erases.sessions, 'session', 'sessions')}, ended`] : []),
    ...(erases.tokens > 0 ? [`${counted(erases.tokens, 'API token', 'API tokens')}, revoked`] : []),
    ...(erases.memberships > 0
      ? [`${counted(erases.memberships, 'group membership', 'group memberships')}, removed`]
      : []),
    ...(erasure.person.invited
      ? ['Their invitation, withdrawn']
      : erases.invitation
        ? ['The invitation that held their address']
        : []),
  ];
}

/** What stays, said whatever the counts (VER-038). */
function stays(erasure: Erasure): string[] {
  return [
    'Their identifier, and the one their provider gives them, so they can never sign in here again',
    `${counted(erasure.remains.events, 'audit event', 'audit events')} recorded against them, read with the fixed word`,
    'What they wrote: content, titles, comments and messages',
    'The name a data source saw them by, kept in the data but no longer shown',
    'Audit log exports made before now',
  ];
}

type Shown =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'read'; readonly erasure: Erasure };

/**
 * Asks before a person is erased (the ER plan, ER-F): what goes, what stays and every reason it may
 * not happen yet, read when it opens; **Erase** only where nothing refuses it.
 */
export function EraseDialog({
  client,
  id,
  name,
  onErased,
  onClose,
}: {
  client: Client;
  id: string;
  name: string;
  onErased: () => void;
  onClose: () => void;
}) {
  const heading = useId();
  const [shown, setShown] = useState<Shown>({ state: 'loading' });
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  // Held apart from the state, so a second press before the page redraws is still the one act.
  const acting = useRef(false);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/principals/{id}/erasure', { params: { path: { id } } })
      .then(({ data }) => {
        if (current) setShown(data ? { state: 'read', erasure: data } : { state: 'failed' });
      })
      .catch(() => current && setShown({ state: 'failed' }));
    return () => {
      current = false;
    };
  }, [client, id]);

  const erase = async () => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    const answer = await client
      .POST('/v1/principals/{id}/erase', { params: { path: { id } } })
      .catch(() => undefined);
    if (answer?.data) {
      onErased();
      return;
    }
    const refusals = (answer?.error as { refusals?: ErasureRefusal[] } | undefined)?.refusals;
    if (refusals && shown.state === 'read') {
      setShown({ state: 'read', erasure: { ...shown.erasure, refusals } });
    } else {
      setSaid(`${name} could not be erased. Try again.`);
    }
    acting.current = false;
    setBusy(false);
  };

  return (
    <Modal labelledBy={heading} size="dialog" onClose={onClose}>
      <div className={styles['erasing']}>
        <h2 id={heading}>{`Erase ${name}?`}</h2>
        {shown.state === 'loading' && <p>Reading what erasing them takes.</p>}
        {shown.state === 'failed' && <p>What erasing them takes could not be read.</p>}
        {shown.state === 'read' && (
          <>
            {shown.erasure.refusals.length > 0 && (
              <>
                <p>They cannot be erased while:</p>
                <ul className={styles['listed']}>
                  {shown.erasure.refusals.map((refusal) => (
                    <li key={refusal.code}>{erasureRefusalWords(refusal)}</li>
                  ))}
                </ul>
              </>
            )}
            <h3>What goes</h3>
            <ul className={styles['listed']}>
              {goes(shown.erasure).map((each) => (
                <li key={each}>{each}</li>
              ))}
            </ul>
            <h3>What stays</h3>
            <ul className={styles['listed']}>
              {stays(shown.erasure).map((each) => (
                <li key={each}>{each}</li>
              ))}
            </ul>
            <p>This cannot be undone.</p>
          </>
        )}
        <p role="status">{said}</p>
        <div className={styles['buttons']}>
          <button type="button" data-autofocus onClick={onClose}>
            Cancel
          </button>
          {shown.state === 'read' && shown.erasure.refusals.length === 0 && (
            <button type="button" className="danger" disabled={busy} onClick={() => void erase()}>
              Erase
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
