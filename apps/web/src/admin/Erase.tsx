import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useRef, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import styles from './Erase.module.css';
import { words } from '../words/words.js';

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
        ? words('admin.1-grant-names-them-remove')
        : words('admin.grants-name-them-remove-their', { value1: refusal.grants ?? 'Some' });
    case 'self':
      return words('admin.you-cannot-erase-yourself');
    case 'service':
      return words('admin.a-service-is-not-a');
    default:
      return words('admin.something-refuses-it');
  }
}

/** What goes, each where there is any. */
function goes(erasure: Erasure): string[] {
  const { erases } = erasure;
  return [
    words('admin.their-name-which-becomes-erased'),
    words('admin.each-replaced-by-a-fixed', {
      value1: counted(erases.labels, 'audit log label naming them', 'audit log labels naming them'),
    }),
    ...(erases.sessions > 0
      ? [words('admin.ended', { value1: counted(erases.sessions, 'session', 'sessions') })]
      : []),
    ...(erases.tokens > 0
      ? [words('admin.revoked', { value1: counted(erases.tokens, 'API token', 'API tokens') })]
      : []),
    ...(erases.memberships > 0
      ? [
          words('admin.removed', {
            value1: counted(erases.memberships, 'group membership', 'group memberships'),
          }),
        ]
      : []),
    ...(erasure.person.invited
      ? [words('admin.their-invitation-withdrawn')]
      : erases.invitation
        ? [words('admin.the-invitation-that-held-their')]
        : []),
  ];
}

/** What stays, said whatever the counts (VER-038). */
function stays(erasure: Erasure): string[] {
  return [
    words('admin.their-identifier-and-the-one'),
    words('admin.recorded-against-them-read-with', {
      value1: counted(erasure.remains.events, 'audit event', 'audit events'),
    }),
    words('admin.what-they-wrote-content-titles'),
    words('admin.the-name-a-data-source'),
    words('admin.audit-log-exports-made-before'),
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
      setSaid(words('admin.could-not-be-erased-try', { name }));
    }
    acting.current = false;
    setBusy(false);
  };

  return (
    <Modal labelledBy={heading} size="dialog" onClose={onClose}>
      <div className={styles['erasing']}>
        <h2 id={heading}>{words('admin.erase', { name })}</h2>
        {shown.state === 'loading' && <p>{words('admin.reading-what-erasing-them-takes')}</p>}
        {shown.state === 'failed' && <p>{words('admin.what-erasing-them-takes-could')}</p>}
        {shown.state === 'read' && (
          <>
            {shown.erasure.refusals.length > 0 && (
              <>
                <p>{words('admin.they-cannot-be-erased-while')}</p>
                <ul className={styles['listed']}>
                  {shown.erasure.refusals.map((refusal) => (
                    <li key={refusal.code}>{erasureRefusalWords(refusal)}</li>
                  ))}
                </ul>
              </>
            )}
            <h3>{words('admin.what-goes')}</h3>
            <ul className={styles['listed']}>
              {goes(shown.erasure).map((each) => (
                <li key={each}>{each}</li>
              ))}
            </ul>
            <h3>{words('admin.what-stays')}</h3>
            <ul className={styles['listed']}>
              {stays(shown.erasure).map((each) => (
                <li key={each}>{each}</li>
              ))}
            </ul>
            <p>{words('admin.this-cannot-be-undone')}</p>
          </>
        )}
        <p role="status">{said}</p>
        <div className={styles['buttons']}>
          <button type="button" data-autofocus onClick={onClose}>
            {words('admin.cancel')}
          </button>
          {shown.state === 'read' && shown.erasure.refusals.length === 0 && (
            <button type="button" className="danger" disabled={busy} onClick={() => void erase()}>
              {words('admin.erase-2')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
