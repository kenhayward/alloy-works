import { describe, expect, it } from 'vitest';

import { admissionLimits, exceedsLimits } from './limits.js';

const nested = (depth: number): unknown => {
  let value: unknown = { type: 'paragraph', content: [] };
  for (let level = 0; level < depth; level += 1) {
    value = { type: 'blockquote', content: [value] };
  }
  return value;
};

describe('the limits one admission is held to', () => {
  it('admits a component-sized document', () => {
    const paragraphs = Array.from({ length: 2_000 }, (_, index) => ({
      type: 'paragraph',
      content: [{ type: 'text', value: `Sentence ${index} about Leeds.`, marks: [] }],
    }));
    expect(exceedsLimits({ schemaVersion: 1, content: paragraphs })).toBeUndefined();
  });

  it('admits a list nested six levels deep, the floor the model promises', () => {
    let list: unknown = { type: 'paragraph', content: [] };
    for (let level = 0; level < 6; level += 1) {
      list = { type: 'list', kind: 'ordered', items: [{ content: [list] }] };
    }
    expect(exceedsLimits({ schemaVersion: 1, content: [list] })).toBeUndefined();
  });

  it('refuses nesting deeper than the limit without exhausting the stack', () => {
    expect(exceedsLimits(nested(100_000))).toMatch(/nested more than 128 deep/);
  });

  it('refuses more values than the limit', () => {
    const many = Array.from({ length: admissionLimits.values }, () => 0);
    expect(exceedsLimits(many)).toMatch(/more than 250000 values/);
  });

  it('refuses more characters than the limit, counted across every string', () => {
    const half = 'a'.repeat(admissionLimits.characters / 2);
    expect(exceedsLimits([half, half])).toBeUndefined();
    expect(exceedsLimits([half, half, 'a'])).toMatch(/more than 8000000 characters/);
  });
});
