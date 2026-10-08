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
  const allowed = await allowedAt(client, target);
  return permissions.every((permission) => allowed.has(permission));
}

/** The permissions the service says the caller holds at a target; none where it could not say. */
async function allowedAt(client: Client, target: string): Promise<ReadonlySet<string>> {
  try {
    const { data } = await client.GET('/v1/access', { params: { query: { target } } });
    if (!isAccessAnswers(data)) return new Set();
    return new Set(
      data.permissions.filter((each) => each.allowed === true).map((each) => each.permission),
    );
  } catch {
    return new Set();
  }
}

/** Where the caller may write a query definition, and where SQL among it. */
export interface DefinitionPlaces {
  readonly spaces: readonly Place[];
  /** The connections in service the caller may use, for a built query (D4-J). */
  readonly connections: readonly Place[];
  /** Those of them on which the caller may write SQL as well (DAT-101). */
  readonly sql: ReadonlySet<string>;
  /** Those of them that reach an HTTPS API, whose query is a request template (the D6 plan). */
  readonly http: ReadonlySet<string>;
  /** The S3 connections among them, whose query is a file read by its key (the D6 plan, task 2). */
  readonly s3: ReadonlySet<string>;
}

/**
 * Where the caller may write a query definition (data.md, "Permissions"; the D4 plan, D4-J): the
 * spaces they may edit in that are not archived (the SP1 plan, SP-E), the connections in service on which they hold `use_connection`, which a
 * built query needs, and among them those where they hold `write_sql` as well, which SQL needs
 * (DAT-101). Null until every answer is in; empty lists where nothing could be read.
 */
export function useDefinitionPlaces(client: Client): DefinitionPlaces | null {
  const [places, setPlaces] = useState<DefinitionPlaces | null>(null);
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const [spaces, connections] = await Promise.all([
          everyPage((cursor) =>
            client.GET('/v1/spaces', {
              params: {
                query: {
                  limit: '100',
                  archived: 'false',
                  ...(cursor === undefined ? {} : { cursor }),
                },
              },
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
        const ofType = (type: string) =>
          new Set(
            ('items' in connections ? connections.items : []).flatMap((item: unknown) =>
              isRecord(item) && typeof item.id === 'string' && item.type === type ? [item.id] : [],
            ),
          );
        const httpConnections = ofType('http');
        const s3Connections = ofType('s3');
        const [editable, atConnections] = await Promise.all([
          Promise.all(
            readableSpaces.map((each) => permitsAt(client, `space:${each.id}`, ['edit'])),
          ),
          Promise.all(liveConnections.map((each) => allowedAt(client, `artifact:${each.id}`))),
        ]);
        const usable = atConnections.map((allowed) => allowed.has('use_connection'));
        const writable = atConnections.map(
          (allowed) => allowed.has('use_connection') && allowed.has('write_sql'),
        );
        if (current) {
          setPlaces({
            spaces: readableSpaces.filter((_, at) => editable[at]),
            connections: liveConnections.filter((_, at) => usable[at]),
            sql: new Set(
              liveConnections
                .filter(
                  (each, at) =>
                    writable[at] && !httpConnections.has(each.id) && !s3Connections.has(each.id),
                )
                .map((each) => each.id),
            ),
            http: httpConnections,
            s3: s3Connections,
          });
        }
      } catch {
        if (current) {
          setPlaces({
            spaces: [],
            connections: [],
            sql: new Set(),
            http: new Set(),
            s3: new Set(),
          });
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [client]);
  return places;
}
