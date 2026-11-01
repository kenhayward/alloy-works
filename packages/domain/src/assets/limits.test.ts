import { describe, expect, it } from 'vitest';

import { ADMITTED_FORMATS, ASSET_MAX_BYTES } from './header.js';
import { byteLimitOf, imageLimitsSchema } from './limits.js';

describe('the size an image may be, by format (the AL plan, AL-I)', () => {
  it('AST-004 declares a size limit per format, which an environment may lower and never raise', () => {
    expect(ADMITTED_FORMATS.png.maxBytes).toBe(25_000_000);
    expect(ADMITTED_FORMATS.jpeg.maxBytes).toBe(25_000_000);
    // The door's limit is the largest any format allows.
    expect(ASSET_MAX_BYTES).toBe(
      Math.max(...Object.values(ADMITTED_FORMATS).map((each) => each.maxBytes)),
    );
    expect(byteLimitOf('png', { png: null, jpeg: null })).toBe(25_000_000);
    expect(byteLimitOf('jpeg', { png: null, jpeg: 2_000_000 })).toBe(2_000_000);
    expect(imageLimitsSchema.safeParse({ png: 25_000_001, jpeg: null }).success).toBe(false);
    expect(imageLimitsSchema.safeParse({ png: 0, jpeg: null }).success).toBe(false);
    expect(imageLimitsSchema.safeParse({ png: 1.5, jpeg: null }).success).toBe(false);
    expect(imageLimitsSchema.safeParse({ png: null }).success).toBe(false);
    expect(imageLimitsSchema.parse({ png: 1024, jpeg: null })).toEqual({ png: 1024, jpeg: null });
  });
});
