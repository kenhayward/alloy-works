import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import styles from './Administration.module.css';
import { formats, words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Endpoint {
  readonly name: string;
  readonly boundary: 'inside' | 'outside';
  readonly retired: boolean;
}

interface View {
  readonly serving: {
    readonly model: string;
    readonly dims: number;
    readonly endpoint: Endpoint | null;
  } | null;
  readonly pending: {
    readonly model: string;
    readonly dims: number | null;
    readonly endpoint: Endpoint | null;
    readonly confirmed: boolean;
    readonly texts: number;
    readonly missing: number;
    readonly estimate: {
      readonly tokens: number;
      readonly cost: string | null;
      readonly currency: string | null;
    };
  } | null;
}

interface Freshness {
  readonly versions: number;
  readonly p95Seconds: number | null;
  readonly maxSeconds: number | null;
}

/** Meaning's lag over the last seven days, in whole seconds rounded up (the FR plan, FR-E). */
const lag = ({ versions, p95Seconds, maxSeconds }: Freshness) =>
  versions === 0 || p95Seconds === null || maxSeconds === null
    ? words('admin.how-long-new-versions-take')
    : words('admin.findable-by-meaning-within-s', {
        p95: Math.ceil(p95Seconds),
        max: Math.ceil(maxSeconds),
        versions,
      });

/** Where a model is reached, as the values of a sentence that says so. */
const where = (endpoint: Endpoint | null) =>
  endpoint === null
    ? { known: 'no' }
    : {
        known: 'yes',
        endpoint: endpoint.name,
        outside: endpoint.boundary === 'outside' ? 'yes' : 'no',
        retired: endpoint.retired ? 'yes' : 'no',
      };

/**
 * Models' **Searching by meaning** (generation.md, "Meaning"; the G7 plan, G7-J; GEN-044): the model
 * meaning is searched by, and the one embedding is routed to that waits, with what embedding the
 * corpus would cost; **Confirm** embeds nothing before it is pressed, and the model serving goes on
 * answering until the new one has every text. Beside it, how long new versions took to be findable by
 * meaning (the FR plan, FR-E; SCH-067).
 */
export function EmbeddingPanel({ client, generation }: { client: Client; generation: number }) {
  const [read, setRead] = useState<View | 'failed' | null>(null);
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/embedding')
      .then(({ data }) => {
        if (current) setRead(data ?? 'failed');
      })
      .catch(() => {
        if (current) setRead('failed');
      });
    // Unread, it is left unsaid.
    client
      .GET('/v1/search/meaning/freshness')
      .then(({ data }) => {
        if (current) setFreshness(data ?? null);
      })
      .catch(() => {
        if (current) setFreshness(null);
      });
    return () => {
      current = false;
    };
  }, [client, generation]);

  const confirm = async (model: string) => {
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/embedding/confirmation', {
        body: { model },
      });
      if (data) {
        setRead(data);
        setSaid(words('admin.is-confirmed-the-parts-are', { model }));
      } else setSaid(refusal(error, words('admin.the-model-could-not-be')));
    } finally {
      setBusy(false);
    }
  };

  if (read === null) return null;
  if (read === 'failed') return <p>{words('admin.searching-by-meaning-could-not')}</p>;
  const pending = read.pending;
  return (
    <section aria-label={words('admin.searching-by-meaning')}>
      <h2>{words('admin.searching-by-meaning')}</h2>
      <p>
        {read.serving
          ? words('admin.meaning-is-searched-by-on', {
              model: read.serving.model,
              ...where(read.serving.endpoint),
            })
          : words('admin.nothing-is-searched-by-meaning')}
      </p>
      {freshness && <p>{lag(freshness)}</p>}
      {pending && !pending.confirmed && (
        <div className={styles['lead']}>
          <p>
            {words('admin.embedding-is-routed-to-on', {
              model: pending.model,
              ...where(pending.endpoint),
              missing: pending.missing,
              texts: pending.texts,
              tokens: pending.estimate.tokens,
              costed: pending.estimate.cost === null ? 'no' : 'yes',
              currency: pending.estimate.currency,
              cost:
                pending.estimate.cost === null
                  ? ''
                  : formats().number(Number(pending.estimate.cost), {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }),
            })}{' '}
            {words('admin.nothing-is-embedded-until-you', {
              served: read.serving ? 'yes' : 'no',
              serving: read.serving?.model ?? '',
            })}
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void confirm(pending.model)}
          >
            {words('admin.confirm-and-embed')}
          </button>
        </div>
      )}
      {pending?.confirmed && (
        <p>
          {words('admin.is-embedding-the-parts-of', {
            model: pending.model,
            done: pending.texts - pending.missing,
            texts: pending.texts,
          })}
          {read.serving && (
            <> {words('admin.serves-until-it-is-done', { model: read.serving.model })}</>
          )}
        </p>
      )}
      <p role="status">{said}</p>
    </section>
  );
}
