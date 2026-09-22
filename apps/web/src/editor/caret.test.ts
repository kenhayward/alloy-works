import { toEditor, type EditorView } from '@alloy-works/editor';
import { parseContentDocument } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { positionAtTextOffset, textOffsetIn } from './caret.js';

const doc = (
  toEditor(
    parseContentDocument({
      schemaVersion: 1,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'Unbox ', marks: [] },
            { type: 'text', value: 'it.', marks: [{ type: 'strong', id: 'm1' }] },
          ],
        },
        {
          type: 'paragraph',
          id: 'b2',
          style: 'body',
          content: [{ type: 'text', value: 'Plug in.', marks: [] }],
        },
      ],
    }),
  ) as { doc: EditorView['state']['doc'] }
).doc;

describe('the caret carried from the rendered text into the editor', () => {
  it('counts the characters before a point in rendered text, through marks and blocks', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Unbox <strong>it.</strong></p><p>Plug in.</p>';
    const second = root.childNodes[1]!.firstChild!;
    expect(textOffsetIn(root, second, 2)).toBe(11);
    const strong = root.firstChild!.childNodes[1]!.firstChild!;
    expect(textOffsetIn(root, strong, 1)).toBe(7);
    // An element and a child index, as a browser reports a point between nodes.
    expect(textOffsetIn(root, root, 1)).toBe(9);
    expect(textOffsetIn(root, document.createTextNode('elsewhere'), 0)).toBeNull();
  });

  it('finds the position in the document at the same count of characters', () => {
    expect(positionAtTextOffset(doc, 0)).toBe(1);
    expect(positionAtTextOffset(doc, 7)).toBe(8);
    // The end of the first paragraph, not the start of the next: the offset is where the click was.
    expect(positionAtTextOffset(doc, 9)).toBe(10);
    expect(positionAtTextOffset(doc, 11)).toBe(14);
    // Past the end, the end of the text.
    expect(positionAtTextOffset(doc, 99)).toBe(20);
  });
});
