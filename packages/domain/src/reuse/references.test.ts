import { describe, expect, it } from 'vitest';
import { referencesIn } from './references.js';

const COMPONENT = '00000000-0000-4000-8000-0000000000c1';
const PIN = '00000000-0000-4000-8000-0000000000f1';
const ASSET_VERSION = '00000000-0000-4000-8000-00000000a551';
const QUERY = '00000000-0000-4000-8000-00000000d001';
const QUERY_VERSION = '00000000-0000-4000-8000-00000000d002';
const CONNECTION = '00000000-0000-4000-8000-00000000c001';
const ENTRY = '00000000-0000-4000-8000-00000000b1b1';

describe('the references a version holds (the R2 plan, R2-A)', () => {
  it("lists a document's references to components, at any depth, each with its mode and pin", () => {
    const outline = {
      nodes: [
        {
          type: 'section',
          id: 's1',
          children: [
            {
              type: 'reference',
              id: 'r1',
              component: COMPONENT,
              mode: { kind: 'latest' },
              children: [],
            },
            {
              type: 'reference',
              id: 'r2',
              component: COMPONENT,
              mode: { kind: 'pinned', version: PIN },
              children: [],
            },
          ],
        },
        {
          type: 'reference',
          id: 'r3',
          component: COMPONENT,
          mode: { kind: 'approved' },
          children: [],
        },
      ],
    };
    expect(referencesIn('document', outline)).toEqual([
      { node: 'r1', target: { artifact: COMPONENT, kind: 'component' }, mode: 'latest' },
      {
        node: 'r2',
        target: { artifact: COMPONENT, kind: 'component' },
        mode: 'pinned',
        version: PIN,
      },
      { node: 'r3', target: { artifact: COMPONENT, kind: 'component' }, mode: 'approved' },
    ]);
  });

  it("lists a component's images by their asset versions and its bindings by their query definitions", () => {
    const content = {
      blocks: [
        { type: 'figure', id: 'f1', asset: ASSET_VERSION, caption: [] },
        {
          type: 'paragraph',
          id: 'p1',
          content: [
            { type: 'image', id: 'i1', asset: ASSET_VERSION },
            { type: 'binding', id: 'b1', query: QUERY, parameters: {} },
            { type: 'binding', id: 'b2', query: QUERY, version: QUERY_VERSION, parameters: {} },
          ],
        },
        // A figure taking its image from a binding names the definition, not an asset.
        { type: 'figure', id: 'f2', binding: { type: 'binding', id: 'b3', query: QUERY } },
        // A text that spells an identifier names nothing.
        { type: 'text', value: QUERY },
      ],
    };
    expect(referencesIn('component', content)).toEqual([
      { node: 'f1', target: { version: ASSET_VERSION, kind: 'asset' }, mode: 'pinned' },
      { node: 'i1', target: { version: ASSET_VERSION, kind: 'asset' }, mode: 'pinned' },
      { node: 'b1', target: { artifact: QUERY, kind: 'queryDefinition' }, mode: 'latest' },
      {
        node: 'b2',
        target: { artifact: QUERY, kind: 'queryDefinition' },
        mode: 'pinned',
        version: QUERY_VERSION,
      },
      { node: 'b3', target: { artifact: QUERY, kind: 'queryDefinition' }, mode: 'latest' },
    ]);
  });

  it("lists a component's citations by their bibliography entries, as its latest version follows them", () => {
    const content = {
      blocks: [
        {
          type: 'paragraph',
          id: 'p1',
          content: [
            { type: 'citation', entry: ENTRY, locator: 'p. 12' },
            // The fixtures' entries are no artifacts' ids: the index keeps only what names one.
            { type: 'citation', entry: 'bib-1' },
          ],
        },
      ],
    };
    expect(referencesIn('component', content)).toEqual([
      { node: null, target: { artifact: ENTRY, kind: 'bibliographyEntry' }, mode: 'latest' },
      { node: null, target: { artifact: 'bib-1', kind: 'bibliographyEntry' }, mode: 'latest' },
    ]);
  });

  it('lists a cross-reference to an entry as a use of the entry, as a citation is (CId)', () => {
    const content = {
      blocks: [
        {
          type: 'paragraph',
          id: 'p1',
          content: [
            {
              type: 'crossReference',
              id: 'x1',
              target: { kind: 'entry', entry: ENTRY },
              display: 'number',
            },
            { type: 'crossReference', id: 'x2', target: { kind: 'block', block: 'p1' } },
          ],
        },
      ],
    };
    expect(referencesIn('component', content)).toEqual([
      { node: 'x1', target: { artifact: ENTRY, kind: 'bibliographyEntry' }, mode: 'latest' },
    ]);
  });

  it("lists a query definition's connection, and nothing for a kind that refers to nothing", () => {
    expect(referencesIn('queryDefinition', { connection: CONNECTION })).toEqual([
      { node: null, target: { artifact: CONNECTION, kind: 'connection' }, mode: 'latest' },
    ]);
    expect(referencesIn('asset', { object: 'x' })).toEqual([]);
  });
});
