import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contentDocumentSchema } from '../content/model/document.js';
import { canonicalJson } from '../stored/canonical.js';
import { canonicaliseVersionContent } from '../version/substance.js';

import {
  canonicaliseOutline,
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  readOutline,
  type OutlineDocument,
  type OutlineNode,
} from './outline.js';

const NODE = 'a'.repeat(26);
const OTHER = 'b'.repeat(26);
const COMPONENT = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';

const fixtures = join(import.meta.dirname, 'fixtures');

const empty: OutlineDocument = {
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The dosing report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [],
};

const section = (id: string, over: Record<string, unknown> = {}) => ({
  type: 'section',
  id,
  title: [{ type: 'text', value: 'Introduction', marks: [] }],
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children: [],
  ...over,
});

describe('the outline a document version holds', () => {
  it('STR-001 gives a document exactly one outline, an ordered tree with nowhere for a second', () => {
    expect(parseOutlineDocument(empty).nodes).toEqual([]);
    const ordered = parseOutlineDocument({ ...empty, nodes: [section(NODE), section(OTHER)] });
    expect(ordered.nodes.map((node) => node.id)).toEqual([NODE, OTHER]);
    // The root is closed: there is no second array to put an outline in.
    expect(() => parseOutlineDocument({ ...empty, outline: [] })).toThrow();
    expect(() => parseOutlineDocument({ ...empty, nodes: {} })).toThrow();
  });

  it('STR-002 makes every node either a section or a component reference, and nothing else', () => {
    const both = parseOutlineDocument({
      ...empty,
      nodes: [
        section(NODE, {
          children: [
            {
              type: 'reference',
              id: OTHER,
              component: COMPONENT,
              mode: { kind: 'latest' },
              numbered: true,
              matter: 'body',
              pageBreak: 'none',
              values: {},
              children: [],
            },
          ],
        }),
      ],
    });
    expect(both.nodes[0]?.children[0]?.type).toBe('reference');
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [{ ...section(NODE), type: 'paragraph' }] }),
    ).toThrow();
  });

  it('gives a node an identifier unique within its outline, as a block has within its component', () => {
    // Not STR-002's own clause - STR-003's, exercised again in task 2 against real allocation.
    expect(() => parseOutlineDocument({ ...empty, nodes: [section(NODE), section(NODE)] })).toThrow(
      /used more than once/,
    );
  });

  it('STR-048 lets a node declare that it begins on a new page, or on a new recto page', () => {
    for (const pageBreak of ['none', 'page', 'recto']) {
      const parsed = parseOutlineDocument({ ...empty, nodes: [section(NODE, { pageBreak })] });
      expect(parsed.nodes[0]).toMatchObject({ pageBreak });
    }
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [section(NODE, { pageBreak: 'verso' })] }),
    ).toThrow();
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [{ ...section(NODE), pageBreak: undefined }] }),
    ).toThrow();
  });

  it('STR-049 makes the page-break declaration a property of the node, never of the content', () => {
    // The node carries it, and `contentDocumentSchema`'s root and every block refuse it, so the
    // declaration cannot travel with a component reused somewhere it should not break a page.
    const parsed = parseOutlineDocument({
      ...empty,
      nodes: [section(NODE, { pageBreak: 'page' })],
    });
    expect(parsed.nodes[0]).toHaveProperty('pageBreak', 'page');
    expect(() =>
      contentDocumentSchema.parse({
        schemaVersion: 1,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        pageBreak: 'page',
        content: [{ type: 'paragraph', id: 'p1', style: 'body', content: [] }],
      }),
    ).toThrow();
    expect(() =>
      contentDocumentSchema.parse({
        schemaVersion: 1,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        content: [{ type: 'paragraph', id: 'p1', style: 'body', content: [], pageBreak: 'page' }],
      }),
    ).toThrow();
  });

  it('STR-058 records which of the three reference modes a component reference takes', () => {
    const reference = (mode: unknown) => ({
      type: 'reference',
      id: NODE,
      component: COMPONENT,
      mode,
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    });
    for (const mode of [
      { kind: 'pinned', version: '11111111-1111-4111-8111-111111111111' },
      { kind: 'latest' },
      { kind: 'approved' },
    ]) {
      expect(parseOutlineDocument({ ...empty, nodes: [reference(mode)] }).nodes[0]).toMatchObject({
        mode,
      });
    }
    // The three are closed, absent is not a fourth, and pinned without a version is not pinned.
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [reference({ kind: 'draft' })] }),
    ).toThrow();
    expect(() =>
      parseOutlineDocument({ ...empty, nodes: [reference({ kind: 'pinned' })] }),
    ).toThrow();
    expect(() =>
      parseOutlineDocument({
        ...empty,
        nodes: [{ ...reference({ kind: 'latest' }), mode: undefined }],
      }),
    ).toThrow();
  });

  it('canonicalises two identical outlines to one string where their marks were built in two orders', () => {
    const marks = [
      { type: 'emphasis', id: 'm2' },
      { type: 'strong', id: 'm1' },
    ];
    const titled = (order: typeof marks) =>
      parseOutlineDocument({
        ...empty,
        nodes: [section(NODE, { title: [{ type: 'text', value: 'Dosing', marks: order }] })],
      });
    const one = titled(marks);
    const other = titled([...marks].reverse());
    expect(canonicaliseOutline(one)).toBe(canonicaliseOutline(other));
    expect(canonicaliseVersionContent({ kind: 'document', content: one })).toBe(
      canonicaliseVersionContent({ kind: 'document', content: other }),
    );
    // The shared rule, which the version chain's `else` branch would have reached, gives two.
    expect(canonicalJson(one)).not.toBe(canonicalJson(other));
  });

  it('reads a stored outline through its own migration chain, and says why one will not read', () => {
    const outcome = readOutline(empty, { artifact: 'a', version: 'v' });
    expect(outcome.ok && outcome.outline.title).toBe('The dosing report');
    const refused = readOutline({ schemaVersion: 1, title: '' }, { artifact: 'a', version: 'v' });
    expect(refused.ok).toBe(false);
    expect(readOutline({}, { artifact: 'a', version: 'v' })).toMatchObject({ ok: false });
  });

  it('parses every fixture stored at every schema version, and the fixture holds every node', () => {
    for (const version of readdirSync(fixtures)) {
      for (const file of readdirSync(join(fixtures, version))) {
        const stored: unknown = JSON.parse(readFileSync(join(fixtures, version, file), 'utf8'));
        expect(readOutline(stored, { artifact: 'a', version: 'v' }).ok).toBe(true);
      }
    }
    const every: OutlineDocument = JSON.parse(
      readFileSync(join(fixtures, 'v1', 'every-node.json'), 'utf8'),
    );
    const types = new Set<string>();
    const modes = new Set<string>();
    const breaks = new Set<string>();
    const walk = (nodes: readonly OutlineNode[]) => {
      for (const node of nodes) {
        types.add(node.type);
        breaks.add(node.pageBreak);
        if (node.type === 'reference') modes.add(node.mode.kind);
        walk(node.children);
      }
    };
    walk(parseOutlineDocument(every).nodes);
    expect([...types].sort()).toEqual(['reference', 'section']);
    expect([...modes].sort()).toEqual(['approved', 'latest', 'pinned']);
    expect([...breaks].sort()).toEqual(['none', 'page', 'recto']);
  });
});
