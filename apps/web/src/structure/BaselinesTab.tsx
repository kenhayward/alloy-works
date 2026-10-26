import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import styles from './BaselinesTab.module.css';
import { baselineLink, comparisonLink } from './links.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Baseline {
  readonly id: string;
  readonly name: string;
  readonly madeBy: { readonly name: string | null };
  readonly madeAt: string;
  readonly superseded: { readonly by: string } | null;
}

type Show = 'all' | 'current' | 'superseded';

const SHOWN: Record<Show, string> = {
  get all() {
    return words('document.all');
  },
  get current() {
    return words('document.current');
  },
  get superseded() {
    return words('document.superseded');
  },
};

/** The formats a baseline may be published to, as the page offers them. */
const FORMATS = {
  pdf: { label: 'PDF', formats: ['pdf'] },
  both: {
    get label() {
      return words('document.pdf-and-word');
    },
    formats: ['pdf', 'docx'],
  },
  docx: {
    get label() {
      return words('document.word');
    },
    formats: ['docx'],
  },
} as const;
type Formats = keyof typeof FORMATS;

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** What a refusal says, from the service's own words, or a sentence of ours where it sent none. */
const refusalOf = (error: unknown, fallback: string) =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : fallback;

/**
 * The document's baselines (baselines.md; the BL plan, Task 2): made of the version the page shows
 * under a name, listed newest first and filtered by state, and one marked superseded by a later one.
 * Somebody who may not publish sees them, and nothing to make or mark.
 */
