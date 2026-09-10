import { describe, expect, it } from 'vitest';

import { browserBridge, resolveBridge, type PlatformBridge } from './bridge.js';

describe('browserBridge', () => {
  it('reports the web delivery', async () => {
    await expect(browserBridge.getPlatformInfo()).resolves.toEqual({
      delivery: 'web',
      runtime: 'Browser',
    });
  });
});

describe('resolveBridge', () => {
  it('falls back to the browser bridge when no shell injected one', () => {
    expect(resolveBridge({})).toBe(browserBridge);
  });

  it('uses the bridge the desktop shell injected', async () => {
    const injected: PlatformBridge = {
      getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron 44.3.0' }),
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
