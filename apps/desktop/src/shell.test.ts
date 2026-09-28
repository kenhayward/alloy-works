import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BRIDGE_GLOBAL,
  DEV_SERVER_URL,
  PLATFORM_INFO_CHANNEL,
  SPELL_CHECK_LANGUAGES_CHANNEL,
  describePlatform,
  resolveRendererTarget,
  spellCheckRequest,
  spellCheckerChoice,
  spellCheckerLanguages,
  spellingMenu,
} from './shell.js';

// String.raw so the Windows separators stay literal - the shell must hand Electron the path it was
// given, not a version of it that survived an escaping round trip.
const WINDOWS_INDEX = String.raw`C:\app\web\dist\index.html`;

describe('resolveRendererTarget', () => {
  it('loads the dev server while unpackaged, so a renderer edit hot-reloads in the window', () => {
    expect(
      resolveRendererTarget({
        packaged: false,
        devServerUrl: 'http://localhost:5173',
        rendererIndexHtml: WINDOWS_INDEX,
      }),
    ).toEqual({ kind: 'url', value: 'http://localhost:5173' });
  });

  it('loads the built renderer from disk once packaged', () => {
    expect(
      resolveRendererTarget({
        packaged: true,
        devServerUrl: 'http://localhost:5173',
        rendererIndexHtml: WINDOWS_INDEX,
      }),
    ).toEqual({ kind: 'file', value: WINDOWS_INDEX });
  });

  it('loads the service when it has one, whether packaged or not', () => {
    const location = {
      packaged: true,
      devServerUrl: DEV_SERVER_URL,
      rendererIndexHtml: WINDOWS_INDEX,
      serviceUrl: 'https://dev.acme.example',
    };
    expect(resolveRendererTarget(location)).toEqual({
      kind: 'url',
      value: 'https://dev.acme.example',
    });
    expect(resolveRendererTarget({ ...location, packaged: false })).toEqual({
      kind: 'url',
      value: 'https://dev.acme.example',
    });
  });

  it('falls back to what it did before when it has no service to load', () => {
    expect(
      resolveRendererTarget({
        packaged: true,
        devServerUrl: DEV_SERVER_URL,
        rendererIndexHtml: WINDOWS_INDEX,
      }),
    ).toEqual({ kind: 'file', value: WINDOWS_INDEX });
  });
});

describe('describePlatform', () => {
  it('reports the desktop delivery and the Electron version behind it', () => {
    expect(describePlatform({ electron: '44.3.0' })).toEqual({
      delivery: 'desktop',
      runtime: 'Electron 44.3.0',
    });
  });

  it('does not invent a version it was not given', () => {
    expect(describePlatform({})).toEqual({ delivery: 'desktop', runtime: 'Electron (unknown)' });
  });
});

describe('the bridge contract', () => {
  // Pinned: the renderer reads window.alloyWorks and the preload writes it. A rename on one side
  // with no matching rename on the other is a blank window, not a build error.
  it('names the global the renderer looks for', () => {
    expect(BRIDGE_GLOBAL).toBe('alloyWorks');
  });

  it('namespaces the IPC channel, so an unrelated handler cannot answer it', () => {
    expect(PLATFORM_INFO_CHANNEL).toBe('alloy-works:platform-info');
  });

  // Pinned for the same reason: the preload invokes it and the main process handles it, and a rename
  // on one side is a spelling checker that silently keeps whatever dictionary it started with.
  it('namespaces the spelling channel, apart from the platform channel', () => {
    expect(SPELL_CHECK_LANGUAGES_CHANNEL).toBe('alloy-works:spell-check-languages');
    expect(SPELL_CHECK_LANGUAGES_CHANNEL).not.toBe(PLATFORM_INFO_CHANNEL);
  });
});

/** What Chromium offers on Windows and Linux, give or take a few: a short, typical list. */
const AVAILABLE = ['de-DE', 'en-AU', 'en-GB', 'en-US', 'es', 'es-ES', 'fr', 'nl', 'pt-BR', 'pt-PT'];

