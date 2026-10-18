import type { ColumnType } from 'kysely';

/** A reviewer's draft of a component, beside it (0077; SG-A): inserted and read, never changed. */
export interface SuggestionTable {
  id: ColumnType<string, string | undefined, never>;
  component_id: ColumnType<string, string, never>;
  component_kind: ColumnType<'component', 'component' | undefined, never>;
  made_against: ColumnType<string, string, never>;
  /** JSONB in as the text of a JSON document. */
  proposed: ColumnType<unknown, string, never>;
  proposed_digest: ColumnType<string, string, never>;
  made_by: ColumnType<string, string, never>;
  made_at: ColumnType<Date, never, never>;
  /** The run a generated suggestion came from, and its digest copied (0121; the G2 plan, G2-E). */
  run_id: ColumnType<string | null, string | undefined, never>;
  context_digest: ColumnType<string | null, string | undefined, never>;
}

/** How a suggestion ended, once (COL-022, COL-048). */
export interface SuggestionResolutionTable {
  suggestion_id: ColumnType<string, string, never>;
  act: ColumnType<
    'accepted' | 'rejected' | 'withdrawn',
    'accepted' | 'rejected' | 'withdrawn',
    never
  >;
  version_id: ColumnType<string | null, string | null, never>;
  resolved_by: ColumnType<string, string, never>;
  resolved_at: ColumnType<Date, never, never>;
}
