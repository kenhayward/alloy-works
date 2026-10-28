import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { formats, words as say } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Policy {
  readonly fallback: 'source' | 'refuse';
  readonly outOfDate: 'publish' | 'refuse';
  readonly note: Readonly<Record<string, string>>;
  readonly conflict: 'review' | 'accept' | 'reject';
  readonly machine: 'off' | 'inside' | 'any';
}

/** The note's words by language, as the form holds them: one `tag: words` a line. */
const noteText = (note: Policy['note']) =>
  Object.entries(note)
    .map(([language, words]) => `${language}: ${words}`)
    .join('\n');

const noteOf = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        const at = line.indexOf(':');
        return at < 0 ? [line, ''] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );

/** One change to the policy, as the history lists it (the TE plan, TE-D). */
interface Change {
  readonly id: string;
  readonly at: string;
  readonly by: { readonly displayName: string | null } | null;
  readonly policy: Policy;
}

/** Each value in the words of the choice the form offers for it. */
const VALUE_WORDS = {
  fallback: { source: 'admin.publish-it-in-its-own', refuse: 'admin.refuse-the-publish' },
  outOfDate: { publish: 'admin.publish-it', refuse: 'admin.refuse-the-publish' },
  conflict: {
    review: 'admin.hold-it-for-review',
    accept: 'admin.offer-to-accept-it',
    reject: 'admin.offer-to-reject-it',
  },
  machine: {
    off: 'admin.send-nothing',
    inside: 'admin.only-inside-the-data-boundary',
    any: 'admin.to-any-translate-endpoint',
  },
} as const;

