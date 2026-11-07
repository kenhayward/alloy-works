import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState, type FormEvent } from 'react';

import { everyPage } from '../paging.js';
import { Chip } from '../parts/Chip.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import { formats, words } from '../words/words.js';
import styles from './Administration.module.css';
import { notYours } from './listing.js';

type Client = ReturnType<typeof createApiClient>;

export type SupportScope = 'diagnostics' | 'metadata' | 'content';
const SCOPES: readonly SupportScope[] = ['diagnostics', 'metadata', 'content'];

interface Named {
  readonly id: string;
  readonly name: string | null;
}

/** A support grant as `GET /v1/support-access` lists it (support.md, "Seen while active"). */
export interface SupportRow {
  readonly id: string;
  readonly person: { readonly id: string; readonly name: string | null; readonly email: string };
  readonly scope: SupportScope;
  readonly spaces: readonly string[];
  readonly purpose: string;
  readonly expiresAt: string;
  readonly grantedBy: Named;
  readonly grantedAt: string;
  readonly revokedAt: string | null;
  readonly revokedBy: Named | null;
  readonly revokedReason: 'revoked' | 'cap_lowered' | null;
  readonly active: boolean;
}

interface Listing {
  readonly items: readonly SupportRow[];
  readonly active: number;
  readonly defaultDays: number;
  readonly capDays: number;
}

/** A scope's name, as a heading or a cell says it. */
export const scopeName = (scope: SupportScope): string =>
  ({
    diagnostics: words('admin.support-scope.diagnostics'),
    metadata: words('admin.support-scope.metadata'),
    content: words('admin.support-scope.content'),
  })[scope];

/** What a scope lets them see, in plain words, beside its choice. */
const scopeExplained = (scope: SupportScope): string =>
  ({
    diagnostics: words('admin.support-scope-explained.diagnostics'),
    metadata: words('admin.support-scope-explained.metadata'),
    content: words('admin.support-scope-explained.content'),
  })[scope];

/** The service's refusals of a grant, each as a sentence (the contract's 409 codes). */
const REFUSED: Readonly<Record<string, () => string>> = {
  support_member: () => words('admin.support-refused.member'),
  support_kind_differs: () => words('admin.support-refused.kind-differs'),
  support_signed_in: () => words('admin.support-refused.signed-in'),
  support_erased: () => words('admin.support-refused.erased'),
  support_active: () => words('admin.support-refused.active'),
  support_expiry_past: () => words('admin.support-refused.expiry-past'),
  support_past_cap: () => words('admin.support-refused.past-cap'),
  support_spaces_required: () => words('admin.support-refused.spaces-required'),
  support_space_missing: () => words('admin.support-refused.space-missing'),
};

const when = (at: string) =>
  formats().date(new Date(at), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const personOf = (row: SupportRow) => row.person.name ?? row.person.email;
const named = (who: Named) => who.name ?? words('admin.somebody');

/** Every support grant, read again at each `generation`; undefined while read, null where refused. */
export function useSupportListing(
  client: Client,
  enabled: boolean,
  generation: number,
): Listing | 'refused' | 'failed' | null | undefined {
  const [read, setRead] = useState<Listing | 'refused' | 'failed' | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    client
      .GET('/v1/support-access')
      .then(({ data, response }) => {
        if (!current) return;
        if (data) setRead(data as Listing);
        else setRead(response.status === 403 ? 'refused' : 'failed');
      })
      .catch(() => {
        if (current) setRead('failed');
      });
    return () => {
      current = false;
    };
  }, [client, enabled, generation]);
  return read;
}

