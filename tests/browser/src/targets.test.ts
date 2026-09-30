import { describe, expect, it } from 'vitest';
import { BROWSER_TARGETS, browserTargets } from './testing/targets.js';

const EVERY = {
  ALLOY_BROWSER_SERVICE: 'http://dev.acme.localhost:19088',
  ALLOY_BROWSER_API: 'http://127.0.0.1:19088',
  ALLOY_BROWSER_IDP: 'http://idp.localhost:19090',
  ALLOY_BROWSER_DATABASE: 'postgres://grace:secret@127.0.0.1:19432/alloy_dev',
  ALLOY_BROWSER_STORE_AT: '127.0.0.1',
};

describe('the browser suite runs only at a stack it was pointed at', () => {
  it('names every target it reads', () => {
    expect([...BROWSER_TARGETS].sort()).toEqual(Object.keys(EVERY).sort());
  });

  it('returns each target as it was set', () => {
    expect(browserTargets(EVERY)).toEqual({
      service: 'http://dev.acme.localhost:19088',
      api: 'http://127.0.0.1:19088',
      idp: 'http://idp.localhost:19090',
      database: 'postgres://grace:secret@127.0.0.1:19432/alloy_dev',
      storeAt: '127.0.0.1',
    });
  });

  it('refuses with none set, naming every variable and falling back to nothing', () => {
    expect(() => browserTargets({})).toThrow(
      /ALLOY_BROWSER_SERVICE, ALLOY_BROWSER_API, ALLOY_BROWSER_IDP, ALLOY_BROWSER_DATABASE, ALLOY_BROWSER_STORE_AT/,
    );
    expect(() => browserTargets({})).toThrow(/never falls back to a default/);
  });

  it('refuses when one is missing or empty, naming only those', () => {
    const withoutDatabase = { ...EVERY, ALLOY_BROWSER_DATABASE: undefined };
    let said = '';
    try {
      browserTargets({ ...withoutDatabase, ALLOY_BROWSER_API: '' });
    } catch (error) {
      said = (error as Error).message;
    }
    expect(said).toMatch(/ALLOY_BROWSER_API, ALLOY_BROWSER_DATABASE/);
    expect(said).not.toMatch(/ALLOY_BROWSER_SERVICE|ALLOY_BROWSER_IDP|ALLOY_BROWSER_STORE_AT/);
  });
});
