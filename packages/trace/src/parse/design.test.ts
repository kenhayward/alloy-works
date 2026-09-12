import { describe, expect, it } from 'vitest';

import { parseDesignDocument } from './design.js';

const document = 'invented-subsystem.md';

describe('parsing a design document', () => {
  it('reads the claims in the Requirements owned section', () => {
    const text = [
      '# Invented subsystem',
      '',
      '## Requirements owned',
      '',
      '| ID          | How it is met            |',
      '| ----------- | ------------------------ |',
      '| **ZZZ-001** | A column holds the name  |',
      '| **ZZZ-002** | The row is never updated |',
      '',
      '## Traceability',
      '',
      '| **ZZZ-003** | Mentioned after the section, so not claimed |',
    ].join('\n');

    expect(parseDesignDocument(document, text)).toEqual({
      document,
      owns: [
        { id: 'ZZZ-001', howItIsMet: 'A column holds the name' },
        { id: 'ZZZ-002', howItIsMet: 'The row is never updated' },
      ],
    });
  });

  it('claims nothing when the document has no Requirements owned section', () => {
    const text = '# Invented subsystem\n\nProse, and an identifier ZZZ-004 mentioned in it.\n';

    expect(parseDesignDocument(document, text)).toEqual({ document, owns: [] });
  });

  it('does not treat an identifier in prose inside the section as a claim', () => {
    const text = [
      '## Requirements owned',
      '',
      'This subsystem also relates to ZZZ-009, which it does not own.',
      '',
      '| **ZZZ-005** | The only claim |',
    ].join('\n');

    expect(parseDesignDocument(document, text).owns).toEqual([
      { id: 'ZZZ-005', howItIsMet: 'The only claim' },
    ]);
  });

  it('refuses a claim that explains nothing', () => {
    const text = '## Requirements owned\n\n| **ZZZ-006** |  |';

    expect(() => parseDesignDocument(document, text)).toThrow(/invented-subsystem\.md:3/);
  });

  it('does not claim a row of the wrong width, even with a valid identifier in it', () => {
    const text = [
      '## Requirements owned',
      '',
      '| **ZZZ-007** | A third column | That should not be here |',
    ].join('\n');

    expect(parseDesignDocument(document, text).owns).toEqual([]);
  });

  it('does not claim a non-requirement or an open question, which cannot be owned by a design', () => {
    const text = [
      '## Requirements owned',
      '',
      '| **ZZZ-N01** | A non-requirement has nothing to meet |',
      '| **ZZZ-Q01** | An open question has nothing to meet |',
      '| **ZZZ-008** | The only real claim |',
    ].join('\n');

    expect(parseDesignDocument(document, text).owns).toEqual([
      { id: 'ZZZ-008', howItIsMet: 'The only real claim' },
    ]);
  });
});
