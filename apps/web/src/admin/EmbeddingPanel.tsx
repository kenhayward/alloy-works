import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import styles from './Administration.module.css';

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
    ? 'How long new versions take to be findable by meaning has not been measured in the last 7 days.'
    : `Findable by meaning within ${Math.ceil(p95Seconds)} s at p95, at most ${Math.ceil(maxSeconds)} s, over ${versions} ${versions === 1 ? 'version' : 'versions'} in the last 7 days.`;

const where = (endpoint: Endpoint | null) =>
  endpoint === null
    ? 'an endpoint no longer there'
    : `${endpoint.name}${endpoint.boundary === 'outside' ? ', outside your data boundary' : ''}${
        endpoint.retired ? ', retired' : ''
      }`;

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
        setSaid(`${model} is confirmed: the parts are being embedded.`);
      } else setSaid(refusal(error, 'The model could not be confirmed.'));
    } finally {
      setBusy(false);
    }
  };

  if (read === null) return null;
  if (read === 'failed') return <p>Searching by meaning could not be read.</p>;
  const pending = read.pending;
  return (
    <section aria-label="Searching by meaning">
      <h2>Searching by meaning</h2>
      <p>
        {read.serving
          ? `Meaning is searched by ${read.serving.model}, on ${where(read.serving.endpoint)}.`
          : 'Nothing is searched by meaning: search finds by words alone.'}
      </p>
      {freshness && <p>{lag(freshness)}</p>}
      {pending && !pending.confirmed && (
        <div className={styles['lead']}>
          <p>
            {`Embedding is routed to ${pending.model}, on ${where(pending.endpoint)}. Embedding the ${pending.missing} of ${pending.texts} texts it lacks would take about ${pending.estimate.tokens.toLocaleString('en-GB')} tokens`}
            {pending.estimate.cost === null
              ? '.'
              : `, about ${pending.estimate.currency} ${Number(pending.estimate.cost).toFixed(2)}.`}{' '}
            Nothing is embedded until you confirm it
            {read.serving ? `, and ${read.serving.model} goes on serving until it is done.` : '.'}
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void confirm(pending.model)}
          >
            Confirm and embed
          </button>
        </div>
      )}
      {pending?.confirmed && (
        <p>
          {`${pending.model} is embedding the parts: ${pending.texts - pending.missing} of ${pending.texts} texts done.`}
          {read.serving ? ` ${read.serving.model} serves until it is done.` : ''}
        </p>
      )}
      <p role="status">{said}</p>
    </section>
  );
}