describe('spellCheckRequest', () => {
  // The renderer is untrusted, so what it sends is checked here, in the main process, whatever the
  // renderer checked first: a short list of language tags in the shape the stored model takes them.
  it('accepts a short list of language tags', () => {
    expect(spellCheckRequest(['en-GB'])).toEqual(['en-GB']);
    expect(spellCheckRequest(['fr-CA', 'sr-Latn-RS', 'sl-IT-nedis', 'es-419'])).toEqual([
      'fr-CA',
      'sr-Latn-RS',
      'sl-IT-nedis',
      'es-419',
    ]);
    expect(spellCheckRequest([])).toEqual([]);
  });

  it('refuses anything that is not an array of strings', () => {
    for (const value of [undefined, null, 'en-GB', 42, { 0: 'en-GB', length: 1 }, [42], [null]]) {
      expect(spellCheckRequest(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('refuses a tag in any other shape, and the whole request with it', () => {
    for (const tag of [
      '',
      'en_GB',
      'EN-gb',
      'english',
      'en-GB ',
      'en-GB-u-ca-gregory',
      'x-private',
      '../../dictionaries',
      `en-GB${String.fromCharCode(0)}`,
      'a'.repeat(200),
    ]) {
      expect(spellCheckRequest(['en-GB', tag]), tag).toBeNull();
    }
  });

  it('refuses more tags than a window could have components open in different languages', () => {
    expect(spellCheckRequest(Array.from({ length: 8 }, () => 'en-GB'))).toHaveLength(8);
    expect(spellCheckRequest(Array.from({ length: 9 }, () => 'en-GB'))).toBeNull();
  });
});

describe('spellCheckerLanguages', () => {
  it('CNT-178 maps the languages of the components open to the dictionaries Electron has', () => {
    expect(spellCheckerLanguages(['en-GB'], AVAILABLE)).toEqual(['en-GB']);
    expect(spellCheckerLanguages(['en-GB', 'de-DE'], AVAILABLE)).toEqual(['en-GB', 'de-DE']);
  });

  it('falls back to the language on its own, then to its usual dictionary, then to any of it', () => {
    // A region Electron has no dictionary for is checked against the language's own.
    expect(spellCheckerLanguages(['fr-CA'], AVAILABLE)).toEqual(['fr']);
    // English has no dictionary without a region: American English is the usual one.
    expect(spellCheckerLanguages(['en-NZ'], AVAILABLE)).toEqual(['en-US']);
    expect(spellCheckerLanguages(['en-GB'], ['en-US', 'fr'])).toEqual(['en-US']);
    // German's usual one is Germany's.
    expect(spellCheckerLanguages(['de-AT'], AVAILABLE)).toEqual(['de-DE']);
    // Portuguese's usual one is Portugal's; with no usual one there, the first there is.
    expect(spellCheckerLanguages(['pt'], AVAILABLE)).toEqual(['pt-PT']);
    expect(spellCheckerLanguages(['en-NZ'], ['en-GB', 'en-AU'])).toEqual(['en-GB']);
    // A script the dictionaries do not carry falls back the same way.
    expect(spellCheckerLanguages(['nl-Latn-NL'], AVAILABLE)).toEqual(['nl']);
  });

  it('matches regardless of case, and answers in the spelling Electron uses', () => {
    expect(spellCheckerLanguages(['en-GB'], ['EN-gb'])).toEqual(['EN-gb']);
  });

  it('drops a language with no dictionary, and names each dictionary once', () => {
    expect(spellCheckerLanguages(['cy', 'en-GB'], AVAILABLE)).toEqual(['en-GB']);
    expect(spellCheckerLanguages(['fr-CA', 'fr-BE', 'fr'], AVAILABLE)).toEqual(['fr']);
    expect(spellCheckerLanguages(['cy'], AVAILABLE)).toEqual([]);
  });
});

describe('spellCheckerChoice', () => {
  it('sets the dictionaries a request maps to', () => {
    expect(spellCheckerChoice(['en-GB', 'fr-CA'], AVAILABLE, 'win32')).toEqual({
      kind: 'set',
      languages: ['en-GB', 'fr'],
    });
    expect(spellCheckerChoice(['en-GB'], AVAILABLE, 'linux')).toEqual({
      kind: 'set',
      languages: ['en-GB'],
    });
  });

  it('refuses a request that is not a short list of language tags', () => {
    expect(spellCheckerChoice('en-GB', AVAILABLE, 'win32')).toEqual({ kind: 'refused' });
    expect(spellCheckerChoice(['en GB'], AVAILABLE, 'win32')).toEqual({ kind: 'refused' });
  });

  // Setting none would switch the checker off, so a request with no dictionary leaves it as it was.
  it('leaves the dictionaries alone where nothing maps', () => {
    expect(spellCheckerChoice(['cy'], AVAILABLE, 'win32')).toEqual({ kind: 'unchanged' });
    expect(spellCheckerChoice([], AVAILABLE, 'win32')).toEqual({ kind: 'unchanged' });
  });

  // macOS checks with the system's own checker, which chooses its languages itself; Electron's
  // setSpellCheckerLanguages does nothing there.
  it('leaves macOS to its own checker, and still refuses a malformed request there', () => {
    expect(spellCheckerChoice(['en-GB'], [], 'darwin')).toEqual({ kind: 'unchanged' });
    expect(spellCheckerChoice(['en-GB'], AVAILABLE, 'darwin')).toEqual({ kind: 'unchanged' });
    expect(spellCheckerChoice('en-GB', AVAILABLE, 'darwin')).toEqual({ kind: 'refused' });
  });
});

describe('spellingMenu', () => {
  it('offers the suggestions for a misspelled word, then to add it to the dictionary', () => {
    expect(
      spellingMenu({ misspelledWord: 'recieve', dictionarySuggestions: ['receive', 'relieve'] }),
    ).toEqual([
      { kind: 'replace', label: 'receive', text: 'receive' },
      { kind: 'replace', label: 'relieve', text: 'relieve' },
      { kind: 'separator' },
      { kind: 'add', label: 'Add to dictionary', word: 'recieve' },
    ]);
  });

  it('says there are no suggestions where there are none, and still offers to add the word', () => {
    expect(spellingMenu({ misspelledWord: 'Zyxwv', dictionarySuggestions: [] })).toEqual([
      { kind: 'none', label: 'No suggestions' },
      { kind: 'separator' },
      { kind: 'add', label: 'Add to dictionary', word: 'Zyxwv' },
    ]);
  });

  it('offers at most five suggestions', () => {
    const suggestions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const menu = spellingMenu({ misspelledWord: 'x', dictionarySuggestions: suggestions });
    expect(menu.filter((item) => item.kind === 'replace').map((item) => item.text)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('offers nothing where nothing is misspelled', () => {
    expect(spellingMenu({ misspelledWord: '', dictionarySuggestions: ['a'] })).toEqual([]);
  });
});

describe('the dev server address', () => {
  it('is the IPv4 loopback, matching what the dev server binds', () => {
    expect(DEV_SERVER_URL).toBe('http://127.0.0.1:5173');
  });

  // The dev script waits for this address before launching Electron. If the two drift apart,
  // wait-on blocks forever and the window never opens - with no error to explain why.
  it('is the address the dev script waits for', () => {
    const packageJson: { scripts: Record<string, string> } = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    );
    const waitOn = /wait-on tcp:(\S+)/.exec(packageJson.scripts.dev ?? '');

    expect(waitOn?.[1]).toBe(new URL(DEV_SERVER_URL).host);
  });
});

describe('the built preload', () => {
  const preload = (): string => readFileSync(join(process.cwd(), 'dist', 'preload.js'), 'utf8');

  // The window is created with sandbox: true, and a sandboxed preload can require `electron` and a
  // few Node built-ins - nothing else. A relative require throws before contextBridge is reached,
  // and the renderer then falls back to the browser bridge without anything reporting a problem.
  // So the preload has to arrive as one self-contained file.
  it('contains no relative require, which the sandbox cannot resolve', () => {
    expect(preload()).not.toMatch(/require\(['"]\.{1,2}[/\\]/);
  });

  // The allowed list for a sandboxed preload is electron, events, timers and url. Anything else
  // - node:path included - throws on load and takes the whole bridge down with it, silently. So
  // the invariant is not "no relative require", it is "nothing but electron".
  it('requires nothing but electron', () => {
    const required = [...preload().matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);

    expect([...new Set(required)]).toEqual(['electron']);
  });

  it('still exposes the bridge under the name the renderer reads', () => {
    expect(preload()).toContain(BRIDGE_GLOBAL);
    expect(preload()).toContain(PLATFORM_INFO_CHANNEL);
    expect(preload()).toContain(SPELL_CHECK_LANGUAGES_CHANNEL);
  });
});
