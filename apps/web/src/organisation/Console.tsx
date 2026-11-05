import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useState } from 'react';

import styles from './Console.module.css';
import { Administration, sectionOf, type Section } from '../admin/Administration.js';
import { SignInAgain } from '../admin/Closure.js';
import { words, type WordKey } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface OrganisationTenant {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly since: string;
  readonly suspendedBy?: string | null;
  readonly closedBy: string | null;
  readonly graceEndsAt: string | null;
  readonly hostnames: readonly string[];
}

/** What an organisation's tenant has of Administration; the rest needs content (TL-K). */
const SECTIONS: readonly Section[] = ['people', 'groups', 'roles', 'sign-in', 'audit', 'export'];

/** What an organisation's tenant shows: its console, or the section of Administration asked for. */
export function OrganisationHome({ client }: { client: Client }): React.JSX.Element {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const follow = () => setHash(window.location.hash);
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return SECTIONS.includes(sectionOf(hash)) ? (
    <main data-app-region>
      <Administration client={client} about={null} only={SECTIONS} />
    </main>
  ) : (
    <Console client={client} />
  );
}

/**
 * An organisation's own console (IAM-068, IAM-069): its tenants, where each stands, and the acts it has
 * on them. What it sees of them is what the service returns, which is metadata and nothing else.
 */
export function Console({ client }: { client: Client }): React.JSX.Element {
  const [tenants, setTenants] = useState<readonly OrganisationTenant[] | null>(null);
  const [said, setSaid] = useState('');
  const [stopping, setStopping] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [stale, setStale] = useState(false);

  const read = useCallback(async () => {
    const { data, response } = await client.GET('/v1/organisation/tenants');
    if (data) setTenants(data.items);
    else if (response.status === 403) setSaid(words('organisation.no-permission'));
    else setSaid(words('organisation.could-not-read'));
  }, [client]);

  useEffect(() => {
    void read().catch(() => setSaid(words('organisation.could-not-read')));
  }, [read]);

  const did = async (act: () => Promise<{ response: Response; error?: unknown }>) => {
    setSaid('');
    setStale(false);
    try {
      const { response, error } = await act();
      setStale((error as { code?: string } | undefined)?.code === 'reauthentication_required');
      if (response.ok) {
        setStopping(null);
        setReason('');
        await read();
      } else setSaid(words('organisation.could-not-do'));
    } catch {
      setSaid(words('organisation.could-not-do'));
    }
  };

  const path = (id: string) => ({ params: { path: { id } } });

  return (
    <main className={styles['console']} data-app-region>
      <h1>{words('organisation.title')}</h1>
      <p>{words('organisation.lead')}</p>
      <nav aria-label={words('organisation.more')} className={styles['more']}>
        {SECTIONS.map((section) => (
          <a key={section} href={`#/admin/${section}`}>
            {words(`organisation.${section}` as WordKey)}
          </a>
        ))}
      </nav>
      <button
        type="button"
        onClick={() =>
          void client
            .POST('/v1/sign-out')
            .catch(() => undefined)
            .then(() => window.location.reload())
        }
      >
        {words('environment.closing-sign-out')}
      </button>
      {said !== '' && <p role="alert">{said}</p>}
      {stale && <SignInAgain client={client} />}
      {tenants?.length === 0 && <p>{words('organisation.none')}</p>}
      {tenants !== null && tenants.length > 0 && (
        <table aria-label={words('organisation.tenants')}>
          <thead>
            <tr>
              <th scope="col">{words('organisation.name')}</th>
              <th scope="col">{words('organisation.state')}</th>
              <th scope="col">{words('organisation.since')}</th>
              <th scope="col">{words('organisation.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr key={tenant.id}>
                <td>
                  {tenant.name}
                  <br />
                  <small>{tenant.hostnames.join(', ')}</small>
                </td>
                <td>{words(`organisation.state-${tenant.state}` as WordKey)}</td>
                <td>{new Date(tenant.since).toLocaleDateString()}</td>
                <td>
                  {tenant.state === 'active' && (
                    <button type="button" onClick={() => setStopping(tenant.id)}>
                      {words('organisation.suspend')}
                    </button>
                  )}
                  {tenant.state === 'suspended' && tenant.suspendedBy === 'operator' && (
                    <>{words('organisation.operators-suspension')}</>
                  )}
                  {tenant.state === 'suspended' && tenant.suspendedBy !== 'operator' && (
                    <button
                      type="button"
                      onClick={() =>
                        void did(() =>
                          client.DELETE(
                            '/v1/organisation/tenants/{id}/suspension',
                            path(tenant.id),
                          ),
                        )
                      }
                    >
                      {words('organisation.lift')}
                    </button>
                  )}
                  {(tenant.state === 'closing' || tenant.state === 'retained') &&
                    (tenant.closedBy === 'person' ? (
                      <button
                        type="button"
                        onClick={() =>
                          void did(() =>
                            client.DELETE('/v1/organisation/tenants/{id}/closure', path(tenant.id)),
                          )
                        }
                      >
                        {words('organisation.give-up')}
                      </button>
                    ) : (
                      words('organisation.operators-closure')
                    ))}
                  {stopping === tenant.id && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void did(() =>
                          client.POST('/v1/organisation/tenants/{id}/suspension', {
                            ...path(tenant.id),
                            body: { reason },
                          }),
                        );
                      }}
                    >
                      <label>
                        {words('organisation.why')}
                        <input value={reason} onChange={(event) => setReason(event.target.value)} />
                      </label>
                      <button type="submit" disabled={reason.trim() === ''}>
                        {words('organisation.suspend-it', { name: tenant.name })}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
