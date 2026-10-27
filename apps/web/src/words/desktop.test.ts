import { describe, expect, it } from 'vitest';

import { desktopLanguage, desktopWords, isInterfaceLanguage } from './desktop.js';

describe("the desktop shell's own words (the UI plan, UI-I)", () => {
  it('LOC-005 words the tray and the spelling menu from the catalogue, in the language asked for', () => {
    expect(desktopWords('en-GB')).toEqual({
      'desktop.show': 'Show Alloy Works',
      'desktop.quit': 'Quit',
      'desktop.no-suggestions': 'No suggestions',
      'desktop.add-to-dictionary': 'Add to dictionary',
    });
    const pseudo = desktopWords('en-XA');
    expect(pseudo['desktop.quit']).toMatch(/^\[Ǫûîţ ~+\]$/);
    // A tag not declared is English.
    expect(desktopWords('fr-FR')['desktop.quit']).toBe('Quit');
  });

  it("starts in the system's language where one is declared, else English, never a pseudo-locale", () => {
    expect(desktopLanguage('en-US')).toBe('en-GB');
    expect(desktopLanguage('fr')).toBe('en-GB');
    expect(desktopLanguage('en-XA')).toBe('en-GB');
  });

  it('takes from the renderer only a declared tag', () => {
    expect(isInterfaceLanguage('ar-XB')).toBe(true);
    expect(isInterfaceLanguage('en-GB')).toBe(true);
    for (const refused of ['fr-FR', 'EN-GB', '', 1, null, ['en-GB'], { tag: 'en-GB' }]) {
      expect(isInterfaceLanguage(refused)).toBe(false);
    }
  });
});
