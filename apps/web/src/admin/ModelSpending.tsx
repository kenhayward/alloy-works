import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { isShownPerson, personName, type ShownPerson } from '../access/describe.js';
import { everyPage } from '../paging.js';
import styles from './Administration.module.css';
import { formats, words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** An amount of money to the cent, in the reader's language. */
const cents = (amount: string | number) =>
  formats().number(Number(amount), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
      <Trend client={client} />
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

  const shown = (answer: Budget, recipientsToo = true) => {
    setRead(answer);
    if (answer.budget) {
      setCurrency(answer.budget.currency);
      setLimit(String(answer.budget.limit));
      setThresholds(answer.budget.thresholds.join(', '));
    }
    if (recipientsToo) setTold(new Set(answer.recipients.map((each) => each.id)));
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
      shown(data, false);
      setSaid(words('admin.the-budget-is-set-counting'));
    } else setSaid(refusal(error, words('admin.the-budget-could-not-be')));
  };

  const lift = async () => {
    const { data, error } = await client.PUT('/v1/model-budget', { body: { budget: null } });
    if (data) {
      shown(data, false);
      setSaid(words('admin.there-is-no-budget-now'));
    } else setSaid(refusal(error, words('admin.the-budget-could-not-be-2')));
  };

  const name = async () => {
    const { data, error } = await client.PUT('/v1/model-budget/recipients', {
      body: { principals: people.filter((one) => told.has(one.id)).map((one) => one.id) },
    });
    if (data) {
      shown(data);
      const count = data.recipients.length;
      setSaid(words('admin.people-are-told', { count: count }));
    } else setSaid(refusal(error, words('admin.who-is-told-could-not')));
  };

  return (
    <section aria-label={words('admin.budget')}>
      <h2>{words('admin.budget')}</h2>
      <div className={styles['lead']}>
        <p>{words('admin.what-the-environment-means-to')}</p>
        <p>{words('admin.when-it-is-spent-nothing')}</p>
      </div>
      {read === 'failed' && <p>{words('admin.the-budget-could-not-be-3')}</p>}
      {read !== null && read !== 'failed' && (
        <>
          <p>
            {read.budget
              ? words('admin.of-spent-in', {
                  currency,
                  spent: cents(read.spent),
                  limit: cents(read.budget.limit),
                  month: read.month,
                })
              : words('admin.no-budget-is-set-spent', {
                  currency,
                  spent: cents(read.spent),
                  month: read.month,
                })}
            {read.otherCurrencyRuns > 0 && (
              <>
                {' '}
                {words('admin.runs-cost-something-in-another', { runs: read.otherCurrencyRuns })}
              </>
            )}
          </p>
          <form
            className={styles['toolbar']}
            aria-label={words('admin.set-the-budget')}
            onSubmit={(event) => void save(event)}
            noValidate
          >
            <label className={styles['filter']}>
              {words('admin.currency')}
              <input value={currency} onChange={(change) => setCurrency(change.target.value)} />
            </label>
            <label className={styles['filter']}>
              {words('admin.monthly-limit')}
              <input
                type="number"
                min={0}
                step="any"
                value={limit}
                onChange={(change) => setLimit(change.target.value)}
              />
            </label>
            <label className={styles['filter']}>
              {words('admin.alert-at-percents')}
              <input value={thresholds} onChange={(change) => setThresholds(change.target.value)} />
            </label>
            <button type="submit" className="primary" disabled={!(Number(limit) > 0)}>
              {words('admin.save-budget')}
            </button>
            {read.budget && (
              <button type="button" onClick={() => void lift()}>
                {words('admin.lift-budget')}
              </button>
            )}
          </form>
          <fieldset className={styles['toolbar']}>
            <legend>{words('admin.told-through-the-inbox')}</legend>
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
                <span data-content>{personName(one)}</span>
              </label>
            ))}
            <button type="button" onClick={() => void name()}>
              {words('admin.save-who-is-told')}
            </button>
          </fieldset>
        </>
      )}
      <p role="status">{said}</p>
    </section>
  );
}

interface Usage {
  readonly months: readonly string[];
  readonly models: readonly {
    readonly month: string;
    readonly purpose: string;
    readonly runs: number;
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly tokensCached: number;
    readonly costs: readonly { readonly currency: string; readonly cost: string }[];
  }[];
  readonly queries: readonly {
    readonly month: string;
    readonly runs: number;
    readonly rows: number;
    readonly bytes: number;
  }[];
}

const PURPOSES: Readonly<Record<string, string>> = {
  get drafting() {
    return words('admin.drafting');
  },
  get chat() {
    return words('admin.conversations');
  },
  get summarising() {
    return words('admin.summarising');
  },
  get embedding() {
    return words('admin.embedding');
  },
  get trial() {
    return words('admin.prompt-trials');
  },
  get test() {
    return words('admin.endpoint-tests');
  },
};

