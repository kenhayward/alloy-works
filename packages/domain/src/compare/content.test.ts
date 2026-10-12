import { describe, expect, it } from 'vitest';

import type { BlockNode, ContentDocument } from '../content/model/index.js';
import {
  OUTLINE_SCHEMA_VERSION,
  type OutlineDocument,
  type OutlineNode,
} from '../structure/outline.js';
import {
  compareContent,
  compareOutlines,
  createMeter,
  unitTexts,
  type UnitChange,
} from './content.js';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const para = (id: string, value: string, style = 'body'): BlockNode => ({
  type: 'paragraph',
  id,
  style,
  content: value === '' ? [] : [text(value)],
});
const docOf = (...content: BlockNode[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

const matched = (changes: readonly UnitChange[]) =>
  changes.flatMap((each) => (each.change === 'matched' ? [each] : []));
const kinds = (changes: readonly UnitChange[]) => changes.map((each) => each.change);
const keyOf = (change: UnitChange) => (change.change === 'deleted' ? change.older : change.newer);

// Case 7 of the content model spike, on the content model as it is stored: Bravo moves past two
// blocks and is reworded, so exactly one block moved and two shifted.
const before = docOf(
  para('b1', 'Alpha'),
  para('b2', 'Bravo'),
  para('b3', 'Charlie'),
  para('b4', 'Delta'),
);
const after = docOf(
  para('b1', 'Alpha'),
  para('b3', 'Charlie'),
  para('b4', 'Delta'),
  para('b2', 'Bravo, revised'),
);
/** The same documents with no identifier in common, as after a restore or an import. */
const anonymous = (document: ContentDocument, prefix: string): ContentDocument => ({
  ...document,
  content: document.content.map((block, index) => ({ ...block, id: `${prefix}${index}` })),
});

describe('comparing two versions of a component', () => {
  it('VER-027 reports a paragraph moved past two others and reworded as one change, the others standing still', () => {
    const changes = compareContent(before, after).changes;
    expect(kinds(changes)).not.toContain('inserted');
    expect(kinds(changes)).not.toContain('deleted');
    const bravo = matched(changes).find((each) => each.newer === 'b2')!;
    expect(bravo.moved).toEqual({ after: 'b4' });
    expect(bravo.edited).toMatchObject({ ops: expect.any(Array) });
    for (const still of ['b1', 'b3', 'b4']) {
      const change = matched(changes).find((each) => each.newer === still)!;
      expect(change).toMatchObject({ moved: null, edited: null, changed: [] });
    }
  });

  it('VER-028 matches by similarity, at 0.4 or more, where the two share no identifier, and below it reports a deletion and an insertion', () => {
    const changes = compareContent(anonymous(before, 'o'), anonymous(after, 'n')).changes;
    expect(kinds(changes)).not.toContain('inserted');
    const bravo = matched(changes).find((each) => each.older === 'o1')!;
    expect(bravo).toMatchObject({ newer: 'n3', matched: 'similarity', moved: { after: 'n2' } });

    const apart = compareContent(
      anonymous(docOf(para('x', 'Alpha'), para('y', 'Bravo')), 'o'),
      anonymous(docOf(para('x', 'Alpha'), para('y', 'Something else')), 'n'),
    ).changes;
    expect(kinds(apart).sort()).toEqual(['deleted', 'inserted', 'matched']);
  });

  it('VER-029 names how every matched change was matched', () => {
    for (const change of matched(compareContent(before, after).changes)) {
      expect(change.matched).toBe('identity');
    }
    for (const change of matched(
      compareContent(anonymous(before, 'o'), anonymous(after, 'n')).changes,
    )) {
      expect(change.matched).toBe('similarity');
    }
  });

  it('VER-024 compares the text inside a block word by word, and its attributes apart', () => {
    const [change] = compareContent(
      docOf(para('p1', 'Set the tray, then wait.')),
      docOf(para('p1', 'Set the new tray, then wait an hour.', 'note')),
    ).changes;
    expect(change).toMatchObject({ change: 'matched', changed: ['style'] });
    if (change?.change !== 'matched' || change.edited === null || !('ops' in change.edited)) {
      throw new Error('not edited');
    }
    expect(change.edited.ops.filter((op) => op.op !== 'keep')).toEqual([
      { op: 'insert', text: 'new ' },
      { op: 'insert', text: ' an hour' },
    ]);
  });

  it('keys a list item by its first block, so an item added is one insertion and its term an edit of the item', () => {
    const list = (items: { first: string; term: string }[]): BlockNode => ({
      type: 'list',
      id: 'l1',
      kind: 'definition',
      items: items.map((each) => ({
        term: [text(each.term)],
        content: [para(each.first, `Defined as ${each.term}`)],
      })),
    });
    const changes = compareContent(
      docOf(
        list([
          { first: 'a1', term: 'Tray' },
          { first: 'a2', term: 'Light' },
        ]),
      ),
      docOf(
        list([
          { first: 'a1', term: 'The tray' },
          { first: 'a3', term: 'Lid' },
          { first: 'a2', term: 'Light' },
        ]),
      ),
    ).changes;
    expect(changes.filter((each) => each.change === 'inserted').map(keyOf)).toEqual([
      'item:a3',
      'a3',
    ]);
    const tray = matched(changes).find((each) => each.newer === 'item:a1')!;
    expect(tray.edited).not.toBeNull();
    expect(matched(changes).find((each) => each.newer === 'item:a2')!.moved).toBeNull();
  });

  it('keys a table cell by its row and column, and a row added is the table’s shape changing', () => {
    const table = (rows: string[][]): BlockNode => ({
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [text('Doses')],
      headerRows: 1,
      headerColumns: 0,
      rows: rows.map((row, r) => ({
        cells: row.map((value, c) => ({
          content: [para(`c${r}${c}`, value)],
          colspan: 1,
          rowspan: 1,
        })),
      })),
    });
    const changes = compareContent(
      docOf(
        table([
          ['Dose', 'Time'],
          ['5', '9'],
        ]),
      ),
      docOf(
        table([
          ['Dose', 'Time'],
          ['6', '9'],
          ['7', '12'],
        ]),
      ),
    ).changes;
    expect(matched(changes).find((each) => each.newer === 't1')!.changed).toEqual(['shape']);
    expect(matched(changes).find((each) => each.newer === 'c10')!.edited).not.toBeNull();
    expect(changes.filter((each) => each.change === 'inserted').map(keyOf)).toContain(
      'cell:t1:2:0',
    );
  });

  it('reports a footnote edited once, beneath the footnote, and its paragraph unchanged around it', () => {
    const withNote = (note: string): BlockNode => ({
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [
        text('Set the tray'),
        {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [para('fp1', note)],
        },
        text('.'),
      ],
    });
    const changes = compareContent(
      docOf(withNote('Any tray.')),
      docOf(withNote('Any tray will do.')),
    ).changes;
    expect(matched(changes).find((each) => each.newer === 'p1')).toMatchObject({
      edited: null,
      changed: [],
    });
    expect(matched(changes).find((each) => each.newer === 'fp1')!.edited).not.toBeNull();
  });

  it('reports a split and a join as such, never as a block changed out of recognition', () => {
    const split = compareContent(
      docOf(para('p1', 'Set the tray. Then wait.')),
      docOf(para('p1', 'Set the tray.'), para('p2', 'Then wait.')),
    ).changes;
    expect(matched(split).find((each) => each.newer === 'p1')!.split).toBe('p2');
    const joined = compareContent(
      docOf(para('p1', 'Set the tray.'), para('p2', 'Then wait.')),
      docOf(para('p1', 'Set the tray. Then wait.')),
    ).changes;
    expect(matched(joined).find((each) => each.newer === 'p1')!.joined).toBe('p2');
  });

  it('VER-051 compares a document of 300 components of 20 blocks with ten changes within its counted budget', () => {
    const meter = createMeter();
    for (let component = 0; component < 300; component += 1) {
      const blocks = Array.from({ length: 20 }, (_, index) =>
        para(`c${component}b${index}`, `Step ${index} of procedure ${component}, as written.`),
      );
      const changed = component % 30 === 0;
      const newer = changed
        ? blocks.map((block, index) =>
            index === 3 ? para(block.id, 'Step three, rewritten entirely.') : block,
          )
        : blocks;
      compareContent(docOf(...blocks), docOf(...newer), meter);
    }
    // Identity settles every block, so no similarity is scored, and only the ten edited blocks
    // are compared word by word.
    expect(meter.similarityPairs).toBe(0);
    expect(meter.wordCells).toBeLessThan(10 * 15 * 15);
  });
});

describe('the text of each unit', () => {
  it('prints each unit’s own text by its key, a footnote standing as one character', () => {
    const texts = unitTexts(docOf(para('p1', 'Set the tray.')));
    expect(texts.get('p1')).toEqual({ type: 'paragraph', parent: 'root', text: 'Set the tray.' });
  });
});

describe('comparing two outlines', () => {
  const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
  const section = (id: string, title: string, children: OutlineNode[] = []): OutlineNode => ({
    type: 'section',
    id,
    title: [text(title)],
    ...base,
    children,
  });
  const reference = (id: string, component: string): OutlineNode => ({
    type: 'reference',
    id,
    component,
    mode: { kind: 'latest' },
    ...base,
    children: [],
  });
  const outline = (...nodes: OutlineNode[]): OutlineDocument => ({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'Report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  });

  it('VER-024 reports a section moved, one retitled and a reference added, as the structure changed', () => {
    const changes = compareOutlines(
      outline(
        section('s1', 'Introduction', [reference('r1', 'c1')]),
        section('s2', 'Method'),
        section('s3', 'Results'),
      ),
      outline(
        section('s1', 'Introduction', [reference('r1', 'c1'), reference('r2', 'c2')]),
        section('s3', 'Findings'),
        section('s2', 'Method'),
      ),
    ).changes;
    expect(
      changes
        .filter((each) => each.change === 'inserted')
        .map((each) => each.change === 'inserted' && each.newer),
    ).toEqual(['r2']);
    const moved = matched(changes)
      .filter((each) => each.moved !== null)
      .map((each) => each.newer);
    expect(moved).toHaveLength(1);
    expect(matched(changes).find((each) => each.newer === 's3')!.edited).not.toBeNull();
  });
});
