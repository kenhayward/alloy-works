import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  describeGrant,
  explainAnswer,
  isExplainedPermission,
  isShownGrant,
  isShownPerson,
  isShownRole,
  permissionName,
  personName,
  placesFor,
  refusalMessage,
  type ExplainedPermission,
  type Place,
  type ShownGrant,
  type ShownPerson,
  type ShownRole,
} from './describe.js';

type Client = ReturnType<typeof createApiClient>;

export interface AccessPanelProps {
  readonly componentId: string;
  readonly client: Client;
}

/** The grants at one level, or why they are not shown. */
type Listing =
  | { readonly state: 'loading' }
  /** The caller may not administer this level, or anything above it. */
  | { readonly state: 'unmanaged' }
  | { readonly state: 'unauthorized' }
  | { readonly state: 'failed' }
  | { readonly state: 'loaded'; readonly grants: readonly ShownGrant[] };

type Opened =
  | { readonly state: 'loading' }
  | { readonly state: 'missing' }
  | { readonly state: 'unauthorized' }
  | { readonly state: 'failed' }
  | { readonly state: 'unmanaged' }
  | {
      readonly state: 'open';
      readonly title: string;
      readonly places: readonly Place[];
      readonly people: readonly ShownPerson[];
      readonly roles: readonly ShownRole[];
    };

type Page<T> = { readonly items: readonly T[]; readonly next: string | null };

/** Every page of a listing, or the status the first page that failed was refused with. */
async function everyPage<T>(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ readonly data?: Page<T>; readonly response: Response }>,
): Promise<{ readonly items: T[] } | { readonly status: number }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const { data, response } = await fetchPage(cursor);
    if (!data) return { status: response.status };
    items.push(...data.items);
    if (data.next === null) return { items };
    cursor = data.next;
  }
}

const CHANGE_UNKNOWN =
  'Whether that was done could not be told. What is shown below is what the service now holds.';
// Unlike a lost response, a 409 or a 400 is the service answering: nothing was done, whatever its
// own message looked like.
const REFUSED_UNREADABLE = 'That was refused, for a reason that could not be shown.';
const SIGNED_OUT = 'You are signed out. Sign in again to manage access.';
const EXPLAIN_SIGNED_OUT = 'You are signed out. Sign in again to see what they may do.';
const EXPLAIN_REFUSED = 'You may no longer see what they may do.';
const EXPLAIN_UNREADABLE = 'What they may do could not be shown. Try again.';

/**
 * Access to one component (access.md, "Routes"): the grants made at the component, its space and the
 * whole environment - each shown only where the signed-in person may administer - with a way to give
 * a person a role at any of those levels and to remove a grant, and what a chosen person may do here
 * and why. Every list is read again from the service after each change, so what is shown is what the
 * service holds rather than what this page expected it to.
 */