export function BaselinesTab({
  client,
  document,
  version,
  mayPublish,
}: {
  client: Client;
  document: string;
  version: string;
  mayPublish: boolean;
}) {
  const [show, setShow] = useState<Show>('all');
  const [baselines, setBaselines] = useState<readonly Baseline[] | null | undefined>(undefined);
  // Every baseline, whatever is shown, so a superseding one is named and offered.
  const [every, setEvery] = useState<readonly Baseline[]>([]);
  const [name, setName] = useState('');
  const [said, setSaid] = useState('');
  const [refused, setRefused] = useState('');
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState<string | null>(null);
  const [by, setBy] = useState('');
  const [publishing, setPublishing] = useState<string | null>(null);
  const [formats, setFormats] = useState<Formats>('pdf');
  // What each baseline is to be compared with: a later one, or the document now (VER-025).
  const [against, setAgainst] = useState<Readonly<Record<string, string>>>({});
  const ids = useId();

  const read = useCallback(async () => {
    const asked = (state?: 'current' | 'superseded') =>
      client.GET('/v1/documents/{id}/baselines', {
        params: { path: { id: document }, query: state ? { state } : {} },
      });
    const [shown, all] = await Promise.all([
      asked(show === 'all' ? undefined : show),
      show === 'all' ? null : asked(),
    ]);
    if (!shown.data) return setBaselines(null);
    setBaselines(shown.data.baselines);
    setEvery(all?.data?.baselines ?? shown.data.baselines);
  }, [client, document, show]);

  useEffect(() => {
    void read().catch(() => setBaselines(null));
  }, [read]);

  const make = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setSaid('');
    setRefused('');
    const answer = await client.POST('/v1/documents/{id}/baselines', {
      params: { path: { id: document } },
      body: { version, name },
    });
    setBusy(false);
    if (!answer.data) {
      setRefused(refusalOf(answer.error, words('document.the-baseline-could-not-be-2')));
      return;
    }
    setSaid(words('document.made', { name: answer.data.name }));
    setName('');
    await read();
  };

  const mark = async (baseline: string) => {
    setRefused('');
    const answer = await client.POST('/v1/baselines/{id}/supersession', {
      params: { path: { id: baseline } },
      body: { by },
    });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, words('document.it-could-not-be-marked')));
      return;
    }
    setMarking(null);
    await read();
  };

  // A publish of the baseline from its pins (the BL plan, Task 3): followed, as any publish is, in
  // Publications once it is made.
  const publish = async (baseline: Baseline) => {
    setSaid('');
    setRefused('');
    const answer = await client.POST('/v1/baselines/{id}/publications', {
      params: { path: { id: baseline.id } },
      body: { formats: [...FORMATS[formats].formats] },
    });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, words('document.it-could-not-be-published')));
      return;
    }
    setPublishing(null);
    setSaid(words('document.publishing-it-is-listed-in', { name: baseline.name }));
  };

  const nameOf = (id: string) =>
    every.find((each) => each.id === id)?.name ?? words('document.a-later-baseline');
  const laterThan = (baseline: Baseline) =>
    every.filter((each) => each.id !== baseline.id && each.madeAt > baseline.madeAt);

  return (
    <div className={styles['tab']}>
      {mayPublish && (
        <form className={styles['make']} onSubmit={(event) => void make(event)}>
          <label htmlFor={`${ids}-name`}>{words('document.name')}</label>
          <input
            id={`${ids}-name`}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" disabled={busy || name.trim() === ''}>
            {words('document.make-baseline')}
          </button>
        </form>
      )}
      <p role="status" className={styles['note']}>
        {said}
      </p>
      {refused !== '' && (
        <p role="alert" className={styles['refused']}>
          {refused}
        </p>
      )}
      <div className={styles['controls']}>
        <label htmlFor={`${ids}-show`}>{words('document.show')}</label>
        <select
          id={`${ids}-show`}
          value={show}
          onChange={(event) => setShow(event.target.value as Show)}
        >
          {(Object.keys(SHOWN) as Show[]).map((each) => (
            <option key={each} value={each}>
              {SHOWN[each]}
            </option>
          ))}
        </select>
      </div>
      {baselines === null && (
        <p className={styles['note']}>{words('document.the-baselines-could-not-be')}</p>
      )}
      {baselines?.length === 0 && (
        <p className={styles['note']}>{words('document.no-baseline-yet')}</p>
      )}
      {baselines !== undefined && baselines !== null && baselines.length > 0 && (
        <ul className={styles['rows']}>
          {baselines.map((baseline) => {
            const later = laterThan(baseline);
            const heading = `${ids}-${baseline.id}`;
            return (
              <li key={baseline.id} className={styles['row']} aria-labelledby={heading}>
                <h3 id={heading} className={styles['name']}>
                  <a href={baselineLink(document, baseline.id)}>{baseline.name}</a>
                </h3>
                <span className={styles['note']}>
                  {`${baseline.madeBy.name ?? words('document.somebody')}, ${when.format(new Date(baseline.madeAt))}`}
                </span>
                <span className={styles['note']}>
                  {baseline.superseded === null
                    ? words('document.current')
                    : words('document.superseded-by', { value1: nameOf(baseline.superseded.by) })}
                </span>
                <div className={styles['controls']}>
                  <label htmlFor={`${heading}-against`}>{words('document.compare-with')}</label>
                  <select
                    id={`${heading}-against`}
                    value={against[baseline.id] ?? 'now'}
                    onChange={(event) =>
                      setAgainst({ ...against, [baseline.id]: event.target.value })
                    }
                  >
                    <option value="now">{words('document.the-document-now-2')}</option>
                    {later.map((each) => (
                      <option key={each.id} value={each.id}>
                        {each.name}
                      </option>
                    ))}
                  </select>
                  <a href={comparisonLink(document, baseline.id, against[baseline.id] ?? 'now')}>
                    {words('document.compare')}
                  </a>
                </div>
                {mayPublish &&
                  (publishing === baseline.id ? (
                    <div className={styles['controls']}>
                      <label htmlFor={`${heading}-formats`}>{words('document.formats')}</label>
                      <select
                        id={`${heading}-formats`}
                        value={formats}
                        onChange={(event) => setFormats(event.target.value as Formats)}
                      >
                        {(Object.keys(FORMATS) as Formats[]).map((each) => (
                          <option key={each} value={each}>
                            {FORMATS[each].label}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => void publish(baseline)}>
                        {words('document.publish-now')}
                      </button>
                      <button type="button" onClick={() => setPublishing(null)}>
                        {words('document.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles['act']}
                      onClick={() => setPublishing(baseline.id)}
                    >
                      {words('document.publish')}
                    </button>
                  ))}
                {mayPublish &&
                  baseline.superseded === null &&
                  later.length > 0 &&
                  (marking === baseline.id ? (
                    <div className={styles['controls']}>
                      <label htmlFor={`${heading}-by`}>{words('document.superseded-by-2')}</label>
                      <select
                        id={`${heading}-by`}
                        value={by}
                        onChange={(event) => setBy(event.target.value)}
                      >
                        {later.map((each) => (
                          <option key={each.id} value={each.id}>
                            {each.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => void mark(baseline.id)}>
                        {words('document.mark')}
                      </button>
                      <button type="button" onClick={() => setMarking(null)}>
                        {words('document.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles['act']}
                      onClick={() => {
                        setMarking(baseline.id);
                        setBy(later[later.length - 1]!.id);
                      }}
                    >
                      {words('document.mark-superseded')}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
