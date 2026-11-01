import { z } from 'zod';

import { ADMITTED_FORMATS, type AssetFormat } from './header.js';

/** A format's limit lowered, in bytes: at least 1 KB, never above the format's own; null for its own. */
const lowered = (format: AssetFormat) =>
  z.number().int().min(1024).max(ADMITTED_FORMATS[format].maxBytes).nullable();

/**
 * **The size an image may be, by format** (AST-004; the AL plan, AL-I): each format declares its
 * limit in `ADMITTED_FORMATS`, and an environment may lower it in its Images setting, never raise it.
 */
export const imageLimitsSchema = z.strictObject({
  png: lowered('png'),
  jpeg: lowered('jpeg'),
});
export type ImageLimits = z.infer<typeof imageLimitsSchema>;

/** The most bytes an image of this format may be in an environment with these limits. */
export function byteLimitOf(format: AssetFormat, limits: ImageLimits): number {
  return limits[format] ?? ADMITTED_FORMATS[format].maxBytes;
}
