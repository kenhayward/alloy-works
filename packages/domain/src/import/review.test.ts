import { describe, expect, it } from 'vitest';
import { blockIdentifierFrom } from '../content/model/identifier.js';
import { DEFAULT_IMPORT_LEVELS, proposeImport, type ImportFlowItem } from './proposal.js';
import {
  acceptedCounts,
  blockText,
  editProposal,
  partMatches,
  reviewFlags,
  type ReviewPart,
} from './review.js';

let next = 0;
const newIdentifier = () => {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(12, (next += 1));
  return blockIdentifierFrom(bytes);
};
const context = { language: 'en', direction: 'ltr' as const };

const heading = (level: number, text: string): ImportFlowItem => ({
  kind: 'heading',
  level,
  style: `Heading ${level}`,
  text,
});
const para = (text: string): ImportFlowItem => ({
  kind: 'block',
  block: { type: 'paragraph', content: [{ type: 'text', value: text, marks: [] }] },
  source: text,
});
const texts = (part: ReviewPart | undefined) =>
  (part?.blocks ?? []).map((block) =>
    (block as { content: { value: string }[] }).content.map((each) => each.value).join(''),
  );

/** Ada's report as read: Introduction; Methods, holding Sampling and Analysis; Results. */
function read(): ReviewPart[] {
  const { parts } = proposeImport(
    [
      para('Opening words'),
      heading(1, 'Methods'),
      heading(2, 'Sampling'),
      para('How Ada sampled'),
      para('Where Ada sampled'),
      heading(2, 'Analysis'),
      para('How Grace analysed'),
      heading(1, 'Results'),
    ],
    DEFAULT_IMPORT_LEVELS,
    { ...context, newIdentifier },
  );
  return parts.map((part, index) => ({
    id: `p${index}`,
    kind: part.kind,
    title: part.title,
    blocks: part.blocks,
    source: part.source,
    reason: part.reason,
    flags: part.flags,
    origins: [index],
    headings: part.headings,
    changes: part.changes,
    threads: part.threads,
  }));
}

const edited = (answer: ReturnType<typeof editProposal>) => {
  if (!answer.ok) throw new Error(`Refused: ${answer.refusal}`);
  return answer.parts;
};

