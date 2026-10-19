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

interface Budget {
  readonly budget: {
    readonly currency: string;
    readonly limit: number;
    readonly thresholds: readonly number[];
  } | null;
  readonly month: string;
  readonly spent: string;
  readonly otherCurrencyRuns: number;
  readonly recipients: readonly { readonly id: string; readonly name: string | null }[];
}

/**
 * Administration's **Model spending** (generation.md, "Cost"; the G6 plan): the monthly budget and who
 * is told as it is spent (GEN-034, ADM-013, ADM-014, ADM-034), and how often each person may call a
 * model (GEN-035).
 */
export function ModelSpending({ client }: { client: Client }) {
  const [people, setPeople] = useState<readonly ShownPerson[]>([]);
  useEffect(() => {
    let current = true;
    everyPage<ShownPerson>((cursor) =>
      client.GET('/v1/principals', {
        params: { query: { level: 'tenant', ...(cursor ? { cursor } : {}) } },
      }),
    )
      .then((answer) => {
        if (current && 'items' in answer) {
          setPeople(
            answer.items.filter(
              (one) => isShownPerson(one) && one.erased !== true && one.kind === 'user',
            ),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);
  return (
    <>
      <MonthlyBudget client={client} people={people} />
      <RateLimits client={client} people={people} />
    </>
  );
}

/** Thresholds from what was typed: whole percents, in the order typed. */
const thresholdsOf = (typed: string) =>
  typed
    .split(/[ ,%]+/u)
    .filter((part) => part !== '')
    .map(Number);

/** The monthly budget, what is spent, and who is told (G6-B to G6-D). */
function MonthlyBudget({ client, people }: { client: Client; people: readonly ShownPerson[] }) {
  const [read, setRead] = useState<Budget | 'failed' | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [limit, setLimit] = useState('');
  const [thresholds, setThresholds] = useState('50, 80, 100');
  const [told, setTold] = useState<ReadonlySet<string>>(new Set());
  const [said, setSaid] = useState('');

  const shown = (answer: Budget) => {
    setRead(answer);
    if (answer.budget) {
      setCurrency(answer.budget.currency);
      setLimit(String(answer.budget.limit));
      setThresholds(answer.budget.thresholds.join(', '));
    }
    setTold(new Set(answer.recipients.map((each) => each.id)));
  };

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/model-budget')
      .then(({ data }) => {
        if (current) {
          if (data) shown(data);
          else setRead('failed');
        }
      })
      .catch(() => {
        if (current) setRead('failed');
      });
    return () => {
      current = false;
    };
  }, [client]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const { data, error } = await client.PUT('/v1/model-budget', {
      body: {
        budget: {
          currency: currency.trim().toUpperCase(),
          limit: Number(limit),
          thresholds: thresholdsOf(thresholds),
        },
      },
    });
    if (data) {
      shown(data);
      setSaid('The budget is set, counting from this month.');
    } else setSaid(refusal(error, 'The budget could not be set.'));
  };

  const lift = async () => {
    const { data, error } = await client.PUT('/v1/model-budget', { body: { budget: null } });
    if (data) {
      shown(data);
      setSaid('There is no budget now.');
    } else setSaid(refusal(error, 'The budget could not be lifted.'));
  };

  const name = async () => {
    const { data, error } = await client.PUT('/v1/model-budget/recipients', {
      body: { principals: people.filter((one) => told.has(one.id)).map((one) => one.id) },
    });
    if (data) {
      shown(data);
      const count = data.recipients.length;
      setSaid(count === 1 ? '1 person is told.' : `${count} people are told.`);
    } else setSaid(refusal(error, 'Who is told could not be saved.'));
  };

  const money = (amount: string | number) => `${currency} ${Number(amount).toFixed(2)}`;
  return (
    <section aria-label="Budget">
      <h2>Budget</h2>
      <div className={styles['lead']}>
        <p>
          What the environment means to spend on models a month, and the percents of it at which the
          people named here are told, in their inbox.
        </p>
        <p>When it is spent, nothing stops: every capability continues.</p>
      </div>
      {read === 'failed' && <p>The budget could not be loaded.</p>}
      {read !== null && read !== 'failed' && (
        <>
          <p>
            {read.budget
              ? `${money(read.spent)} of ${money(read.budget.limit)} spent in ${read.month}.`
              : `No budget is set. ${money(read.spent)} spent in ${read.month}.`}
            {read.otherCurrencyRuns > 0 &&
              ` ${read.otherCurrencyRuns} runs cost something in another currency, counted in no budget.`}
          </p>
          <form
            className={styles['toolbar']}
            aria-label="Set the budget"
            onSubmit={(event) => void save(event)}
            noValidate
          >
            <label className={styles['filter']}>
              Currency
              <input value={currency} onChange={(change) => setCurrency(change.target.value)} />
            </label>
            <label className={styles['filter']}>
              Monthly limit
              <input
                type="number"
                min={0}
                step="any"
                value={limit}
                onChange={(change) => setLimit(change.target.value)}
              />
            </label>
            <label className={styles['filter']}>
              Alert at percents
              <input value={thresholds} onChange={(change) => setThresholds(change.target.value)} />
            </label>
            <button type="submit" className="primary" disabled={!(Number(limit) > 0)}>
              Save budget
            </button>
            {read.budget && (
              <button type="button" onClick={() => void lift()}>
                Lift budget
              </button>
            )}
          </form>
          <fieldset className={styles['toolbar']}>
            <legend>Told, through the inbox</legend>
            {people.map((one) => (
              <label key={one.id} className={styles['filter']}>
                <input
                  type="checkbox"
                  checked={told.has(one.id)}
                  onChange={(change) => {
                    const next = new Set(told);
                    if (change.target.checked) next.add(one.id);
                    else next.delete(one.id);
                    setTold(next);
                  }}
                />
                {personName(one)}
              </label>
            ))}
            <button type="button" onClick={() => void name()}>
              Save who is told
            </button>
          </fieldset>
        </>
      )}
      <p role="status">{said}</p>
    </section>
  );
}

/** How many runs each person may start an hour, and a person's own in place of it (G6-A). */
function RateLimits({ client, people }: { client: Client; people: readonly ShownPerson[] }) {
  const [limits, setLimits] = useState<Limits | 'failed' | null>(null);
  const [each, setEach] = useState('');
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

  useEffect(() => {
    if (person === '' && people[0]) setPerson(people[0].id);
  }, [people, person]);

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
