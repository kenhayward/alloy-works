import { describe, expect, it } from 'vitest';

import { browserBridge, resolveBridge, type PlatformBridge } from './bridge.js';

describe('browserBridge', () => {
  it('reports the web delivery', async () => {
    await expect(browserBridge.getPlatformInfo()).resolves.toEqual({
      delivery: 'web',
      runtime: 'Browser',
    });
  });

  it('opens a page the service shows in a new tab, which carries its session (HT-N)', () => {
    expect(browserBridge.opensServedPages).toBe(true);
  });

  // The browser checks spelling on the surface with its own checker and its own dictionaries, which a
  // page cannot choose, so there is nothing for it to set.
  it('sets no spelling languages, and answers', async () => {
    await expect(browserBridge.setSpellCheckLanguages(['en-GB'])).resolves.toBeUndefined();
    await expect(browserBridge.setInterfaceLanguage('ar-XB')).resolves.toBeUndefined();
  });
});

describe('resolveBridge', () => {
  it('falls back to the browser bridge when no shell injected one', () => {
    expect(resolveBridge({})).toBe(browserBridge);
  });

  it('uses the bridge the desktop shell injected', async () => {
    const injected: PlatformBridge = {
      getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron 44.3.0' }),
      opensServedPages: false,
      setSpellCheckLanguages: async () => {},
      setInterfaceLanguage: async () => {},
    };

    expect(resolveBridge({ alloyWorks: injected })).toBe(injected);
    await expect(resolveBridge({ alloyWorks: injected }).getPlatformInfo()).resolves.toEqual({
      delivery: 'desktop',
      runtime: 'Electron 44.3.0',
    });
  });

  it('reads the real window when given no host', () => {
    expect(resolveBridge()).toBe(browserBridge);
  });
});
