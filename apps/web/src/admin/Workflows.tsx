import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';

type Client = ReturnType<typeof createApiClient>;

type Kind = 'component' | 'document' | 'queryDefinition' | 'prompt' | 'term';
type Permission = 'edit' | 'approve';

interface State {
  readonly key: string;
  readonly name: string;
  readonly initial: boolean;
  readonly approved: boolean;
}

interface Transition {
  readonly key: string;
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly permission: Permission;
  readonly reasonRequired: boolean;
  readonly gate?: Gate | undefined;
  readonly requires?: readonly Condition[] | undefined;
}

/** What a review day passing unmet does, and how long before it its owner is prompted (LIF-059). */
interface Review {
  readonly remind: number;
  readonly lapse:
    | { readonly kind: 'visibility' }
    | { readonly kind: 'move'; readonly to: string }
    | { readonly kind: 'escalate'; readonly to: string };
}

/** None declared: 30 days, and shown alone (ADR-0061). */
const NO_REVIEW: Review = { remind: 30, lapse: { kind: 'visibility' } };

/** What a transition may require before it is taken (LIF-004; the WF3 plan, WF3-A). */
type Condition =
  | 'suggestions'
  | 'threads'
  | 'bindings'
  | 'sections'
  | 'revisions'
  | 'components'
  | 'profile'
  | 'generated'
  | 'trial'
  | 'noRetracted';

/** Each condition, as a transition's row offers it: "Submit requires no open threads". */
const CONDITIONS: Readonly<Record<Condition, string>> = {
  suggestions: 'no unresolved suggestions',
  threads: 'no open threads',
  bindings: 'every binding resolved',
  sections: 'no required section missing',
  revisions: 'no value revised by hand outstanding',
  components: 'every component approved',
  // LIF-065 (the R11 plan, R11-G): every axis what the document keeps depends on, set.
  profile: 'every condition set in the profile',
  // GEN-025 (the G3 plan, G3-B): a part of "no unresolved suggestions", the generated ones alone.
  generated: 'no generated content waiting to be accepted',
  // GEN-045 (the G4 plan, G4-E): a prompt's approval attests a trial of it.
  trial: 'a finished trial run of the version',
  // LIB-036 (the XR plan, XR-H): a source its source says is retracted, cited by what is placed.
  noRetracted: 'no retracted sources cited',
};

/** What each kind's transitions may require: a query definition has nothing to (WF3-A). */
const CONDITIONS_OF: Readonly<Record<Kind, readonly Condition[]>> = {
  component: ['suggestions', 'threads', 'generated'],
  document: [
    'suggestions',
    'threads',
    'bindings',
    'sections',
    'revisions',
    'components',
    'profile',
    'generated',
    'noRetracted',
  ],
  queryDefinition: [],
  prompt: ['trial'],
  term: [],
};

/** A transition that is a gate (the WF2 plan, WF2-A). */
interface Gate {
  readonly approvals: number;
  readonly notAuthor?: boolean;
  readonly reject: { readonly name: string; readonly to: string };
  readonly designates?: boolean;
  readonly baseline?: boolean;
  readonly publication?: 'none' | 'permitted' | 'required';
}

/** A kind's workflow in force, and how many are in each state now (workflow.md, "Definitions"). */
interface Listed {
  readonly definition: {
    readonly kind: Kind;
    readonly version: number;
    readonly body: {
      readonly states: readonly State[];
      readonly transitions: readonly Transition[];
      readonly review?: Review | undefined;
    };
    readonly by: { readonly id: string; readonly name: string | null } | null;
    readonly at: string;
  };
  readonly counts: Readonly<Record<string, number>>;
}

/** A row being edited, with the name it is labelled by: what it was read or added as. */
type Edited<T> = T & { readonly label: string };

const KINDS: Readonly<Record<Kind, { heading: string; one: string }>> = {
  component: { heading: 'Components', one: 'Component' },
  document: { heading: 'Documents', one: 'Document' },
  queryDefinition: { heading: 'Query definitions', one: 'Query definition' },
  prompt: { heading: 'Prompts', one: 'Prompt' },
  term: { heading: 'Terms', one: 'Term' },
};

