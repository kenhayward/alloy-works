import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import styles from './Administration.module.css';
import { words } from '../words/words.js';

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
    readonly expired?: boolean;
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
 * The day an extension is offered first: the day after the grant ends, or after today where it has
 * ended or never does - never the day it already ends, which would extend it by hours.
 */
const nextDay = (expiresAt: string | null) => {
  const from = Math.max(expiresAt === null ? 0 : new Date(expiresAt).getTime(), Date.now());
  return isoDay(new Date(from + 86_400_000).toISOString());
};

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

  const nameOf = (person: Reached['principal']) =>
    person.name ?? person.email ?? words('admin.somebody');
  const whereOf = (grant: Reached['grants'][number], reads: Reached['reads']) => {
    const [kind, id] = grant.level.split(':');
    if (kind === 'space')
      return reads.spaces.find((each) => each.id === id)?.name ?? words('admin.a-space');
    // A share names its publication (the R17 plan); a grant before R17 names nothing.
    const on = (grant as { on?: { kind: string; title: string | null } | null }).on;
    return on?.title ? `${on.title} (${on.kind})` : words('admin.one-item');
  };

  const extend = async (person: Reached, grant: Reached['grants'][number], where: string) => {
    setSaid('');
    setRefused('');
    const chosen = days[grant.id] ?? nextDay(grant.expiresAt);
    if (chosen === '') return;
    const { error } = await client.POST('/v1/grants/{id}/extension', {
      params: { path: { id: grant.id } },
      body: { expiresAt: `${chosen}T23:59:59.000Z` },
    });
    if (error) {
      setRefused(refusal(error, words('admin.the-access-could-not-be')));
      return;
    }
    setSaid(
      words('admin.extended-in-for-to', {
        name: grant.role.name,
        where,
        value3: nameOf(person.principal),
        value4: day.format(new Date(`${chosen}T00:00:00.000Z`)),
      }),
    );
    await read();
  };

  return (
    <section aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>{words('admin.from-outside-the-organisation')}</h2>
      <p role="status">{said}</p>
      {refused !== '' && <p role="alert">{refused}</p>}
      {listed === null && <p>{words('admin.reading-who-is-from-outside')}</p>}
      {listed === 'unread' && <p role="alert">{words('admin.who-is-from-outside-could')}</p>}
      {typeof listed === 'object' && listed !== null && listed.length === 0 && (
        <p>{words('admin.nobody-from-outside-the-organisation')}</p>
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
                ? words('admin.may-read-nothing-yet')
                : words('admin.may-read', {
                    value1: person.reads.spaces.map((each) => each.name).join(', '),
                  })}
            </p>
            <table aria-label={words('admin.what-reaches', { value1: nameOf(person.principal) })}>
              <thead>
                <tr>
                  <th scope="col">{words('admin.role')}</th>
                  <th scope="col">{words('admin.where')}</th>
                  <th scope="col">{words('admin.through')}</th>
                  <th scope="col">{words('admin.until')}</th>
                  <th scope="col">{words('admin.extend')}</th>
                </tr>
              </thead>
              <tbody>
                {person.grants.map((grant) => {
                  const where = whereOf(grant, person.reads);
                  const extendable = grant.effect === 'allow' && grant.group === null;
                  return (
                    <tr key={grant.id}>
                      <td>
                        {grant.role.name}
                        {grant.effect === 'deny' ? words('admin.denied') : ''}
                      </td>
                      <td>{where}</td>
                      <td>
                        {grant.group === null
                          ? words('admin.directly')
                          : words('admin.the-group', { name: grant.group.name })}
                      </td>
                      <td>
                        {grant.expiresAt === null
                          ? words('admin.no-end')
                          : `${grant.expired === true ? words('admin.ended-2') : ''}${day.format(new Date(grant.expiresAt))}`}
                      </td>
                      <td>
                        {extendable && (
                          <>
                            <label htmlFor={`${ids}-${grant.id}`} className={styles['hidden']}>
                              {words('admin.extend-in-to', { name: grant.role.name, where })}
                            </label>
                            <input
                              id={`${ids}-${grant.id}`}
                              type="date"
                              value={days[grant.id] ?? nextDay(grant.expiresAt)}
                              onChange={(event) =>
                                setDays((now) => ({ ...now, [grant.id]: event.target.value }))
                              }
                            />{' '}
                            <button
                              type="button"
                              disabled={(days[grant.id] ?? nextDay(grant.expiresAt)) === ''}
                              onClick={() => void extend(person, grant, where)}
                            >
                              {words('admin.extend')}
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
