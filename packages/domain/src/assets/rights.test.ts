import { describe, expect, it } from 'vitest';

import type { Licence } from './licence.js';
import { assetRightsSchema, rightsAtPublish, type AssetRights } from './rights.js';

const LICENCE = '6f1c2a4e-0b3d-4c5e-8f7a-9b0c1d2e3f40';

const licence = (permits: Licence['permits']): Licence => ({
  schemaVersion: 1,
  id: LICENCE,
  name: 'Stock',
  key: 'stock',
  base: 'en',
  names: [{ language: 'en', text: 'Stock' }],
  permits,
  attribution: { required: false },
});

const declared = (more: Partial<Extract<AssetRights, { kind: 'declared' }>> = {}): AssetRights => ({
  kind: 'declared',
  source: { text: 'Bought from a stock library', url: 'https://stock.example/1234' },
  licence: LICENCE,
  ...more,
});

describe("an image's rights (the AL plan, AL-C)", () => {
  it('AST-021 records the source and the licence an image is held under, or that neither was declared', () => {
    expect(assetRightsSchema.parse(declared({ credit: 'Photograph by Ada' }))).toEqual(
      declared({ credit: 'Photograph by Ada' }),
    );
    expect(assetRightsSchema.parse({ kind: 'undeclared' })).toEqual({ kind: 'undeclared' });
    expect(assetRightsSchema.safeParse({ kind: 'declared', licence: LICENCE }).success).toBe(false);
    expect(assetRightsSchema.safeParse(declared({ source: { text: ' ' } })).success).toBe(false);
  });

  it('AST-052 records an expiry on the grant an image is held under, a calendar date', () => {
    expect(assetRightsSchema.parse(declared({ expires: '2027-03-31' }))).toMatchObject({
      expires: '2027-03-31',
    });
    expect(assetRightsSchema.safeParse(declared({ expires: '2027-02-30' })).success).toBe(false);
    expect(assetRightsSchema.safeParse(declared({ expires: '31/03/2027' })).success).toBe(false);
  });
});

describe('rights at publish (the AL plan, AL-F)', () => {
  const today = '2026-11-01';

  it('AST-023 refuses an image whose licence does not permit publication, whatever the policy', () => {
    for (const policy of ['warn', 'refuse'] as const) {
      expect(rightsAtPublish(declared(), licence(['internal']), today, policy)).toEqual({
        code: 'asset_licence_forbids',
        refuses: true,
      });
    }
    expect(rightsAtPublish(declared(), licence(['publication']), today, 'refuse')).toBeNull();
  });

  it('AST-053 refuses or reports an undeclared image by the declared policy, never passing it silently', () => {
    expect(rightsAtPublish({ kind: 'undeclared' }, undefined, today, 'warn')).toEqual({
      code: 'asset_undeclared',
      refuses: false,
    });
    expect(rightsAtPublish({ kind: 'undeclared' }, undefined, today, 'refuse')).toEqual({
      code: 'asset_undeclared',
      refuses: true,
    });
    // A licence that is not there is no licence declared.
    expect(rightsAtPublish(declared(), undefined, today, 'refuse')).toEqual({
      code: 'asset_undeclared',
      refuses: true,
    });
    // A dataset's image is the environment's own data (AL-C).
    expect(rightsAtPublish({ kind: 'dataset' }, undefined, today, 'refuse')).toBeNull();
  });

  it('AST-052 reports a grant past its expiry, and refuses it under refuse; its last day is still in it', () => {
    const lapsed = declared({ expires: '2026-10-31' });
    expect(rightsAtPublish(lapsed, licence(['publication']), today, 'warn')).toEqual({
      code: 'asset_licence_expired',
      refuses: false,
    });
    expect(rightsAtPublish(lapsed, licence(['publication']), today, 'refuse')).toEqual({
      code: 'asset_licence_expired',
      refuses: true,
    });
    const lastDay = declared({ expires: today });
    expect(rightsAtPublish(lastDay, licence(['publication']), today, 'refuse')).toBeNull();
  });
});
