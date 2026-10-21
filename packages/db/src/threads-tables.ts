import type { ColumnType, Generated } from 'kysely';

/** A thread beside the content (0076): inserted and read, never changed (COL-049, COL-050). */
export interface ThreadTable {
  id: ColumnType<string, string | undefined, never>;
  on_id: ColumnType<string, string, never>;
  on_kind: ColumnType<'component' | 'document', 'component' | 'document', never>;
  made_against: ColumnType<string, string, never>;
  /** JSONB in as the text of a JSON document. */
  anchor: ColumnType<unknown, string, never>;
  created_by: ColumnType<string, string, never>;
  created_at: ColumnType<Date, never, never>;
}

export interface ThreadCommentTable {
  id: ColumnType<string, string | undefined, never>;
  thread_id: ColumnType<string, string, never>;
  author: ColumnType<string, string, never>;
  created_at: ColumnType<Date, never, never>;
}

/** Every text a comment has had, the latest its own (COL-051). */
export interface ThreadCommentTextTable {
  id: Generated<string>;
  comment_id: ColumnType<string, string, never>;
  parts: ColumnType<unknown, string, never>;
  written_at: ColumnType<Date, never, never>;
}

export interface ThreadResolutionTable {
  thread_id: ColumnType<string, string, never>;
  resolved_by: ColumnType<string, string, never>;
  resolved_at: ColumnType<Date, never, never>;
}

/** A thread kept from every principal from outside (0109; COL-038; the R13 plan, R13-C). */
export interface ThreadInternalTable {
  thread_id: ColumnType<string, string, never>;
  marked_by: ColumnType<string, string, never>;
  marked_at: ColumnType<Date, never, never>;
}

/** One person's notification (0076; COL-063): never the text (COL-036). */
export interface NotificationTable {
  id: ColumnType<string, string | undefined, never>;
  recipient: ColumnType<string, string, never>;
  kind: ColumnType<
    'mention' | 'reply' | 'resolution' | 'round' | 'digest' | 'budget',
    'mention' | 'reply' | 'resolution' | 'round' | 'digest' | 'budget',
    never
  >;
  actor: ColumnType<string | null, string | null, never>;
  thread_id: ColumnType<string | null, string | null, never>;
  /** A round's notification names it (0079; RR-H); none before 0079. */
  round_id: ColumnType<string | null, string | null | undefined, never>;
  artifact_id: ColumnType<string | null, string | null, never>;
  counts: ColumnType<unknown, string | null, never>;
  at: ColumnType<Date, Date | undefined, never>;
  read_at: ColumnType<Date | null, never, Date>;
  /** Its event's sequence (0139; the WB plan, WB-C). */
  sequence: ColumnType<string, never, never>;
}

/** A daily event held for the fold (TH-F). */
export interface NotificationHeldTable {
  id: Generated<string>;
  recipient: ColumnType<string, string, never>;
  kind: ColumnType<
    'mention' | 'reply' | 'resolution' | 'round',
    'mention' | 'reply' | 'resolution' | 'round',
    never
  >;
  actor: ColumnType<string, string, never>;
  thread_id: ColumnType<string | null, string | null, never>;
  round_id: ColumnType<string | null, string | null | undefined, never>;
  artifact_id: ColumnType<string, string, never>;
  at: ColumnType<Date, Date | undefined, never>;
}

export interface NotificationPreferenceTable {
  principal_id: string;
  kind: 'mention' | 'reply' | 'resolution' | 'round';
  cadence: 'at_once' | 'daily' | 'never';
}
