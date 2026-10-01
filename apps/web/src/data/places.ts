import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { isAccessAnswers } from '../access/describe.js';
import { everyPage } from '../paging.js';
import { isRecord } from './shapes.js';

type Client = ReturnType<typeof createApiClient>;

/** A space or a connection, by id and name. */
export interface Place {
  readonly id: string;
  readonly name: string;
}

/**
 * Whether the service says the caller holds every one of these permissions at a target. A
 * convenience for what a page offers: every act is decided again by the service.
 */
export async function permitsAt(
  client: Client,
  target: string,
  permissions: readonly string[],
): Promise<boolean> {
  try {
    const { data } = await client.GET('/v1/access', { params: { query: { target } } });
    if (!isAccessAnswers(data)) return false;
    return permissions.every(
      (permission) =>
        data.permissions.find((each) => each.permission === permission)?.allowed === true,
    );
  } catch {
    return false;
  }
}

/**
 * Where the caller may write a query definition (data.md, "Permissions"): the spaces they may edit
 * in, and the connections in service on which they hold `use_connection` and `write_sql` (DAT-101).
 * Null until every answer is in; empty lists where nothing could be read.
 */
export function useSqlPlaces(client: Client): {
  readonly spaces: readonly Place[];
  readonly connections: readonly Place[];
} | null {
  const [places, setPlaces] = useState<{
    readonly spaces: readonly Place[];
    readonly connections: readonly Place[];
  } | null>(null);
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const [spaces, connections] = await Promise.all([
          everyPage((cursor) =>
            client.GET('/v1/spaces', {
              params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
            }),
          ),
          everyPage((cursor) =>
            client.GET('/v1/connections', {
              params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
            }),
          ),
        ]);
        const named = (items: readonly unknown[], live: boolean) =>
          items.flatMap((item: unknown) =>
            isRecord(item) &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            (!live || item.retired === false)
              ? [{ id: item.id, name: item.name }]
              : [],
          );
        const readableSpaces = named('items' in spaces ? spaces.items : [], false);
        const liveConnections = named('items' in connections ? connections.items : [], true);
        const [editable, writable] = await Promise.all([
          Promise.all(
            readableSpaces.map((each) => permitsAt(client, `space:${each.id}`, ['edit'])),
          ),
          Promise.all(
            liveConnections.map((each) =>
              permitsAt(client, `artifact:${each.id}`, ['use_connection', 'write_sql']),
            ),
          ),
        ]);
        if (current) {
          setPlaces({
            spaces: readableSpaces.filter((_, at) => editable[at]),
            connections: liveConnections.filter((_, at) => writable[at]),
          });
        }
      } catch {
        if (current) setPlaces({ spaces: [], connections: [] });
      }
    })();
    return () => {
      current = false;
    };
  }, [client]);
  return places;
}
