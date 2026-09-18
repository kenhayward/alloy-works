import { describe, expect, it } from 'vitest';

import { canonicalise } from './canonical.js';
import { CURRENT_SCHEMA_VERSION, parseContentDocument, type ContentDocument } from './document.js';

const base = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  title: 'A component',
  language: 'en-GB',
  direction: 'ltr' as const,
};

describe('canonical serialisation', () => {
  it('CNT-011 produces one string for two documents differing only in member order', () => {
    const one = parseContentDocument({
      ...base,
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [{ type: 'text', value: 'x', marks: [] }],
        },
      ],
    });
    const other = parseContentDocument({
      content: [
        {
          style: 'body',
          content: [{ marks: [], value: 'x', type: 'text' }],
          id: 'b1',
          type: 'paragraph',
        },
      ],
      direction: 'ltr',
      language: 'en-GB',
      title: 'A component',
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    expect(canonicalise(one)).toBe(canonicalise(other));
  });

  it('CNT-011 produces one string for two documents differing only in mark order', () => {
    const marks = [
      { type: 'strong', id: 'm1' },
      { type: 'emphasis', id: 'm2' },
    ];
    const withOrder = (ordered: unknown[]) =>
      canonicalise(
        parseContentDocument({
          ...base,
          content: [
            {
              type: 'paragraph',
              id: 'b1',
              style: 'body',
              content: [{ type: 'text', value: 'x', marks: ordered }],
            },
          ],
        }),
      );
    expect(withOrder(marks)).toBe(withOrder([...marks].reverse()));
  });

  it('CNT-056 emits NFC, so two visually identical strings serialise alike', () => {
    // Written as code points rather than as characters on purpose. An editor normalises what it
    // saves, so two literals typed as "cafe with an acute" are one string in the file and the test
    // asserts nothing. Composed U+00E9 against decomposed e + U+0301 is a difference that survives.
    const composed = 'caf\u00e9';
    const decomposed = 'cafe\u0301';
    expect(composed).not.toBe(decomposed);
    const titled = (title: string) =>
      canonicalise(
        parseContentDocument({
          ...base,
          title,
          content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
        }),
      );
    expect(titled(composed)).toBe(titled(decomposed));
  });

  it('CNT-011 changes the string when the content changes', () => {
    const of = (value: string) =>
      canonicalise(
        parseContentDocument({
          ...base,
          content: [
            {
              type: 'paragraph',
              id: 'b1',
              style: 'body',
              content: [{ type: 'text', value, marks: [] }],
            },
          ],
        }),
      );
    expect(of('x')).not.toBe(of('y'));
  });

  it('CNT-011 emits no insignificant whitespace', () => {
    const serialised = canonicalise(
      parseContentDocument({
        ...base,
        content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
      }),
    );
    expect(serialised).not.toMatch(/\n|\t|: | ,/);
  });

  it('serialises a cross-reference and its target to one string whatever their member order, and reads it back', () => {
    const component = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
    const one = parseContentDocument({
      ...base,
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
              target: { kind: 'component', component, block: 'b2' },
              display: 'page',
              withoutPages: 'number',
            },
          ],
        },
        {
          type: 'figure',
          id: 'b2',
          asset: 'asset-1',
          imageStyle: 'column-width',
          caption: 'Dose',
          alternative: { kind: 'decorative' },
        },
      ],
    });
    // Unparsed on purpose: the parse rebuilds every object in the schema's member order, so two
    // parsed spellings are one value before `canonicalise` sorts anything. Every member reversed -
    // the root, each block, the reference and its target.
    const other = {
      content: [
        {
          content: [
            { marks: [], value: 'See ', type: 'text' },
            {
              withoutPages: 'number',
              display: 'page',
              target: { block: 'b2', component, kind: 'component' },
              id: 'x1',
              type: 'crossReference',
            },
          ],
          style: 'body',
          id: 'b1',
          type: 'paragraph',
        },
        {
          alternative: { kind: 'decorative' },
          caption: 'Dose',
          imageStyle: 'column-width',
          asset: 'asset-1',
          id: 'b2',
          type: 'figure',
        },
      ],
      direction: 'ltr',
      language: 'en-GB',
      title: 'A component',
      schemaVersion: CURRENT_SCHEMA_VERSION,
    } as unknown as ContentDocument;
    expect(canonicalise(one)).toBe(canonicalise(other));
    // What is stored is the canonical string; read back, it is the same document and the same string.
    const read = parseContentDocument(JSON.parse(canonicalise(one)));
    expect(read).toEqual(one);
    expect(canonicalise(read)).toBe(canonicalise(one));
  });

  it('holds a footnote as parsed, so its defaults spelled out or omitted give one string', () => {
    const noted = (inside: unknown) => ({
      ...base,
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'Dose', marks: [] },
            { type: 'footnote', id: 'f1', anchor: { kind: 'span' }, content: [inside] },
          ],
        },
      ],
    });
    const spelled = parseContentDocument(
      noted({
        type: 'paragraph',
        id: 'fb1',
        style: 'body',
        content: [{ type: 'text', value: 'Measured at the bench.', marks: [] }],
      }),
    );
    // The paragraph's `style` and the run's `marks` left to their defaults, as the parse fills them
    // in everywhere else.
    const omitted = parseContentDocument(
      noted({
        type: 'paragraph',
        id: 'fb1',
        content: [{ type: 'text', value: 'Measured at the bench.' }],
      }),
    );
    expect(omitted).toEqual(spelled);
    expect(canonicalise(omitted)).toBe(canonicalise(spelled));
  });
});