/** Twelve months of use, by month and purpose, the oldest first (G6-F). */
function Trend({ client }: { client: Client }) {
  const [usage, setUsage] = useState<Usage | 'failed' | null>(null);
  useEffect(() => {
    let current = true;
    client
      .GET('/v1/model-usage')
      .then(({ data }) => {
        if (current) setUsage(data ?? 'failed');
      })
      .catch(() => {
        if (current) setUsage('failed');
      });
    return () => {
      current = false;
    };
  }, [client]);
  const count = (value: number) => formats().number(value);
  return (
    <section aria-label={words('admin.twelve-months')}>
      <h2>{words('admin.twelve-months')}</h2>
      {usage === 'failed' && <p>{words('admin.the-months-could-not-be')}</p>}
      {usage !== null && usage !== 'failed' && (
        <>
          {usage.models.length === 0 ? (
            <p className={styles['muted']}>{words('admin.no-model-has-been-called')}</p>
          ) : (
            <table aria-label={words('admin.model-use-by-month')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{words('admin.month')}</th>
                  <th scope="col">{words('admin.for')}</th>
                  <th scope="col">{words('admin.runs')}</th>
                  <th scope="col">{words('admin.tokens-in')}</th>
                  <th scope="col">{words('admin.from-the-cache')}</th>
                  <th scope="col">{words('admin.tokens-out')}</th>
                  <th scope="col">{words('admin.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {usage.models.map((row) => (
                  <tr key={`${row.month} ${row.purpose}`}>
                    <td>{row.month}</td>
                    <td>{PURPOSES[row.purpose] ?? row.purpose}</td>
                    <td>{count(row.runs)}</td>
                    <td>{count(row.tokensIn)}</td>
                    <td>{count(row.tokensCached)}</td>
                    <td>{count(row.tokensOut)}</td>
                    <td>
                      {formats().list(
                        row.costs.map((each) =>
                          words('admin.cost-in', { currency: each.currency, amount: cents(each.cost) }),
                        ),
                        { type: 'unit' },
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {usage.queries.length > 0 && (
            <table aria-label={words('admin.query-runs-by-month')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{words('admin.month')}</th>
                  <th scope="col">{words('admin.query-runs')}</th>
                  <th scope="col">{words('admin.rows')}</th>
                  <th scope="col">{words('admin.bytes')}</th>
                </tr>
              </thead>
              <tbody>
                {usage.queries.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{count(row.runs)}</td>
                    <td>{count(row.rows)}</td>
                    <td>{count(row.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
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
    // Only an empty box lifts the limit: anything else not a whole number of runs is said so.
    if (perHour === null && each.trim() !== '') {
      setSaid(words('admin.a-limit-is-a-whole'));
      return;
    }
    const { data, error } = await client.PUT('/v1/model-limits', { body: { perHour } });
    if (data) {
      shown(data);
      setSaid(
        perHour === null
          ? words('admin.nobody-is-limited-now')
          : words('admin.each-person-may-start-runs', { perHour }),
      );
    } else setSaid(refusal(error, words('admin.the-limit-could-not-be')));
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
          ? words('admin.has-the-environment-s-limit', { name })
          : words('admin.may-start-runs-an-hour', { name, perHour }),
      );
    } else setSaid(refusal(error, words('admin.their-limit-could-not-be')));
  };

  useEffect(() => {
    if (person === '' && people[0]) setPerson(people[0].id);
  }, [people, person]);

  const chosen = people.find((one) => one.id === person);
  return (
    <section aria-label={words('admin.rate-limits')}>
      <h2>{words('admin.rate-limits')}</h2>
      <div className={styles['lead']}>
        <p>{words('admin.how-many-model-runs-each')}</p>
      </div>
      {limits === 'failed' && <p>{words('admin.the-limits-could-not-be')}</p>}
      {limits !== null && limits !== 'failed' && (
        <>
          <form className={styles['toolbar']} onSubmit={(event) => void save(event)} noValidate>
            <label className={styles['filter']}>
              {words('admin.runs-an-hour-per-person')}
              <input
                type="number"
                min={1}
                value={each}
                placeholder={words('admin.unlimited')}
                onChange={(change) => setEach(change.target.value)}
              />
            </label>
            <button type="submit" className="primary">
              {words('admin.save-limit')}
            </button>
          </form>
          {limits.people.length === 0 ? (
            <p className={styles['muted']}>{words('admin.nobody-has-a-limit-of')}</p>
          ) : (
            <table
              aria-label={words('admin.people-with-their-own-limit')}
              className={styles['table']}
            >
              <thead>
                <tr>
                  <th scope="col">{words('admin.person')}</th>
                  <th scope="col">{words('admin.runs-an-hour')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{words('admin.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {limits.people.map((row) => {
                  const name = row.person.name ?? words('admin.someone-with-no-name');
                  return (
                    <tr key={row.person.id}>
                      <td
                        className={styles['strong']}
                        {...(row.person.name === null ? {} : { 'data-content': '' })}
                      >
                        {name}
                      </td>
                      <td>{formats().number(row.perHour)}</td>
                      <td>
                        <button
                          type="button"
                          aria-label={words('admin.remove', { name })}
                          onClick={() => void setOwn(row.person.id, null, name)}
                        >
                          {words('admin.remove-2')}
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
            aria-label={words('admin.set-a-person-s-own')}
            onSubmit={(event) => {
              event.preventDefault();
              const perHour = runsOf(theirs);
              if (chosen && perHour !== null) void setOwn(chosen.id, perHour, personName(chosen));
            }}
            noValidate
          >
            <label className={styles['filter']}>
              {words('admin.person')}
              <select value={person} onChange={(change) => setPerson(change.target.value)}>
                {people.map((one) => (
                  <option key={one.id} value={one.id} data-content>
                    {personName(one)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles['filter']}>
              {words('admin.their-runs-an-hour')}
              <input
                type="number"
                min={1}
                value={theirs}
                onChange={(change) => setTheirs(change.target.value)}
              />
            </label>
            <button type="submit" disabled={!chosen || runsOf(theirs) === null}>
              {words('admin.set-theirs')}
            </button>
          </form>
        </>
      )}
      <p role="status">{said}</p>
    </section>
  );
}
