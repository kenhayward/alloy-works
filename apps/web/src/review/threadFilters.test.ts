import { describe, expect, it } from 'vitest';

import type { ThreadSummary } from './ThreadsPanel.js';
import { countsOf, inState, peopleIn, shownThreads, THE_ASSISTANT } from './threadFilters.js';

const ADA = { id: 'ada', name: 'Ada Moreau' };
const GRACE = { id: 'grace', name: 'Grace Ibáñez' };

const thread = (id: string, over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  on: { id: 'c', kind: 'component' },
  anchor: { kind: 'component' },
  startedBy: ADA,
  startedAt: '2026-11-03T09:00:00.000Z',
  resolvedAt: null,
  comments: 1,
  lastAt: '2026-11-03T09:00:00.000Z',
  said: [{ text: 'Said' }],
  participants: [ADA],
  mentioned: [],
  words: 'Said',
  drafted: false,
  new: false,
  orphaned: false,
  ...over,
});

const reading = {
  principalId: 'ada',
  nameOf: (id: string) => (id === 'grace' ? 'Grace Ibáñez' : 'Somebody'),
  placeOf: () => '1 Method',
  anchorOf: () => 'The whole component',
};
const ids = (threads: readonly ThreadSummary[]) => threads.map((each) => each.id);
const none = { show: 'all', person: null, text: '' } as const;

describe('finding threads in the list', () => {
  it('COL-071 finds a thread by anybody who started, replied in or is named in it, as one filter', () => {
    const threads = [
      thread('started', { startedBy: GRACE, participants: [GRACE] }),
      thread('replied', { participants: [ADA, GRACE] }),
      thread('named', { mentioned: ['grace'] }),
      thread('neither'),
    ];
    expect(ids(shownThreads(threads, { ...none, person: 'grace' }, reading))).toEqual([
      'started',
      'replied',
      'named',
    ]);
  });

  it('COL-071 finds a thread by a reply’s words and by a name, ignoring case and accents', () => {
    const threads = [
      thread('reply', { words: 'First\nThe confidence interval' }),
      thread('name', { mentioned: ['grace'] }),
      thread('other'),
    ];
    expect(ids(shownThreads(threads, { ...none, text: 'CONFIDENCE' }, reading))).toEqual(['reply']);
    expect(ids(shownThreads(threads, { ...none, text: 'ibanez' }, reading))).toEqual(['name']);
    expect(ids(shownThreads(threads, { ...none, text: '  ' }, reading))).toHaveLength(3);
  });

  it('counts each Show item over every state, the narrower ones over what is open', () => {
    const threads = [
      thread('open'),
      thread('new', { new: true, startedBy: GRACE }),
      thread('mentions', { mentioned: ['ada'], startedBy: GRACE }),
      thread('drafted', { drafted: true, internal: true, startedBy: GRACE }),
      thread('done', { resolvedAt: '2026-11-03T10:00:00.000Z', new: true, drafted: true }),
    ];
    expect(countsOf(threads, 'ada')).toEqual({
      all: 5,
      open: 4,
      new: 1,
      mentioning: 1,
      mine: 1,
      assistant: 1,
      internal: 1,
      resolved: 1,
    });
  });

  it('marks in the text only what Show’s state leaves', () => {
    const threads = [thread('open'), thread('done', { resolvedAt: '2026-11-03T10:00:00.000Z' })];
    expect(ids(inState(threads, 'all'))).toEqual(['open', 'done']);
    expect(ids(inState(threads, 'resolved'))).toEqual(['done']);
    expect(ids(inState(threads, 'mentioning'))).toEqual(['open']);
  });

  it('puts the reader first and the assistant last, counting the open threads of each', () => {
    const threads = [
      thread('a', { startedBy: GRACE, participants: [GRACE, ADA], mentioned: ['ivy'] }),
      thread('b', { resolvedAt: '2026-11-03T10:00:00.000Z' }),
      thread('c', { startedBy: GRACE, participants: [GRACE], drafted: true }),
    ];
    const found = peopleIn(threads, [{ id: 'ivy', name: 'Ivy' }], 'grace');
    expect(found.map((each) => [each.id, each.threads, each.open])).toEqual([
      ['grace', 2, 2],
      ['ada', 2, 1],
      ['ivy', 1, 1],
      [THE_ASSISTANT, 1, 1],
    ]);
  });
});
