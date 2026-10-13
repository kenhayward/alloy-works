import { describe, expect, it } from 'vitest';

import {
  componentAddress,
  componentVersionLink,
  resultLink,
  searchAddress,
  searchLink,
  searchScope,
  threadAddress,
  whereFound,
} from './links.js';

const ID = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const NODE = 'abcdefghijklmnopqrstuvwxyz';
const VERSION = '7b1d2c9f-0a4e-4b3c-8e47-3b5f2d0a8c21';
const BASELINE = '8c2e3d0a-1b5f-4c4d-9f58-4c6a3e1b9d32';

describe("a search result's link and place", () => {
  it('links by identity to where it matched, where the application has a page for it', () => {
    const result = (kind: string, place: string | null, node: string | null = null) =>
      resultLink({ kind, artifactId: ID, node, place });
    expect(result('component', 'block:b2')).toBe(`#/components/${ID}/blocks/b2`);
    expect(result('component', 'title')).toBe(`#/components/${ID}`);
    expect(result('section', 'title', NODE)).toBe(`#/documents/${ID}/nodes/${NODE}`);
    expect(result('document', 'title')).toBe(`#/documents/${ID}`);
    expect(result('publication', 'title')).toBe(`#/publications/${ID}`);
    expect(result('queryDefinition', 'columns')).toBe(`#/query-definitions/${ID}`);
    // Nothing to open yet: no page shows a template, an image or a definition on its own.
    for (const kind of ['template', 'asset', 'field', 'metadataSchema', 'componentType']) {
      expect(result(kind, 'title')).toBeNull();
    }
  });

  it('SCH-057 links a thread to its page, on a component or a document, at the message it matched', () => {
    const thread = (on: 'component' | 'document', place: string | null) =>
      resultLink({
        kind: 'thread',
        artifactId: ID,
        node: on === 'document' ? NODE : null,
        place,
        thread: { id: BASELINE, on, resolved: false },
      });
    expect(thread('component', `message:${VERSION}`)).toBe(
      `#/components/${ID}/threads/${BASELINE}/comments/${VERSION}`,
    );
    expect(thread('document', 'anchor')).toBe(`#/documents/${ID}/threads/${BASELINE}`);
    expect(threadAddress(`#/components/${ID}/threads/${BASELINE}/comments/${VERSION}`)).toEqual({
      on: { kind: 'component', id: ID },
      thread: BASELINE,
      comment: VERSION,
    });
    expect(threadAddress(`#/documents/${ID}/threads/${BASELINE}`)).toEqual({
      on: { kind: 'document', id: ID },
      thread: BASELINE,
      comment: null,
    });
    expect(threadAddress(`#/documents/${ID}`)).toBeNull();
    expect(componentAddress(`#/components/${ID}/threads/${BASELINE}`)).toBeNull();
  });

  it('reads a component address with a block, and without', () => {
    expect(componentAddress(`#/components/${ID}/blocks/b2`)).toEqual({
      component: ID,
      access: false,
      block: 'b2',
      version: null,
    });
    expect(componentAddress(`#/components/${ID}/access`)).toEqual({
      component: ID,
      access: true,
      block: null,
      version: null,
    });
    expect(componentAddress(`#/components/${ID}`)).toEqual({
      component: ID,
      access: false,
      block: null,
      version: null,
    });
    expect(componentAddress('#/components')).toBeNull();
  });

  it('SCH-058 links a result from an earlier version to that version, at its place', () => {
    const earlier = { id: VERSION, number: '0.2', latest: false };
    const latest = { id: VERSION, number: '0.3', latest: true };
    const result = (kind: string, place: string | null, version: typeof earlier | null) =>
      resultLink({ kind, artifactId: ID, node: kind === 'section' ? NODE : null, place, version });
    expect(result('component', 'block:b2', earlier)).toBe(
      `#/components/${ID}/versions/${VERSION}/blocks/b2`,
    );
    expect(result('component', 'title', earlier)).toBe(`#/components/${ID}/versions/${VERSION}`);
    expect(result('section', 'title', earlier)).toBe(
      `#/documents/${ID}/versions/${VERSION}/nodes/${NODE}`,
    );
    expect(result('document', 'title', earlier)).toBe(`#/documents/${ID}/versions/${VERSION}`);
    // The latest opens the live page, as before.
    expect(result('component', 'block:b2', latest)).toBe(`#/components/${ID}/blocks/b2`);
    // Found in a baseline: the baseline's page, at the node.
    expect(
      resultLink({
        kind: 'component',
        artifactId: ID,
        node: null,
        place: 'block:b2',
        version: earlier,
        baseline: { id: BASELINE, name: 'Approved', document: VERSION, node: NODE },
      }),
    ).toBe(`#/documents/${VERSION}/baselines/${BASELINE}/nodes/${NODE}`);
  });

  it("reads a component version's address, with a block and without", () => {
    expect(componentAddress(componentVersionLink(ID, VERSION, 'b2'))).toEqual({
      component: ID,
      access: false,
      block: 'b2',
      version: VERSION,
    });
    expect(componentAddress(componentVersionLink(ID, VERSION))).toEqual({
      component: ID,
      access: false,
      block: null,
      version: VERSION,
    });
  });

  it('says where a result was found in words', () => {
    const fields = new Map([['f1', 'Reviewer']]);
    expect(whereFound('title', fields)).toBe('In its title');
    expect(whereFound('block:b2', fields)).toBe('In its text');
    expect(whereFound('field:f1', fields)).toBe('In Reviewer');
    expect(whereFound('field:f9', fields)).toBe('In a field');
    expect(whereFound('description', fields)).toBe('In its description');
    expect(whereFound('section:intro', fields)).toBe('In a starting section');
    expect(whereFound('fields', fields)).toBe('In the fields it groups');
    expect(whereFound('schemas', fields)).toBe('In the schemas it assigns');
    expect(whereFound('columns', fields)).toBe('In its column names');
    expect(whereFound(`message:${VERSION}`, fields)).toBe('In a message');
    expect(whereFound('anchor', fields)).toBe('In the text it is on');
    expect(whereFound('connection', fields)).toBeNull();
    expect(whereFound(null, fields)).toBeNull();
  });
});

describe("a search's address", () => {
  it('holds its query, and reads back what it wrote', () => {
    expect(searchAddress('#/search')).toBe('');
    expect(searchLink('')).toBe('#/search');
    expect(searchAddress(searchLink('lever -brake "hand lever"'))).toBe(
      'lever -brake "hand lever"',
    );
    expect(searchAddress('#/searches')).toBeNull();
    expect(searchAddress('#/components')).toBeNull();
  });

  it('holds which versions it searches, or the baseline, beside its query', () => {
    expect(searchScope('#/search?q=lever')).toEqual({ versions: 'latest', baseline: null });
    const every = searchLink('lever', { versions: 'all', baseline: null });
    expect(searchAddress(every)).toBe('lever');
    expect(searchScope(every)).toEqual({ versions: 'all', baseline: null });
    const pinned = searchLink('', { versions: 'latest', baseline: BASELINE });
    expect(searchAddress(pinned)).toBe('');
    expect(searchScope(pinned)).toEqual({ versions: 'latest', baseline: BASELINE });
    // A baseline searches what it pins: never every version as well.
    expect(searchScope(`#/search?versions=all&baseline=${BASELINE}`)).toEqual({
      versions: 'latest',
      baseline: BASELINE,
    });
    expect(searchScope('#/search?baseline=nonsense')).toEqual({
      versions: 'latest',
      baseline: null,
    });
  });
});
