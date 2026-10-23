import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Policy {
  readonly fallback: 'source' | 'refuse';
  readonly outOfDate: 'publish' | 'refuse';
  readonly note: Readonly<Record<string, string>>;
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
 * that mark one published in its own language. Read by anybody, changed by an administrator of the
 * environment; a document may set its own fallback.
 */
export function TranslationPolicy({ client, mayChange }: { client: Client; mayChange: boolean }) {
  const [read, setRead] = useState<Policy | 'failed' | null>(null);
  const [fallback, setFallback] = useState<Policy['fallback']>('source');
  const [outOfDate, setOutOfDate] = useState<Policy['outOfDate']>('publish');
  const [note, setNote] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const noteId = useId();

  const show = (policy: Policy) => {
    setRead(policy);
    setFallback(policy.fallback);
    setOutOfDate(policy.outOfDate);
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
        body: { fallback, outOfDate, note: noteOf(note) },
      });
      if (data) {
        show(data);
        setSaid('Saved.');
      } else setSaid(refusal(error, 'The policy could not be saved.'));
    } catch {
      setSaid('The policy could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (read === null) return <Waiting>Loading...</Waiting>;
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>The translation settings could not be read.</p>
      </Notice>
    );
  }
  return (
    <form className={styles['settings']} onSubmit={(event) => void save(event)}>
      <fieldset>
        <legend className={styles['strong']}>A component with no translation</legend>
        {(
          [
            ['source', 'Publish it in its own language', 'Marked as untranslated, and reported.'],
            ['refuse', 'Refuse the publish', 'Naming each component without a translation.'],
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
        <legend className={styles['strong']}>A translation out of date with its source</legend>
        {(
          [
            ['publish', 'Publish it', 'Reported, where the change needs retranslating.'],
            ['refuse', 'Refuse the publish', 'Only where the change needs retranslating.'],
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
      <label htmlFor={noteId} className={styles['strong']}>
        What the mark says, by language
      </label>
      <textarea
        id={noteId}
        rows={4}
        value={note}
        disabled={!mayChange}
        placeholder="fr: Non traduit"
        onChange={(event) => setNote(event.target.value)}
      />
      <p className={styles['muted']}>
        One language a line, its tag then its words. A language with none says Untranslated,
        followed by the language the component is in.
      </p>
      <p role="status">{said}</p>
      {mayChange ? (
        <div>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      ) : (
        <p className={styles['muted']}>Only an administrator of the environment may change this.</p>
      )}
    </form>
  );
}
