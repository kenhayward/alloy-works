import { describe, expect, it } from 'vitest';

import { canonicalise } from './canonical.js';
import { CURRENT_SCHEMA_VERSION, parseContentDocument } from './document.js';

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
});
