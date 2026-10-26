import type { createApiClient } from '@alloy-works/api-client';
import { useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

type Side = 'sent' | 'returned' | 'both';

/** A guardrail as the page lists it (GEN-049; the G5 plan, G5-F). */
interface Rule {
  readonly id: string;
  readonly phrase: string;
  readonly applies: Side;
  readonly reason: string;
  readonly retiredAt: string | null;
}

const SIDES: Readonly<Record<Side, string>> = {
  get sent() {
    return words('admin.what-is-sent');
  },
  get returned() {
    return words('admin.what-comes-back');
  },
  get both() {
    return words('admin.both');
  },
};

/**
 * Administration's **Guardrails** (generation.md, "Guardrails"; the G5 plan, G5-F): the phrases this
 * environment forbids in what a model is sent and what it returns, each with the reason a refusal
 * gives; **Add** and **Retire**. A phrase, never a pattern; nothing here changes what the assistant
 * may do.
 */
export function Guardrails({ client }: { client: Client }) {
  const [generation, setGeneration] = useState(0);
  const [load] = useState(() => async () => {
    const { data, response } = await client.GET('/v1/guardrails');
    return data ? { items: data.items as Rule[] } : { status: response.status };
  });
  const read = useListing<Rule>(load, true, generation);
  const [phrase, setPhrase] = useState('');
  const [applies, setApplies] = useState<Side>('both');
  const [reason, setReason] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const again = () => setGeneration((was) => was + 1);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/guardrails', {
        body: { phrase: phrase.trim(), applies, reason: reason.trim() },
      });
      if (data) {
        setSaid(words('admin.is-forbidden-from-the-next', { phrase: data.phrase }));
        setPhrase('');
        setReason('');
        again();
      } else setSaid(refusal(error, words('admin.the-guardrail-could-not-be')));
    } finally {
      setBusy(false);
    }
  };

  const retire = async (rule: Rule) => {
    const { data, error } = await client.POST('/v1/guardrails/{id}/retirement', {
      params: { path: { id: rule.id } },
    });
    if (data) {
      setSaid(words('admin.is-retired-it-refuses-nothing', { phrase: rule.phrase }));
      again();
    } else setSaid(refusal(error, words('admin.the-guardrail-could-not-be-2')));
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.phrases-this-environment-forbids-in')}</p>
      </div>
      <form
        className={styles['toolbar']}
        onSubmit={(event) => void add(event)}
        aria-label={words('admin.add-a-guardrail')}
        noValidate
      >
        <label className={styles['filter']}>
          {words('admin.phrase')}
          <input value={phrase} onChange={(change) => setPhrase(change.target.value)} />
        </label>
        <label className={styles['filter']}>
          {words('admin.watches')}
          <select value={applies} onChange={(change) => setApplies(change.target.value as Side)}>
            {Object.entries(SIDES).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles['filter']}>
          {words('admin.reason')}
          <input value={reason} onChange={(change) => setReason(change.target.value)} />
        </label>
        <button
          type="submit"
          className="primary"
          disabled={busy || phrase.trim() === '' || reason.trim() === ''}
        >
          {words('admin.add')}
        </button>
      </form>
      <Shown read={read} failed="The guardrails could not be loaded.">
        {(rows) =>
          rows.length === 0 ? (
            <p className={styles['muted']}>{words('admin.no-phrase-is-forbidden')}</p>
          ) : (
            <table aria-label={words('admin.guardrails')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{words('admin.phrase')}</th>
                  <th scope="col">{words('admin.watches')}</th>
                  <th scope="col">{words('admin.reason')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{words('admin.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((rule) => (
                  <tr key={rule.id}>
                    <td className={styles['strong']}>{rule.phrase}</td>
                    <td>{SIDES[rule.applies]}</td>
                    <td>{rule.reason}</td>
                    <td>
                      <button
                        type="button"
                        aria-label={words('admin.retire', { phrase: rule.phrase })}
                        onClick={() => void retire(rule)}
                      >
                        {words('admin.retire-2')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Shown>
      <p role="status">{said}</p>
    </>
  );
}
