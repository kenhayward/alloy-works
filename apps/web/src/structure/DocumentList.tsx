import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { documentLink } from './links.js';
import { NewDocument } from './NewDocument.js';

type Client = ReturnType<typeof createApiClient>;

interface Listed {
  readonly id: string;
  readonly title: string;
  readonly space: string;
  readonly version: string;
}

/**
 * The listing, checked rather than trusted: the client's bodies are `any`. `undefined` is a body that
 * is not a listing at all; an entry missing a member it needs is left out rather than shown half-read.
 */
function documentsIn(data: unknown): Listed[] | undefined {
  if (typeof data !== 'object' || data === null || !('items' in data)) return undefined;
  const items = (data as { items: unknown }).items;
  if (!Array.isArray(items)) return undefined;
  return items.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, title, space, version } = item as Record<string, unknown>;
    const name =
      typeof space === 'object' && space !== null ? (space as { name?: unknown }).name : undefined;
    if (
      typeof id !== 'string' ||
      typeof title !== 'string' ||
      typeof version !== 'string' ||
      typeof name !== 'string'
    ) {
      return [];
    }
    return [{ id, title, space: name, version }];
  });
}

export interface DocumentListProps {
  readonly client: Client;
  /** Called with a document's id to open it: a new one, once it is made. */
  readonly onOpen: (id: string) => void;
}

/**
 * The documents the signed-in person may read, each a link that opens it, with **New document** beside
 * them. `GET /v1/documents` answers them all at once, with no cursor, so there is no page to ask for.
 */
export function DocumentList({ client, onOpen }: DocumentListProps) {
  const [items, setItems] = useState<readonly Listed[] | null>(null);
  const [problem, setProblem] = useState<'signedOut' | 'failed' | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const generation = ++request.current;
    setLoading(true);
    setProblem(null);
    try {
      const { data, response } = await client.GET('/v1/documents');
      if (request.current !== generation) return;
      const listed = documentsIn(data);
      if (listed === undefined) {
        setProblem(response.status === 401 ? 'signedOut' : 'failed');
        return;
      }
      setItems(listed);
    } catch {
      if (request.current === generation) setProblem('failed');
    } finally {
      if (request.current === generation) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  if (problem !== null) {
    return (
      <section aria-labelledby="documents-heading">
        <h2 id="documents-heading">Documents</h2>
        {problem === 'signedOut' ? (
          <p>You are signed out. Sign in again to see your documents.</p>
        ) : (
          <>
            <p>The documents could not be loaded.</p>
            <button type="button" disabled={loading} onClick={() => void load()}>
              Try again
            </button>
          </>
        )}
      </section>
    );
  }
  if (items === null) return null;
  return (
    <section aria-labelledby="documents-heading">
      <h2 id="documents-heading">Documents</h2>
      <NewDocument client={client} onCreated={onOpen} />
      {items.length === 0 ? (
        <p>There are no documents you may read.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <a href={documentLink(item.id)}>{item.title}</a> - version {item.version} in{' '}
              {item.space}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