const when = (at: string) =>
  formats().date(new Date(at), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * The policy's history (the TE plan, TE-D; LOC-036): each change whole, the newest first, by whom and
 * when, a page at a time. The first is the policy as its history began, by nobody.
 */
function PolicyHistory({ client }: { client: Client }) {
  const [changes, setChanges] = useState<readonly Change[] | 'failed' | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (cursor: string | null) => {
    setBusy(true);
    try {
      const { data } = await client.GET('/v1/settings/translation/history', {
        params: { query: cursor === null ? {} : { cursor } },
      });
      if (!data) {
        if (cursor === null) setChanges('failed');
        return;
      }
      setChanges((shown) => [...(Array.isArray(shown) ? shown : []), ...data.items]);
      setNext(data.next);
    } catch {
      if (cursor === null) setChanges('failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load(null);
    // Once, on opening: a change saved below reloads the page's own copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  if (changes === null) return <Waiting>{say('admin.loading')}</Waiting>;
  if (changes === 'failed') {
    return (
      <Notice tone="failed">
        <p>{say('admin.the-history-of-the-translation')}</p>
      </Notice>
    );
  }
  return (
    <section>
      <h2>{say('admin.history')}</h2>
      <table
        aria-label={say('admin.changes-to-the-translation-policy')}
        className={styles['table']}
      >
        <thead>
          <tr>
            <th scope="col">{say('admin.when')}</th>
            <th scope="col">{say('admin.changed-by')}</th>
            <th scope="col">{say('admin.the-policy')}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={change.id}>
              <td>{when(change.at)}</td>
              <td>
                {change.by === null
                  ? say('admin.as-its-history-began')
                  : (change.by.displayName ?? say('admin.somebody'))}
              </td>
              <td>
                <ul>
                  {(
                    [
                      [
                        'admin.a-component-with-no-translation',
                        VALUE_WORDS.fallback[change.policy.fallback],
                      ],
                      [
                        'admin.a-translation-out-of-date',
                        VALUE_WORDS.outOfDate[change.policy.outOfDate],
                      ],
                      [
                        'admin.a-returned-translation-whose-source',
                        VALUE_WORDS.conflict[change.policy.conflict],
                      ],
                      ['admin.machine-translation', VALUE_WORDS.machine[change.policy.machine]],
                    ] as const
                  ).map(([setting, value]) => (
                    <li key={setting}>
                      {say('admin.setting-value', { setting: say(setting), value: say(value) })}
                    </li>
                  ))}
                  <li>
                    {say('admin.setting-value', {
                      setting: say('admin.what-the-mark-says-by'),
                      value:
                        Object.keys(change.policy.note).length === 0
                          ? say('admin.the-default-words')
                          : formats().list(
                              Object.entries(change.policy.note).map(([language, words]) =>
                                say('admin.setting-value', { setting: language, value: words }),
                              ),
                              { type: 'unit' },
                            ),
                    })}
                  </li>
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {next !== null && (
        <button type="button" disabled={busy} onClick={() => void load(next)}>
          {say('admin.show-more')}
        </button>
      )}
    </section>
  );
}

/**
 * **Administration's Translation** (the TR plan, TR-J; LOC-017, LOC-036, LOC-037): what publishing in
 * a language does with a component not translated into it, or translated out of date, and the words
 * that mark one published in its own language; and what a translation returned for a source that moved
 * since it was sent is offered first (XL-G; LOC-035); and whether content goes to machine translation
 * (XL-K; LOC-026). Read by anybody, changed by an administrator of the
 * environment, who sees its history (TE-D; LOC-036); a document may set its own fallback.
 */
export function TranslationPolicy({ client, mayChange }: { client: Client; mayChange: boolean }) {
  const [read, setRead] = useState<Policy | 'failed' | null>(null);
  const [fallback, setFallback] = useState<Policy['fallback']>('source');
  const [outOfDate, setOutOfDate] = useState<Policy['outOfDate']>('publish');
  const [conflict, setConflict] = useState<Policy['conflict']>('review');
  const [machine, setMachine] = useState<Policy['machine']>('off');
  const [note, setNote] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  // Bumped by each save, so the history is read again with the change in it.
  const [history, setHistory] = useState(0);
  const noteId = useId();

  const show = (policy: Policy) => {
    setRead(policy);
    setFallback(policy.fallback);
    setOutOfDate(policy.outOfDate);
    setConflict(policy.conflict);
    setMachine(policy.machine);
    setNote(noteText(policy.note));
  };

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/settings/translation')
      .then(({ data }) => {
        if (!current) return;
        if (data) show(data);
        else setRead('failed');
      })
      .catch(() => current && setRead('failed'));
    return () => {
      current = false;
    };
  }, [client]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await client.PUT('/v1/settings/translation', {
        body: { fallback, outOfDate, note: noteOf(note), conflict, machine },
      });
      if (data) {
        show(data);
        setHistory((count) => count + 1);
        setSaid(say('admin.saved'));
      } else setSaid(refusal(error, say('admin.the-policy-could-not-be')));
    } catch {
      setSaid(say('admin.the-policy-could-not-be'));
    } finally {
      setBusy(false);
    }
  };

  if (read === null) return <Waiting>{say('admin.loading')}</Waiting>;
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>{say('admin.the-translation-settings-could-not')}</p>
      </Notice>
    );
  }
  return (
    <>
      <form className={styles['settings']} onSubmit={(event) => void save(event)}>
        <fieldset>
          <legend className={styles['strong']}>
            {say('admin.a-component-with-no-translation')}
          </legend>
          {(
            [
              [
                'source',
                say('admin.publish-it-in-its-own'),
                say('admin.marked-as-untranslated-and-reported'),
              ],
              [
                'refuse',
                say('admin.refuse-the-publish'),
                say('admin.naming-each-component-without-a'),
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className={styles['setting']}>
              <span>
                <input
                  type="radio"
                  name="translation-fallback"
                  value={value}
                  checked={fallback === value}
                  disabled={!mayChange}
                  onChange={() => setFallback(value)}
                />{' '}
                {label}
              </span>
              <span className={styles['muted']}>{hint}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend className={styles['strong']}>{say('admin.a-translation-out-of-date')}</legend>
          {(
            [
              ['publish', say('admin.publish-it'), say('admin.reported-where-the-change-needs')],
              ['refuse', say('admin.refuse-the-publish'), say('admin.only-where-the-change-needs')],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className={styles['setting']}>
              <span>
                <input
                  type="radio"
                  name="translation-out-of-date"
                  value={value}
                  checked={outOfDate === value}
                  disabled={!mayChange}
                  onChange={() => setOutOfDate(value)}
                />{' '}
                {label}
              </span>
              <span className={styles['muted']}>{hint}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend className={styles['strong']}>
            {say('admin.a-returned-translation-whose-source')}
          </legend>
          {(
            [
              [
                'review',
                say('admin.hold-it-for-review'),
                say('admin.a-person-decides-nothing-offered'),
              ],
              ['accept', say('admin.offer-to-accept-it'), say('admin.as-a-translation-of-the')],
              ['reject', say('admin.offer-to-reject-it'), say('admin.a-person-still-decides')],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className={styles['setting']}>
              <span>
                <input
                  type="radio"
                  name="translation-conflict"
                  value={value}
                  checked={conflict === value}
                  disabled={!mayChange}
                  onChange={() => setConflict(value)}
                />{' '}
                {label}
              </span>
              <span className={styles['muted']}>{hint}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend className={styles['strong']}>{say('admin.machine-translation')}</legend>
          {(
            [
              ['off', say('admin.send-nothing'), say('admin.no-component-is-drafted-by')],
              [
                'inside',
                say('admin.only-inside-the-data-boundary'),
                say('admin.to-a-translate-endpoint-inside'),
              ],
              [
                'any',
                say('admin.to-any-translate-endpoint'),
                say('admin.inside-or-outside-the-boundary'),
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className={styles['setting']}>
              <span>
                <input
                  type="radio"
                  name="translation-machine"
                  value={value}
                  checked={machine === value}
                  disabled={!mayChange}
                  onChange={() => setMachine(value)}
                />{' '}
                {label}
              </span>
              <span className={styles['muted']}>{hint}</span>
            </label>
          ))}
        </fieldset>
        <label htmlFor={noteId} className={styles['strong']}>
          {say('admin.what-the-mark-says-by')}
        </label>
        <textarea
          id={noteId}
          rows={4}
          value={note}
          disabled={!mayChange}
          placeholder={say('admin.fr-non-traduit')}
          onChange={(event) => setNote(event.target.value)}
        />
        <p className={styles['muted']}>{say('admin.one-language-a-line-its')}</p>
        <p role="status">{said}</p>
        {mayChange ? (
          <div>
            <button type="submit" className="primary" disabled={busy}>
              {say('admin.save')}
            </button>
          </div>
        ) : (
          <p className={styles['muted']}>{say('admin.only-an-administrator-of-the-2')}</p>
        )}
      </form>
      {mayChange && <PolicyHistory key={history} client={client} />}
    </>
  );
}
