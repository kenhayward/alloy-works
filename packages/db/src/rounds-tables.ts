import type { ColumnType, Generated } from 'kysely';

/** A review round (0079; the RR plan, RR-A): inserted and read, never changed. */
export interface ReviewRoundTable {
  id: ColumnType<string, string | undefined, never>;
  document_id: ColumnType<string, string, never>;
  document_kind: ColumnType<'document', 'document' | undefined, never>;
  title: ColumnType<string, string, never>;
  scope: ColumnType<string[], string[] | undefined, never>;
  due_at: ColumnType<Date, Date, never>;
  baseline_id: ColumnType<string | null, string | null, never>;
  made_against: ColumnType<string, string, never>;
  opened_by: ColumnType<string, string, never>;
  opened_at: ColumnType<Date, never, never>;
  made_tx: ColumnType<string, never, never>;
}

/** A round's reviewers, named as it opens (COL-028). */
export interface ReviewRoundReviewerTable {
  round_id: ColumnType<string, string, never>;
  principal_id: ColumnType<string, string, never>;
}

/** A reviewer's act, or the round's closing (RR-A, RR-D). */
export interface ReviewRoundEventTable {
  id: Generated<string>;
  round_id: ColumnType<string, string, never>;
  act: ColumnType<
    'started' | 'completed' | 'reopened' | 'closed',
    'started' | 'completed' | 'reopened' | 'closed',
    never
  >;
  principal_id: ColumnType<string, string, never>;
  outcome: ColumnType<
    'commented' | 'nothing_to_say' | null,
    'commented' | 'nothing_to_say' | null,
    never
  >;
  version_id: ColumnType<string | null, string | null, never>;
  at: ColumnType<Date, never, never>;
}
