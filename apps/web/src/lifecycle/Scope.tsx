import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { declaredAxes, type OfferedAxis } from '../editor/ConditionDialog.js';
import { Modal } from '../layouts/Modal.js';
import { Chip } from '../parts/Chip.js';
import styles from './Hold.module.css';
import { formats, words } from '../words/words.js';

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

/** No scope and nothing waiting: what a view before R15 is read as. */
export const NO_SCOPE: ScopeNow = { scope: [], pending: [] };

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

/** A scope by its axis and value keys, as a chip says it. */
const said = (axis: string, value: string) => words('lifecycle.axis-value', { axis, value });

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
    else setRefused(refusal(error, words('lifecycle.it-could-not-be-accepted')));
  };
  return (
    <>
      {scope.scope.length > 0 && (
        <Chip>
          {words('lifecycle.effective-for', {
            scopes: formats().list(
              scope.scope.map((each) => said(each.axis, each.value)),
              { type: 'unit' },
            ),
          })}
        </Chip>
      )}
      {scope.pending.map((each) => (
        <span key={`${each.axis}:${each.value}`}>
          <Chip tone="info">
            {words('lifecycle.revision-waits-on-for-the', {
              revision: each.revision,
              named: each.party.name === null ? 'no' : 'yes',
              party: each.party.name ?? '',
              scope: said(each.axis, each.value),
            })}
          </Chip>
          {each.mayAccept && (
            <button type="button" disabled={busy} onClick={() => void accept(each)}>
              {words('lifecycle.accept-revision-for', {
                revision: each.revision,
                scope: said(each.axis, each.value),
              })}
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
  mayEdit = true,
  line,
}: {
  client: Client;
  kind: 'component' | 'document';
  id: string;
  title: string;
  scope: ScopeNow;
  onSaved: (scope: ScopeNow) => void;
  className?: string | undefined;
  /** Whether the reader may set it: else the dialog asks what was effective alone. */
  mayEdit?: boolean;
  /** A divergent line's scope (R16-C), or undefined for the main line's. */
  line?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {words('lifecycle.effective-for-2')}
      </button>
      {open && (
        <ScopeDialog
          client={client}
          kind={kind}
          id={id}
          title={title}
          scope={scope}
          mayEdit={mayEdit}
          line={line}
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
  mayEdit,
  line,
  onClose,
  onSaved,
}: {
  client: Client;
  kind: 'component' | 'document';
  id: string;
  title: string;
  scope: ScopeNow;
  mayEdit: boolean;
  line: string | undefined;
  onClose: () => void;
  onSaved: (scope: ScopeNow) => void;
}) {
  const headingId = useId();
  const [axes, setAxes] = useState<readonly OfferedAxis[] | 'unread' | null>(null);
  const [people, setPeople] = useState<readonly { id: string; name: string }[]>([]);
  // Each value ticked, by `axis:value`, with who accepts it there as `<kind>:<id>`, or none.
  const [chosen, setChosen] = useState<ReadonlyMap<string, string>>(
    new Map(
      scope.scope.map((each) => [
        `${each.axis}:${each.value}`,
        each.party === null ? '' : `${each.party.kind}:${each.party.id}`,
      ]),
    ),
  );
  // A group a scope already names stays offered, so saving keeps it (the final review).
  const groups = [
    ...new Map(
      scope.scope.flatMap((each) =>
        each.party?.kind === 'group' ? [[each.party.id, each.party.name] as const] : [],
      ),
    ),
  ];
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
          party:
            person === ''
              ? null
              : {
                  kind: person.startsWith('group:') ? ('group' as const) : ('principal' as const),
                  id: person.slice(person.indexOf(':') + 1),
                },
        };
      }),
    };
    const options = {
      params: { path: { id } },
      body: { ...body, ...(line === undefined ? {} : { line }) },
    };
    const { data, error } = await (
      kind === 'component'
        ? client.PUT('/v1/components/{id}/scope', options)
        : client.PUT('/v1/documents/{id}/scope', options)
    ).catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) onSaved(data);
    else setSaid(refusal(error, words('lifecycle.the-scope-could-not-be')));
  };

  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onClose}>
      <h2 id={headingId} className={styles['heading']}>
        {words('lifecycle.effective-for-3', { title })}
      </h2>
      {mayEdit && (
        <form className={styles['form']} onSubmit={(event) => void save(event)}>
          <p className={styles['muted']}>{words('lifecycle.a-revision-approved-from-now')}</p>
          {axes === null && <p role="status">{words('lifecycle.reading-the-condition-axes')}</p>}
          {axes === 'unread' && (
            <p role="alert">{words('lifecycle.the-condition-axes-could-not')}</p>
          )}
          {axes !== null && axes !== 'unread' && axes.length === 0 && (
            <p>{words('lifecycle.no-condition-axes-are-declared')}</p>
          )}
          {axes !== null &&
            axes !== 'unread' &&
            axes.map((axis) => (
              <fieldset key={axis.key}>
                <legend data-content>{axis.name}</legend>
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
                        <span data-content>{value.label}</span>
                      </label>
                      {chosen.has(key) && (
                        <label>
                          {words('lifecycle.accepted-in-by', { label: value.label })}
                          <select
                            value={chosen.get(key)}
                            onChange={(event) => accepter(key, event.target.value)}
                          >
                            <option value="">
                              {words('lifecycle.nobody-effective-as-approved')}
                            </option>
                            {groups.map(([group, name]) => (
                              <option key={group} value={`group:${group}`}>
                                {words('lifecycle.group', {
                                  named: name === null ? 'no' : 'yes',
                                  name: name ?? '',
                                })}
                              </option>
                            ))}
                            {people.map((each) => (
                              <option key={each.id} value={`principal:${each.id}`}>
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
          {said !== '' && <p role="alert">{said}</p>}
          <div className={styles['buttons']}>
            <button type="button" onClick={onClose}>
              {words('lifecycle.cancel')}
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {words('lifecycle.save')}
            </button>
          </div>
        </form>
      )}
      <EffectiveAsk client={client} kind={kind} id={id} />
      {!mayEdit && (
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            {words('lifecycle.close')}
          </button>
        </div>
      )}
    </Modal>
  );
}

/** A local time from a `datetime-local` value, as an instant with the reader's offset (LIF-062). */
const instantOf = (local: string) => {
  const at = new Date(local);
  const minutes = -at.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const whole = Math.abs(minutes);
  const offset = `${sign}${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  return `${local}:00${offset}`;
};

/** Now as a `datetime-local` value, in the reader's own zone. */
const localNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/**
 * **What was effective** (LIF-043; R15-F), within Effective for, to every reader: a scope and a
 * moment asked, and the one revision effective there then said in words, so nobody needs engineering
 * help to know what applied at a plant on a day.
 */
function EffectiveAsk({
  client,
  kind,
  id,
}: {
  client: Client;
  kind: 'component' | 'document';
  id: string;
}) {
  const headingId = useId();
  const [axes, setAxes] = useState<readonly OfferedAxis[]>([]);
  const [where, setWhere] = useState('');
  const [when, setWhen] = useState(localNow());
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void declaredAxes(client)
      .then((read) => {
        if (current) setAxes(read);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  const named = (scope: string) => {
    const [axisKey, valueKey] = scope.split(':');
    const axis = axes.find((each) => each.key === axisKey);
    const value = axis?.values.find((each) => each.key === valueKey);
    return words('lifecycle.axis-named', {
      axis: axis?.name ?? axisKey ?? '',
      value: value?.label ?? valueKey ?? '',
    });
  };

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const query = {
      ...(where === '' ? {} : { scope: where }),
      ...(when === '' ? {} : { at: instantOf(when) }),
    };
    const options = { params: { path: { id }, query } };
    const { data } = await (
      kind === 'component'
        ? client.GET('/v1/components/{id}/effective', options)
        : client.GET('/v1/documents/{id}/effective', options)
    ).catch(() => ({ data: undefined }));
    setBusy(false);
    if (!data) {
      setAnswer(words('lifecycle.what-was-effective-could-not'));
      return;
    }
    if (data.revision === null) {
      setAnswer(words('lifecycle.nothing-was-approved-by-then'));
      return;
    }
    const revision = data.revision.number;
    setAnswer(
      data.why === 'scoped'
        ? words('lifecycle.effective-for-then', { revision, scope: named(where) })
        : where === ''
          ? words('lifecycle.effective-everywhere-then', { revision })
          : words('lifecycle.effective-everywhere-then-none-was', {
              revision,
              scope: named(where),
            }),
    );
  };

  return (
    <form
      className={styles['form']}
      aria-labelledby={headingId}
      onSubmit={(event) => void ask(event)}
    >
      <h3 id={headingId}>{words('lifecycle.what-was-effective')}</h3>
      <label>
        {words('lifecycle.where')}
        <select value={where} onChange={(event) => setWhere(event.target.value)}>
          <option value="">{words('lifecycle.everywhere')}</option>
          {axes.flatMap((axis) =>
            axis.values.map((value) => (
              <option key={`${axis.key}:${value.key}`} value={`${axis.key}:${value.key}`}>
                {words('lifecycle.axis-named', { axis: axis.name, value: value.label })}
              </option>
            )),
          )}
        </select>
      </label>
      <label>
        {words('lifecycle.when')}
        <input
          type="datetime-local"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
        />
      </label>
      <p role="status">{answer}</p>
      <div className={styles['buttons']}>
        <button type="submit" disabled={busy}>
          {words('lifecycle.ask')}
        </button>
      </div>
    </form>
  );
}
