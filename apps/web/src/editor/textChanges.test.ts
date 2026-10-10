import type { ContentDocument } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { changesBetween } from './textChanges.js';

const para = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: value === '' ? [] : [{ type: 'text', value, marks: [] }],
});
const doc = (...content: unknown[]) =>
  ({ schemaVersion: 1, title: 'Install the printer', content }) as unknown as ContentDocument;

describe('what restoring saved text would change', () => {
  it('says each block added, removed or edited, by its identity, the edited one word by word, and nothing unchanged', () => {
    const now = doc(
      para('a', 'Unbox the printer.'),
      para('b', 'Keep the box.'),
      para('c', 'Plug it in.'),
    );
    const saved = doc(
      para('a', 'Unbox the printer.'),
      para('c', 'Plug it in at the wall.'),
      para('d', 'Then switch it on.'),
    );
    expect(changesBetween(now, saved)).toEqual([
      {
        kind: 'edited',
        parts: [
          { text: 'Plug it', change: 'same' },
          { text: 'in.', change: 'removed' },
          { text: 'in at the wall.', change: 'added' },
        ],
      },
      { kind: 'added', text: 'Then switch it on.' },
      { kind: 'removed', text: 'Keep the box.' },
    ]);
  });

  it('names a block with no words of its own by what it is', () => {
    const figure = {
      type: 'figure',
      id: 'f',
      asset: { version: '11111111-1111-4111-8111-111111111111' },
      alternative: { kind: 'asset' },
      caption: [],
    };
    expect(changesBetween(doc(para('a', 'Text.')), doc(para('a', 'Text.'), figure))).toEqual([
      { kind: 'added', text: 'A figure' },
    ]);
    expect(changesBetween(doc(para('a', 'Text.'), para('e', '')), doc(para('a', 'Text.')))).toEqual(
      [{ kind: 'removed', text: 'An empty paragraph' }],
    );
  });

  it('says nothing changes where the two are the same', () => {
    const same = doc(para('a', 'Unbox the printer.'));
    expect(changesBetween(same, same)).toEqual([]);
  });
});
