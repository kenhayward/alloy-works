import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { Block, DecomposedDocument, Inline } from '@kenhayward/bridge-contract';
import { describe, expect, it } from 'vitest';

import { parseContentDocument } from '../content/model/index.js';
import { parseOutlineDocument } from '../structure/outline.js';

import { mapDocument } from './document.js';
import { componentIdFor, elementIdFor } from './ids.js';

const require = createRequire(import.meta.url);
const ASSET = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
const VERSION = '3b1f6a52-9c04-4d7e-a1b8-52e6f0c97d34';

const cellOf = (blocks: Block[]) => ({
  rowSpan: 1,
  colSpan: 1,
  hAlign: 'left' as const,
  vAlign: 'top' as const,
  header: false,
  blocks,
});
const cellTable = () => ({
  kind: 'table' as const,
  id: 'tab',
  numbered: false,
  caption: [],
  captionPosition: 'above' as const,
  columnWidths: [],
  headerRows: 0,
  notes: [],
  wide: false,
  key: null,
  rows: [],
});
const text = (value: string): Inline => ({ kind: 'text', text: value, marks: [] });
const para = (id: string, ...inlines: Inline[]): Block => ({ kind: 'paragraph', id, inlines });
const section = (
  id: string,
  title: string,
  blocks: Block[] = [],
  sections: DecomposedDocument['sections'] = [],
): DecomposedDocument['sections'][number] => ({
  id,
  title: title === '' ? [] : [text(title)],
  blocks,
  sections,
});
const documentOf = (
  over: Partial<DecomposedDocument> & Pick<DecomposedDocument, 'sections'>,
): DecomposedDocument => ({
  blocks: [],
  images: [],
  equations: [],
  notes: [],
  properties: [],
  report: [],
  ...over,
});
const input = { persistentId: 'persist-1', title: 'Report', assets: new Map<string, string>() };
const pinsFor = (mapped: ReturnType<typeof mapDocument>): Map<string, string> =>
  new Map(mapped.components.map((component) => [component.artifactId, VERSION]));

