import { z } from 'zod';
import { languageTagSchema } from '../content/model/document.js';
import { storableText } from '../stored/storable.js';
import { ADMITTED_FORMATS, ASSET_MAX_BYTES, ASSET_MAX_PIXELS, type AssetFormat } from './header.js';

/**
 * What an asset version says (docs/design/assets.md, "The asset, stored"), at its first schema
 * version. Flat, strict at every member and bounded, because a version is immutable: anything this
 * accepts that a later rule refuses would be a migration of stored history.
 */
export const ASSET_SCHEMA_VERSION = 1;

/**
 * The object store's key for a tenant's bytes, as `packages/objects` makes it: the tenant's prefix
 * and the original's SHA-256 (AST-041). Repeated here rather than imported, because the domain
 * depends on no other package; `packages/objects` refuses any other key before it reaches the store.
 */
const OBJECT_KEY = /^t_[0-9a-z]{1,40}\/sha256\/[0-9a-f]{64}$/;

/** The longest default description, which is prose for a screen reader rather than a caption. */
export const ALTERNATIVE_MAX_LENGTH = 2000;

/**
 * An asset's default alternative text and the language it is written in (AST-012, AST-039): words,
 * not blank, storable, and in a language the content model would accept for a component.
 */
export const assetAlternativeSchema = z.strictObject({
  text: z
    .string()
    .max(ALTERNATIVE_MAX_LENGTH)
    .refine((text) => text.trim() !== '', 'A description says something')
    .refine(storableText, 'A description holds no character the store cannot keep'),
  language: languageTagSchema,
});

export type AssetAlternative = z.infer<typeof assetAlternativeSchema>;

const formats = Object.keys(ADMITTED_FORMATS) as [AssetFormat, ...AssetFormat[]];

export const assetVersionSchema = z
  .strictObject({
    schemaVersion: z.literal(ASSET_SCHEMA_VERSION),
    object: z.string().regex(OBJECT_KEY, "not a key of the tenant's store"),
    format: z.enum(formats),
    bytes: z.number().int().positive().max(ASSET_MAX_BYTES),
    /** As displayed: after the orientation below has turned the stored image. */
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    orientation: z.number().int().min(1).max(8),
    colour: z.enum(['rgb', 'grey', 'cmyk']),
    alpha: z.boolean(),
    depth: z.union([z.literal(8), z.literal(16)]),
    /** Dots per inch as the file declares them, or null where it declares none - never a guess. */
    resolution: z.number().positive().finite().nullable(),
    alternative: assetAlternativeSchema.nullable(),
  })
  .refine(
    (version) => version.width * version.height <= ASSET_MAX_PIXELS,
    'An asset is no larger than the pixel limit',
  );

export type AssetVersionContent = z.infer<typeof assetVersionSchema>;

/** Parses an asset version's content, throwing where it is not one. */
export function parseAssetVersion(value: unknown): AssetVersionContent {
  return assetVersionSchema.parse(value);
}
