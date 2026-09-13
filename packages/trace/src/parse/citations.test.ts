import { describe, expect, it } from 'vitest';

import { parseCitations } from './citations.js';

const file = 'apps/invented/src/widget.test.ts';

describe('scanning a test file for citations', () => {
  it('reads an identifier out of an it title', () => {
    const text = `it('refuses a widget nobody asked for (ABC-043)', () => {});`;

    expect(parseCitations(file, text)).toEqual([{ id: 'ABC-043', file, line: 1, kind: 'title' }]);
  });

  it('reads an identifier out of a describe title', () => {
    const text = `describe('what a widget may do (ABC-004)', () => {});`;

    expect(parseCitations(file, text)).toEqual([{ id: 'ABC-004', file, line: 1, kind: 'title' }]);
  });

  it('reads an identifier out of a rule field, which is how the product cites itself', () => {
    const text = `expect(response.json()).toMatchObject({ code: 'closed', rule: 'ABC-043' });`;

    expect(parseCitations(file, text)).toEqual([{ id: 'ABC-043', file, line: 1, kind: 'rule' }]);
  });

  // Mentioning a requirement is not claiming to verify it. This is the whole reason the strict count
  // of cited identifiers in this repository is smaller than a naive grep suggests.
  it('ignores an identifier in a comment', () => {
    const text = [
      '// The case this exists for is the one a filter forgets (ABC-004).',
      "it('x', () => {});",
    ].join('\n');

    expect(parseCitations(file, text)).toEqual([]);
  });

  it('ignores an identifier in ordinary code that is not a title or a rule', () => {
    const text = `const requirement = 'ABC-004';`;

    expect(parseCitations(file, text)).toEqual([]);
  });

  it('reads every identifier a single title names', () => {
    const text = `it('holds for both (ABC-004) and (ABC-005)', () => {});`;

    expect(parseCitations(file, text).map((citation) => citation.id)).toEqual([
      'ABC-004',
      'ABC-005',
    ]);
  });

  it('reports the line the citation is on, not the line the file starts at', () => {
    const text = ['', '', `it('a widget must spin (ABC-007)', () => {});`].join('\n');

    expect(parseCitations(file, text)[0]?.line).toBe(3);
  });

  it('finds an identifier in a title that prettier wrapped onto the next line', () => {
    const text = [
      'it(',
      `  'a widget must do a great many things, enough that the title does not fit (ABC-009)',`,
      '  () => {},',
      ');',
    ].join('\n');

    expect(parseCitations(file, text).map((citation) => citation.id)).toEqual(['ABC-009']);
  });

  // ZZZ is reserved for fixtures. This package's own parser tests are full of ZZZ identifiers, and
  // the rule that every cited identifier must exist would otherwise refuse all of them.
  it('ignores the reserved fixture area entirely', () => {
    const text = `it('a fixture widget must exist (ZZZ-001)', () => {});`;

    expect(parseCitations(file, text)).toEqual([]);
  });

  // A decision record is not a requirement, and `\b` is what stops ADR-0013 reading as ADR-001.
  it('does not mistake a four-digit decision record for a requirement', () => {
    const text = `it('treats the data as data (ADR-0013)', () => {});`;

    expect(parseCitations(file, text)).toEqual([]);
  });

  it('deduplicates a title that names the same identifier twice', () => {
    const text = `it('ABC-011 and again ABC-011', () => {});`;

    expect(parseCitations(file, text)).toHaveLength(1);
  });
});