/** Each space's name by its id, for the spaces a grant names. */
export function useSpaceNames(client: Client, enabled: boolean): ReadonlyMap<string, string> {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    everyPage<{ id: string; name: string }>((cursor) =>
      client.GET('/v1/spaces', {
        params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
      }),
    )
      .then((answer) => {
        if (current && 'items' in answer) {
          setNames(new Map(answer.items.map((each) => [each.id, each.name])));
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, enabled]);
  return names;
}

const spacesOf = (row: SupportRow, names: ReadonlyMap<string, string>) =>
  formats().list(row.spaces.map((id) => names.get(id) ?? words('admin.a-space-you-cannot-see')));

/**
 * Support access active now, at the top of every section for every administrator (ADM-025; SA-G):
 * who, what scope and until when, with the way to the section that ends it.
 */
export function ActiveSupport({
  client,
  enabled,
  generation,
}: {
  client: Client;
  enabled: boolean;
  generation: number;
}) {
  const read = useSupportListing(client, enabled, generation);
  const active =
    typeof read === 'object' && read !== null ? read.items.filter((each) => each.active) : [];
  const names = useSpaceNames(client, active.length > 0);
  if (active.length === 0) return null;
  return (
    <Notice tone="support">
      <div role="status" aria-label={words('admin.support-access-active')}>
        {active.map((row) => (
          <p key={row.id}>
            {row.scope === 'diagnostics'
              ? words('admin.support-active-diagnostics', {
                  person: personOf(row),
                  until: when(row.expiresAt),
                })
              : words('admin.support-active-in', {
                  person: personOf(row),
                  scope: scopeName(row.scope),
                  spaces: spacesOf(row, names),
                  until: when(row.expiresAt),
                })}
          </p>
        ))}
        <p>
          <a href="#/admin/support">{words('admin.support-see')}</a>
        </p>
      </div>
    </Notice>
  );
}

/** How a grant stands: active, or how it ended. Operational, so a chip, not a lozenge. */
function Standing({ row }: { row: SupportRow }) {
  if (row.active) return <Chip tone="info">{words('admin.support-is-active')}</Chip>;
  const why =
    row.revokedReason === 'cap_lowered'
      ? words('admin.support-ended-cap', { at: when(row.revokedAt!) })
      : row.revokedAt !== null
        ? words('admin.support-revoked-by', {
            by: row.revokedBy === null ? words('admin.somebody') : named(row.revokedBy),
            at: when(row.revokedAt),
          })
        : words('admin.support-expired', { at: when(row.expiresAt) });
  return (
    <>
      <Chip tone="neutral">{words('admin.support-ended')}</Chip>
      <br />
      <span className={styles['muted']}>{why}</span>
    </>
  );
}

/** `YYYY-MM-DD` for a day `days` from today, in the reader's own calendar. */
const dayFrom = (days: number, from = new Date()) => {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
};

/**
 * The end a chosen day means: that day at this time of day, a minute short, so the last day the cap
 * allows is still within it however long the form was open.
 */
const endOn = (day: string, now = new Date()) => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(
    new Date(year, month - 1, date, now.getHours(), now.getMinutes()).getTime() - 60_000,
  );
};

