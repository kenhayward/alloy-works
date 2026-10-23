import { describe, expect, it } from 'vitest';
import { blockIdentifierFrom } from '../content/model/identifier.js';
import { DEFAULT_IMPORT_LEVELS, proposeImport, type ImportFlowItem } from './proposal.js';
import type { ImportComment } from './structure.js';

let next = 0;
const options = {
  language: 'en',
  direction: 'ltr' as const,
  newIdentifier: () => {
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setUint32(12, (next += 1));
    return blockIdentifierFrom(bytes);
  },
};

const heading = (level: number, text: string, anchor?: string): ImportFlowItem => ({
  kind: 'heading',
  level,
  style: `Heading ${level}`,
  text,
  ...(anchor === undefined ? {} : { anchor }),
});
const run = (value: string, change?: object) => ({
  type: 'text',
  value,
  marks: [],
  ...(change === undefined ? {} : { change }),
});
const block = (content: object[], id?: string): ImportFlowItem => ({
  kind: 'block',
  block: { type: 'paragraph', ...(id === undefined ? {} : { id }), content },
  source: '',
});
const insert = (author: string, id = '1') => ({ kind: 'insert', author, id });
const remove = (author: string, id = '2') => ({ kind: 'delete', author, id });
const textOf = (value: unknown): string =>
  (value as { content: { value?: string }[] }).content.map((each) => each.value ?? '').join('');

describe('proposeImport, structure (IMc)', () => {
  it("IMP-005 proposes each Word author's changes in a component as one suggestion against its text with every change rejected", () => {
    const { parts } = proposeImport(
      [
        heading(2, 'Sampling'),
        block([
          run('The newts '),
          run('quickly ', insert('Ada')),
          run('slowly ', remove('Grace')),
          run('left.'),
        ]),
        block([run('Then rain.', insert('Ada', '3'))]),
        block([run('Counted by Edsger.')]),
      ],
      DEFAULT_IMPORT_LEVELS,
      options,
    );
    const [part] = parts;
    expect(part!.blocks.map(textOf)).toEqual(['The newts slowly left.', 'Counted by Edsger.']);
    expect(
      part!.changes.map((change) => [change.author, change.block, change.proposed.map(textOf)]),
    ).toEqual([
      ['Ada', part!.blocks[0]!.id, ['The newts quickly slowly left.', 'Then rain.']],
      ['Grace', part!.blocks[0]!.id, ['The newts left.']],
    ]);
    // A suggestion's blocks are the component's own, and what it inserts is new.
    const [ada] = part!.changes;
    expect(ada!.proposed[0]!.id).toBe(part!.blocks[0]!.id);
    expect(part!.blocks.map((each) => each.id)).not.toContain(ada!.proposed[1]!.id);
    expect(part!.flags).toEqual([]);
  });

  it('IMP-005 proposes the deletion of each of two paragraphs an author deleted whole, one after the other', () => {
    const { parts } = proposeImport(
      [
        heading(2, 'Sampling'),
        block([run('Kept.')]),
        block([run('First gone.', remove('Grace', '4'))]),
        block([run('Second gone.', remove('Grace', '5'))]),
        block([run('Also kept.')]),
      ],
      DEFAULT_IMPORT_LEVELS,
      options,
    );
    const [part] = parts;
    const [, first, second] = part!.blocks;
    expect(part!.changes.map((change) => change.block)).toEqual([first!.id, second!.id]);
    const proposed = part!.blocks.flatMap((each) => {
      const change = part!.changes.find((one) => one.block === each.id);
      return change ? change.proposed : [each];
    });
    expect(proposed.map(textOf).filter((text) => text !== '')).toEqual(['Kept.', 'Also kept.']);
  });

  it('IMP-005 keeps a change crossing a split in the part it starts in, flagged', () => {
    const { parts } = proposeImport(
      [
        heading(2, 'Before'),
        block([run('Ponds '), run('and lakes', insert('Ada', '7'))]),
        heading(2, 'After'),
        block([run('more lakes', insert('Ada', '7')), run(' dried.')]),
      ],
      DEFAULT_IMPORT_LEVELS,
      options,
    );
    expect(parts.map((part) => [part.title, part.changes.length, part.flags])).toEqual([
      ['Before', 1, ['changeClamped']],
      ['After', 0, []],
    ]);
    expect(parts[1]!.blocks.map(textOf)).toEqual([' dried.']);
  });

  it('IMP-005 proposes a comment as a thread anchored to its span, its replies as its comments, and one crossing a block anchored where it starts and flagged', () => {
    const comment = (id: string, block: string, quote: string, crossed = false): ImportComment => ({
      id,
      block,
      quote,
      before: '',
      crossed,
      author: 'Ada',
      initials: 'AL',
      date: null,
      text: `Comment ${id}`,
      replies: id === '0' ? [{ author: 'Grace', initials: null, date: null, text: 'Agreed.' }] : [],
    });
    const { parts } = proposeImport(
      [
        heading(2, 'Counts', 'wb-1'),
        block([run('We saw three newts today.')], 'wb-2'),
        block([run('Then we left')], 'wb-3'),
        block([run('for home.')]),
      ],
      DEFAULT_IMPORT_LEVELS,
      {
        ...options,
        comments: [
          comment('0', 'wb-2', 'three newts'),
          comment('2', 'wb-3', 'we left', true),
          comment('4', 'wb-1', 'Counts'),
        ],
      },
    );
    const [part] = parts;
    const [first, second] = part!.blocks;
    expect(
      part!.threads.map((each) => [
        each.comment,
        each.block,
        each.span,
        each.clamped,
        each.replies.length,
      ]),
    ).toEqual([
      ['0', first!.id, true, false, 1],
      ['2', second!.id, true, true, 0],
      // On the heading, which is the component's title: on the component.
      ['4', first!.id, false, false, 0],
    ]);
    expect(part!.flags).toEqual(['commentClamped']);
  });

  it("IMP-006 records where each block a reference may name was admitted, and each part's heading", () => {
    const { parts, anchors } = proposeImport(
      [heading(1, 'Methods', 'wb-1'), heading(2, 'Sampling'), block([run('Nets.')], 'wb-9')],
      DEFAULT_IMPORT_LEVELS,
      options,
    );
    expect(parts.map((part) => part.headings)).toEqual([['wb-1'], []]);
    expect(anchors).toEqual({ 'wb-9': parts[1]!.blocks[0]!.id });
  });
});
