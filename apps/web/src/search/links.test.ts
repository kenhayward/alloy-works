import { describe, expect, it } from 'vitest';

import { componentAddress, resultLink, searchAddress, searchLink, whereFound } from './links.js';

const ID = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const NODE = 'abcdefghijklmnopqrstuvwxyz';

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

  it('reads a component address with a block, and without', () => {
    expect(componentAddress(`#/components/${ID}/blocks/b2`)).toEqual({
      component: ID,
      access: false,
      block: 'b2',
    });
    expect(componentAddress(`#/components/${ID}/access`)).toEqual({
      component: ID,
      access: true,
      block: null,
    });
    expect(componentAddress(`#/components/${ID}`)).toEqual({
      component: ID,
      access: false,
      block: null,
    });
    expect(componentAddress('#/components')).toBeNull();
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
    expect(whereFound('connection', fields)).toBe("In its connection's name");
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
});