const PERMISSIONS: Readonly<Record<Permission, string>> = { edit: 'Edit', approve: 'Approve' };

const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** A stable key from a name: lower snake, starting with a letter, unique among `taken`. */
export function keyOf(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+|_+$/g, '')
      .slice(0, 56) || 'state';
  let key = base;
  for (let count = 2; taken.includes(key); count += 1) key = `${base}_${count}`;
  return key;
}

const labelled = <T extends { name: string }>(rows: readonly T[]): Edited<T>[] =>
  rows.map((row) => ({ ...row, label: row.name }));

/**
 * **Administration's Workflows** (LIF-001, LIF-002; the WF1 plan, WF-J): each kind's states, how many
 * are in each, and its transitions, each with what it needs and whether it asks for a reason; edited
 * here and saved as the kind's next version, in force at once.
 */
export function Workflows({ client }: { client: Client }) {
  const [load] = useState(() => async () => {
    const { data, response } = await client.GET('/v1/workflows');
    return data ? { items: data.workflows as Listed[] } : { status: response.status };
  });
  const [generation, setGeneration] = useState(0);
  const read = useListing<Listed>(load, true, generation);
  return (
    <>
      <div className={styles['lead']}>
        <p>
          Every component and document is in one state of its kind&apos;s workflow, and moves along
          its transitions by whoever each permits. A save here is the next version, in force at
          once; every version is kept.
        </p>
      </div>
      <Shown read={read} failed="The workflows could not be loaded.">
        {(rows) =>
          rows.map((listed) => (
            <KindWorkflow
              key={listed.definition.kind}
              client={client}
              listed={listed}
              onSaved={() => setGeneration((count) => count + 1)}
            />
          ))
        }
      </Shown>
    </>
  );
}

