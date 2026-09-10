import { describe, expect, it } from 'vitest';

import { doc, paragraph, text } from '../document.js';
import { compareBlocks, stripBlockIds } from '../compare.js';

/**
 * Case 7 of the content model spike - a GATE.
 * See docs/specification/Content_Model_Spike.md.
 *
 * A paragraph is moved into a different position and reworded in the same revision. A positional
 * diff calls that a delete plus an insert, which is the single most common way comparison becomes
 * noise instead of information.
 *
 * Passing means: comparison says "moved and edited" where identity survives, AND degrades to
 * something legible rather than noise between two versions that share no identity at all - which
 * is the normal situation after a restore, or between components edited in unrelated sessions.
 */

//        0            1            2              3
// before: Alpha        Bravo        Charlie        Delta
// after:  Alpha        Charlie      Delta          Bravo, revised
//
// Bravo moves past two blocks, so the longest common subsequence is unambiguous: exactly one
// block moved, and the other two shifted. A test where the mover is ambiguous would pass or fail
// on a tie-break rather than on the property being tested.
const before = doc([
  paragraph([text('Alpha')], 'b1'),
  paragraph([text('Bravo')], 'b2'),
  paragraph([text('Charlie')], 'b3'),
  paragraph([text('Delta')], 'b4'),
]);

const after = doc([
  paragraph([text('Alpha')], 'b1'),
  paragraph([text('Charlie')], 'b3'),
  paragraph([text('Delta')], 'b4'),
  paragraph([text('Bravo, revised')], 'b2'),
]);

describe('case 7 - comparison across a move plus an edit', () => {
  it('reports one block as moved and edited, not as a deletion and an insertion', () => {
    const changes = compareBlocks(before, after);
    const moved = changes.filter((change) => change.kind === 'moved-and-edited');

    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ id: 'b2', from: 1, to: 3, matchedBy: 'id' });
  });

  it('invents no deletions or insertions to explain the move', () => {
    const kinds = compareBlocks(before, after).map((change) => change.kind);

    expect(kinds).not.toContain('removed');
    expect(kinds).not.toContain('inserted');
  });

  it('leaves the blocks that merely shifted position alone', () => {
    const changes = compareBlocks(before, after);
    const unchanged = changes.filter((change) => change.kind === 'unchanged').map((c) => c.id);

    expect(unchanged.sort()).toEqual(['b1', 'b3', 'b4']);
  });

  /**
   * The second half of the gate. Two versions that share no block identity - after a restore, or
   * an import, or independent authoring - still have to compare to something a reader can use.
   * Falling back to content similarity should recover the same story, and must say that it did so
   * by similarity rather than by identity, because a reader needs to know how much to trust it.
   */
  describe('when the two versions share no block identity', () => {
    const anonymousBefore = stripBlockIds(before);
    const anonymousAfter = stripBlockIds(after);

    it('still recovers the move and the edit', () => {
      const changes = compareBlocks(anonymousBefore, anonymousAfter);
      const moved = changes.filter((change) => change.kind === 'moved-and-edited');

      expect(moved).toHaveLength(1);
      expect(moved[0]).toMatchObject({ from: 1, to: 3, matchedBy: 'similarity' });
    });

    it('does not degenerate into a deletion and an insertion', () => {
      const kinds = compareBlocks(anonymousBefore, anonymousAfter).map((change) => change.kind);

      expect(kinds).not.toContain('removed');
      expect(kinds).not.toContain('inserted');
    });

    it('reports genuinely new and genuinely gone content as inserted and removed', () => {
      const changes = compareBlocks(
        stripBlockIds(doc([paragraph([text('Alpha')]), paragraph([text('Bravo')])])),
        stripBlockIds(doc([paragraph([text('Alpha')]), paragraph([text('Something else')])])),
      );

      expect(changes.map((change) => change.kind).sort()).toEqual([
        'inserted',
        'removed',
        'unchanged',
      ]);
    });
  });
});
