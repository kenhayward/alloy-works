import { describe, expect, it } from 'vitest';

import {
  applyEdit,
  chooseMention,
  EMPTY_DRAFT,
  fromParts,
  hasContent,
  toParts,
  typedMention,
} from './mentionDraft.js';

const ADA_ONE = { id: 'one', name: 'Ada Moreau' };
const ADA_TWO = { id: 'two', name: 'Ada Moreau' };

const named = (text: string, person = ADA_ONE) => {
  const draft = applyEdit(EMPTY_DRAFT, text);
  const at = text.indexOf('@');
  return chooseMention(draft, at, text.length, person);
};

describe('mentions typed in a comment', () => {
  it('COL-015 names people where they were typed, each by id, however alike their names', () => {
    const first = named('Ask @a').draft;
    const typed = applyEdit(first, `${first.text}and @a`);
    const second = chooseMention(typed, typed.text.lastIndexOf('@'), typed.text.length, ADA_TWO);
    expect(toParts(second.draft)).toEqual([
      { text: 'Ask ' },
      { mention: 'one' },
      { text: ' and ' },
      { mention: 'two' },
      { text: ' ' },
    ]);
  });

  it('moves a mention with the text before it, and stops naming somebody once their name is typed into', () => {
    const { draft } = named('Ask @a');
    const moved = applyEdit(draft, `Now ${draft.text}`);
    expect(moved.mentions).toEqual([{ from: 8, to: 19, id: 'one' }]);
    const broken = applyEdit(draft, draft.text.replace('Moreau', 'Morau'));
    expect(broken.mentions).toEqual([]);
    expect(toParts(broken)).toEqual([{ text: 'Ask @Ada Morau ' }]);
  });

  it('keeps a mention through an edit at either of its edges', () => {
    const { draft } = named('@a');
    expect(applyEdit(draft, `x${draft.text}`).mentions).toHaveLength(1);
    expect(applyEdit(draft, `${draft.text}x`).mentions).toHaveLength(1);
  });

  it('keeps a mention’s place through a comment read back to edit', () => {
    const parts = [{ text: 'Ask ' }, { mention: 'one' }, { text: ' please' }];
    const draft = fromParts(parts, () => 'Ada Moreau');
    expect(draft.text).toBe('Ask @Ada Moreau please');
    expect(toParts(draft)).toEqual(parts);
  });

  it('offers a mention only for an @ at a word’s start, on the line being typed', () => {
    const typed = (text: string) => typedMention(applyEdit(EMPTY_DRAFT, text), text.length);
    expect(typed('Ask @me')).toEqual({ at: 4, query: 'me' });
    expect(typed('@')).toEqual({ at: 0, query: '' });
    expect(typed('ada@example')).toBeNull();
    expect(typed('@me now')).toBeNull();
    expect(typedMention(named('@a').draft, 3)).toBeNull();
  });

  it('turns a pasted tab into a space, and takes a line feed as it is', () => {
    expect(toParts(applyEdit(EMPTY_DRAFT, 'One\ttwo\nthree'))).toEqual([
      { text: 'One two\nthree' },
    ]);
  });

  it('has nothing to send in nothing but space, and something in a person named', () => {
    expect(hasContent(applyEdit(EMPTY_DRAFT, '  \n'))).toBe(false);
    expect(hasContent(named('@a').draft)).toBe(true);
  });
});
