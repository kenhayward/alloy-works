import type { ThreadSummary } from './ThreadsPanel.js';

/** What Show offers. Only All and Resolved list a resolved thread; every other narrows the open ones. */
export const SHOWS = [
  'all',
  'open',
  'new',
  'mentioning',
  'mine',
  'assistant',
  'internal',
  'resolved',
] as const;
export type Show = (typeof SHOWS)[number];

/** The strip's and the search's choice standing for the assistant, whom no person's id can be. */
export const THE_ASSISTANT = 'assistant';

/** What a filter is told of the reader and how the page words a thread. */
export interface Reading {
  readonly principalId?: string | undefined;
  readonly nameOf: (id: string) => string;
  readonly placeOf: (thread: ThreadSummary) => string;
  readonly anchorOf: (thread: ThreadSummary) => string;
}

/** A name or a search folded so that "ibanez" finds Ibáñez and case never matters. */
export const fold = (words: string): string =>
  words.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** The threads Show leaves on its own: what the text marks, as the list's state did. */
export function inState(threads: readonly ThreadSummary[], show: Show): readonly ThreadSummary[] {
  if (show === 'all') return threads;
  return threads.filter((each) => (each.resolvedAt !== null) === (show === 'resolved'));
}

const shownBy = (thread: ThreadSummary, show: Show, principalId: string | undefined): boolean => {
  if (show === 'all') return true;
  if (show === 'resolved') return thread.resolvedAt !== null;
  if (thread.resolvedAt !== null) return false;
  switch (show) {
    case 'open':
      return true;
    case 'new':
      return thread.new;
    case 'mentioning':
      return principalId !== undefined && thread.mentioned.includes(principalId);
    case 'mine':
      return thread.startedBy.id === principalId;
    case 'assistant':
      return thread.drafted;
    case 'internal':
      return thread.internal === true;
  }
};

/** Whether a person is in a thread: started it, replied in it or is named in it. */
export const isIn = (thread: ThreadSummary, person: string): boolean =>
  person === THE_ASSISTANT
    ? thread.drafted
    : thread.startedBy.id === person ||
      thread.participants.some((each) => each.id === person) ||
      thread.mentioned.includes(person);

const says = (thread: ThreadSummary, text: string, reading: Reading): boolean => {
  const looked = fold(text.trim());
  if (looked === '') return true;
  return fold(
    [
      reading.anchorOf(thread),
      reading.placeOf(thread),
      thread.words,
      ...thread.participants.map((each) => each.name ?? ''),
      ...thread.mentioned.map(reading.nameOf),
    ].join('\n'),
  ).includes(looked);
};

/** The threads the list shows: Show, the one person chosen, and the words searched for, all at once. */
export function shownThreads(
  threads: readonly ThreadSummary[],
  filter: { readonly show: Show; readonly person: string | null; readonly text: string },
  reading: Reading,
): readonly ThreadSummary[] {
  return threads.filter(
    (each) =>
      shownBy(each, filter.show, reading.principalId) &&
      (filter.person === null || isIn(each, filter.person)) &&
      says(each, filter.text, reading),
  );
}

/** How many threads each of Show's items would list. */
export function countsOf(
  threads: readonly ThreadSummary[],
  principalId: string | undefined,
): Readonly<Record<Show, number>> {
  const counts = Object.fromEntries(SHOWS.map((show) => [show, 0])) as Record<Show, number>;
  for (const thread of threads) {
    for (const show of SHOWS) if (shownBy(thread, show, principalId)) counts[show] += 1;
  }
  return counts;
}

/** Somebody in the threads, as the strip and the search offer them. */
export interface InThreads {
  readonly id: string;
  readonly name: string | null;
  /** The threads they are in, and how many of those are open. */
  readonly threads: number;
  readonly open: number;
}

/**
 * Everybody in these threads: the reader first, the rest by name, and the assistant last where it
 * drafted any comment.
 */
export function peopleIn(
  threads: readonly ThreadSummary[],
  people: readonly { readonly id: string; readonly name: string | null }[],
  principalId: string | undefined,
): readonly InThreads[] {
  const names = new Map<string, string | null>();
  for (const thread of threads) {
    names.set(thread.startedBy.id, thread.startedBy.name);
    for (const each of thread.participants) names.set(each.id, each.name);
    for (const each of thread.mentioned) {
      if (!names.has(each)) names.set(each, people.find((one) => one.id === each)?.name ?? null);
    }
  }
  const counted = (id: string, name: string | null): InThreads => {
    const theirs = threads.filter((each) => isIn(each, id));
    return {
      id,
      name,
      threads: theirs.length,
      open: theirs.filter((each) => each.resolvedAt === null).length,
    };
  };
  const everybody = [...names]
    .map(([id, name]) => counted(id, name))
    .sort(
      (a, b) =>
        Number(b.id === principalId) - Number(a.id === principalId) ||
        (a.name ?? '').localeCompare(b.name ?? ''),
    );
  return threads.some((each) => each.drafted)
    ? [...everybody, counted(THE_ASSISTANT, null)]
    : everybody;
}
