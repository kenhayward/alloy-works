import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pluralCategory, pluralSamples, type PluralSample } from '@alloy-works/domain';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The domain's compiled plural rules held to the interface's FormatJS (the MF plan, MF-B), over every
 * sample the pinned CLDR writes: whole numbers alike everywhere, decimals alike but where FormatJS
 * departs from CLDR's own samples, which is pinned.
 */

const cldr = (
  JSON.parse(
    readFileSync(
      createRequire(import.meta.url).resolve('cldr-core/supplemental/plurals.json'),
      'utf8',
    ),
  ) as { supplemental: { 'plurals-type-cardinal': Record<string, Record<string, string>> } }
).supplemental['plurals-type-cardinal'];

/** The whole-number samples CLDR writes, every locale's together. */
const INTEGER_SAMPLES = 5_690;

const samples = (rules: Record<string, string>): PluralSample[] =>
  Object.values(rules).flatMap(pluralSamples);

/** FormatJS's compiled rules, by the locale its data names. */
const formatjs = (
  Intl.PluralRules as unknown as {
    localeData: Record<string, { fn: (value: string, ordinal: boolean) => string }>;
  }
).localeData;

/**
 * The locale FormatJS resolves a CLDR key to: the key as `Intl` canonicalises it (`mo` is `ro`, `tl` is
 * `fil`), else that one's language where FormatJS has no data of its own for it (`sh`, `sr-Latn`: `sr`).
 */
const resolved = (locale: string) => {
  const tag = Intl.getCanonicalLocales(locale)[0]!;
  return formatjs[tag] ? tag : tag.split('-')[0]!;
};

const made = new Map<string, Intl.PluralRules>();
/** The interface's rules for a locale, printing `scale` places. */
const atScale = (locale: string, scale: number) => {
  const key = `${locale} ${scale}`;
  if (!made.has(key)) {
    made.set(
      key,
      new Intl.PluralRules(locale, { minimumFractionDigits: scale, maximumFractionDigits: scale }),
    );
  }
  return made.get(key)!;
};

describe('the domain’s plural rules and the interface’s (the MF plan, MF-B)', () => {
  beforeAll(async () => {
    // FormatJS's own data for every locale, onto the `Intl.PluralRules` polyfills.ts forces.
    for (const locale of Object.keys(cldr)) {
      await import(`@formatjs/intl-pluralrules/locale-data/${locale}.js`);
    }
    for (const locale of Object.keys(cldr)) {
      await import(`@formatjs/intl-pluralrules/locale-data/${resolved(locale)}.js`);
    }
  });

  it('selects what the interface selects for every whole-number sample of every CLDR locale', () => {
    let compared = 0;
    for (const [locale, rules] of Object.entries(cldr)) {
      // A deprecated tag asked for as FormatJS resolves it: it cannot resolve `sh` itself.
      const interfaceRules = new Intl.PluralRules(resolved(locale));
      // Its own data, never a fallback's.
      expect(interfaceRules.resolvedOptions().locale, locale).toBe(resolved(locale));
      for (const { value, scale } of samples(rules)) {
        if (scale > 0) continue;
        expect(pluralCategory(locale, value, 0), `${locale} ${value}`).toBe(
          interfaceRules.select(Number(value)),
        );
        compared += 1;
      }
    }
    expect(compared).toBe(INTEGER_SAMPLES);
  });

  it('differs from FormatJS on a decimal only where FormatJS departs from CLDR’s own sample', () => {
    let selectDiffers = 0;
    const rulesDiffer = new Set<string>();
    for (const [locale, rules] of Object.entries(cldr)) {
      for (const [key, rule] of Object.entries(rules)) {
        for (const { value, scale } of pluralSamples(rule)) {
          if (scale === 0) continue;
          const ours = pluralCategory(locale, value, scale);
          // CLDR's own category for the sample, which the domain always gives.
          expect(ours, `${locale} ${value}`).toBe(key.replace('pluralRule-count-', ''));
          const interfaceRules = atScale(resolved(locale), scale);
          if (interfaceRules.select(Number(value)) !== ours) selectDiffers += 1;
          if (formatjs[locale]!.fn(value, false) !== ours) rulesDiffer.add(locale);
        }
      }
    }
    // FormatJS 6.3.15 departs twice. `select` keeps the point when it reads a fraction's digits, so
    // 1.1 reaches af's rule as "1.0.1", read as 1, `one`. And its compiled rules read `n = 0..1` as
    // a span, so 0.1 is ak's `one`, where CLDR's samples make it `other`: `n` is in a range only
    // when whole. Pinned, so a FormatJS that reads either again is seen.
    expect(selectDiffers).toBe(1_453);
    expect([...rulesDiffer]).toEqual([
      'ak',
      'bho',
      'csw',
      'guw',
      'ln',
      'mg',
      'nso',
      'pa',
      'shi',
      'ti',
      'tzm',
      'wa',
    ]);
  });
});
