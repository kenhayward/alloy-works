import { describe, expect, it } from 'vitest';

import { cldrPluralRules } from '../../scripts/cldr-inputs.js';
import { CONTENT_LANGUAGES } from './content-languages.js';
import { PLURAL_RULE_OF, PLURAL_RULES } from './plural-rules.js';
import { compilePluralRules, pluralCategory, pluralSamples, renderPluralRules } from './plurals.js';

describe('the compiled plural rules (the MF plan, MF-B)', () => {
  it('LOC-044 are the rules the pinned CLDR gives, regenerated and compared', () => {
    // `pnpm --filter @alloy-works/domain generate:languages` rewrites plural-rules.ts.
    expect(compilePluralRules(cldrPluralRules())).toEqual({
      rules: PLURAL_RULES,
      of: PLURAL_RULE_OF,
    });
    // Moves with the CLDR, and only then.
    expect(Object.keys(PLURAL_RULE_OF)).toHaveLength(224);
    expect(PLURAL_RULES).toHaveLength(40);
  });

  it('selects the category CLDR names for every sample it writes, in every locale', () => {
    let checked = 0;
    for (const [locale, rules] of Object.entries(cldrPluralRules())) {
      for (const [category, rule] of Object.entries(rules)) {
        for (const { value, scale } of pluralSamples(rule)) {
          expect(pluralCategory(locale, value, scale), `${locale} ${value}`).toBe(
            category.replace('pluralRule-count-', ''),
          );
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it('reads the samples CLDR writes: ranges expanded, compact ones and the ellipsis dropped', () => {
    expect(
      pluralSamples('i = 1 and v = 0 @integer 1, 3~5, … @decimal 0.0~0.2, 1.00, 1.1c6, …'),
    ).toEqual([
      { value: '1', scale: 0 },
      { value: '3', scale: 0 },
      { value: '4', scale: 0 },
      { value: '5', scale: 0 },
      { value: '0.0', scale: 1 },
      { value: '0.1', scale: 1 },
      { value: '0.2', scale: 1 },
      { value: '1.00', scale: 2 },
    ]);
  });

  it('reads the operands at the declared scale, so 1.50 is not one in English', () => {
    expect(pluralCategory('en', '1', 0)).toBe('one');
    expect(pluralCategory('en', '1', 2)).toBe('other');
    expect(pluralCategory('en', '1.5', 2)).toBe('other');
    expect(pluralCategory('en', '-1', 0)).toBe('one');
    // n is the value, so 1.0 meets `n = 1` and 1.5 meets none.
    expect(pluralCategory('ar', '1', 1)).toBe('one');
    expect(pluralCategory('ar', '1.5', 1)).toBe('other');
    expect(pluralCategory('ar', '3', 0)).toBe('few');
    expect(pluralCategory('ar', '11', 0)).toBe('many');
    expect(pluralCategory('ar', '100', 0)).toBe('other');
    // Larger than a float holds exactly.
    expect(pluralCategory('ru', '123456789012345678901', 0)).toBe('one');
  });

  it('tries the full tag, then its language, then und, in any case', () => {
    expect(pluralCategory('pt', '0', 0)).toBe('one');
    expect(pluralCategory('pt-PT', '0', 0)).toBe('other');
    expect(pluralCategory('PT-pt', '0', 0)).toBe('other');
    expect(pluralCategory('pt-BR', '0', 0)).toBe('one');
    expect(pluralCategory('en-GB', '1', 0)).toBe('one');
    expect(pluralCategory('zz', '1', 0)).toBe('other');
  });

  it('refuses a value that is not a canonical number', () => {
    expect(() => pluralCategory('en', '1e3', 0)).toThrow();
    expect(() => pluralCategory('en', '', 0)).toThrow();
    expect(() => pluralCategory('en', '1', -1)).toThrow();
  });

  it('has rules for every declared content language, with the categories it declares', () => {
    for (const language of CONTENT_LANGUAGES) {
      const rules = cldrPluralRules();
      const key = rules[language.tag] ? language.tag : language.tag.split('-')[0]!;
      const seen = new Set<string>();
      for (const rule of Object.values(rules[key] ?? rules['und']!)) {
        for (const { value, scale } of pluralSamples(rule)) {
          seen.add(pluralCategory(language.tag, value, scale));
        }
      }
      expect([...seen].sort(), language.tag).toEqual([...language.plurals].sort());
    }
  });

  it('compiles and, or, modulo, ranges and lists as CLDR reads them', () => {
    const compiled = compilePluralRules({
      xx: {
        'pluralRule-count-one': 'n % 10 = 1 and n % 100 != 11,71..79 or v = 2 @integer 1',
        'pluralRule-count-other': ' @integer 0',
      },
      yy: { 'pluralRule-count-other': ' @integer 0' },
    });
    expect(compiled).toEqual({
      rules: [
        [
          [
            'one',
            [
              [
                ['n', 10, [1, 1]],
                ['n', 100, [11, 11, 71, 79], true],
              ],
              [['v', 0, [2, 2]]],
            ],
          ],
        ],
        [],
      ],
      of: { xx: 0, yy: 1 },
    });
    expect(renderPluralRules(compiled)).toContain('export const PLURAL_RULE_OF');
    expect(() => compilePluralRules({ xx: { 'pluralRule-count-one': 'n within 1..2' } })).toThrow();
  });
});
