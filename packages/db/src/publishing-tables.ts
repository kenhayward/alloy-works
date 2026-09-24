import type { ColumnType } from 'kysely';

/**
 * Operational: inserted by what was asked alone, and finished by the one update its grant allows,
 * once, from `queued` to `done` or `failed` (0017's `publication_request_finish_once`).
 */
export interface PublicationRequestTable {
  id: ColumnType<string, never, never>;
  document_id: ColumnType<string, string, never>;
  document_version_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', never, never>;
  formats: ColumnType<string[], string[], never>;
  requested_by: ColumnType<string, string, never>;
  requested_at: ColumnType<Date, never, never>;
  state: ColumnType<'queued' | 'done' | 'failed', never, 'done' | 'failed'>;
  /** JSONB in as the text of a JSON document, as a version's content is. */
  failures: ColumnType<unknown[], string | undefined, string>;
  finished_at: ColumnType<Date | null, never, Date>;
  /**
   * The layout version the request was made under (0018): both or neither, and never neither on a
   * request made since - a request made before layouts keeps none, and publishes under template 1.
   */
  layout_id: ColumnType<string | null, string, never>;
  layout_version_id: ColumnType<string | null, string, never>;
  layout_kind: ColumnType<'layout', never, never>;
  /**
   * The theme version the request was made under (0024): both or neither, and never neither on a
   * request made since. A request still queued when 0024 ran was given the declared theme; one already
   * answered keeps none.
   */
  theme_id: ColumnType<string | null, string, never>;
  theme_version_id: ColumnType<string | null, string, never>;
  theme_kind: ColumnType<'theme', never, never>;
}

/** Insert and read, nothing else (0017). */
export interface PublicationRequestOccurrenceTable {
  request_id: ColumnType<string, string, never>;
  node: ColumnType<string, string, never>;
  component_id: ColumnType<string, string, never>;
  version_id: ColumnType<string, string, never>;
  component_kind: ColumnType<'component', never, never>;
}

/** An image a request's components place, as its publisher could read it (figures 3, ruling R6). */
export interface PublicationRequestAssetTable {
  request_id: ColumnType<string, string, never>;
  version_id: ColumnType<string, string, never>;
  asset_id: ColumnType<string, string, never>;
  asset_kind: ColumnType<'asset', never, never>;
}

/** An image a publication printed: exactly its request's, insert and read and nothing else. */
export interface PublicationAssetTable {
  publication_id: ColumnType<string, string, never>;
  version_id: ColumnType<string, string, never>;
  asset_id: ColumnType<string, string, never>;
  asset_kind: ColumnType<'asset', never, never>;
}

/** Insert and read, nothing else (PUB-050). */
export interface PublicationTable {
  id: ColumnType<string, string, never>;
  kind: ColumnType<'publication', never, never>;
  request_id: ColumnType<string, string, never>;
  document_id: ColumnType<string, string, never>;
  document_version_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', never, never>;
  publisher: ColumnType<string, string, never>;
  published_at: ColumnType<Date, Date, never>;
  approval: ColumnType<'none', 'none', never>;
  formats: ColumnType<string[], string[], never>;
  engine: ColumnType<'typst', 'typst', never>;
  engine_version: ColumnType<string, string, never>;
  template: ColumnType<'publication', 'publication', never>;
  template_version: ColumnType<number, number, never>;
  pipeline_version: ColumnType<string, string, never>;
  fonts: ColumnType<{ file: string; sha256: string }[], string, never>;
  data_sha256: ColumnType<string, string, never>;
  numbering: ColumnType<unknown, string, never>;
  /** Its request's layout version, exactly: null for null (0018's `publication_recorded_whole`). */
  layout_id: ColumnType<string | null, string | null, never>;
  layout_version_id: ColumnType<string | null, string | null, never>;
  layout_kind: ColumnType<'layout', never, never>;
  /** Its request's theme version, exactly: null for null (0024's `publication_recorded_whole`). */
  theme_id: ColumnType<string | null, string | null, never>;
  theme_version_id: ColumnType<string | null, string | null, never>;
  theme_kind: ColumnType<'theme', never, never>;
}

export interface PublicationInputTable {
  publication_id: ColumnType<string, string, never>;
  version_id: ColumnType<string, string, never>;
  node: ColumnType<string | null, string | null, never>;
}

export interface PublicationOutputTable {
  publication_id: ColumnType<string, string, never>;
  format: ColumnType<'pdf', 'pdf', never>;
  object_key: ColumnType<string, string, never>;
  sha256: ColumnType<string, string, never>;
  bytes: ColumnType<number, number, never>;
  standard: ColumnType<'ua-1', 'ua-1', never>;
}
