// Assets: what an upload is, read from its bytes, and what an asset version records
// (docs/design/assets.md).
export {
  ADMITTED_FORMATS,
  ASSET_MAX_BYTES,
  ASSET_MAX_PIXELS,
  admittedFormat,
  readImageHeader,
} from './header.js';
export type {
  AssetFormat,
  HeaderReading,
  HeaderRefusal,
  ImageColour,
  ImageHeader,
} from './header.js';
export {
  ALTERNATIVE_MAX_LENGTH,
  ASSET_SCHEMA_VERSION,
  assetAlternativeSchema,
  assetVersionSchema,
  parseAssetVersion,
} from './version.js';
export type { AssetAlternative, AssetVersionContent } from './version.js';
