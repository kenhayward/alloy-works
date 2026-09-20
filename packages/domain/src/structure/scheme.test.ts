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

  it('holds the default front matter to its own rules', () => {
    const { sequences } = defaultNumberingScheme;
    expect(sequences['section']!.front).toEqual({
      label: '',
      format: ['lowerRoman', 'decimal'],
      restartAt: null,
      prefix: null,
      separator: '.',
    });
    expect(sequences['figure']!.front).toEqual({
      label: 'Figure',
      format: ['decimal'],
      restartAt: 1,
      prefix: 1,
      separator: '.',
    });
    expect(sequences['table']!.front).toEqual({
      label: 'Table',
      format: ['decimal'],
      restartAt: 1,
      prefix: 1,
      separator: '.',
    });
    expect(sequences['equation']!.front).toEqual({
      label: 'Equation',
      format: ['lowerRoman'],
      restartAt: null,
      prefix: null,
      separator: '.',
    });
    expect(sequences['footnote']!.front).toEqual({
      label: '',
      format: ['decimal'],
      restartAt: null,
      prefix: null,
      separator: '.',
    });
    // Every sequence has a front rule: a scheme missing any one is refused, never numbered as the body.
    for (const name of ['section', 'figure', 'table', 'equation', 'footnote']) {
      const withoutFront: Record<string, unknown> = { ...sequences[name]! };
      delete withoutFront['front'];
      const missing = {
        ...defaultNumberingScheme,
        sequences: { ...sequences, [name]: withoutFront },
      };
      expect(numberingSchemeSchema.safeParse(missing).success, name).toBe(false);
    }
    // The scheme is stored in a layout's versions, so its rules hold in front matter as in the others:
    // a front figure restarting with no prefix, and a front section that restarts, are both refused.
    const figure = sequences['figure']!;
    const unprefixed = {
      ...defaultNumberingScheme,
      sequences: {
        ...sequences,
        figure: { ...figure, front: { ...figure.front, restartAt: 1, prefix: null } },
      },
    };
    expect(numberingSchemeSchema.safeParse(unprefixed).success).toBe(false);
    const section = sequences['section']!;
    const restarting = {
      ...defaultNumberingScheme,
      sequences: {
        ...sequences,
        section: { ...section, front: { ...section.front, restartAt: 1 } },
      },
    };
    expect(numberingSchemeSchema.safeParse(restarting).success).toBe(false);
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

  it(
    'restarts a footnote sequence per chapter with no prefix, since its labels are meant to ' +
      'repeat by house style, while a figure doing the same is still refused',
    () => {
      const footnote = defaultNumberingScheme.sequences['footnote']!;
      const perChapterFootnotes = {
        ...defaultNumberingScheme,
        sequences: {
          ...defaultNumberingScheme.sequences,
          footnote: { ...footnote, body: { ...footnote.body, restartAt: 1, prefix: null } },
        },
      };
      expect(numberingSchemeSchema.safeParse(perChapterFootnotes).success).toBe(true);
      const figure = defaultNumberingScheme.sequences['figure']!;
      const perChapterFigures = {
        ...defaultNumberingScheme,
        sequences: {
          ...defaultNumberingScheme.sequences,
          figure: { ...figure, body: { ...figure.body, restartAt: 1, prefix: null } },
        },
      };
      expect(numberingSchemeSchema.safeParse(perChapterFigures).success).toBe(false);
    },
  );

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
