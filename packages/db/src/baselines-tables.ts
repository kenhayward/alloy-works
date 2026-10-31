import type { ColumnType } from 'kysely';

/** A named, immutable version of a whole document (0072): inserted and read, never changed. */
export interface BaselineTable {
  id: ColumnType<string, string | undefined, never>;
  document_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', never, never>;
  name: ColumnType<string, string, never>;
  name_key: ColumnType<string, string, never>;
  document_version_id: ColumnType<string, string, never>;
  made_by: ColumnType<string, string, never>;
  made_at: ColumnType<Date, never, never>;
  made_tx: ColumnType<string, never, never>;
  /** The gate it was made at, by its transition key (0097; VER-059); null for a person's. */
  gate: ColumnType<string | null, string | null | undefined, never>;
  layout_id: ColumnType<string, string, never>;
  layout_version_id: ColumnType<string, string, never>;
  layout_kind: ColumnType<'layout', never, never>;
  theme_id: ColumnType<string, string, never>;
  theme_version_id: ColumnType<string, string, never>;
  theme_kind: ColumnType<'theme', never, never>;
  template_id: ColumnType<string | null, string | null, never>;
  template_version_id: ColumnType<string | null, string | null, never>;
  template_kind: ColumnType<'template', never, never>;
  digest: ColumnType<string, string, never>;
}

/** A component version by its node, or an asset version by none (0072). */
export interface BaselinePinTable {
  baseline_id: ColumnType<string, string, never>;
  node: ColumnType<string | null, string | null, never>;
  version_id: ColumnType<string, string, never>;
  artifact_id: ColumnType<string, string, never>;
  /**
   * A bibliography entry's since 0147 (CIc), a term's since 0154 (TMb), and a vocabulary's since 0177
   * (VO-H), with no node.
   */
  kind: ColumnType<
    'component' | 'asset' | 'bibliographyEntry' | 'term' | 'vocabulary',
    'component' | 'asset' | 'bibliographyEntry' | 'term' | 'vocabulary',
    never
  >;
}

/** A binding's dataset version and the dataset's name when the baseline was made (0072; DAT-038). */
export interface BaselineBindingTable {
  baseline_id: ColumnType<string, string, never>;
  node: ColumnType<string, string, never>;
  binding: ColumnType<string, string, never>;
  digest: ColumnType<string, string, never>;
  resolution: ColumnType<string, string, never>;
  dataset_version: ColumnType<string, string, never>;
  dataset_id: ColumnType<string, string, never>;
  dataset_kind: ColumnType<'dataset', never, never>;
  dataset_name: ColumnType<string | null, string | null, never>;
  /** The revisions it read, in ascending order (0078; RV-E): bigint[], read as strings. */
  revisions: ColumnType<string[], string[] | undefined, never>;
}

/** Superseded once, by a later baseline of the same document (0072; VER-049). */
export interface BaselineSupersessionTable {
  baseline_id: ColumnType<string, string, never>;
  document_id: ColumnType<string, string, never>;
  superseded_by: ColumnType<string, string, never>;
  superseded_by_principal: ColumnType<string, string, never>;
  superseded_at: ColumnType<Date, never, never>;
}
