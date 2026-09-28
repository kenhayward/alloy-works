import { describe, expect, it } from 'vitest';

import type { PlatformBridge } from './contract.js';
import { spellingFor } from './spelling.js';

/** A bridge that records every list of languages it is asked to set. */
function recording(): { bridge: PlatformBridge; asked: string[][] } {
  const asked: string[][] = [];
  const bridge: PlatformBridge = {
    getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron 44.3.0' }),
    setSpellCheckLanguages: async (languages) => {
      asked.push([...languages]);
    },
  };
  return { bridge, asked };
}

describe('the languages of the components open', () => {
  it('asks for each base language held, in the order first held', () => {
    const { bridge, asked } = recording();
    const spelling = spellingFor(bridge);
    spelling.hold('en-GB');
    spelling.hold('de-DE');
    expect(asked).toEqual([['en-GB'], ['en-GB', 'de-DE']]);
  });

  it('asks again for what is left as a component closes', () => {
    const { bridge, asked } = recording();
    const spelling = spellingFor(bridge);
    const english = spelling.hold('en-GB');
    spelling.hold('de-DE');
    english();
    expect(asked.at(-1)).toEqual(['de-DE']);
  });

  it('keeps a language two components share until both have closed', () => {
    const { bridge, asked } = recording();
    const spelling = spellingFor(bridge);
    const first = spelling.hold('en-GB');
    const second = spelling.hold('en-GB');
    spelling.hold('fr');
    first();
    expect(asked).toEqual([['en-GB'], ['en-GB', 'fr']]);
    second();
    expect(asked.at(-1)).toEqual(['fr']);
  });

  // Setting none would switch the desktop's checker off, and the page's other text fields with it.
  it('asks nothing once every component has closed, leaving the dictionaries as they were', () => {
    const { bridge, asked } = recording();
    const release = spellingFor(bridge).hold('en-GB');
    release();
    release();
    expect(asked).toEqual([['en-GB']]);
  });

  // React opens a component twice over in StrictMode, closing it in between: that is not news.
  it('does not ask again for the list it last asked for', () => {
    const { bridge, asked } = recording();
    const spelling = spellingFor(bridge);
    spelling.hold('en-GB')();
    spelling.hold('en-GB');
    expect(asked).toEqual([['en-GB']]);
  });

  it('keeps one list per bridge', () => {
    const one = recording();
    const other = recording();
    expect(spellingFor(one.bridge)).toBe(spellingFor(one.bridge));
    spellingFor(one.bridge).hold('en-GB');
    spellingFor(other.bridge).hold('fr');
    expect(one.asked).toEqual([['en-GB']]);
    expect(other.asked).toEqual([['fr']]);
  });

  it('leaves a bridge that refuses to its refusal, unheard', async () => {
    const bridge: PlatformBridge = {
      getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron 44.3.0' }),
      setSpellCheckLanguages: () => Promise.reject(new Error('refused')),
    };
    spellingFor(bridge).hold('en-GB');
    // An unhandled rejection would fail the run after the test; a turn lets one surface.
    await new Promise((settle) => setTimeout(settle, 0));
  });
});
