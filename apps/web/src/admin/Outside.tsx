import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import styles from './Administration.module.css';

type Client = ReturnType<typeof createApiClient>;

/** Somebody from outside, as `GET /v1/access/external` lists them (IAM-051). */
interface Reached {
  readonly principal: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  };
  readonly grants: readonly {
    readonly id: string;
    readonly role: { readonly id: string; readonly name: string };
    readonly level: string;
    readonly effect: 'allow' | 'deny';
    readonly expiresAt: string | null;
    readonly group: { readonly id: string; readonly name: string } | null;
  }[];
  readonly reads: { readonly spaces: readonly { readonly id: string; readonly name: string }[] };
}

const day = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** The day a date picker holds for an instant, in UTC. */
const isoDay = (at: string) => at.slice(0, 10);

/**
 * Administration's **From outside** (IAM-050, IAM-051; the R13 plan, R13-E, R13-F): everybody from
 * outside the organisation, what each may read, every grant reaching them with its expiry, and
 * **Extend** on each allow made to them - a new grant to a later day, as the service holds it to the cap.
 */
export function Outside({ client }: { client: Client }) {
  const [listed, setListed] = useState<readonly Reached[] | 'unread' | null>(null);
  const [said, setSaid] = useState('');
  const [refused, setRefused] = useState('');
  const [days, setDays] = useState<Readonly<Record<string, string>>>({});
  const ids = useId();

  const read = useCallback(async () => {
    const { data } = await client.GET('/v1/access/external');
    setListed(data ? (data.items as readonly Reached[]) : 'unread');
  }, [client]);
  useEffect(() => {
    void read();
  }, [read]);

  const nameOf = (person: Reached['principal']) => person.name ?? person.email ?? 'Somebody';
  const whereOf = (level: string, reads: Reached['reads']) => {
    const [kind, id] = level.split(':');
    if (kind === 'space') return reads.spaces.find((each) => each.id === id)?.name ?? 'a space';
    return 'one item';
  };

  const extend = async (person: Reached, grant: Reached['grants'][number], where: string) => {
    setSaid('');
    setRefused('');
    const chosen = days[grant.id] ?? (grant.expiresAt === null ? '' : isoDay(grant.expiresAt));
    const { error } = await client.POST('/v1/grants/{id}/extension', {
      params: { path: { id: grant.id } },
      body: { expiresAt: `${chosen}T23:59:59.000Z` },
    });
    if (error) {
      setRefused(refusal(error, 'The access could not be extended.'));
      return;
    }
    setSaid(
      `Extended ${grant.role.name} in ${where} for ${nameOf(person.principal)} to ${day.format(new Date(`${chosen}T00:00:00.000Z`))}.`,
    );
    await read();
  };

  return (
    <section aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>From outside the organisation</h2>
      <p role="status">{said}</p>
      {refused !== '' && <p role="alert">{refused}</p>}
      {listed === null && <p>Reading who is from outside.</p>}
      {listed === 'unread' && <p role="alert">Who is from outside could not be read.</p>}
      {typeof listed === 'object' && listed !== null && listed.length === 0 && (
        <p>Nobody from outside the organisation has access.</p>
      )}
      {typeof listed === 'object' &&
        listed !== null &&
        listed.map((person) => (
          <section
            key={person.principal.id}
            aria-labelledby={`${ids}-${person.principal.id}`}
            className={styles['card']}
          >
            <h3 id={`${ids}-${person.principal.id}`}>{nameOf(person.principal)}</h3>
            {person.principal.email !== null && <p>{person.principal.email}</p>}
            <p>
              {person.reads.spaces.length === 0
                ? 'May read nothing yet.'
                : `May read: ${person.reads.spaces.map((each) => each.name).join(', ')}.`}
            </p>
            <table aria-label={`What reaches ${nameOf(person.principal)}`}>
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  <th scope="col">Where</th>
                  <th scope="col">Through</th>
                  <th scope="col">Until</th>
                  <th scope="col">Extend</th>
                </tr>
              </thead>
              <tbody>
                {person.grants.map((grant) => {
                  const where = whereOf(grant.level, person.reads);
                  const extendable = grant.effect === 'allow' && grant.group === null;
                  return (
                    <tr key={grant.id}>
                      <td>
                        {grant.role.name}
                        {grant.effect === 'deny' ? ', denied' : ''}
                      </td>
                      <td>{where}</td>
                      <td>{grant.group === null ? 'Directly' : `The group ${grant.group.name}`}</td>
                      <td>
                        {grant.expiresAt === null
                          ? 'No end'
                          : day.format(new Date(grant.expiresAt))}
                      </td>
                      <td>
                        {extendable && (
                          <>
                            <label htmlFor={`${ids}-${grant.id}`} className={styles['hidden']}>
                              {`Extend ${grant.role.name} in ${where} to`}
                            </label>
                            <input
                              id={`${ids}-${grant.id}`}
                              type="date"
                              value={
                                days[grant.id] ??
                                (grant.expiresAt === null ? '' : isoDay(grant.expiresAt))
                              }
                              onChange={(event) =>
                                setDays((now) => ({ ...now, [grant.id]: event.target.value }))
                              }
                            />{' '}
                            <button type="button" onClick={() => void extend(person, grant, where)}>
                              Extend
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
    </section>
  );
}
