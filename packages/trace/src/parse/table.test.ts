import { describe, expect, it } from 'vitest';

import { boldIdentifier, tableCells } from './table.js';

/**
 * Direct tests for the riskiest function in this package. Both parsers only exercise `tableCells`
 * and `boldIdentifier` through whole documents, so a defect narrow enough to dodge every fixture
 * there could still ship. These tests aim straight at the two functions instead.
 */
describe('tableCells', () => {
  it('splits a normal row into trimmed cells', () => {
    expect(tableCells('| **ZZZ-001** | A widget must exist | T1 | Specified |')).toEqual([
      '**ZZZ-001**',
      'A widget must exist',
      'T1',
      'Specified',
    ]);
  });

  it('tolerates leading whitespace before the opening pipe', () => {
    expect(tableCells('   | **ZZZ-001** | A widget must exist |')).toEqual([
      '**ZZZ-001**',
      'A widget must exist',
    ]);
  });

  it('keeps an escaped pipe inside a cell whole, rather than splitting on it', () => {
    expect(tableCells('| **ZZZ-001** | A widget must accept `a \\| b` as one value |')).toEqual([
      '**ZZZ-001**',
      'A widget must accept `a \\| b` as one value',
    ]);
  });

  it('yields an empty string for an empty cell rather than dropping it', () => {
    expect(tableCells('| **ZZZ-006** |  |')).toEqual(['**ZZZ-006**', '']);
  });

  it('returns undefined for the bare separator line', () => {
    expect(tableCells('|')).toBeUndefined();
  });

  it('returns undefined for a line that is not a table row at all', () => {
    expect(tableCells('# Just a heading, not a table')).toBeUndefined();
  });
});

describe('boldIdentifier', () => {
  it('accepts a bolded requirement identifier', () => {
    expect(boldIdentifier('**ZZZ-001**')).toBe('ZZZ-001');
  });

  it('accepts a bolded non-requirement identifier', () => {
    expect(boldIdentifier('**ZZZ-N01**')).toBe('ZZZ-N01');
  });

  it('accepts a bolded open-question identifier', () => {
    expect(boldIdentifier('**ZZZ-Q01**')).toBe('ZZZ-Q01');
  });

  it('rejects a bolded cell that is not an identifier', () => {
    expect(boldIdentifier('**Concept**')).toBeUndefined();
  });
});