export function AccessPanel({ componentId, client }: AccessPanelProps) {
  const [opened, setOpened] = useState<Opened>({ state: 'loading' });
  const [listings, setListings] = useState<ReadonlyMap<string, Listing>>(new Map());
  // Whether the lists are being read right now, whatever triggered it (the first load, a change, or
  // pressing a level's own Try again): a level already showing failed offers only one read at a time.
  const [readingGrants, setReadingGrants] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState('');
  const [role, setRole] = useState('');
  const [where, setWhere] = useState('');
  const [effect, setEffect] = useState<'allow' | 'deny'>('allow');
  const [explainFor, setExplainFor] = useState('');
  const [explainMessage, setExplainMessage] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<{
    readonly principal: string;
    readonly answers: readonly ExplainedPermission[];
  } | null>(null);
  // One change at a time from this page, checked before any await so a second submit that lands
  // before React has re-rendered the button disabled sends nothing.
  const pending = useRef(false);
  // Only the latest opening of the page, reading of the lists, and of an explanation, is ever shown:
  // an older answer that arrives late is dropped rather than put over a newer one.
  const opening = useRef(0);
  const reading = useRef(0);
  const explaining = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const readGrants = useCallback(
    async (places: readonly Place[]) => {
      const mine = ++reading.current;
      setReadingGrants(true);
      try {
        const read = await Promise.all(
          places.map(async (place): Promise<Listing> => {
            try {
              const answer = await everyPage<ShownGrant>((cursor) =>
                client.GET('/v1/grants', {
                  params: {
                    query: { level: place.target, limit: '100', ...(cursor ? { cursor } : {}) },
                  },
                }),
              );
              if ('items' in answer) {
                // A page that cannot describe a grant it is holding shows the same failure a lost
                // response would, rather than crash rendering it.
                return answer.items.every(isShownGrant)
                  ? { state: 'loaded', grants: answer.items }
                  : { state: 'failed' };
              }
              if (answer.status === 401) return { state: 'unauthorized' };
              return answer.status === 403 || answer.status === 404
                ? { state: 'unmanaged' }
                : { state: 'failed' };
            } catch {
              return { state: 'failed' };
            }
          }),
        );
        if (!mounted.current || mine !== reading.current) return;
        setListings(new Map(places.map((place, index) => [place.target, read[index]!])));
      } finally {
        if (mounted.current && mine === reading.current) setReadingGrants(false);
      }
    },
    [client],
  );

  const loadComponent = useCallback(async () => {
    const mine = ++opening.current;
    setOpened({ state: 'loading' });
    const target = `artifact:${componentId}`;
    try {
      const { data, response } = await client.GET('/v1/components/{id}', {
        params: { path: { id: componentId } },
      });
      if (!mounted.current || mine !== opening.current) return;
      if (!data) {
        if (response.status === 404) setOpened({ state: 'missing' });
        else if (response.status === 401) setOpened({ state: 'unauthorized' });
        else setOpened({ state: 'failed' });
        return;
      }
      // Choosing people and roles needs administer here or above: the most any level on this
      // component's chain can ask, so a refusal here means nothing on the page could be managed.
      const [people, roles] = await Promise.all([
        everyPage<ShownPerson>((cursor) =>
          client.GET('/v1/principals', {
            params: { query: { level: target, limit: '100', ...(cursor ? { cursor } : {}) } },
          }),
        ),
        everyPage<ShownRole>((cursor) =>
          client.GET('/v1/roles', {
            params: { query: { level: target, limit: '100', ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ]);
      if (!mounted.current || mine !== opening.current) return;
      const peopleOk = 'items' in people && people.items.every(isShownPerson);
      const rolesOk = 'items' in roles && roles.items.every(isShownRole);
      if (!peopleOk || !rolesOk) {
        const statuses = [people, roles].map((answer) =>
          'status' in answer ? answer.status : null,
        );
        if (statuses.includes(401)) setOpened({ state: 'unauthorized' });
        else if (statuses.some((status) => status === 403 || status === 404)) {
          setOpened({ state: 'unmanaged' });
        } else setOpened({ state: 'failed' });
        return;
      }
      const title = typeof data.content.title === 'string' ? data.content.title : 'Untitled';
      const places = placesFor(data);
      setOpened({ state: 'open', title, places, people: people.items, roles: roles.items });
      setWhere(places[0]!.target);
      await readGrants(places);
    } catch {
      if (mounted.current && mine === opening.current) setOpened({ state: 'failed' });
    }
  }, [client, componentId, readGrants]);

  useEffect(() => {
    void loadComponent();
  }, [loadComponent]);

  if (opened.state === 'loading') return <p>Opening...</p>;
  if (opened.state === 'missing') return <p>There is nothing here, or nothing you may read.</p>;
  if (opened.state === 'unauthorized') return <p>{SIGNED_OUT}</p>;
  if (opened.state === 'unmanaged') return <p>You may not manage access to this component.</p>;
  if (opened.state === 'failed') {
    return (
      <p>
        Access to this component could not be loaded.{' '}
        <button type="button" onClick={() => void loadComponent()}>
          Try again
        </button>
      </p>
    );
  }

  const { places, people, roles } = opened;
  const byId = new Map(people.map((each) => [each.id, each]));
  const manageable = places.filter((place) => listings.get(place.target)?.state === 'loaded');
  const effectiveWhere = manageable.some((place) => place.target === where) ? where : '';
  const named = (target: string) =>
    places.find((place) => place.target === target)?.named ?? target;

  /** A change, then the lists read again whatever happened: the service is what is shown. */
  const change = async (run: () => Promise<string>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    // What someone may do is about to change, so an explanation already shown would no longer be true.
    explaining.current += 1;
    setExplanation(null);
    setExplainMessage(null);
    try {
      const said = await run();
      if (mounted.current) setMessage(said);
    } catch {
      if (mounted.current) setMessage(CHANGE_UNKNOWN);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
      await readGrants(places);
    }
  };

  const refusal = (status: number, error: unknown, missing: string) => {
    if (status === 409 || status === 400) return refusalMessage(error) ?? REFUSED_UNREADABLE;
    if (status === 401) return SIGNED_OUT;
    if (status === 404) return missing;
    if (status === 403) return 'You may not manage access there.';
    return CHANGE_UNKNOWN;
  };

  const give = (event: React.FormEvent) => {
    event.preventDefault();
    if (person === '' || role === '' || effectiveWhere === '') {
      setMessage('Choose a person, a role and where.');
      return;
    }
    void change(async () => {
      const { data, error, response } = await client.POST('/v1/grants', {
        body: { role, subject: { principal: person }, level: effectiveWhere, effect },
      });
      if (data) {
        return isShownGrant(data.grant)
          ? `${describeGrant(data.grant)} on ${named(data.grant.level)}.`
          : 'That was granted, though what exactly could not be shown.';
      }
      return refusal(response.status, error, 'You may not manage access there.');
    });
  };

  const remove = (grant: ShownGrant) =>
    void change(async () => {
      const { data, error, response } = await client.DELETE('/v1/grants/{id}', {
        params: { path: { id: grant.id } },
      });
      if (data) return `Removed: ${describeGrant(grant)} on ${named(grant.level)}.`;
      return refusal(response.status, error, 'That grant is gone, or you may no longer manage it.');
    });

  const explain = async () => {
    const principal = explainFor;
    if (principal === '') return;
    const mine = ++explaining.current;
    setExplanation(null);
    setExplainMessage(null);
    try {
      const { data, response } = await client.GET('/v1/access/explain', {
        params: { query: { principal, target: `artifact:${componentId}` } },
      });
      if (!mounted.current || mine !== explaining.current) return;
      if (
        data &&
        Array.isArray(data.permissions) &&
        data.permissions.every(isExplainedPermission)
      ) {
        setExplanation({ principal, answers: data.permissions });
        return;
      }
      if (data) {
        setExplainMessage(EXPLAIN_UNREADABLE);
        return;
      }
      if (response.status === 401) setExplainMessage(EXPLAIN_SIGNED_OUT);
      else if (response.status === 403 || response.status === 404)
        setExplainMessage(EXPLAIN_REFUSED);
      else setExplainMessage(EXPLAIN_UNREADABLE);
    } catch {
      if (mounted.current && mine === explaining.current) setExplainMessage(EXPLAIN_UNREADABLE);
    }
  };

  const personOptions = people.map((each) => (
    <option key={each.id} value={each.id}>
      {personName(each)}
      {each.name !== null && each.email !== null ? ` (${each.email})` : ''}
      {each.kind === 'external' ? ', from outside the organisation' : ''}
    </option>
  ));

  return (
    <section aria-labelledby="access-heading">
      <h2 id="access-heading">Access to {opened.title}</h2>
      {places.map((place) => {
        const listing = listings.get(place.target) ?? { state: 'loading' };
        const heading = `access-${place.target.replace(':', '-')}`;
        return (
          <section key={place.target} aria-labelledby={heading}>
            <h3 id={heading}>{place.label}</h3>
            {listing.state === 'loading' && <p>Loading...</p>}
            {listing.state === 'unmanaged' && <p>You may not manage access here.</p>}
            {listing.state === 'unauthorized' && <p>{SIGNED_OUT}</p>}
            {listing.state === 'failed' && (
              <p>
                What is granted here could not be loaded.{' '}
                <button
                  type="button"
                  disabled={readingGrants}
                  onClick={() => void readGrants(places)}
                >
                  {readingGrants ? 'Reading...' : 'Try again'}
                </button>
              </p>
            )}
            {listing.state === 'loaded' &&
              (listing.grants.length === 0 ? (
                <p>Nothing is granted here.</p>
              ) : (
                <ul>
                  {listing.grants.map((grant) => (
                    <li key={grant.id}>
                      {describeGrant(grant)}{' '}
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Remove: ${describeGrant(grant)}`}
                        onClick={() => remove(grant)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </section>
        );
      })}

      <form aria-labelledby="give-heading" onSubmit={give}>
        <h3 id="give-heading">Give access</h3>
        <label>
          Person{' '}
          <select value={person} onChange={(event) => setPerson(event.target.value)}>
            <option value="">Choose a person</option>
            {personOptions}
          </select>
        </label>{' '}
        <label>
          Role{' '}
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">Choose a role</option>
            {roles.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}: {each.permissions.map(permissionName).join(', ')}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Where{' '}
          <select value={effectiveWhere} onChange={(event) => setWhere(event.target.value)}>
            {effectiveWhere === '' && <option value="">Choose where</option>}
            {manageable.map((place) => (
              <option key={place.target} value={place.target}>
                {place.label}
              </option>
            ))}
          </select>
        </label>{' '}
        <fieldset>
          <legend>Allow or deny</legend>
          <label>
            <input
              type="radio"
              name="effect"
              checked={effect === 'allow'}
              onChange={() => setEffect('allow')}
            />{' '}
            Allow
          </label>{' '}
          <label>
            <input
              type="radio"
              name="effect"
              checked={effect === 'deny'}
              onChange={() => setEffect('deny')}
            />{' '}
            Deny
          </label>
        </fieldset>
        <button type="submit" disabled={busy || manageable.length === 0}>
          Give
        </button>
      </form>
      {message !== null && <p role="status">{message}</p>}

      <section aria-labelledby="explain-heading">
        <h3 id="explain-heading">What someone may do here</h3>
        <label>
          Whose access{' '}
          <select
            value={explainFor}
            onChange={(event) => {
              explaining.current += 1;
              setExplanation(null);
              setExplainMessage(null);
              setExplainFor(event.target.value);
            }}
          >
            <option value="">Choose a person</option>
            {personOptions}
          </select>
        </label>{' '}
        <button type="button" disabled={explainFor === ''} onClick={() => void explain()}>
          Show
        </button>
        {explainMessage !== null && <p role="status">{explainMessage}</p>}
        {explanation && (
          <table>
            <caption>
              What {personName(byId.get(explanation.principal) ?? { name: null, email: null })} may
              do with this component
            </caption>
            <thead>
              <tr>
                <th scope="col">Permission</th>
                <th scope="col">Answer</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {explanation.answers.map((answer) => (
                <tr key={answer.permission}>
                  <th scope="row">{permissionName(answer.permission)}</th>
                  <td>{answer.allowed ? 'Allowed' : 'Refused'}</td>
                  <td>{explainAnswer(answer, places, byId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
