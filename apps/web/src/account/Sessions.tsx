import type { createApiClient, paths } from '@alloy-works/api-client';
import { useCallback, useEffect, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import { Chip } from '../parts/Chip.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import { moment, refusal } from './TokenTable.js';
import styles from './Tokens.module.css';

type Client = ReturnType<typeof createApiClient>;
type Session =
  paths['/v1/sessions']['get']['responses']['200']['content']['application/json']['sessions'][number];

/** How a session signed in, in words. */
const ROUTE_WORDS: Readonly<Record<Session['route'], string>> = {
  organisation: "Your organisation's sign-in",
  google: 'Google',
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
      if (response.ok || response.status === 404) setStatus('Ended that session.');
      else setStatus(refusal(error, 'That session could not be ended.'));
    } catch {
      setStatus('That session could not be ended.');
    }
    await load();
  };

  const endOthers = async () => {
    try {
      const { data, error } = await client.DELETE('/v1/sessions');
      if (data) {
        setStatus(
          data.ended === 1 ? 'Ended 1 other session.' : `Ended ${data.ended} other sessions.`,
        );
      } else setStatus(refusal(error, 'Your other sessions could not be ended.'));
    } catch {
      setStatus('Your other sessions could not be ended.');
    }
    await load();
  };

  const sessions = read === null || read === 'failed' ? null : read;
  const others = sessions === null ? 0 : sessions.filter((session) => !session.current).length;

  return (
    <Modal labelledBy="sessions-heading" onClose={onClose}>
      <div className={styles['tokens']}>
        <h2 id="sessions-heading">Sessions</h2>
        <p className={styles['muted']}>
          Everywhere you are signed in. End a session you do not recognise, or have left signed in
          elsewhere; whatever it was doing stops.
        </p>
        {read === null && <Waiting>Loading...</Waiting>}
        {read === 'failed' && (
          <Notice tone="failed">
            <p>Your sessions could not be loaded.</p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </Notice>
        )}
        {sessions !== null && (
          <div className={styles['holder']}>
            <table aria-label="Your sessions">
              <thead>
                <tr>
                  <th scope="col">Signed in with</th>
                  <th scope="col">Began</th>
                  <th scope="col">Last used</th>
                  <th scope="col">
                    <span className={styles['hidden']}>Actions</span>
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
                        <Chip tone="accent">This session</Chip>
                      ) : (
                        <button
                          type="button"
                          aria-label={`End the session begun ${moment(session.startedAt)}`}
                          onClick={() => void end(session)}
                        >
                          End
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
              End all other sessions
            </button>
          )}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
