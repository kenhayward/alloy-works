import type { createApiClient } from '@alloy-works/api-client';
import { useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';

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
  sent: 'What is sent',
  returned: 'What comes back',
  both: 'Both',
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
        setSaid(`"${data.phrase}" is forbidden from the next call.`);
        setPhrase('');
        setReason('');
        again();
      } else setSaid(refusal(error, 'The guardrail could not be added.'));
    } finally {
      setBusy(false);
    }
  };

  const retire = async (rule: Rule) => {
    const { data, error } = await client.POST('/v1/guardrails/{id}/retirement', {
      params: { path: { id: rule.id } },
    });
    if (data) {
      setSaid(`"${rule.phrase}" is retired. It refuses nothing now.`);
      again();
    } else setSaid(refusal(error, 'The guardrail could not be retired.'));
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>
          Phrases this environment forbids in what a model is sent and what it returns, in any case
          or spacing. A turn or a run meeting one is refused, and says which and why. Where a rule
          watches what comes back, a reply is shown once it has been checked.
        </p>
      </div>
      <form
        className={styles['toolbar']}
        onSubmit={(event) => void add(event)}
        aria-label="Add a guardrail"
        noValidate
      >
        <label className={styles['filter']}>
          Phrase
          <input value={phrase} onChange={(change) => setPhrase(change.target.value)} />
        </label>
        <label className={styles['filter']}>
          Watches
          <select value={applies} onChange={(change) => setApplies(change.target.value as Side)}>
            {Object.entries(SIDES).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles['filter']}>
          Reason
          <input value={reason} onChange={(change) => setReason(change.target.value)} />
        </label>
        <button
          type="submit"
          className="primary"
          disabled={busy || phrase.trim() === '' || reason.trim() === ''}
        >
          Add
        </button>
      </form>
      <Shown read={read} failed="The guardrails could not be loaded.">
        {(rows) =>
          rows.length === 0 ? (
            <p className={styles['muted']}>No phrase is forbidden.</p>
          ) : (
            <table aria-label="Guardrails" className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">Phrase</th>
                  <th scope="col">Watches</th>
                  <th scope="col">Reason</th>
                  <th scope="col">
                    <span className={styles['hidden']}>Actions</span>
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
                        aria-label={`Retire ${rule.phrase}`}
                        onClick={() => void retire(rule)}
                      >
                        Retire
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
