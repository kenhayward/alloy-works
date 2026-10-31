import { describe, expect, it } from 'vitest';

import { desktopLanguage, desktopWords, isInterfaceLanguage } from './desktop.js';

describe("the desktop shell's own words (the UI plan, UI-I)", () => {
  it('LOC-005 words the tray and the spelling menu from the catalogue, in the language asked for', () => {
    expect(desktopWords('en-GB')).toEqual({
      'desktop.show': 'Show Alloy Works',
      'desktop.connect': 'Connect to another environment',
      'desktop.update.check': 'Check for updates',
      'desktop.update.checking': 'Checking for updates',
      'desktop.update.downloading': 'Downloading the update, {percent}%',
      'desktop.update.restart': 'Restart to update',
      'desktop.update.title': 'Alloy Works updates',
      'desktop.update.available': 'Alloy Works {version} is available.',
      'desktop.update.available-detail': 'Download it now? It installs when Alloy Works restarts.',
      'desktop.update.download': 'Download',
      'desktop.update.not-now': 'Not now',
      'desktop.update.ready': 'Alloy Works {version} is ready to install.',
      'desktop.update.ready-detail':
        'Restart now, or it installs the next time you quit Alloy Works.',
      'desktop.update.restart-now': 'Restart now',
      'desktop.update.later': 'Later',
      'desktop.update.none': 'Alloy Works is up to date.',
      'desktop.update.failed': 'Alloy Works could not check for updates. Try again later.',
      'desktop.update.ok': 'OK',
      'desktop.quit': 'Quit',
      'desktop.no-suggestions': 'No suggestions',
      'desktop.add-to-dictionary': 'Add to dictionary',
    });
    const pseudo = desktopWords('en-XA');
    expect(pseudo['desktop.quit']).toMatch(/^\[Ǫûîţ ~+\]$/);
    // A placeholder survives, for the shell to fill.
    expect(pseudo['desktop.update.available']).toContain('{version}');
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
