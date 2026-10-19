import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { isShownPerson, personName, type ShownPerson } from '../access/describe.js';
import { everyPage } from '../paging.js';
import styles from './Administration.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Limits {
  readonly perHour: number | null;
  readonly people: readonly {
    readonly person: { readonly id: string; readonly name: string | null };
    readonly perHour: number;
  }[];
}

/** A whole number of runs an hour from what was typed, or null for none. */
const runsOf = (typed: string): number | null => {
  const value = Number(typed.trim());
  return typed.trim() === '' || !Number.isInteger(value) || value < 1 ? null : value;
};

/**
 * Administration's **Model spending** (generation.md, "Cost"; the G6 plan): how often each person may
 * call a model (GEN-035).
 */
export function ModelSpending({ client }: { client: Client }) {
  return <RateLimits client={client} />;
}

/** How many runs each person may start an hour, and a person's own in place of it (G6-A). */
function RateLimits({ client }: { client: Client }) {
  const [limits, setLimits] = useState<Limits | 'failed' | null>(null);
  const [each, setEach] = useState('');
  const [people, setPeople] = useState<readonly ShownPerson[]>([]);
  const [person, setPerson] = useState('');
  const [theirs, setTheirs] = useState('');
  const [said, setSaid] = useState('');

  const shown = (read: Limits) => {
    setLimits(read);
    setEach(read.perHour === null ? '' : String(read.perHour));
  };

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/model-limits')
      .then(({ data }) => {
        if (current) {
          if (data) shown(data);
          else setLimits('failed');
        }
      })
      .catch(() => {
        if (current) setLimits('failed');
      });
    everyPage<ShownPerson>((cursor) =>
      client.GET('/v1/principals', {
        params: { query: { level: 'tenant', ...(cursor ? { cursor } : {}) } },
      }),
    )
      .then((answer) => {
        if (current && 'items' in answer) {
          const listed = answer.items.filter(
            (one) => isShownPerson(one) && one.erased !== true && one.kind !== 'service',
          );
          setPeople(listed);
          if (listed[0]) setPerson(listed[0].id);
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const perHour = runsOf(each);
    const { data, error } = await client.PUT('/v1/model-limits', { body: { perHour } });
    if (data) {
      shown(data);
      setSaid(
        perHour === null
          ? 'Nobody is limited now.'
          : `Each person may start ${perHour} runs an hour.`,
      );
    } else setSaid(refusal(error, 'The limit could not be saved.'));
  };

  const setOwn = async (id: string, perHour: number | null, name: string) => {
    const { data, error } = await client.PUT('/v1/model-limits/people/{principal}', {
      params: { path: { principal: id } },
      body: { perHour },
    });
    if (data) {
      shown(data);
      setTheirs('');
      setSaid(
        perHour === null
          ? `${name} has the environment's limit again.`
          : `${name} may start ${perHour} runs an hour.`,
      );
    } else setSaid(refusal(error, 'Their limit could not be saved.'));
  };

  const chosen = people.find((one) => one.id === person);
  return (
    <section aria-label="Rate limits">
      <h2>Rate limits</h2>
      <div className={styles['lead']}>
        <p>
          How many model runs each person may start an hour. A run over it is refused, saying when
          one is free again. Testing an endpoint is never counted.
        </p>
      </div>
      {limits === 'failed' && <p>The limits could not be loaded.</p>}
      {limits !== null && limits !== 'failed' && (
        <>
          <form className={styles['toolbar']} onSubmit={(event) => void save(event)} noValidate>
            <label className={styles['filter']}>
              Runs an hour per person
              <input
                type="number"
                min={1}
                value={each}
                placeholder="Unlimited"
                onChange={(change) => setEach(change.target.value)}
              />
            </label>
            <button type="submit" className="primary">
              Save limit
            </button>
          </form>
          {limits.people.length === 0 ? (
            <p className={styles['muted']}>Nobody has a limit of their own.</p>
          ) : (
            <table aria-label="People with their own limit" className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Runs an hour</th>
                  <th scope="col">
                    <span className={styles['hidden']}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {limits.people.map((row) => {
                  const name = row.person.name ?? 'Someone with no name';
                  return (
                    <tr key={row.person.id}>
                      <td className={styles['strong']}>{name}</td>
                      <td>{row.perHour}</td>
                      <td>
                        <button
                          type="button"
                          aria-label={`Remove ${name}`}
                          onClick={() => void setOwn(row.person.id, null, name)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <form
            className={styles['toolbar']}
            aria-label="Set a person's own limit"
            onSubmit={(event) => {
              event.preventDefault();
              const perHour = runsOf(theirs);
              if (chosen && perHour !== null) void setOwn(chosen.id, perHour, personName(chosen));
            }}
            noValidate
          >
            <label className={styles['filter']}>
              Person
              <select value={person} onChange={(change) => setPerson(change.target.value)}>
                {people.map((one) => (
                  <option key={one.id} value={one.id}>
                    {personName(one)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles['filter']}>
              Their runs an hour
              <input
                type="number"
                min={1}
                value={theirs}
                onChange={(change) => setTheirs(change.target.value)}
              />
            </label>
            <button type="submit" disabled={!chosen || runsOf(theirs) === null}>
              Set theirs
            </button>
          </form>
        </>
      )}
      <p role="status">{said}</p>
    </section>
  );
}