function KindWorkflow({
  client,
  listed,
  onSaved,
}: {
  client: Client;
  listed: Listed;
  onSaved: () => void;
}) {
  const { kind, version, body, by, at } = listed.definition;
  const { heading, one } = KINDS[kind];
  const headingId = useId();
  const [states, setStates] = useState(() => labelled(body.states));
  const [transitions, setTransitions] = useState(() => labelled(body.transitions));
  const [newState, setNewState] = useState('');
  const [newTransition, setNewTransition] = useState('');
  // The review policy, for a component's and a document's workflow (the WF5 plan, WF5-E).
  const [review, setReview] = useState<Review | undefined>(body.review);
  const [people, setPeople] = useState<readonly { id: string; name: string }[]>([]);
  const [said, setSaid] = useState('');
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  // A newer version read: edited from afresh.
  useEffect(() => {
    setStates(labelled(body.states));
    setTransitions(labelled(body.transitions));
  }, [body]);

  const changeState = (key: string, change: Partial<State>) =>
    setStates((was) => was.map((each) => (each.key === key ? { ...each, ...change } : each)));
  const changeTransition = (key: string, change: Partial<Transition>) =>
    setTransitions((was) => was.map((each) => (each.key === key ? { ...each, ...change } : each)));

  const addState = () => {
    const name = newState.trim();
    if (name === '') return;
    const key = keyOf(
      name,
      states.map((each) => each.key),
    );
    setStates((was) => [...was, { key, name, initial: false, approved: false, label: name }]);
    setNewState('');
  };
  const addTransition = () => {
    const name = newTransition.trim();
    if (name === '' || states.length === 0) return;
    const key = keyOf(
      name,
      transitions.map((each) => each.key),
    );
    const from = states[0]!.key;
    const to = (states[1] ?? states[0]!).key;
    setTransitions((was) => [
      ...was,
      { key, name, from, to, permission: 'edit', reasonRequired: false, label: name },
    ]);
    setNewTransition('');
  };

  const save = async () => {
    setBusy(true);
    setProblems([]);
    try {
      const { data, error } = await client.POST('/v1/workflows', {
        body: {
          kind,
          basedOn: version,
          states: states.map(({ label: _, ...each }) => each),
          ...(review === undefined ? {} : { review }),
          transitions: transitions.map(({ label: _, gate, requires, ...each }) => ({
            ...each,
            ...(gate === undefined ? {} : { gate }),
            ...(requires === undefined ? {} : { requires: [...requires] }),
          })),
        },
      });
      if (data) {
        setSaid(
          data.version === version
            ? `Nothing changed: version ${version} is in force.`
            : `Saved as version ${data.version}.`,
        );
        onSaved();
      } else {
        setSaid(refusal(error, 'The workflow could not be saved.'));
        const found = (error as { problems?: unknown } | undefined)?.problems;
        if (Array.isArray(found)) {
          setProblems(
            found.flatMap((each: unknown) =>
              typeof (each as { message?: unknown }).message === 'string'
                ? [(each as { message: string }).message]
                : [],
            ),
          );
        }
      }
    } catch {
      setSaid('The workflow could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const stateOptions = states.map((each) => (
    <option key={each.key} value={each.key}>
      {each.name}
    </option>
  ));

  return (
    <section aria-labelledby={headingId} className={styles['workflow']}>
      <h2 id={headingId}>{heading}</h2>
      <p className={styles['muted']}>
        {by === null
          ? `Version ${version}, as seeded`
          : `Version ${version}, saved by ${by.name ?? 'somebody'} on ${when.format(new Date(at))}`}
      </p>
      <table aria-label={`${one} states`} className={styles['table']}>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">Starts here</th>
            <th scope="col">Approved</th>
            <th scope="col">In it now</th>
            <th scope="col">
              <span className={styles['hidden']}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {states.map((state) => (
            <tr key={state.key}>
              <td>
                <input
                  aria-label={`Name of ${state.label}`}
                  value={state.name}
                  onChange={(change) => changeState(state.key, { name: change.target.value })}
                />
              </td>
              <td>
                <input
                  type="radio"
                  name={`${kind}-initial`}
                  aria-label={`${state.label} is where one starts`}
                  checked={state.initial}
                  onChange={() =>
                    setStates((was) =>
                      was.map((each) => ({ ...each, initial: each.key === state.key })),
                    )
                  }
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${state.label} counts as approved`}
                  checked={state.approved}
                  onChange={(change) => changeState(state.key, { approved: change.target.checked })}
                />
              </td>
              <td>{listed.counts[state.key] ?? 0}</td>
              <td>
                <button
                  type="button"
                  aria-label={`Remove the state ${state.label}`}
                  onClick={() => {
                    setStates((was) => was.filter((each) => each.key !== state.key));
                    setTransitions((was) =>
                      was.filter((each) => each.from !== state.key && each.to !== state.key),
                    );
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles['toolbar']}>
        <input
          aria-label="New state"
          placeholder="New state"
          value={newState}
          onChange={(change) => setNewState(change.target.value)}
        />
        <button type="button" onClick={addState}>
          Add state
        </button>
      </div>
      <table aria-label={`${one} transitions`} className={styles['table']}>
        <thead>
          <tr>
            <th scope="col">Transition</th>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Needs</th>
            <th scope="col">Reason</th>
            <th scope="col">Gate</th>
            {CONDITIONS_OF[kind].length > 0 && <th scope="col">Requires</th>}
            <th scope="col">
              <span className={styles['hidden']}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {transitions.map((transition) => (
            <tr key={transition.key}>
              <td>
                <input
                  aria-label={`Name of ${transition.label}`}
                  value={transition.name}
                  onChange={(change) =>
                    changeTransition(transition.key, { name: change.target.value })
                  }
                />
              </td>
              <td>
                <select
                  aria-label={`${transition.label} moves from`}
                  value={transition.from}
                  onChange={(change) =>
                    changeTransition(transition.key, { from: change.target.value })
                  }
                >
                  {stateOptions}
                </select>
              </td>
              <td>
                <select
                  aria-label={`${transition.label} moves to`}
                  value={transition.to}
                  onChange={(change) =>
                    changeTransition(transition.key, { to: change.target.value })
                  }
                >
                  {stateOptions}
                </select>
              </td>
              <td>
                <select
                  aria-label={`${transition.label} needs`}
                  value={transition.permission}
                  onChange={(change) =>
                    changeTransition(transition.key, {
                      permission: change.target.value as Permission,
                    })
                  }
                >
                  {(['edit', 'approve'] as const).map((permission) => (
                    <option key={permission} value={permission}>
                      {PERMISSIONS[permission]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${transition.label} asks for a reason`}
                  checked={transition.reasonRequired}
                  onChange={(change) =>
                    changeTransition(transition.key, { reasonRequired: change.target.checked })
                  }
                />
              </td>
              <td>
                <GateCell
                  kind={kind}
                  transition={transition}
                  stateOptions={stateOptions}
                  initial={states.find((each) => each.initial)?.key ?? transition.from}
                  onChange={(change) => changeTransition(transition.key, change)}
                />
              </td>
              {CONDITIONS_OF[kind].length > 0 && (
                <td>
                  <div className={styles['gate']}>
                    {CONDITIONS_OF[kind].map((condition) => (
                      <label key={condition}>
                        <input
                          type="checkbox"
                          aria-label={`${transition.label} requires ${CONDITIONS[condition]}`}
                          checked={transition.requires?.includes(condition) ?? false}
                          onChange={(change) => {
                            const was = transition.requires ?? [];
                            const now = CONDITIONS_OF[kind].filter((each) =>
                              each === condition ? change.target.checked : was.includes(each),
                            );
                            changeTransition(transition.key, {
                              requires: now.length === 0 ? undefined : now,
                            });
                          }}
                        />
                        {`${CONDITIONS[condition][0]!.toUpperCase()}${CONDITIONS[condition].slice(1)}`}
                      </label>
                    ))}
                  </div>
                </td>
              )}
              <td>
                <button
                  type="button"
                  aria-label={`Remove the transition ${transition.label}`}
                  onClick={() =>
                    setTransitions((was) => was.filter((each) => each.key !== transition.key))
                  }
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles['toolbar']}>
        <input
          aria-label="New transition"
          placeholder="New transition"
          value={newTransition}
          onChange={(change) => setNewTransition(change.target.value)}
        />
        <button type="button" onClick={addTransition}>
          Add transition
        </button>
      </div>
      {kind !== 'queryDefinition' && kind !== 'prompt' && kind !== 'term' && (
        <ReviewPolicy
          one={one}
          review={review ?? NO_REVIEW}
          states={states}
          people={people}
          onPeople={() => {
            if (people.length > 0) return;
            void client
              .GET('/v1/people', { params: { query: { limit: '100' } } })
              .then(({ data }) => data && setPeople(data.items))
              .catch(() => undefined);
          }}
          onChange={setReview}
        />
      )}
      <div className={styles['toolbar']}>
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          {`Save as version ${version + 1}`}
        </button>
      </div>
      <p role="status">{said}</p>
      {problems.length > 0 && (
        <ul>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Whether a transition is a gate, and if so how many approvers it needs, whether its authors are
 * refused, and what a rejection is called and returns to (the WF2 plan, WF2-A, WF2-L). A gate is taken
 * by approvers, so making one sets what it needs to Approve.
 */
function GateCell({
  kind,
  transition,
  stateOptions,
  initial,
  onChange,
}: {
  kind: Kind;
  transition: Transition & { label: string };
  stateOptions: React.ReactNode;
  initial: string;
  onChange: (change: Partial<Transition>) => void;
}) {
  const { gate, label } = transition;
  return (
    <div className={styles['gate']}>
      <input
        type="checkbox"
        aria-label={`${label} is a gate`}
        checked={gate !== undefined}
        onChange={(change) => {
          if (!change.target.checked) {
            onChange({ gate: undefined });
            return;
          }
          onChange({
            permission: 'approve',
            gate: {
              approvals: 1,
              notAuthor: true,
              reject: { name: 'Return', to: initial },
              designates: true,
              baseline: false,
              publication: 'none',
            },
          });
        }}
      />
      {gate && (
        <>
          <label>
            Approvers
            <select
              aria-label={`Approvers ${label} needs`}
              value={gate.approvals}
              onChange={(change) =>
                onChange({ gate: { ...gate, approvals: Number(change.target.value) } })
              }
            >
              {Array.from({ length: 10 }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              aria-label={`${label} refuses its authors`}
              checked={gate.notAuthor ?? false}
              onChange={(change) =>
                onChange({ gate: { ...gate, notAuthor: change.target.checked } })
              }
            />
            Not its authors
          </label>
          <input
            aria-label={`Rejecting ${label} is called`}
            value={gate.reject.name}
            onChange={(change) =>
              onChange({ gate: { ...gate, reject: { ...gate.reject, name: change.target.value } } })
            }
          />
          <select
            aria-label={`Rejecting ${label} returns to`}
            value={gate.reject.to}
            onChange={(change) =>
              onChange({ gate: { ...gate, reject: { ...gate.reject, to: change.target.value } } })
            }
          >
            {stateOptions}
          </select>
          {/* A document's gate may take a baseline (VER-059) and publish it (LIF-050). */}
          {kind === 'document' && (
            <>
              <label>
                <input
                  type="checkbox"
                  aria-label={`${label} takes a baseline`}
                  checked={gate.baseline ?? false}
                  onChange={(change) =>
                    onChange({
                      gate: {
                        ...gate,
                        baseline: change.target.checked,
                        ...(change.target.checked ? {} : { publication: 'none' as const }),
                      },
                    })
                  }
                />
                Takes a baseline
              </label>
              <select
                aria-label={`${label} publishes`}
                value={gate.publication ?? 'none'}
                disabled={!(gate.baseline ?? false)}
                onChange={(change) =>
                  onChange({
                    gate: {
                      ...gate,
                      publication: change.target.value as 'none' | 'permitted' | 'required',
                    },
                  })
                }
              >
                <option value="none">Publishes nothing</option>
                <option value="permitted">May publish</option>
                <option value="required">Publishes</option>
              </select>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A kind's review policy (LIF-017, LIF-059; the WF5 plan, WF5-E): how many days before a review-by day
 * its owner is prompted on Home, and what the day passing unmet does: shown alone, a move to a state,
 * or an escalation to a person.
 */
function ReviewPolicy({
  one,
  review,
  states,
  people,
  onPeople,
  onChange,
}: {
  one: string;
  review: Review;
  states: readonly State[];
  people: readonly { id: string; name: string }[];
  onPeople: () => void;
  onChange: (review: Review) => void;
}) {
  const { lapse } = review;
  useEffect(() => {
    if (lapse.kind === 'escalate') onPeople();
  }, [lapse.kind, onPeople]);
  return (
    <fieldset className={styles['gate']}>
      <legend>{`${one} reviews`}</legend>
      <label>
        Days before a review its owner is prompted
        <input
          type="number"
          min={0}
          max={365}
          value={review.remind}
          onChange={(change) =>
            onChange({
              ...review,
              remind: Math.max(0, Math.min(365, Number(change.target.value) || 0)),
            })
          }
        />
      </label>
      <label>
        When a review lapses
        <select
          value={lapse.kind}
          onChange={(change) => {
            const kind = change.target.value;
            onChange({
              ...review,
              lapse:
                kind === 'move'
                  ? { kind: 'move', to: states[0]?.key ?? '' }
                  : kind === 'escalate'
                    ? { kind: 'escalate', to: people[0]?.id ?? '' }
                    : { kind: 'visibility' },
            });
          }}
        >
          <option value="visibility">Show it as past review</option>
          <option value="move">Move it to a state</option>
          <option value="escalate">Escalate to a person</option>
        </select>
      </label>
      {lapse.kind === 'move' && (
        <select
          aria-label="A lapsed review moves it to"
          value={lapse.to}
          onChange={(change) =>
            onChange({ ...review, lapse: { kind: 'move', to: change.target.value } })
          }
        >
          {states.map((each) => (
            <option key={each.key} value={each.key}>
              {each.name}
            </option>
          ))}
        </select>
      )}
      {lapse.kind === 'escalate' && (
        <select
          aria-label="A lapsed review is escalated to"
          value={lapse.to}
          onChange={(change) =>
            onChange({ ...review, lapse: { kind: 'escalate', to: change.target.value } })
          }
        >
          {people.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </select>
      )}
    </fieldset>
  );
}
