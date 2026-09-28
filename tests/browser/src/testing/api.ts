import { createApiClient, type paths } from '@alloy-works/api-client';
import { inject } from 'vitest';
import { API } from './addresses.js';

export type Client = ReturnType<typeof createApiClient>;
export type DocumentView =
  paths['/v1/documents/{id}']['get']['responses']['200']['content']['application/json'];
type Operation =
  paths['/v1/documents/{id}/outline']['post']['requestBody']['content']['application/json']['operation'];

/**
 * The generated client, signed in as Ada from Node (the W13 plan's B-C): fixtures are made through the
 * API, the path a person's content takes, never written into the store.
 */
export function api(): Client {
  const session = inject('session');
  // The client hands fetch a whole Request, whose headers a JSON body's content type is among: the
  // cookie is added to it, never swapped in for them.
  const signedIn = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init);
    request.headers.set('cookie', session);
    return fetch(request);
  }) as typeof fetch;
  return createApiClient({ baseUrl: API, fetch: signedIn });
}

/** A node of an outline as the service returns it, narrowed to what the suite reads. */
export interface OutlineNode {
  readonly id: string;
  readonly type: 'section' | 'reference';
  readonly title?: readonly { readonly type: string; readonly value?: string }[];
  readonly pageBreak: 'none' | 'page' | 'recto';
  readonly children: readonly OutlineNode[];
}

/** The outline a document view carries. */
export function nodesOf(document: DocumentView): readonly OutlineNode[] {
  return (document.outline as { nodes?: readonly OutlineNode[] }).nodes ?? [];
}

/** A section's title as plain words. */
export function titleOf(node: OutlineNode): string {
  return (node.title ?? []).map((run) => run.value ?? '').join('');
}

/**
 * The outline as a nested list of titles, which is what a person sees in the tree and what an
 * assertion can compare at a glance: `['Alpha', ['Beta', 'Beta one'], 'Gamma']` for Beta holding one.
 */
export type ShapeEntry = string | readonly ShapeEntry[];

export function shapeOf(nodes: readonly OutlineNode[]): ShapeEntry[] {
  return nodes.map((node) =>
    node.children.length === 0 ? titleOf(node) : [titleOf(node), ...shapeOf(node.children)],
  );
}

/** Reads a document back from the service at its latest version. */
export async function readDocument(client: Client, id: string): Promise<DocumentView> {
  const { data, response } = await client.GET('/v1/documents/{id}', { params: { path: { id } } });
  if (!data) throw new Error(`reading document ${id} answered ${response.status}`);
  return data;
}

/** Applies one operation to the latest version, answering the version it made. */
export async function edit(
  client: Client,
  document: DocumentView,
  operation: Operation,
): Promise<DocumentView> {
  const { data, error, response } = await client.POST('/v1/documents/{id}/outline', {
    params: { path: { id: document.id } },
    body: { openedFrom: document.version.id, operation },
  });
  if (!data)
    throw new Error(`${operation.operation} answered ${response.status}: ${JSON.stringify(error)}`);
  return data;
}

/** A title of words alone, as the outline stores one. */
export function words(value: string): [{ type: 'text'; value: string; marks: [] }] {
  return [{ type: 'text', value, marks: [] }];
}

/**
 * A document in the development environment's General space, holding the sections `shape` names in
 * order, made through the API one operation at a time. Its title carries `name` and the moment it was
 * made, so a run leaves documents a person can tell apart from their own and from each other.
 */
export async function makeDocument(
  client: Client,
  name: string,
  shape: readonly (string | readonly [string, ...string[]])[],
): Promise<DocumentView> {
  const { data: spaces } = await client.GET('/v1/spaces');
  const general = spaces?.items.find((space) => space.name === 'General');
  if (!general) throw new Error('The development environment has no General space');
  const { data: made, response } = await client.POST('/v1/spaces/{space}/documents', {
    params: { path: { space: general.id } },
    body: {
      title: `${name} ${new Date().toISOString()}`,
      language: 'en-GB',
      direction: 'ltr',
    },
  });
  if (!made) throw new Error(`making a document answered ${response.status}`);
  let document = made;
  for (const [position, entry] of shape.entries()) {
    const [title, ...children] = typeof entry === 'string' ? [entry] : entry;
    document = await edit(client, document, {
      operation: 'insert',
      parent: null,
      position,
      node: { type: 'section', title: words(title) },
    });
    const parent = nodesOf(document)[position]!.id;
    for (const [index, child] of children.entries()) {
      document = await edit(client, document, {
        operation: 'insert',
        parent,
        position: index,
        node: { type: 'section', title: words(child) },
      });
    }
  }
  return document;
}
