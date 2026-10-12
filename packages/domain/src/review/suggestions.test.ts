import { describe, expect, it } from 'vitest';

import type { BlockNode, ContentDocument } from '../content/model/index.js';
import { applySuggestion } from './suggestions.js';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const para = (id: string, value: string): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [text(value)],
});
const doc = (...content: BlockNode[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content,
});
let counter = 0;
const fresh = () => `fresh${(counter += 1)}`;
const texts = (applied: ReturnType<typeof applySuggestion>) =>
  applied.applies
    ? applied.content.content.map((block) => [
        block.id,
        block.type === 'paragraph' ? (block.content[0] as { value: string }).value : block.type,
      ])
    : applied;

const base = doc(para('a', 'Unbox it.'), para('b', 'Set the tray.'), para('c', 'Wait.'));

describe('a suggestion applied to the component as it is now', () => {
  it('CNT-009 applies a change, a removal and an addition over a version edited elsewhere, keeping every block its identifier', () => {
    const proposed = doc(
      para('a', 'Unbox it carefully.'),
      para('n', 'Plug it in.'),
      para('c', 'Wait.'),
    );
    // Meanwhile the author changed c and added d at the end.
    const current = doc(
      para('a', 'Unbox it.'),
      para('b', 'Set the tray.'),
      para('c', 'Wait a minute.'),
      para('d', 'Done.'),
    );
    expect(texts(applySuggestion(base, proposed, current, fresh))).toEqual([
      ['a', 'Unbox it carefully.'],
      ['n', 'Plug it in.'],
      ['c', 'Wait a minute.'],
      ['d', 'Done.'],
    ]);
  });

  it('CNT-009 gives an added block a fresh identifier where its own is taken', () => {
    const proposed = doc(
      para('a', 'Unbox it.'),
      para('d', 'Mine.'),
      para('b', 'Set the tray.'),
      para('c', 'Wait.'),
    );
    const current = doc(
      para('a', 'Unbox it.'),
      para('b', 'Set the tray.'),
      para('c', 'Wait.'),
      para('d', 'Theirs.'),
    );
    const applied = texts(applySuggestion(base, proposed, current, () => 'renamed'));
    expect(applied).toEqual([
      ['a', 'Unbox it.'],
      ['renamed', 'Mine.'],
      ['b', 'Set the tray.'],
      ['c', 'Wait.'],
      ['d', 'Theirs.'],
    ]);
  });

  it('applies a split, a join and a move, and keeps the order the author made meanwhile', () => {
    // Split a into a and s; join b and c into b; move nothing else.
    const proposed = doc(para('a', 'Unbox'), para('s', 'it.'), para('b', 'Set the tray. Wait.'));
    // The author moved c above b meanwhile, and left both as they were.
    const current = doc(para('a', 'Unbox it.'), para('c', 'Wait.'), para('b', 'Set the tray.'));
    expect(texts(applySuggestion(base, proposed, current, fresh))).toEqual([
      ['a', 'Unbox'],
      ['s', 'it.'],
      ['b', 'Set the tray. Wait.'],
    ]);
    const moved = doc(para('c', 'Wait.'), para('a', 'Unbox it.'), para('b', 'Set the tray.'));
    const later = doc(
      para('a', 'Unbox it.'),
      para('b', 'Set the tray.'),
      para('c', 'Wait.'),
      para('d', 'Done.'),
    );
    expect(texts(applySuggestion(base, moved, later, fresh))).toEqual([
      ['c', 'Wait.'],
      ['a', 'Unbox it.'],
      ['b', 'Set the tray.'],
      ['d', 'Done.'],
    ]);
  });

  it('COL-052 COL-023 says each place it no longer fits, and applies nothing', () => {
    const proposed = {
      ...doc(
        para('a', 'Unbox it carefully.'),
        para('b', 'Set the tray.'),
        para('n', 'After b.'),
        para('c', 'Wait.'),
      ),
      title: 'Printing',
    };
    // The author changed a, removed b (which n follows), and retitled it.
    const current = { ...doc(para('a', 'Unbox it gently.'), para('c', 'Wait.')), title: 'Set up' };
    const removing = doc(para('a', 'Unbox it.'), para('c', 'Wait.'));
    expect(applySuggestion(base, proposed, current, fresh)).toEqual({
      applies: false,
      stale: [
        { block: 'a', why: 'changed' },
        { block: 'n', why: 'anchor_gone' },
        { block: null, member: 'title', why: 'changed' },
      ],
    });
    // Removing a block somebody changed meanwhile is stale there too.
    expect(
      applySuggestion(
        base,
        removing,
        doc(para('a', 'Unbox it.'), para('b', 'Set it.'), para('c', 'Wait.')),
        fresh,
      ),
    ).toEqual({
      applies: false,
      stale: [{ block: 'b', why: 'changed' }],
    });
  });

  it('applies a title and a language change where nobody changed them', () => {
    const proposed = { ...base, title: 'Printing', language: 'en-US' };
    const applied = applySuggestion(base, proposed, base, fresh);
    expect(applied.applies && [applied.content.title, applied.content.language]).toEqual([
      'Printing',
      'en-US',
    ]);
  });

  it('places a second accepted suggestion’s block after the first’s, after the same block', () => {
    const first = doc(
      para('a', 'Unbox it.'),
      para('x', 'First.'),
      para('b', 'Set the tray.'),
      para('c', 'Wait.'),
    );
    const second = doc(
      para('a', 'Unbox it.'),
      para('y', 'Second.'),
      para('b', 'Set the tray.'),
      para('c', 'Wait.'),
    );
    const once = applySuggestion(base, first, base, fresh);
    if (!once.applies) throw new Error('stale');
    expect(
      (texts(applySuggestion(base, second, once.content, fresh)) as string[][]).map(([id]) => id),
    ).toEqual(['a', 'x', 'y', 'b', 'c']);
  });

  it('COL-052 says a result that would not be a content document, and applies nothing', () => {
    const empty = (id: string): BlockNode => ({
      type: 'paragraph',
      id,
      style: 'body',
      content: [],
    });
    const opened = doc(
      para('a', 'Unbox it.'),
      empty('e1'),
      para('b', 'Set the tray.'),
      para('c', 'Wait.'),
    );
    // Removing b would be fine on its own; the author has since emptied c, so e1 and c would touch.
    const removing = doc(para('a', 'Unbox it.'), empty('e1'), para('c', 'Wait.'));
    const now = doc(para('a', 'Unbox it.'), empty('e1'), para('b', 'Set the tray.'), empty('c'));
    const answer = applySuggestion(opened, removing, now, fresh);
    expect(answer).toMatchObject({ applies: false, stale: [{ block: null, why: 'invalid' }] });
  });
});
