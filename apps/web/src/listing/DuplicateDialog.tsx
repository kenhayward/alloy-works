import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import { useCreatableSpaces } from '../spaces.js';
import { words } from '../words/words.js';
import type { RowKind } from './ContentRowMenu.js';

type Client = ReturnType<typeof createApiClient>;

/** What a document's copy does with its components (REU-057; the RM plan, RM-G). */
export type Components = 'reuse' | 'own' | 'all';

/** What the preview says a copy would do, read rather than trusted. */
export interface Previewed {
  /** How many components it would copy. */
  readonly copies: number;
  readonly titleInUse: boolean;
  /** What it says it would refuse, in the service's words, or null. */
  readonly refused: string | null;
  /** What going to another space would cost, each said whole. */
  readonly costs: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function previewIn(data: unknown): Previewed | null {
  if (!isRecord(data)) return null;
  const counts = isRecord(data.counts) ? data.counts : {};
  return {
    copies: typeof counts.copied === 'number' ? counts.copied : 0,
    titleInUse: data.titleInUse === true,
    refused: null,
    costs: Array.isArray(data.costs)
      ? data.costs.filter((each): each is string => typeof each === 'string')
      : [],
  };
}

const refusalIn = (data: unknown): string =>
  isRecord(data) && typeof data.message === 'string' ? data.message : words('rows.copy-failed');

type Body = { to: string; title: string; components?: Components };

async function post(client: Client, id: string, path: 'copy' | 'copy/preview', body: Body) {
  const route = `/v1/artifacts/{id}/${path}` as '/v1/artifacts/{id}/move';
  const { data, error, response } = await client.POST(route, {
    params: { path: { id } },
    body: body as never,
  });
  return { data: data as unknown, error: error as unknown, ok: response.ok };
}

/**
 * Duplicate (REU-056 to REU-058; the RM plan): a new title and a space, warned of a title in use
 * there, and for a document what to do with its components, counted first. It stays open, with a
 * progress bar, until the copy is made or refused.
 */
export function DuplicateDialog({
  client,
  kind,
  id,
  title,
  onDone,
  onClose,
}: {
  client: Client;
  kind: RowKind;
  id: string;
  title: string;
  onDone: (said: string) => void;
  onClose: () => void;
}) {
  const heading = useId();
  const { spaces, where, setWhere } = useCreatableSpaces(
    client,
    kind === 'template' ? 'mayDesign' : 'mayCreate',
  );
  const [named, setNamed] = useState(words('rows.copy-of', { title }));
  const [components, setComponents] = useState<Components>('own');
  const [previewed, setPreviewed] = useState<Previewed | null>(null);
  const [copying, setCopying] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const body = (): Body => ({
    to: where,
    title: named.trim(),
    ...(kind === 'document' ? { components } : {}),
  });

  // Asked again as the choice changes, a moment after typing stops.
  useEffect(() => {
    if (where === '' || named.trim() === '') return undefined;
    let current = true;
    const wait = setTimeout(() => {
      void post(client, id, 'copy/preview', body()).then(({ data, error, ok }) => {
        if (!current) return;
        setPreviewed(ok ? previewIn(data) : { ...EMPTY, refused: refusalIn(error) });
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(wait);
    };
    // `body` is rebuilt from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, id, where, named, components]);

  const copy = async () => {
    setCopying(true);
    setRefused(null);
    const { error, ok } = await post(client, id, 'copy', body());
    setCopying(false);
    if (ok) onDone(words('rows.duplicated', { title: named.trim() }));
    else setRefused(refusalIn(error));
  };

  const reason =
    named.trim() === ''
      ? words('rows.copy-needs-a-title')
      : (previewed?.refused ?? null);
  const name = `${heading}-components`;
  const choice = (value: Components, label: string) => (
    <label>
      <input
        type="radio"
        name={name}
        value={value}
        checked={components === value}
        disabled={copying}
        onChange={() => setComponents(value)}
      />
      {label}
    </label>
  );

  return (
    <Modal labelledBy={heading} onClose={copying ? () => undefined : onClose}>
      <h2 id={heading}>{words('rows.duplicate-title', { title })}</h2>
      <label>
        {words('document.title')}
        <input value={named} disabled={copying} onChange={(event) => setNamed(event.target.value)} />
      </label>
      {previewed?.titleInUse === true && <p>{words('rows.title-in-use')}</p>}
      <label>
        {words('document.where')}
        <select value={where} disabled={copying} onChange={(event) => setWhere(event.target.value)}>
          {(spaces ?? []).map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      {kind === 'document' && (
        <fieldset>
          <legend>{words('rows.components')}</legend>
          {choice('reuse', words('rows.reuse-every-component'))}
          {choice('own', words('rows.copy-its-own-components'))}
          {choice('all', words('rows.copy-every-component'))}
        </fieldset>
      )}
      {kind === 'document' && previewed !== null && previewed.refused === null && (
        <p>{words('rows.it-copies', { count: previewed.copies })}</p>
      )}
      {previewed !== null && previewed.costs.length > 0 && (
        <ul aria-label={words('rows.what-the-space-costs')}>
          {previewed.costs.map((cost) => (
            <li key={cost}>{cost}</li>
          ))}
        </ul>
      )}
      {copying && (
        <p>
          <progress aria-label={words('rows.copying')} />{' '}
          {kind === 'document'
            ? words('rows.copying-count', { count: previewed?.copies ?? 0 })
            : words('rows.copying')}
        </p>
      )}
      <p role="status">{refused ?? (copying ? '' : (reason ?? ''))}</p>
      <div>
        <button
          type="button"
          className="primary"
          disabled={copying}
          aria-disabled={reason !== null || undefined}
          onClick={() => {
            if (reason === null) void copy();
          }}
        >
          {words('rows.duplicate-act')}
        </button>{' '}
        <button type="button" disabled={copying} onClick={onClose}>
          {words('document.cancel')}
        </button>
      </div>
    </Modal>
  );
}

const EMPTY: Previewed = { copies: 0, titleInUse: false, refused: null, costs: [] };
