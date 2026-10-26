import { describe, expect, it } from 'vitest';

import { INTERFACE_LOCALES, chosenLanguage, localeOf } from './locales.js';
import { pseudolocalise } from './pseudo.js';

describe('the interface languages (the UI plan, UI-B, UI-D)', () => {
  it('LOC-038 declares its languages, each its direction and the locale its formats use', () => {
    expect(
      INTERFACE_LOCALES.map((each) => [each.tag, each.direction, each.formats, each.pseudo]),
    ).toEqual([
      ['en-GB', 'ltr', 'en-GB', false],
      ['en-XA', 'ltr', 'en-GB', true],
      ['ar-XB', 'rtl', 'ar', true],
    ]);
    expect(localeOf('ar-XB').direction).toBe('rtl');
  });

  it('LOC-005 takes a person’s own choice, else their browser’s first declared language, never a pseudo-locale unasked, else English', () => {
    expect(chosenLanguage('en-XA', ['fr-FR'])).toBe('en-XA');
    expect(chosenLanguage(null, ['fr-FR', 'en-US', 'en-GB'])).toBe('en-GB');
    expect(chosenLanguage(null, ['ar-XB', 'en-XA'])).toBe('en-GB');
    expect(chosenLanguage(null, ['en'])).toBe('en-GB');
    expect(chosenLanguage('xx-YY', [])).toBe('en-GB');
  });

  it('LOC-042 LOC-029 accents and brackets every word, half again longer, twice under twenty characters, its placeholders and plurals untouched', () => {
    const short = pseudolocalise('Save', 'en-XA');
    expect(short.startsWith('[')).toBe(true);
    expect(short.endsWith(']')).toBe(true);
    expect(short).toMatch(/Šåṽé/);
    expect(short.length).toBeGreaterThanOrEqual('Save'.length * 2);
    const long = 'The document could not be published in that language.';
    expect(pseudolocalise(long, 'en-XA').length).toBeGreaterThanOrEqual(long.length * 1.5);
    const message = '{count, plural, one {# part} other {# parts}} by {name}';
    const pseudo = pseudolocalise(message, 'en-XA');
    expect(pseudo).toContain('{count,plural,one{# þåŕţ} other{# þåŕţš}}');
    expect(pseudo).toContain('{name}');
    expect(pseudo).not.toContain('{ñåɱé}');
  });

  it('LOC-004 marks the right-to-left pseudo-locale’s words, reversed in direction, so a left-to-right string shows', () => {
    const rtl = pseudolocalise('Save {name}', 'ar-XB');
    expect(rtl.startsWith('‮')).toBe(true);
    expect(rtl).toContain('{name}');
  });
});
