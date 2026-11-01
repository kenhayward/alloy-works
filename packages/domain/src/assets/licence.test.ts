import { describe, expect, it } from 'vitest';

import { licenceName, licencePermits, LicenceRefused, parseLicence, type Licence } from './licence.js';

const ccBy: Licence = {
  schemaVersion: 1,
  id: 'licence-1',
  name: 'CC BY 4.0',
  key: 'cc_by_4',
  base: 'en',
  names: [
    { language: 'en', text: 'Creative Commons Attribution 4.0' },
    { language: 'fr', text: 'Creative Commons Attribution 4.0 (fr)' },
  ],
  permits: ['internal', 'publication', 'redistribution', 'modification'],
  attribution: { required: true, wording: 'Photograph by Ada, CC BY 4.0' },
  url: 'https://creativecommons.org/licenses/by/4.0/',
};

const refusal = (value: unknown) => {
  try {
    parseLicence(value);
  } catch (error) {
    return (error as LicenceRefused).problems.map((each) => each.path);
  }
  return [];
};

describe('a licence (the AL plan, AL-B)', () => {
  it('AST-022 declares what it permits: internal use, publication, redistribution, modification', () => {
    expect(parseLicence(ccBy)).toEqual(ccBy);
    const internal = parseLicence({ ...ccBy, permits: ['internal'] });
    expect(licencePermits(internal, 'publication')).toBe(false);
    expect(licencePermits(internal, 'internal')).toBe(true);
    expect(refusal({ ...ccBy, permits: ['publication', 'publication'] })).toEqual(['permits']);
    expect(refusal({ ...ccBy, permits: ['printing'] })).toEqual(['permits.0']);
  });

  it('AST-045 declares that it requires attribution, and what that attribution must say', () => {
    expect(parseLicence({ ...ccBy, attribution: { required: false } }).attribution).toEqual({
      required: false,
    });
    expect(refusal({ ...ccBy, attribution: { required: false, wording: 'Ada' } })).toEqual([
      'attribution.wording',
    ]);
    expect(refusal({ ...ccBy, attribution: { required: true, wording: 'x'.repeat(501) } })).toEqual(
      ['attribution.wording'],
    );
  });

  it('is named in the base language, in a reader language where it has one', () => {
    expect(licenceName(ccBy, 'fr')).toBe('Creative Commons Attribution 4.0 (fr)');
    expect(licenceName(ccBy, 'de')).toBe('Creative Commons Attribution 4.0');
    expect(refusal({ ...ccBy, names: [{ language: 'fr', text: 'Seulement' }] })).toEqual(['names']);
    expect(refusal({ ...ccBy, url: 'http://example.com/licence' })).toEqual(['url']);
    expect(refusal({ ...ccBy, key: 'CC BY' })).toEqual(['key']);
  });
});
