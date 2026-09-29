import { describe, expect, it } from 'vitest';

import { approved, EDITOR_DEVIATIONS, WORD_DEVIATIONS, type Difference } from './compare.js';

const difference = (property: string, what: string): Difference => ({
  token: 'Ze1',
  what,
  property,
  editor: 'Cambria Math',
  pdf: 'STIX Two Math',
});

describe('the lists of approved deviations, one for each pair of outputs (the W15 plan, W15-H)', () => {
  it('approves nothing between the editor and the PDF, and between Word and the PDF only the maths face a theme names for Word', () => {
    const face = difference('maths face', "the equation's face");
    expect(EDITOR_DEVIATIONS).toEqual([]);
    expect(approved(face, EDITOR_DEVIATIONS)).toBe(false);
    expect(approved(face, WORD_DEVIATIONS)).toBe(true);
  });

  it('approves a difference only by its property and what it stands in together', () => {
    expect(approved(difference('maths face', 'a heading at depth 1'), WORD_DEVIATIONS)).toBe(false);
    expect(approved(difference('face', "the equation's face"), WORD_DEVIATIONS)).toBe(false);
  });
});
