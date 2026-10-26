import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { words as say } from '../words/words.js';

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

/**
 * **Administration's Translation** (the TR plan, TR-J; LOC-017, LOC-036, LOC-037): what publishing in
 * a language does with a component not translated into it, or translated out of date, and the words
 * that mark one published in its own language; and what a translation returned for a source that moved
 * since it was sent is offered first (XL-G; LOC-035); and whether content goes to machine translation
 * (XL-K; LOC-026). Read by anybody, changed by an administrator of the
 * environment; a document may set its own fallback.
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
    <form className={styles['settings']} onSubmit={(event) => void save(event)}>
      <fieldset>
        <legend className={styles['strong']}>{say('admin.a-component-with-no-translation')}</legend>
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
  );
}
