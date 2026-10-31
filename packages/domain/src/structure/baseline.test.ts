import { describe, expect, it } from 'vitest';
import { baselineDigestInput, baselineNameProblem, type BaselinePins } from './baseline.js';

const v = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const d = (c: string) => c.repeat(64);

const pins: BaselinePins = {
  document: { version: v(1), digest: d('a') },
  layout: { version: v(2), digest: d('b') },
  theme: { version: v(3), digest: d('c') },
  template: null,
  occurrences: [
    { node: 'bbbbbbbbbbbbbbbbbbbbbbbbbb', version: v(5), digest: d('e') },
    { node: 'aaaaaaaaaaaaaaaaaaaaaaaaaa', version: v(4), digest: d('d') },
  ],
  assets: [{ version: v(6), digest: d('f') }],
  bindings: [
    {
      node: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
      binding: 'dose',
      digest: d('1'),
      datasetVersion: v(7),
      datasetDigest: d('2'),
    },
  ],
};

describe('a baseline’s digest input and its name', () => {
  it('VER-043 is one canonical string over every pin, whatever order they are listed in', () => {
    const reordered: BaselinePins = { ...pins, occurrences: [...pins.occurrences].reverse() };
    expect(baselineDigestInput(reordered)).toBe(baselineDigestInput(pins));
    expect(baselineDigestInput(pins)).toContain(`"version":"${v(4)}"`);
    const moved: BaselinePins = {
      ...pins,
      occurrences: [pins.occurrences[0]!, { ...pins.occurrences[1]!, version: v(9) }],
    };
    expect(baselineDigestInput(moved)).not.toBe(baselineDigestInput(pins));
    const rebound: BaselinePins = {
      ...pins,
      bindings: [{ ...pins.bindings[0]!, datasetVersion: v(8) }],
    };
    expect(baselineDigestInput(rebound)).not.toBe(baselineDigestInput(pins));
  });

  it('digests the term versions it pins in one order, and a baseline pinning none as it did (TMb)', () => {
    const termed: BaselinePins = {
      ...pins,
      terms: [
        { version: v(11), digest: d('4') },
        { version: v(10), digest: d('3') },
      ],
    };
    expect(baselineDigestInput({ ...termed, terms: [...termed.terms!].reverse() })).toBe(
      baselineDigestInput(termed),
    );
    expect(baselineDigestInput(termed)).toContain(`"terms":[{"digest":"${d('3')}"`);
    expect(baselineDigestInput(pins)).not.toContain('terms');
  });

  it('digests the vocabulary versions it pins in one order, and a baseline pinning none as it did (VO-H)', () => {
    const labelled: BaselinePins = {
      ...pins,
      vocabularies: [
        { version: v(13), digest: d('6') },
        { version: v(12), digest: d('5') },
      ],
    };
    expect(
      baselineDigestInput({ ...labelled, vocabularies: [...labelled.vocabularies!].reverse() }),
    ).toBe(baselineDigestInput(labelled));
    expect(baselineDigestInput(labelled)).toContain(`"vocabularies":[{"digest":"${d('5')}"`);
    expect(baselineDigestInput(pins)).not.toContain('vocabularies');
  });

  it('VER-046 holds a name to 1 to 120 characters, its own trim and no control character', () => {
    expect(baselineNameProblem('As approved')).toBeNull();
    expect(baselineNameProblem('a'.repeat(120))).toBeNull();
    expect(baselineNameProblem('')).toBe('A name is 1 to 120 characters');
    expect(baselineNameProblem('a'.repeat(121))).toBe('A name is 1 to 120 characters');
    expect(baselineNameProblem(' Approved')).toBe('A name has no space before or after it');
    expect(baselineNameProblem('Appro\u0007ved')).toBe('A name holds no control character');
  });
});