/** Giving support access (ADM-042): the address, the scope, its spaces, why and until when. */
function GiveSupport({
  client,
  listing,
  names,
  onGiven,
}: {
  client: Client;
  listing: Listing;
  names: ReadonlyMap<string, string>;
  onGiven: (said: string) => void;
}) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [scope, setScope] = useState<SupportScope>('diagnostics');
  const [spaces, setSpaces] = useState<ReadonlySet<string>>(new Set());
  const [purpose, setPurpose] = useState('');
  const [ends, setEnds] = useState(() => dayFrom(Math.min(listing.defaultDays, listing.capDays)));
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = dayFrom(listing.capDays);

  const give = async (event: FormEvent) => {
    event.preventDefault();
    setFailure('');
    if (scope !== 'diagnostics' && spaces.size === 0) {
      setFailure(words('admin.support-refused.spaces-required'));
      return;
    }
    if (ends === '' || ends < dayFrom(0)) {
      setFailure(words('admin.support-refused.expiry-past'));
      return;
    }
    if (ends > latest) {
      setFailure(words('admin.support-refused.past-cap'));
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/support-access', {
        body: {
          email: email.trim(),
          scope,
          spaces: [...spaces],
          purpose: purpose.trim(),
          expiresAt: endOn(ends).toISOString(),
        },
      });
      if (data) {
        setEmail('');
        setPurpose('');
        setSpaces(new Set());
        onGiven(
          words('admin.support-given', {
            person: email.trim(),
            until: when((data as { support: SupportRow }).support.expiresAt),
          }),
        );
      } else {
        const code = (error as { code?: unknown } | undefined)?.code;
        const sentence = typeof code === 'string' ? REFUSED[code] : undefined;
        setFailure(sentence ? sentence() : words('admin.support-could-not-be-given'));
      }
    } catch {
      setFailure(words('admin.the-service-could-not-be-reached'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={styles['settings']}
      onSubmit={(event) => void give(event)}
      aria-label={words('admin.support-give')}
      noValidate
    >
      <h2>{words('admin.support-give')}</h2>
      <label className={`${styles['setting']} ${styles['settingWide']}`}>
        {words('admin.support-address')}
        <input
          type="email"
          autoComplete="off"
          value={email}
          onChange={(change) => setEmail(change.target.value)}
        />
      </label>
      <fieldset>
        <legend>{words('admin.support-what')}</legend>
        {SCOPES.map((each) => (
          <label key={each} className={styles['setting']}>
            <span>
              <input
                type="radio"
                name={`${id}-scope`}
                value={each}
                checked={scope === each}
                aria-describedby={`${id}-${each}`}
                onChange={() => setScope(each)}
              />{' '}
              <span className={styles['strong']}>{scopeName(each)}</span>
            </span>
            <span id={`${id}-${each}`} className={styles['muted']}>
              {scopeExplained(each)}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>
          {scope === 'diagnostics'
            ? words('admin.support-spaces-diagnostics')
            : words('admin.support-spaces-required')}
        </legend>
        {[...names].map(([space, name]) => (
          <label key={space} className={styles['setting']}>
            <span>
              <input
                type="checkbox"
                checked={spaces.has(space)}
                onChange={(change) => {
                  const next = new Set(spaces);
                  if (change.target.checked) next.add(space);
                  else next.delete(space);
                  setSpaces(next);
                }}
              />{' '}
              <span data-content>{name}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className={`${styles['setting']} ${styles['settingWide']}`}>
        {words('admin.support-why')}
        <textarea
          value={purpose}
          maxLength={500}
          onChange={(change) => setPurpose(change.target.value)}
        />
      </label>
      <label className={styles['setting']}>
        {words('admin.support-ends')}
        <input
          type="date"
          value={ends}
          min={dayFrom(0)}
          max={latest}
          aria-describedby={`${id}-ends`}
          onChange={(change) => setEnds(change.target.value)}
        />
      </label>
      <p id={`${id}-ends`} className={styles['muted']}>
        {words('admin.support-ends-within', { days: listing.capDays })}
      </p>
      {failure !== '' && (
        <Notice tone="failed">
          <p role="alert">{failure}</p>
        </Notice>
      )}
      <div>
        <button
          type="submit"
          className="primary"
          disabled={busy || email.trim() === '' || purpose.trim() === ''}
        >
          {words('admin.support-give')}
        </button>
      </div>
    </form>
  );
}

/**
 * Administration's **Support access** (support.md; ADM-022 to ADM-026, ADM-042): every grant, active
 * and ended, with who, what, where, why, by whom and until when; to whoever holds `grant_support`, the
 * form that gives one and **Revoke**, which says what it ends first.
 */
export function SupportAccess({
  client,
  mayGrant,
  generation,
  onChanged,
}: {
  client: Client;
  mayGrant: boolean;
  generation: number;
  onChanged: () => void;
}) {
  const read = useSupportListing(client, true, generation);
  const names = useSpaceNames(client, true);
  const [said, setSaid] = useState('');
  const [revoking, setRevoking] = useState<SupportRow | null>(null);

  const revoke = async (row: SupportRow) => {
    const { data, error } = await client.DELETE('/v1/support-access/{id}', {
      params: { path: { id: row.id } },
    });
    setRevoking(null);
    const code = (error as { code?: unknown } | undefined)?.code;
    setSaid(
      data || code === 'support_revoked'
        ? words('admin.support-revoked', { person: personOf(row) })
        : words('admin.support-could-not-be-revoked', { person: personOf(row) }),
    );
    onChanged();
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.support-lead')}</p>
      </div>
      {read === undefined || read === null ? (
        <Waiting>{words('admin.loading')}</Waiting>
      ) : read === 'refused' ? (
        <Notice tone="refused">
          <p>{notYours()}</p>
        </Notice>
      ) : read === 'failed' ? (
        <Notice tone="failed">
          <p>{words('admin.support-could-not-be-read')}</p>
        </Notice>
      ) : (
        <>
          {mayGrant && (
            <GiveSupport
              client={client}
              listing={read}
              names={names}
              onGiven={(sentence) => {
                setSaid(sentence);
                onChanged();
              }}
            />
          )}
          <p role="status">{said}</p>
          {read.items.length === 0 ? (
            <p className={styles['muted']}>{words('admin.support-none')}</p>
          ) : (
            <table aria-label={words('admin.support-access')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{words('admin.support-person')}</th>
                  <th scope="col">{words('admin.support-scope')}</th>
                  <th scope="col">{words('admin.support-purpose')}</th>
                  <th scope="col">{words('admin.support-granted')}</th>
                  <th scope="col">{words('admin.support-until')}</th>
                  <th scope="col">{words('admin.status')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{words('admin.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {read.items.map((row) => (
                  <tr key={row.id} data-archived={row.active ? undefined : 'true'}>
                    <td className={styles['wraps']}>
                      <span className={styles['strong']} data-content>
                        {personOf(row)}
                      </span>
                      {row.person.name !== null && (
                        <>
                          <br />
                          <span className={`${styles['muted']} ${styles['breaks']}`} data-content>
                            {row.person.email}
                          </span>
                        </>
                      )}
                    </td>
                    <td className={styles['wraps']}>
                      {scopeName(row.scope)}
                      {row.spaces.length > 0 && (
                        <>
                          <br />
                          <span className={styles['muted']} data-content>
                            {spacesOf(row, names)}
                          </span>
                        </>
                      )}
                    </td>
                    <td className={styles['wraps']} data-content>
                      {row.purpose}
                    </td>
                    <td className={styles['wraps']}>
                      <span {...(row.grantedBy.name === null ? {} : { 'data-content': '' })}>
                        {named(row.grantedBy)}
                      </span>
                      <br />
                      <span className={styles['muted']}>{when(row.grantedAt)}</span>
                    </td>
                    <td className={styles['wraps']}>{when(row.expiresAt)}</td>
                    <td>
                      <Standing row={row} />
                    </td>
                    <td className={styles['wraps']}>
                      {mayGrant && row.active && (
                        <button
                          type="button"
                          aria-label={words('admin.support-revoke-for', { person: personOf(row) })}
                          onClick={() => setRevoking(row)}
                        >
                          {words('admin.support-revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {revoking !== null && (
        <ConfirmDialog
          question={words('admin.support-revoke-question', { person: personOf(revoking) })}
          sentence={
            revoking.scope === 'diagnostics'
              ? words('admin.support-revoke-ends-diagnostics', { person: personOf(revoking) })
              : words('admin.support-revoke-ends', {
                  person: personOf(revoking),
                  scope: scopeName(revoking.scope),
                  spaces: spacesOf(revoking, names),
                })
          }
          keep={words('admin.keep-it')}
          act={words('admin.support-revoke')}
          onKeep={() => setRevoking(null)}
          onAct={() => revoke(revoking)}
        />
      )}
    </>
  );
}
