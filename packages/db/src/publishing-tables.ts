import type { ColumnType } from 'kysely';

/**
 * Operational: a request is finished by the one update its grant allows, once, from `queued` to
 * `done` or `failed` (0017's `publication_request_finish_once`).
 */
export interface PublicationRequestTable {
  id: ColumnType<string, string | undefined, never>;
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
}

/** Insert and read, nothing else (0017). */
export interface PublicationRequestOccurrenceTable {
  request_id: ColumnType<string, string, never>;
  node: ColumnType<string, string, never>;
  component_id: ColumnType<string, string, never>;
  version_id: ColumnType<string, string, never>;
  component_kind: ColumnType<'component', never, never>;
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
