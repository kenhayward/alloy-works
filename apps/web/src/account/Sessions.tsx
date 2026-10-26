import type { createApiClient, paths } from '@alloy-works/api-client';
import { useCallback, useEffect, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import { Chip } from '../parts/Chip.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import { moment, refusal } from './TokenTable.js';
import styles from './Tokens.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;
type Session =
  paths['/v1/sessions']['get']['responses']['200']['content']['application/json']['sessions'][number];

/** How a session signed in, in words. */
const ROUTE_WORDS: Readonly<Record<Session['route'], string>> = {
  get organisation() {
    return words('account.your-organisation-s-sign-in');
  },
  get google() {
    return words('account.google');
  },
};

type Read = readonly Session[] | 'failed' | null;

/**
 * **Sessions, from the account chip** (IAM-040): a modal, as API tokens is. Every session of yours
 * that has not ended - how it signed in, when it began and was last used - this one marked, and each
 * other ended at a press, or all of them at once. Nothing tells a laptop from a phone: no device or
 * address is kept (AU-F).
 */
export function Sessions({ client, onClose }: { client: Client; onClose: () => void }) {
  const [read, setRead] = useState<Read>(null);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await client.GET('/v1/sessions');
      setRead(data ? data.sessions : 'failed');
    } catch {
      setRead('failed');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const end = async (session: Session) => {
    try {
      const { response, error } = await client.DELETE('/v1/sessions/{id}', {
        params: { path: { id: session.id } },
      });
      if (response.ok || response.status === 404) setStatus(words('account.ended-that-session'));
      else setStatus(refusal(error, words('account.that-session-could-not-be')));
    } catch {
      setStatus(words('account.that-session-could-not-be'));
    }
    await load();
  };

  const endOthers = async () => {
    try {
      const { data, error } = await client.DELETE('/v1/sessions');
      if (data) {
        setStatus(words('account.ended-other-sessions', { count: data.ended }));
      } else setStatus(refusal(error, words('account.your-other-sessions-could-not')));
    } catch {
      setStatus(words('account.your-other-sessions-could-not'));
    }
    await load();
  };

  const sessions = read === null || read === 'failed' ? null : read;
  const others = sessions === null ? 0 : sessions.filter((session) => !session.current).length;

  return (
    <Modal labelledBy="sessions-heading" onClose={onClose}>
      <div className={styles['tokens']}>
        <h2 id="sessions-heading">{words('account.sessions')}</h2>
        <p className={styles['muted']}>{words('account.everywhere-you-are-signed-in')}</p>
        {read === null && <Waiting>{words('account.loading')}</Waiting>}
        {read === 'failed' && (
          <Notice tone="failed">
            <p>{words('account.your-sessions-could-not-be')}</p>
            <button type="button" onClick={() => void load()}>
              {words('account.try-again')}
            </button>
          </Notice>
        )}
        {sessions !== null && (
          <div className={styles['holder']}>
            <table aria-label={words('account.your-sessions')}>
              <thead>
                <tr>
                  <th scope="col">{words('account.signed-in-with')}</th>
                  <th scope="col">{words('account.began')}</th>
                  <th scope="col">{words('account.last-used')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{words('account.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{ROUTE_WORDS[session.route]}</td>
                    <td>{moment(session.startedAt)}</td>
                    <td>{moment(session.lastActiveAt)}</td>
                    <td className={styles['act']}>
                      {session.current ? (
                        <Chip tone="accent">{words('account.this-session')}</Chip>
                      ) : (
                        <button
                          type="button"
                          aria-label={words('account.end-the-session-begun', {
                            began: moment(session.startedAt),
                          })}
                          onClick={() => void end(session)}
                        >
                          {words('account.end')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p role="status">{status}</p>
        <div className={styles['actions']}>
          {others > 0 && (
            <button type="button" className="danger" onClick={() => void endOthers()}>
              {words('account.end-all-other-sessions')}
            </button>
          )}
          <button type="button" onClick={onClose}>
            {words('account.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
