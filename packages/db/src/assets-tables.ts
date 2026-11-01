import type { ColumnType } from 'kysely';
import type { AssetFormat } from '@alloy-works/domain';
import type { AssetUploadReason, AssetUploadState } from './assets.js';

/**
 * An upload (0020): made by where, by whom and with what description, then moved forwards by the
 * columns each move writes, and never deleted.
 */
export interface AssetUploadTable {
  id: ColumnType<string, never, never>;
  space_id: ColumnType<string, string, never>;
  uploader: ColumnType<string, string, never>;
  /** JSONB in as the text of a JSON document, as a version's content is. */
  alternative: ColumnType<unknown, string | null, never>;
  /** A person's upload, or an image a dataset's result holds (0051; D8-D). */
  origin: ColumnType<'upload' | 'dataset', 'upload' | 'dataset' | undefined, never>;
  state: ColumnType<AssetUploadState, never, Exclude<AssetUploadState, 'awaiting'>>;
  object_key: ColumnType<string | null, never, string>;
  format: ColumnType<AssetFormat | null, never, AssetFormat>;
  bytes: ColumnType<number | null, never, number>;
  reason: ColumnType<AssetUploadReason | null, never, AssetUploadReason>;
  asset_id: ColumnType<string | null, never, string>;
  asset_version_id: ColumnType<string | null, never, string>;
  asset_kind: ColumnType<'asset', never, never>;
  created_at: ColumnType<Date, never, never>;
  finished_at: ColumnType<Date | null, never, Date>;
  /** What the uploader declared (0180; AL-E), the text of a JSON document, or null for nothing. */
  rights: ColumnType<unknown, string | null | undefined, never>;
  /** The file's name at upload (0180; AL-D). */
  name: ColumnType<string | null, string | null | undefined, never>;
}

/** An image's rights, a row per change, never changed (0180; AL-C, AST-031). */
export interface AssetRightsTable {
  id: ColumnType<string, never, never>;
  asset_id: ColumnType<string, string, never>;
  asset_kind: ColumnType<'asset', never, never>;
  rights: ColumnType<unknown, string, never>;
  recorded_by: ColumnType<string, string, never>;
  recorded_at: ColumnType<Date, never, never>;
}

/** The environment's policy for undeclared and lapsed images (0180; AST-053), one row. */
export interface ImagesPolicyTable {
  singleton: ColumnType<true, never, never>;
  undeclared: ColumnType<'warn' | 'refuse', never, 'warn' | 'refuse'>;
  /** The limit each format is lowered to, in bytes, or null for its own (0181; AST-004). */
  limits: ColumnType<unknown, never, string>;
}

/** The rights each image a request recorded was published under (0180; AL-F). */
export interface PublicationRequestRightsTable {
  request_id: ColumnType<string, string, never>;
  asset_id: ColumnType<string, string, never>;
  rights_id: ColumnType<string, string, never>;
  licence_version_id: ColumnType<string | null, string | null, never>;
}

/** An image's derivatives (0181; AL-H), one of each kind per version. */
export interface AssetDerivativeTable {
  version_id: ColumnType<string, string, never>;
  asset_id: ColumnType<string, string, never>;
  asset_kind: ColumnType<'asset', never, never>;
  kind: ColumnType<'thumbnail' | 'preview', 'thumbnail' | 'preview', never>;
  object_key: ColumnType<string, string, never>;
  width: ColumnType<number, number, never>;
  height: ColumnType<number, number, never>;
  bytes: ColumnType<number, number, never>;
  stripped: ColumnType<string[], string[], never>;
  made_at: ColumnType<Date, never, never>;
}

/** A version whose derivatives the `derive` job was asked for and has not made (0181). */
export interface AssetDerivativeWantedTable {
  version_id: ColumnType<string, string, never>;
  wanted_at: ColumnType<Date, never, never>;
}
