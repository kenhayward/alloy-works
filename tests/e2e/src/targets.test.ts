import { describe, expect, it } from 'vitest';
import { E2E_TARGETS, e2eTargets } from './targets.js';

const EVERY = {
  ALLOY_E2E_SERVICE: 'http://127.0.0.1:19088',
  ALLOY_E2E_IDP: 'http://127.0.0.1:19090',
  ALLOY_E2E_IDP_ISSUER: 'http://idp.localhost:19090',
  ALLOY_E2E_STORE_AT: '127.0.0.1',
};

describe('the whole-system suite runs only at a stack it was pointed at', () => {
  it('names every target it reads', () => {
    expect([...E2E_TARGETS].sort()).toEqual(Object.keys(EVERY).sort());
  });

  it('returns each target as it was set', () => {
    expect(e2eTargets(EVERY)).toEqual({
      service: 'http://127.0.0.1:19088',
      idp: 'http://127.0.0.1:19090',
      idpIssuer: 'http://idp.localhost:19090',
      storeAt: '127.0.0.1',
    });
  });

  it('refuses with none set, naming every variable and falling back to nothing', () => {
    expect(() => e2eTargets({})).toThrow(
      /ALLOY_E2E_SERVICE, ALLOY_E2E_IDP, ALLOY_E2E_IDP_ISSUER, ALLOY_E2E_STORE_AT/,
    );
    expect(() => e2eTargets({})).toThrow(/never falls back to a default/);
  });

  it('refuses when one is missing or empty, naming only those', () => {
    const withoutIdp = { ...EVERY, ALLOY_E2E_IDP: undefined };
    let said = '';
    try {
      e2eTargets({ ...withoutIdp, ALLOY_E2E_STORE_AT: ' ' });
    } catch (error) {
      said = (error as Error).message;
    }
    expect(said).toMatch(/ALLOY_E2E_IDP, ALLOY_E2E_STORE_AT/);
    expect(said).not.toMatch(/ALLOY_E2E_SERVICE|ALLOY_E2E_IDP_ISSUER/);
  });
});
