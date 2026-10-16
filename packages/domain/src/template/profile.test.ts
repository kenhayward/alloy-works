import { describe, expect, it } from 'vitest';

import { TEMPLATE_SCHEMA_VERSION, templateDefinitionSchema } from './definition.js';
import { requiredUnset, templateProfile } from './profile.js';

const THEME = '4ae73bd5-0000-4000-8000-000000002866';
const LAYOUT = '1a7e0a2b-0000-4000-8000-00000000f501';

const definition = (over: Record<string, unknown>) =>
  templateDefinitionSchema.safeParse({
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 'Site report',
    theme: THEME,
    layout: LAYOUT,
    schemas: [],
    outline: { sections: [] },
    changes: { add: true, remove: true, reorder: true },
    ...over,
  });

const market = {
  name: 'market',
  type: { base: 'text' },
  required: false,
  list: true,
  changeable: true,
  feeds: { arguments: false, axis: 'market' },
};

describe("a template's profile (the R10 plan, R10-E)", () => {
  it('TPL-051 declares default values for axes and which a document must set, and establishes the profile from them and from parameters', () => {
    const parsed = definition({
      profile: {
        values: { audience: ['internal'], market: ['uk'] },
        required: ['market', 'region'],
      },
      parameters: [market],
    });
    if (!parsed.success) throw parsed.error;
    // The defaults, a parameter's value over the default for the axis it feeds.
    const profile = templateProfile(parsed.data, { market: ['us', 'ca'] });
    expect(profile).toEqual({ values: { audience: ['internal'], market: ['us', 'ca'] } });
    // Never undeclared: a template declaring no profile still gives the document one, empty.
    const bare = definition({});
    expect(bare.success && templateProfile(bare.data, {})).toEqual({ values: {} });
    // Region is required and has no value: the profile is incomplete until it is set.
    expect(requiredUnset(parsed.data, profile)).toEqual(['region']);
    expect(
      requiredUnset(parsed.data, { values: { ...profile.values, region: ['north'] } }),
    ).toEqual([]);
  });

  it('refuses a parameter feeding an axis that is not text, which a profile value is', () => {
    expect(
      definition({ parameters: [{ ...market, type: { base: 'integer' }, list: false }] }).success,
    ).toBe(false);
  });
});
