import type { ContentDocument } from '../content/model/document.js';

/**
 * **Bringing a line back** (LIF-045; the R16 plan, R16-F; LIF-Q05): two lines of a component compared
 * block by block, by each top-level block's identity, and the main line's content with the line's side
 * of each block the author carries across. Nothing merges inside a block.
 */

/** A block that differs: changed on either side, held by the line alone, or by the main line alone. */
export interface BlockDifference {
  readonly block: string;
  readonly change: 'changed' | 'line' | 'main';
}

type Block = ContentDocument['content'][number];

const blocksById = (content: ContentDocument) =>
  new Map(content.content.map((block) => [block.id, block] as const));

const same = (a: Block, b: Block) => JSON.stringify(a) === JSON.stringify(b);

/** Each block that differs between the main line and the line, in the main line's order, then the line's. */
export function lineDifferences(main: ContentDocument, line: ContentDocument): BlockDifference[] {
  const ours = blocksById(main);
  const theirs = blocksById(line);
  return [
    ...main.content.flatMap((block): BlockDifference[] => {
      const other = theirs.get(block.id);
      if (other === undefined) return [{ block: block.id, change: 'main' }];
      return same(block, other) ? [] : [{ block: block.id, change: 'changed' }];
    }),
    ...line.content.flatMap((block): BlockDifference[] =>
      ours.has(block.id) ? [] : [{ block: block.id, change: 'line' }],
    ),
  ];
}

/**
 * The main line's content with the line's side of each block in `carry` (R16-F): a changed block takes
 * the line's; one the line alone holds goes in after the nearest block before it on the line that the
 * result holds, else first; one the main line alone holds goes. Every other block stays the main line's.
 */
export function bringBack(
  main: ContentDocument,
  line: ContentDocument,
  carry: readonly string[],
): ContentDocument {
  if (carry.length === 0) return main;
  const carried = new Set(carry);
  const theirs = blocksById(line);
  const result: Block[] = main.content.flatMap((block): Block[] => {
    if (!carried.has(block.id)) return [block];
    const other = theirs.get(block.id);
    return other === undefined ? [] : [other];
  });
  const held = new Set(result.map((block) => block.id));
  line.content.forEach((block, index) => {
    if (!carried.has(block.id) || held.has(block.id)) return;
    const before = line.content
      .slice(0, index)
      .reverse()
      .find((each) => held.has(each.id));
    const at = before === undefined ? 0 : result.findIndex((each) => each.id === before.id) + 1;
    result.splice(at, 0, block);
    held.add(block.id);
  });
  return { ...main, content: result };
}
