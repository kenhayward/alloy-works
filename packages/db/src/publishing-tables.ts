import type { PublishingFormat } from '@alloy-works/domain';
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
  /** The PDF first, whichever order they were asked in (0027). */
  formats: ColumnType<PublishingFormat[], PublishingFormat[], never>;
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
  /** A publish or a preview, named when it is asked for and never changed (0035). */
  kind: ColumnType<'publish' | 'preview', 'publish' | 'preview' | undefined, never>;
  /**
   * A preview's PDF in the tenant's store by its hash, and when it expires: all four exactly when a
   * preview is done, written only in the move that finishes it, and never on a publish (0035).
   */
  preview_key: ColumnType<string | null, never, string>;
  preview_sha256: ColumnType<string | null, never, string>;
  preview_bytes: ColumnType<number | null, never, number>;
  expires_at: ColumnType<Date | null, never, Date>;
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

/** A binding a request holds, as its latest resolution (0050; B3-C): insert and read alone. */
export interface PublicationRequestBindingTable {
  request_id: ColumnType<string, string, never>;
  node: ColumnType<string, string, never>;
  binding: ColumnType<string, string, never>;
  digest: ColumnType<string, string, never>;
  resolution: ColumnType<string, string, never>;
  dataset_version: ColumnType<string, string, never>;
  dataset_id: ColumnType<string, string, never>;
  dataset_kind: ColumnType<'dataset', never, never>;
}

/** A binding a publication printed from: exactly its request's (0050), insert and read alone. */
export interface PublicationBindingTable {
  publication_id: ColumnType<string, string, never>;
  node: ColumnType<string, string, never>;
  binding: ColumnType<string, string, never>;
  resolution: ColumnType<string, string, never>;
  dataset_version: ColumnType<string, string, never>;
  dataset_id: ColumnType<string, string, never>;
  dataset_kind: ColumnType<'dataset', never, never>;
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
  /** The transaction that wrote it, which a listing's snapshot reads (0032); null from before. */
  written_by: ColumnType<string | null, never, never>;
  id: ColumnType<string, string, never>;
  kind: ColumnType<'publication', never, never>;
  request_id: ColumnType<string, string, never>;
  document_id: ColumnType<string, string, never>;
  document_version_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', never, never>;
  publisher: ColumnType<string, string, never>;
  published_at: ColumnType<Date, Date, never>;
  approval: ColumnType<'none', 'none', never>;
  /** The PDF first, as the request names them (0027). */
  formats: ColumnType<PublishingFormat[], PublishingFormat[], never>;
  /** The PDF's engine and template: all four null exactly where the publication has no PDF (0027). */
  engine: ColumnType<'typst' | null, 'typst' | null, never>;
  engine_version: ColumnType<string | null, string | null, never>;
  template: ColumnType<'publication' | null, 'publication' | null, never>;
  template_version: ColumnType<number | null, number | null, never>;
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

/** One per format its publication names (0027), each saying what made it and what it could not carry. */
export interface PublicationOutputTable {
  publication_id: ColumnType<string, string, never>;
  format: ColumnType<PublishingFormat | 'provenance', PublishingFormat | 'provenance', never>;
  object_key: ColumnType<string, string, never>;
  sha256: ColumnType<string, string, never>;
  bytes: ColumnType<number, number, never>;
  /** A PDF's is PDF/UA-1; a Word document claims none. */
  standard: ColumnType<'ua-1' | null, 'ua-1' | null, never>;
  /** Typst for a PDF, at its publication's template version; the Word writer, at `word/N`, for Word. */
  producer: ColumnType<'typst' | 'word' | 'pipeline', 'typst' | 'word' | 'pipeline', never>;
  producer_version: ColumnType<string, string, never>;
  /** An `OutputReport`, JSONB in as the text of a JSON document: a PDF's is empty. */
  report: ColumnType<unknown, string, never>;
}

/**
 * What veraPDF found of a publication's PDF, checked after the publication was recorded (0040; W-C):
 * insert-only, one per PDF output, and timed by the database.
 */
export interface PublicationCheckTable {
  publication_id: ColumnType<string, string, never>;
  format: ColumnType<'pdf', 'pdf', never>;
  checker: ColumnType<'verapdf', 'verapdf', never>;
  checker_version: ColumnType<string, string, never>;
  profile: ColumnType<'ua1', 'ua1', never>;
  compliant: ColumnType<boolean, boolean, never>;
  /** Each failed rule, `{ clause, test, description? }`, JSONB in as the text of a JSON document. */
  failed_rules: ColumnType<unknown, string, never>;
  /** veraPDF's whole report, kept in the tenant's store by its hash (PUB-091). */
  report_key: ColumnType<string, string, never>;
  report_sha256: ColumnType<string, string, never>;
  report_bytes: ColumnType<number, number, never>;
  checked_at: ColumnType<Date, never, never>;
}

/** A PDF whose check the sweep gave up on for good, after its checks gave up this often (0041). */
export interface PublicationCheckGivenUpTable {
  publication_id: ColumnType<string, string, never>;
  format: ColumnType<'pdf', 'pdf', never>;
  give_ups: ColumnType<number, number, never>;
  given_up_at: ColumnType<Date, never, never>;
}