describe('editProposal', () => {
  it("IMP-002 IMP-041 moves a split: a part's last block to the start of the next, and back", () => {
    const parts = edited(
      editProposal(read(), { edit: 'move', part: 'p2', to: 'next', blocks: 1 }, context),
    );
    expect(texts(parts[2])).toEqual(['How Ada sampled']);
    expect(texts(parts[3])).toEqual(['Where Ada sampled', 'How Grace analysed']);
    expect(parts[3]!.origins).toEqual([3]);
    const back = edited(
      editProposal(parts, { edit: 'move', part: 'p3', to: 'previous', blocks: 1 }, context),
    );
    expect(texts(back[2])).toEqual(['How Ada sampled', 'Where Ada sampled']);
    // A part keeps a block: moving Analysis's only one is refused.
    expect(
      editProposal(back, { edit: 'move', part: 'p3', to: 'previous', blocks: 1 }, context),
    ).toEqual({ ok: false, refusal: 'blocks_out_of_range' });
  });

  it('IMP-041 refuses a move into a section, which holds no blocks, naming why', () => {
    expect(
      editProposal(read(), { edit: 'move', part: 'p2', to: 'previous', blocks: 1 }, context),
    ).toEqual({ ok: false, refusal: 'neighbour_section' });
    expect(
      editProposal(read(), { edit: 'move', part: 'p0', to: 'previous', blocks: 1 }, context),
    ).toEqual({ ok: false, refusal: 'no_neighbour' });
  });

  it('IMP-002 IMP-041 splits a part at a block, the new part after it under its title', () => {
    const parts = edited(
      editProposal(read(), { edit: 'split', part: 'p2', at: 1, title: ' Where ' }, context),
    );
    expect(parts.map((part) => part.title)).toEqual([
      'Introduction',
      'Methods',
      'Sampling',
      'Where',
      'Analysis',
      'Results',
    ]);
    expect(parts[3]).toMatchObject({ id: null, kind: 'component', origins: [2] });
    expect(parts[3]!.reason).toEqual({ rule: 'split' });
    expect(texts(parts[3])).toEqual(['Where Ada sampled']);
    expect(
      editProposal(read(), { edit: 'split', part: 'p2', at: 2, title: 'Where' }, context),
    ).toEqual({ ok: false, refusal: 'blocks_out_of_range' });
    expect(
      editProposal(read(), { edit: 'split', part: 'p2', at: 1, title: '  ' }, context),
    ).toEqual({ ok: false, refusal: 'title_invalid' });
  });

  it('IMP-002 IMP-041 merges two adjacent components, and refuses a section with a component', () => {
    const parts = edited(editProposal(read(), { edit: 'merge', part: 'p2' }, context));
    expect(parts).toHaveLength(4);
    expect(parts[2]).toMatchObject({ id: 'p2', title: 'Sampling', origins: [2, 3] });
    expect(texts(parts[2])).toEqual(['How Ada sampled', 'Where Ada sampled', 'How Grace analysed']);
    expect(parts[2]!.source).toBe(
      'Sampling\nHow Ada sampled\nWhere Ada sampled\nAnalysis\nHow Grace analysed',
    );
    expect(editProposal(read(), { edit: 'merge', part: 'p1' }, context)).toEqual({
      ok: false,
      refusal: 'kinds_differ',
    });
    expect(editProposal(read(), { edit: 'merge', part: 'p4' }, context)).toEqual({
      ok: false,
      refusal: 'no_neighbour',
    });
  });

  it('IMP-041 refuses a merge whose content would fail the content schema (CNT-013)', () => {
    const parts = read();
    // The same block identifier twice in one component is not content (CNT-002).
    const twice: ReviewPart[] = parts.map((part) =>
      part.id === 'p3' ? { ...part, blocks: [parts[2]!.blocks[0]!] } : part,
    );
    expect(editProposal(twice, { edit: 'merge', part: 'p2' }, context)).toEqual({
      ok: false,
      refusal: 'content_invalid',
    });
  });

  it("IMP-002 renames a part, and changes a part's kind where the outline allows it", () => {
    const renamed = edited(
      editProposal(read(), { edit: 'rename', part: 'p0', title: 'Preface' }, context),
    );
    expect(renamed[0]!.title).toBe('Preface');
    expect(editProposal(read(), { edit: 'kind', part: 'p2', kind: 'section' }, context)).toEqual({
      ok: false,
      refusal: 'section_holds_no_blocks',
    });
    const component = edited(
      editProposal(read(), { edit: 'kind', part: 'p4', kind: 'component' }, context),
    );
    expect(component[4]).toMatchObject({ kind: 'component', flags: ['empty'] });
    expect(editProposal(read(), { edit: 'rename', part: 'p9', title: 'Gone' }, context)).toEqual({
      ok: false,
      refusal: 'part_missing',
    });
  });
});

describe('acceptedCounts', () => {
  it('IMP-031 counts each part accepted once: merged, split, edited, renamed or unchanged', () => {
    const as = read();
    let parts = edited(editProposal(as, { edit: 'rename', part: 'p0', title: 'Preface' }, context));
    expect(acceptedCounts(as, parts)).toEqual({
      unchanged: 4,
      edited: 0,
      merged: 0,
      split: 0,
      renamed: 1,
    });
    parts = edited(
      editProposal(parts, { edit: 'split', part: 'p2', at: 1, title: 'Where' }, context),
    );
    parts = edited(editProposal(parts, { edit: 'kind', part: 'p4', kind: 'component' }, context));
    expect(acceptedCounts(as, parts)).toEqual({
      unchanged: 2,
      edited: 1,
      merged: 0,
      split: 2,
      renamed: 1,
    });
    const merged = edited(editProposal(as, { edit: 'merge', part: 'p2' }, context));
    expect(acceptedCounts(as, merged)).toMatchObject({ unchanged: 3, merged: 1 });
  });
});

