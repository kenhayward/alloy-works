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
}
