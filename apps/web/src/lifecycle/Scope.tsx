import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { declaredAxes, type OfferedAxis } from '../editor/ConditionDialog.js';
import { Modal } from '../layouts/Modal.js';
import { Chip } from '../parts/Chip.js';
import styles from './Hold.module.css';

type Client = ReturnType<typeof createApiClient>;

type Party = {
  readonly kind: 'principal' | 'group';
  readonly id: string;
  readonly name: string | null;
};

/** A component's or document's scope, as its view gives it (workflow.md, Scopes; the R15 plan). */
export interface ScopeNow {
  readonly scope: readonly {
    readonly axis: string;
    readonly value: string;
    readonly party: Party | null;
  }[];
  readonly pending: readonly {
    readonly revision: number;
    readonly axis: string;
    readonly value: string;
    readonly party: Party;
    readonly mayAccept: boolean;
  }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A view's `scope`, read defensively: undefined from a view before R15. */
export function scopeIn(data: unknown): ScopeNow | undefined {
  if (!isRecord(data) || !isRecord(data.scope)) return undefined;
  const { scope, pending } = data.scope;
  return {
    scope: Array.isArray(scope) ? (scope as ScopeNow['scope']) : [],
    pending: Array.isArray(pending) ? (pending as ScopeNow['pending']) : [],
  };
}

const said = (axis: string, value: string) => `${axis} ${value}`;

/**
 * What a header says of its scope (LIF-042, LIF-047; R15-B, R15-E): the values a revision approved
 * from now is effective for, and each scope whose newest revision waits on its party, with **Accept**
 * to that party alone. Nothing where none is set and nothing waits.
 */
export function ScopeChips({
  client,
  kind,
  id,
  scope,
  onAccepted,
}: {
  client: Client;
  kind: 'component' | 'document';
  id: string;
  scope: ScopeNow | undefined;
  onAccepted: (scope: ScopeNow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState('');
  if (!scope) return null;
  const accept = async (each: ScopeNow['pending'][number]) => {
    setBusy(true);
    const options = {
      params: { path: { id } },
      body: { revision: each.revision, axis: each.axis, value: each.value },
    };
    const { data, error } = await (
      kind === 'component'
        ? client.POST('/v1/components/{id}/acceptance', options)
        : client.POST('/v1/documents/{id}/acceptance', options)
    ).catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    // Accepted there, it no longer waits.
    if (data) onAccepted({ ...scope, pending: scope.pending.filter((other) => other !== each) });
    else setRefused(refusal(error, 'It could not be accepted.'));
  };
  return (
    <>
      {scope.scope.length > 0 && (
        <Chip>{`Effective for ${scope.scope.map((each) => said(each.axis, each.value)).join(', ')}`}</Chip>
      )}
      {scope.pending.map((each) => (
        <span key={`${each.axis}:${each.value}`}>
          <Chip tone="info">
            {`Revision ${each.revision} waits on ${each.party.name ?? 'its party'} for ${said(each.axis, each.value)}; the revision before stays effective there`}
          </Chip>
          {each.mayAccept && (
            <button type="button" disabled={busy} onClick={() => void accept(each)}>
              {`Accept revision ${each.revision} for ${said(each.axis, each.value)}`}
            </button>
          )}
        </span>
      ))}
      {refused !== '' && <span role="alert">{refused}</span>}
    </>
  );
}

/**
 * **Effective for**, offered to whoever may edit it (LIF-042; R15-B): the condition axis values a
 * revision approved from now is effective for, each perhaps with the person who must accept it there;
 * none ticked is everywhere. Saved as one act, a refusal said in the service's words.
 */
export function ScopeButton({
  client,
  kind,
  id,
  title,
  scope,
  onSaved,
  className,
}: {
  client: Client;
  kind: 'component' | 'document';
  id: string;
  title: string;
  scope: ScopeNow;
  onSaved: (scope: ScopeNow) => void;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Effective for
      </button>
      {open && (
        <ScopeDialog
          client={client}
          kind={kind}
          id={id}
          title={title}
          scope={scope}
          onClose={() => setOpen(false)}
          onSaved={(now) => {
            setOpen(false);
            onSaved(now);
          }}
        />
      )}
    </>
  );
}

function ScopeDialog({
  client,
  kind,
  id,
  title,
  scope,
  onClose,
  onSaved,
}: {
  client: Client;
  kind: 'component' | 'document';
  id: string;
  title: string;
  scope: ScopeNow;
  onClose: () => void;
  onSaved: (scope: ScopeNow) => void;
}) {
  const headingId = useId();
  const [axes, setAxes] = useState<readonly OfferedAxis[] | 'unread' | null>(null);
  const [people, setPeople] = useState<readonly { id: string; name: string }[]>([]);
  // Each value ticked, by `axis:value`, with the person who accepts it there, or none.
  const [chosen, setChosen] = useState<ReadonlyMap<string, string>>(
    new Map(
      scope.scope.map((each) => [
        `${each.axis}:${each.value}`,
        each.party?.kind === 'principal' ? each.party.id : '',
      ]),
    ),
  );
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void declaredAxes(client)
      .then((read) => {
        if (current) setAxes(read);
      })
      .catch(() => {
        if (current) setAxes('unread');
      });
    void client
      .GET('/v1/people', { params: { query: { limit: '100' } } })
      .then(({ data }) => {
        if (current && data) setPeople(data.items);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  const toggle = (key: string) =>
    setChosen((now) => {
      const next = new Map(now);
      if (next.has(key)) next.delete(key);
      else next.set(key, '');
      return next;
    });
  const accepter = (key: string, person: string) =>
    setChosen((now) => new Map(now).set(key, person));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const body = {
      scope: [...chosen].map(([key, person]) => {
        const colon = key.indexOf(':');
        return {
          axis: key.slice(0, colon),
          value: key.slice(colon + 1),
          party: person === '' ? null : { kind: 'principal' as const, id: person },
        };
      }),
    };
    const options = { params: { path: { id } }, body };
    const { data, error } = await (
      kind === 'component'
        ? client.PUT('/v1/components/{id}/scope', options)
        : client.PUT('/v1/documents/{id}/scope', options)
    ).catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) onSaved(data);
    else setSaid(refusal(error, 'The scope could not be saved.'));
  };

  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void save(event)}>
        <h2 id={headingId}>{`Effective for: ${title}`}</h2>
        <p className={styles['muted']}>
          A revision approved from now is effective for the values ticked, and the revision before
          stays effective everywhere else. Tick none for everywhere.
        </p>
        {axes === null && <p role="status">Reading the condition axes.</p>}
        {axes === 'unread' && <p role="alert">The condition axes could not be read.</p>}
        {axes !== null && axes !== 'unread' && axes.length === 0 && (
          <p>No condition axes are declared yet.</p>
        )}
        {axes !== null &&
          axes !== 'unread' &&
          axes.map((axis) => (
            <fieldset key={axis.key}>
              <legend>{axis.name}</legend>
              {axis.values.map((value) => {
                const key = `${axis.key}:${value.key}`;
                return (
                  <div key={key}>
                    <label className={styles['choice']}>
                      <input
                        type="checkbox"
                        checked={chosen.has(key)}
                        onChange={() => toggle(key)}
                      />
                      {value.label}
                    </label>
                    {chosen.has(key) && (
                      <label>
                        {`Accepted in ${value.label} by`}
                        <select
                          value={chosen.get(key)}
                          onChange={(event) => accepter(key, event.target.value)}
                        >
                          <option value="">Nobody, effective as approved</option>
                          {people.map((each) => (
                            <option key={each.id} value={each.id}>
                              {each.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
            </fieldset>
          ))}
        <p role="status">{said}</p>
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