describe('reviewing a proposal', () => {
  it('IMP-028 shows a block as its text, a line for each paragraph it holds', () => {
    const list = {
      type: 'list',
      items: [
        { content: [{ type: 'paragraph', content: [{ type: 'text', value: 'Ada', marks: [] }] }] },
        {
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', value: 'Gr', marks: [] },
                { type: 'text', value: 'ace', marks: [] },
              ],
            },
          ],
        },
      ],
    };
    expect(blockText(list as never)).toBe('Ada\nGrace');
  });

  it('IMP-029 finds a part by its title or its text, ignoring case', () => {
    const [, , sampling] = read();
    expect(partMatches(sampling!, 'sampl')).toBe(true);
    expect(partMatches(sampling!, 'WHERE ADA')).toBe(true);
    expect(partMatches(sampling!, 'Grace')).toBe(false);
  });

  it('IMP-029 flags a part by what it holds and by what the report said of what it came from', () => {
    const report = [
      { action: 'discarded', subject: 'notYetRead', part: 2 },
      { action: 'discarded', subject: 'hyperlink', part: 3 },
      { action: 'rewritten', subject: 'heading', part: 3 },
      { action: 'discarded', subject: 'macro', part: null },
    ];
    expect(reviewFlags({ flags: ['empty'], origins: [2, 3] }, report)).toEqual([
      'empty',
      'notYetRead',
      'leftOut',
      'keptDifferently',
    ]);
    expect(reviewFlags({ flags: [], origins: [0] }, report)).toEqual([]);
  });
});

describe('editProposal, structure (IMc)', () => {
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
  const outside = {
    type: 'crossReference',
    id: 'wr-1',
    target: { kind: 'block', block: 'wx-1' },
    display: 'title',
  };
  /** Grace's notes: one component of three paragraphs, an insertion by Ada and a comment on the last. */
  function notes(): ReviewPart[] {
    const { parts } = proposeImport(
      [
        heading(2, 'Notes'),
        block([run('First, see '), outside]),
        block([run('Second '), run('point', { kind: 'insert', author: 'Ada', id: '1' })]),
        block([run('Third word.')], 'wb-3'),
        heading(2, 'Later'),
        block([run('Last.')]),
      ],
      DEFAULT_IMPORT_LEVELS,
      {
        ...context,
        newIdentifier,
        comments: [
          {
            id: '0',
            block: 'wb-3',
            quote: 'word',
            before: 'Third ',
            crossed: false,
            author: 'Grace',
            initials: null,
            date: null,
            text: 'Which word?',
            replies: [],
          },
        ],
      },
    );
    return parts.map((part, index) => ({
      id: `n${index}`,
      kind: part.kind,
      title: part.title,
      blocks: part.blocks,
      source: part.source,
      reason: part.reason,
      flags: part.flags,
      origins: [index],
      headings: part.headings,
      changes: part.changes,
      threads: part.threads,
    }));
  }

  it("IMP-005 moves a part's suggested changes and threads with the blocks they are on", () => {
    const parts = edited(
      editProposal(notes(), { edit: 'split', part: 'n0', at: 2, title: 'Third' }, context),
    );
    expect(parts.map((part) => [part.title, part.changes.length, part.threads.length])).toEqual([
      ['Notes', 1, 0],
      ['Third', 0, 1],
      ['Later', 0, 0],
    ]);
    const merged = edited(editProposal(parts, { edit: 'merge', part: 'n0' }, context));
    expect(merged.map((part) => [part.title, part.changes.length, part.threads.length])).toEqual([
      ['Notes', 1, 1],
      ['Later', 0, 0],
    ]);
  });

  it('IMP-034 retargets a reference outside the import to a block in it, validated as made', () => {
    const parts = notes();
    const target = parts[1]!.blocks[0]!.id;
    const retargeted = edited(
      editProposal(
        parts,
        { edit: 'reference', reference: 'wx-1', to: { kind: 'block', block: target } },
        context,
      ),
    );
    const [first] = retargeted[0]!.blocks as unknown as {
      content: { type: string; target?: object }[];
    }[];
    expect(first!.content[1]).toMatchObject({ target: { kind: 'block', block: target } });
    expect(
      editProposal(
        parts,
        { edit: 'reference', reference: 'wx-1', to: { kind: 'block', block: 'nowhere' } },
        context,
      ),
    ).toEqual({ ok: false, refusal: 'target_missing' });
    expect(
      editProposal(
        parts,
        { edit: 'reference', reference: 'wx-9', to: { kind: 'text', text: 'x' } },
        context,
      ),
    ).toEqual({ ok: false, refusal: 'reference_missing' });
  });

  it('IMP-034 makes a reference outside the import the text it showed', () => {
    const parts = edited(
      editProposal(
        notes(),
        { edit: 'reference', reference: 'wx-1', to: { kind: 'text', text: 'Section 9' } },
        context,
      ),
    );
    expect(texts(parts[0])[0]).toBe('First, see Section 9');
  });
});