describe('mapDocument', () => {
  it('API-070 a section component keeps its artifact id across two mappings', () => {
    const document = documentOf({ sections: [section('s1', 'One', [para('p1', text('Hi'))])] });
    const first = mapDocument(document, input);
    const second = mapDocument(structuredClone(document), input);
    expect(first.components[0]!.artifactId).toBe(componentIdFor('persist-1', 's1'));
    expect(second.components.map((component) => component.artifactId)).toEqual(
      first.components.map((component) => component.artifactId),
    );
    expect(second.components).toEqual(first.components);
  });

  it('leading blocks become the lead component, referenced first', () => {
    const document = documentOf({
      blocks: [para('lead-1', text('Before any heading'))],
      sections: [section('s1', 'One', [para('p1', text('Hi'))])],
    });
    const mapped = mapDocument(document, input);
    expect(mapped.components.map((component) => component.section)).toEqual(['~lead', 's1']);
    expect(mapped.components[0]!.artifactId).toBe(componentIdFor('persist-1', '~lead'));
    expect(mapped.components[0]!.title).toBe('Report');
    const outline = parseOutlineDocument(mapped.outline(pinsFor(mapped)));
    expect(outline.nodes.map((node) => node.type)).toEqual(['reference', 'section']);
    expect(outline.nodes[0]).toMatchObject({ component: mapped.components[0]!.artifactId });
  });

  it('a section with no blocks is a section node alone', () => {
    const document = documentOf({
      sections: [section('s1', 'Part', [], [section('s2', 'Chapter', [para('p1', text('Hi'))])])],
    });
    const mapped = mapDocument(document, input);
    expect(mapped.components.map((component) => component.section)).toEqual(['s2']);
    const outline = parseOutlineDocument(mapped.outline(pinsFor(mapped)));
    const part = outline.nodes[0]!;
    expect(part).toMatchObject({ type: 'section', numbered: false, matter: 'body' });
    expect(part.children.map((node) => node.type)).toEqual(['section']);
  });

  it('a section component is its section first child, nested sections after it', () => {
    const document = documentOf({
      sections: [
        section(
          's1',
          'Parent',
          [para('p1', text('Own'))],
          [section('s2', 'Child', [para('p2', text('Kid'))])],
        ),
      ],
    });
    const mapped = mapDocument(document, input);
    const outline = parseOutlineDocument(mapped.outline(pinsFor(mapped)));
    expect(outline.nodes[0]!.children.map((node) => node.type)).toEqual(['reference', 'section']);
    expect(mapped.components[0]!.title).toBe('Parent');
  });

  it('API-073 an empty section title takes its first words and is reported', () => {
    const document = documentOf({
      sections: [
        section('s1', '', [para('p1', text('The quick brown fox jumps over the lazy dog today'))]),
      ],
    });
    const mapped = mapDocument(document, input);
    expect(mapped.components[0]!.title).toBe('The quick brown fox jumps over the lazy');
    expect(mapped.carried).toEqual([{ code: 'title_from_text', element: 's1', detail: 'words' }]);
    const outline = parseOutlineDocument(mapped.outline(pinsFor(mapped)));
    expect(outline.nodes[0]).toMatchObject({
      title: [{ type: 'text', value: 'The quick brown fox jumps over the lazy' }],
    });
  });

  it('API-073 an empty title with no words to take is Section n by its position', () => {
    const document = documentOf({
      sections: [section('s1', 'First', [para('p1', text('Hi'))]), section('s2', '')],
    });
    const mapped = mapDocument(document, input);
    expect(mapped.carried).toEqual([
      { code: 'title_from_text', element: 's2', detail: 'position' },
    ]);
    const outline = parseOutlineDocument(mapped.outline(pinsFor(mapped)));
    expect(outline.nodes[1]).toMatchObject({ title: [{ type: 'text', value: 'Section 2' }] });
  });

  it('every component and the outline are language und, ltr', () => {
    const document = documentOf({
      blocks: [para('l', text('Lead'))],
      sections: [section('s1', 'One', [para('p1', text('Hi'))])],
    });
    const mapped = mapDocument(document, input);
    for (const component of mapped.components) {
      expect(component.content).toMatchObject({ language: 'und', direction: 'ltr' });
      parseContentDocument(component.content);
    }
    expect(mapped.outline(pinsFor(mapped))).toMatchObject({ language: 'und', direction: 'ltr' });
  });

  it('the outline pins each reference to the version given', () => {
    const document = documentOf({ sections: [section('s1', 'One', [para('p1', text('Hi'))])] });
    const mapped = mapDocument(document, input);
    const id = mapped.components[0]!.artifactId;
    const outline = mapped.outline(new Map([[id, VERSION]]));
    expect(outline.nodes[0]!.children[0]).toMatchObject({
      type: 'reference',
      component: id,
      mode: { kind: 'pinned', version: VERSION },
      numbered: false,
      pageBreak: 'none',
      values: {},
    });
    expect(() => mapped.outline(new Map())).toThrow(/No version/);
  });

  it('a cross-reference into another section points at that component, and at a section at its node', () => {
    const document = documentOf({
      sections: [
        section('s1', 'One', [
          para('p1', { kind: 'xref', targetId: 'p2', text: 'later' }, text(' '), {
            kind: 'xref',
            targetId: 'p1',
            text: 'here',
          }),
          para('p3', { kind: 'xref', targetId: 's2', text: 'Two' }),
        ]),
        section('s2', 'Two', [para('p2', text('Target'))]),
      ],
    });
    const mapped = mapDocument(document, input);
    const [one, two] = mapped.components;
    const refs = one!.content.content[0] as { content: { type: string; target: unknown }[] };
    const crossings = refs.content.filter((inline) => inline.type === 'crossReference');
    expect(crossings[0]!.target).toEqual({
      kind: 'component',
      component: two!.artifactId,
      block: elementIdFor(two!.artifactId, 'p2'),
    });
    expect(crossings[1]!.target).toEqual({
      kind: 'block',
      block: elementIdFor(one!.artifactId, 'p1'),
    });
    const toSection = one!.content.content[1] as { content: { type: string; target: unknown }[] };
    expect(toSection.content[0]!.target).toEqual({
      kind: 'node',
      node: elementIdFor('persist-1', 's2'),
    });
    parseContentDocument(one!.content);
  });

  it('the package fixture maps to components and an outline the model accepts', () => {
    const fixture = join(
      dirname(dirname(require.resolve('@kenhayward/bridge-contract'))),
      'test',
      'fixtures',
      'package-decomposed.json',
    );
    const delivery = JSON.parse(readFileSync(fixture, 'utf8')) as {
      document: DecomposedDocument;
    };
    const assets = new Map(delivery.document.images.map((image) => [image.id, ASSET]));
    const mapped = mapDocument(delivery.document, {
      persistentId: 'persist-fixture',
      title: 'Example',
      assets,
    });
    expect(mapped.components.length).toBeGreaterThan(0);
    for (const component of mapped.components) parseContentDocument(component.content);
    parseOutlineDocument(mapped.outline(pinsFor(mapped)));
  });

  it('a cross-reference to a block the mapping dropped or flattened never names a missing id', () => {
    const empty = para('e2');
    const nested: Block = {
      kind: 'table',
      id: 'inner',
      numbered: false,
      caption: [],
      captionPosition: 'above',
      columnWidths: [],
      headerRows: 0,
      notes: [],
      wide: false,
      key: null,
      rows: [{ cells: [cellOf([para('deep', text('Deep'))])] }],
    };
    const outer: Block = {
      ...(nested as object),
      id: 'outer',
      rows: [{ cells: [cellOf([nested])] }],
    } as Block;
    const xrefs = (...ids: string[]) =>
      para(
        'x',
        ...ids.flatMap((id) => [{ kind: 'xref' as const, targetId: id, text: id }, text(' ')]),
      );
    const document = documentOf({
      blocks: [para('e1'), empty, para('lead-text', text('Lead'))],
      sections: [
        section('s1', 'One', [xrefs('e2', 'deep', 'inner'), outer]),
        section('s2', 'Two', [para('p', text('Two'))]),
      ],
    });
    const mapped = mapDocument(document, input);
    const made = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        const node = value as { id?: unknown };
        if (typeof node.id === 'string') made.add(node.id);
        Object.values(value).forEach(walk);
      }
    };
    mapped.components.forEach((component) => walk(component.content));
    const pins = pinsFor(mapped);
    const outline = parseOutlineDocument(mapped.outline(pins));
    const nodes = new Set<string>();
    const nodeWalk = (list: readonly (typeof outline.nodes)[number][]): void =>
      list.forEach((node) => {
        nodes.add(node.id);
        nodeWalk(node.children);
      });
    nodeWalk(outline.nodes);
    const one = mapped.components.find((component) => component.section === 's1')!;
    const targets = (
      one.content.content[0] as {
        content: { type: string; target?: { kind: string; node?: string; block?: string } }[];
      }
    ).content
      .filter((inline) => inline.type === 'crossReference')
      .map((inline) => inline.target!);
    expect(targets).toHaveLength(3);
    for (const target of targets) {
      if (target.kind === 'node') expect(nodes.has(target.node!)).toBe(true);
      else expect(made.has(target.block!)).toBe(true);
    }
    parseContentDocument(one.content);
  });

  it('a cross-reference to a figure in a cell, with a caption, takes the section node', () => {
    const figure: Block = {
      kind: 'figure',
      id: 'fig',
      imageId: 'img1',
      numbered: true,
      caption: [text('Caption')],
      captionPosition: 'below',
    };
    const document = documentOf({
      images: [
        {
          id: 'img1',
          contentType: 'image/png',
          widthMm: 1,
          heightMm: 1,
          align: 'left',
          alt: 'A chart',
          origin: 'embedded',
          originalContentType: null,
        },
      ],
      sections: [
        section('s1', 'One', [
          para('x', { kind: 'xref', targetId: 'fig', text: 'figure' }),
          { ...(cellTable() as object), rows: [{ cells: [cellOf([figure])] }] } as Block,
        ]),
      ],
    });
    const mapped = mapDocument(document, { ...input, assets: new Map([['img1', ASSET]]) });
    const target = (
      mapped.components[0]!.content.content[0] as { content: { type: string; target?: unknown }[] }
    ).content.find((inline) => inline.type === 'crossReference')!.target;
    expect(target).toEqual({ kind: 'node', node: elementIdFor('persist-1', 's1') });
  });
});
