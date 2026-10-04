import { renderContent, toEditor, type EditorView } from '@alloy-works/editor';
import { bindingDigestInput, parseContentDocument, type Binding } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { positionAtTextOffset, textOffsetIn } from './caret.js';

const BOUND = {
  type: 'binding',
  id: 'k1',
  query: '00000000-0000-4000-8000-00000000d001',
  parameters: { site: { literal: 'north' } },
  mode: 'checked',
  take: { column: 'count' },
};
const SQUARED =
  '<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>';

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

  it("counts a reference's drawn words as nothing, as the editor's document holds none, so a click after one lands where it was made", () => {
    const stored = parseContentDocument({
      schemaVersion: 1,
      title: 'Site visits',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'See ', marks: [] },
            {
              type: 'crossReference',
              id: 'x1',
              target: { kind: 'block', block: 't1' },
              display: 'number',
            },
            { type: 'text', value: ' for readings.', marks: [] },
          ],
        },
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [{ type: 'text', value: 'Readings', marks: [] }],
          headerRows: 0,
          headerColumns: 0,
          rows: [
            {
              cells: [
                {
                  content: [
                    {
                      type: 'paragraph',
                      id: 'c1',
                      style: 'body',
                      content: [{ type: 'text', value: 'York', marks: [] }],
                    },
                  ],
                  colspan: 1,
                  rowspan: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    const root = document.createElement('div');
    root.append(
      renderContent(stored, document, {
        targets: [
          {
            target: { kind: 'block', block: 't1' },
            kind: 'table',
            label: 'Table 1.1',
            title: 'Readings',
            relative: null,
          },
        ],
      })!,
    );
    expect(root.querySelector('[data-reference]')).toHaveTextContent(/^Table 1\.1$/);
    const after = root.querySelector('p')!.lastChild!;
    expect(after.textContent).toBe(' for readings.');

    // A click just before "for": the space after the reference is the one character counted past it.
    const openAt = textOffsetIn(root, after, 1);
    expect(openAt).toBe(5);
    const opened = (toEditor(stored) as { doc: EditorView['state']['doc'] }).doc;
    const pos = positionAtTextOffset(opened, openAt!);
    expect(opened.textBetween(pos, opened.child(0).nodeSize - 1)).toBe('for readings.');
    // A click inside the reference's words lands just before it.
    expect(textOffsetIn(root, root.querySelector('[data-reference]')!.firstChild!, 3)).toBe(4);
  });

  it("counts a value's drawn and hidden words, and an equation's, as nothing, as the editor's document holds none, so a click after one lands where it was made", () => {
    const stored = parseContentDocument({
      schemaVersion: 1,
      title: 'Site visits',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'There are ', marks: [] },
            BOUND,
            { type: 'text', value: ' sites, ', marks: [] },
            { type: 'equation', mathml: SQUARED },
            { type: 'text', value: ' each.', marks: [] },
          ],
        },
      ],
    });
    const root = document.createElement('div');
    root.append(
      renderContent(stored, document, null, {
        kind: 'document',
        held: new Map([
          [
            'k1',
            {
              binding: bindingDigestInput(BOUND as Binding),
              shown: { value: '12', waiting: false },
            },
          ],
        ]),
      })!,
    );
    expect(root.querySelector('[data-binding]')!.textContent).toMatch(/^12/);
    const opened = (toEditor(stored) as { doc: EditorView['state']['doc'] }).doc;
    const [, , sites, , each] = [...root.querySelector('p')!.childNodes];
    expect(sites!.textContent).toBe(' sites, ');
    expect(each!.textContent).toBe(' each.');

    // A click just before "sites": the space after the value is the one character counted past it.
    const afterValue = textOffsetIn(root, sites!, 1)!;
    expect(afterValue).toBe(11);
    const at = positionAtTextOffset(opened, afterValue);
    expect(opened.textBetween(at, opened.child(0).nodeSize - 1)).toBe('sites,  each.');
    // And past the equation too.
    const afterEquation = textOffsetIn(root, each!, 1)!;
    expect(afterEquation).toBe(19);
    expect(
      opened.textBetween(positionAtTextOffset(opened, afterEquation), opened.child(0).nodeSize - 1),
    ).toBe('each.');
    // A click inside the value's words lands just before it.
    const walker = document.createTreeWalker(
      root.querySelector('[data-binding]')!,
      NodeFilter.SHOW_TEXT,
    );
    expect(textOffsetIn(root, walker.nextNode()!, 1)).toBe(10);
  });

  it('opens at the start of a paragraph beginning with a value, before it, where nothing is counted', () => {
    const opened = (
      toEditor(
        parseContentDocument({
          schemaVersion: 1,
          title: 'Site visits',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'b1',
              style: 'body',
              content: [BOUND, { type: 'text', value: ' sites.', marks: [] }],
            },
          ],
        }),
      ) as { doc: EditorView['state']['doc'] }
    ).doc;
    const at = positionAtTextOffset(opened, 0);
    expect(at).toBe(1);
    // The value stands after the caret, so ArrowRight reaches it (B1-L).
    expect(opened.resolve(at).nodeAfter?.type.name).toBe('binding');
  });
});
