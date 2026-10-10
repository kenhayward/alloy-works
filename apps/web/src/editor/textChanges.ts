import { wordsByBlock, type BlockWords, type ContentDocument } from '@alloy-works/domain';

/** A run of an edited block's words: kept, or taken out, or put in. */
export interface WordRun {
  readonly text: string;
  readonly change: 'same' | 'removed' | 'added';
}

/** One block's change, in words: added or removed whole, or edited word by word. */
export type TextChange =
  | { readonly kind: 'added' | 'removed'; readonly text: string }
  | { readonly kind: 'edited'; readonly parts: readonly WordRun[] };

/** What a block with no words of its own is called instead. */
const NAMED: Partial<Record<BlockWords['kind'], string>> = {
  figure: 'A figure',
  table: 'A table',
  boundTable: 'A bound table',
  equation: 'An equation',
  list: 'A list',
  blockquote: 'A quotation',
  preformatted: 'Preformatted text',
  paragraph: 'An empty paragraph',
};

const said = (block: BlockWords) =>
  block.text === '' ? (NAMED[block.kind] ?? 'A block') : block.text;

/** Past this many word pairs an edit is said as the whole block out and the whole block in. */
const MOST_PAIRS = 40_000;

/** The words of two texts, kept, removed and added, by their longest common run. */
function wordRuns(before: string, after: string): WordRun[] {
  const a = before.split(' ');
  const b = after.split(' ');
  if (a.length * b.length > MOST_PAIRS) {
    return [
      { text: before, change: 'removed' },
      { text: after, change: 'added' },
    ];
  }
  // The longest common subsequence's lengths, from the end.
  const longest = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      longest[i]![j] =
        a[i] === b[j]
          ? longest[i + 1]![j + 1]! + 1
          : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
    }
  }
  const runs: WordRun[] = [];
  const push = (word: string, change: WordRun['change']) => {
    const last = runs.at(-1);
    if (last?.change === change) runs[runs.length - 1] = { text: `${last.text} ${word}`, change };
    else runs.push({ text: word, change });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(a[i]!, 'same');
      i++;
      j++;
    } else if (longest[i + 1]![j]! >= longest[i]![j + 1]!) {
      push(a[i++]!, 'removed');
    } else {
      push(b[j++]!, 'added');
    }
  }
  while (i < a.length) push(a[i++]!, 'removed');
  while (j < b.length) push(b[j++]!, 'added');
  return runs;
}

/**
 * **What putting `after` in place of `before` changes** (the R1 plan's recovery dialog): each block,
 * matched by its identity, that would be added, removed or edited, in the order `after` holds them,
 * then those removed; an edited one word by word. Blocks are read for their own words as search reads
 * them, so a list's items and a table's cells are blocks of their own.
 */
export function changesBetween(before: ContentDocument, after: ContentDocument): TextChange[] {
  const was = new Map(wordsByBlock(before.content).map((block) => [block.id, block]));
  const now = wordsByBlock(after.content);
  const kept = new Set(now.map((block) => block.id));
  const changes: TextChange[] = [];
  for (const block of now) {
    const old = was.get(block.id);
    if (old === undefined) changes.push({ kind: 'added', text: said(block) });
    else if (old.text !== block.text) {
      changes.push({ kind: 'edited', parts: wordRuns(old.text, block.text) });
    }
  }
  for (const block of was.values()) {
    if (!kept.has(block.id)) changes.push({ kind: 'removed', text: said(block) });
  }
  return changes;
}
