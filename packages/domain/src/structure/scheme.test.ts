import { describe, expect, it } from 'vitest';

import { defaultNumberingScheme, formatCounter, numberingSchemeSchema } from './scheme.js';

describe('a numbering scheme', () => {
  it('holds the product default to its own schema, with the five sequences the engine needs', () => {
    expect(numberingSchemeSchema.parse(defaultNumberingScheme)).toEqual(defaultNumberingScheme);
    expect(Object.keys(defaultNumberingScheme.sequences).sort()).toEqual([
      'equation',
      'figure',
      'footnote',
      'section',
      'table',
    ]);
    const { section } = defaultNumberingScheme.sequences;
    expect(
      numberingSchemeSchema.safeParse({ id: 'sections-only/1', sequences: { section } }).success,
    ).toBe(false);
  });

  it('refuses a section rule that restarts or takes a prefix, since a section number is its stack', () => {
    const section = defaultNumberingScheme.sequences['section']!;
    const restarting = {
      ...defaultNumberingScheme,
      sequences: {
        ...defaultNumberingScheme.sequences,
        section: { ...section, body: { ...section.body, restartAt: 1 } },
      },
    };
    expect(numberingSchemeSchema.safeParse(restarting).success).toBe(false);
    const prefixed = {
      ...defaultNumberingScheme,
      sequences: {
        ...defaultNumberingScheme.sequences,
        section: { ...section, body: { ...section.body, prefix: 1 } },
      },
    };
    expect(numberingSchemeSchema.safeParse(prefixed).success).toBe(false);
  });

  it('refuses a rule that restarts without a prefix deep enough to keep two restarts of its counter apart', () => {
    const figure = defaultNumberingScheme.sequences['figure']!;
    const noPrefix = {
      ...defaultNumberingScheme,
      sequences: {
        ...defaultNumberingScheme.sequences,
        figure: { ...figure, body: { ...figure.body, restartAt: 2, prefix: null } },
      },
    };
    expect(numberingSchemeSchema.safeParse(noPrefix).success).toBe(false);
    const shallowPrefix = {
      ...defaultNumberingScheme,
      sequences: {
        ...defaultNumberingScheme.sequences,
        figure: { ...figure, body: { ...figure.body, restartAt: 2, prefix: 1 } },
      },
    };
    expect(numberingSchemeSchema.safeParse(shallowPrefix).success).toBe(false);
    const deepEnough = {
      ...defaultNumberingScheme,
      sequences: {
        ...defaultNumberingScheme.sequences,
        figure: { ...figure, body: { ...figure.body, restartAt: 2, prefix: 2 } },
      },
    };
    expect(numberingSchemeSchema.safeParse(deepEnough).success).toBe(true);
  });

  it('writes every counter in every format, past z and past 3999', () => {
    expect([26, 27, 28, 52, 53, 702, 703].map((n) => formatCounter(n, 'lowerAlpha'))).toEqual([
      'z',
      'aa',
      'ab',
      'az',
      'ba',
      'zz',
      'aaa',
    ]);
    expect(formatCounter(28, 'upperAlpha')).toBe('AB');
    expect(formatCounter(1994, 'lowerRoman')).toBe('mcmxciv');
    expect(formatCounter(4, 'upperRoman')).toBe('IV');
    expect(formatCounter(4000, 'upperRoman')).toBe('4000');
    expect(formatCounter(0, 'upperAlpha')).toBe('0');
    expect(formatCounter(12, 'decimal')).toBe('12');
  });
});
