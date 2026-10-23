import { describe, expect, it } from 'vitest';
import type { BlockNode } from '../content/model/blocks.js';
import {
  AGAIN_DIFF_MOST,
  againDiff,
  againIdentifiers,
  againStatus,
  matchAgain,
  type AgainCandidate,
} from './again.js';

const para = (id: string, text: string): BlockNode =>
  ({
    type: 'paragraph',
    id,
    style: 'body',
    content: [{ type: 'text', value: text, marks: [] }],
  }) as unknown as BlockNode;

const heading = (text: string) =>
  ({ rule: 'heading', style: 'Heading 2', text, level: 2 }) as const;
const component = (title: string, read = title) =>
  ({ kind: 'component', title, reason: heading(read) }) as const;
const section = (title: string) =>
  ({ kind: 'section', title, reason: { ...heading(title), level: 1 } }) as const;

/** What Ada's first import made: Sampling, Analysis and Results, by the headings it read. */
const made: AgainCandidate[] = [
  { component: 'c-sampling', heading: 'Sampling', title: 'Sampling' },
  { component: 'c-analysis', heading: 'Analysis', title: 'How Grace analysed' },
  { component: 'c-results', heading: 'Results', title: 'Results' },
];

describe('matchAgain', () => {
  it('IMP-036 matches each part to what the earlier import made: by provenance, then heading, then position', () => {
    const { matches, gone } = matchAgain(
      [
        section('Methods'),
        // The heading the earlier import read it from.
        component('Sampling'),
        // Renamed in the space since, and the file's heading renamed to match.
        component('How Grace analysed', 'How Grace analysed'),
        // Neither heading: between Analysis and the end, where Results alone is left.
        component('Findings'),
        component('Appendix'),
      ],
      made,
    );
    expect(matches).toEqual([
      null,
      { component: 'c-sampling', by: 'provenance' },
      { component: 'c-analysis', by: 'heading' },
      { component: 'c-results', by: 'position' },
      null,
    ]);
    expect(gone).toEqual([]);
  });

  it('IMP-036 says what the earlier import made that no part matches is gone', () => {
    const { matches, gone } = matchAgain([component('Results')], made);
    expect(matches).toEqual([{ component: 'c-results', by: 'provenance' }]);
    expect(gone).toEqual(['c-sampling', 'c-analysis']);
  });

  it('pairs by position only between two parts matched otherwise, in order', () => {
    const { matches } = matchAgain(
      [component('Results'), component('Other'), component('Sampling')],
      made,
    );
    // Results and Sampling cross over, so nothing stands between them to pair by position.
    expect(matches).toEqual([
      { component: 'c-results', by: 'provenance' },
      null,
      { component: 'c-sampling', by: 'provenance' },
    ]);
  });

  it('matches each component once, ignoring case and spacing', () => {
    const { matches } = matchAgain(
      [component(' sampling '), component('SAMPLING')],
      made.slice(0, 1),
    );
    expect(matches[0]).toEqual({ component: 'c-sampling', by: 'provenance' });
    expect(matches[1]).toBeNull();
  });
});

describe('againStatus and againDiff', () => {
  const current = [para('a', 'Ada sampled at dawn.'), para('b', 'Grace counted.')];

  it('IMP-036 is unchanged where the text is the component’s, whatever the blocks’ identities', () => {
    expect(
      againStatus([para('x', 'Ada sampled at dawn.'), para('y', 'Grace counted.')], current),
    ).toBe('unchanged');
    expect(againStatus([para('x', 'Ada sampled at noon.')], current)).toBe('changed');
    expect(againStatus([para('x', 'Anything')], null)).toBe('new');
  });

  it('IMP-036 shows a changed part as the text removed from and added to the component as it is now', () => {
    expect(
      againDiff(current, [
        para('x', 'Ada sampled at noon.'),
        para('y', 'Grace counted.'),
        para('z', 'Then Ada wrote it up.'),
      ]),
    ).toEqual([
      { change: 'removed', text: 'Ada sampled at dawn.' },
      { change: 'added', text: 'Ada sampled at noon.' },
      { change: 'same', text: 'Grace counted.' },
      { change: 'added', text: 'Then Ada wrote it up.' },
    ]);
  });

  it('IMP-036 compares a long part past its common start and end only, and shows a middle too long to pair as replaced', () => {
    const many = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, at) => para(`${prefix}${at}`, `${prefix} ${at}`));
    const start = para('s', 'Ada sampled at dawn.');
    const end = para('e', 'Grace counted.');
    // One block both hold in the middle: paired within the cap, replaced past it.
    const shared = para('k', 'Kept.');
    const ours = [...many('old', AGAIN_DIFF_MOST), shared];
    const theirs = [shared, ...many('new', AGAIN_DIFF_MOST)];
    const lines = againDiff([start, ...ours, end], [start, ...theirs, end]);
    expect(lines).toHaveLength(ours.length + theirs.length + 2);
    expect(lines[0]).toEqual({ change: 'same', text: 'Ada sampled at dawn.' });
    expect(lines.at(-1)).toEqual({ change: 'same', text: 'Grace counted.' });
    expect(lines.slice(1, -1).map((line) => line.change)).toEqual([
      ...ours.map(() => 'removed'),
      ...theirs.map(() => 'added'),
    ]);
    // Within the cap the middle is still paired.
    expect(
      againDiff(
        [start, para('m', 'Kept.'), end],
        [start, para('n', 'New.'), para('k', 'Kept.'), end],
      ).map((line) => line.change),
    ).toEqual(['same', 'added', 'same', 'same']);
  });
});

describe('againIdentifiers', () => {
  it('IMP-037 gives each block a part shares with its component the component’s identifiers, its own inside too', () => {
    const footnoted = (id: string, note: string): BlockNode =>
      ({
        type: 'paragraph',
        id,
        style: 'body',
        content: [
          { type: 'text', value: 'Newts.', marks: [] },
          { type: 'footnote', id: note, content: [] },
        ],
      }) as unknown as BlockNode;
    const carried = againIdentifiers(
      [para('a', 'Ada sampled at dawn.'), footnoted('b', 'fb')],
      [para('x', 'Ada sampled at noon.'), footnoted('y', 'fy'), para('z', 'More.')],
    );
    expect(Object.fromEntries(carried)).toEqual({ y: 'b', fy: 'fb' });
  });
});
