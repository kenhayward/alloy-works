import { kindsMatching, type AuditFilter } from '@alloy-works/domain';
import { sql } from 'kysely';
import { checkedLimit, snapshotFor } from './listing.js';
import type { TenantTransaction } from './tables.js';

/** A label as a reader sees it: its text, or the word erasure left, and whether it was erased. */
export interface AuditEntryLabel {
  readonly text: string;
  readonly erased: boolean;
}

/** One event as the log is read and exported (audit.md, "The event"). */
export interface AuditEntry {
  readonly sequence: string;
  readonly at: Date;
  readonly kind: string;
  readonly actorKind: string;
  readonly actor: string | null;
  readonly token: string | null;
  readonly subject: {
    readonly kind: string;
    readonly id: string | null;
    readonly version: string | null;
  } | null;
  readonly space: string | null;
  readonly outcome: 'done' | 'refused';
  readonly detail: Readonly<Record<string, unknown>>;
  readonly traceId: string | null;
  /** By role: `actor`, `subject`, `space` and whatever else the kind keeps. */
  readonly labels: Readonly<Record<string, AuditEntryLabel>>;
}

export interface AuditPageRequest {
  readonly limit: number;
  /** The sequence the page before ended at. */
  readonly after?: string;
  /** The snapshot the walk's first page was read as of. */
  readonly snapshot?: string;
  /** No event past this sequence: an export's newest, so it never holds its own asking. */
  readonly upTo?: string;
  /** Newest first, as a person reads it; oldest first, as an export writes it. */
  readonly order?: 'desc' | 'asc';
}

export interface AuditPage {
  readonly items: readonly AuditEntry[];
  /** The sequence the next page begins after, or null at the end. */
  readonly next: string | null;
  readonly snapshot: string;
}

/**
 * **A page of the tenant's audit log** (ADM-038, LIF-028; the AU2 plan, AU-M): the events every filter
 * given holds for, by sequence, each with its labels, as of the snapshot the walk's first page took -
 * an event commits in the order its act does, not its sequence's, so a walk holds exactly what its
 * first page could see, none twice, and one committed during it is in the next walk. Reading writes
 * no event (audit.md, "Reading and export").
 */
export async function readAuditEvents(
  trx: TenantTransaction,
  filter: AuditFilter,
  request: AuditPageRequest,
): Promise<AuditPage> {
  const limit = checkedLimit(request.limit);
  const order = request.order ?? 'desc';
  const snapshot = await snapshotFor(trx, request.snapshot);
  const kind = filter.kind;
  const rows = await trx
    .selectFrom('audit_event as e')
    .select([
      sql<string>`e.sequence::text`.as('sequence'),
      'e.at',
      'e.kind',
      'e.actor_kind',
      'e.actor',
      'e.token',
      'e.subject_kind',
      'e.subject',
      'e.subject_version',
      'e.space',
      'e.outcome',
      'e.detail',
      'e.trace_id',
      sql<Record<string, AuditEntryLabel>>`coalesce((
        select jsonb_object_agg(l.role, jsonb_build_object('text', l.text, 'erased', l.erased_at is not null))
        from audit_label l where l.sequence = e.sequence), '{}'::jsonb)`.as('labels'),
    ])
    .where(sql<boolean>`pg_visible_in_snapshot(e.xact, ${snapshot}::pg_snapshot)`)
    .$if(request.after !== undefined, (query) =>
      query.where(
        sql<boolean>`e.sequence ${sql.raw(order === 'desc' ? '<' : '>')} ${request.after}::bigint`,
      ),
    )
    .$if(request.upTo !== undefined, (query) =>
      query.where(sql<boolean>`e.sequence <= ${request.upTo}::bigint`),
    )
    .$if(filter.actor !== undefined, (query) => query.where('e.actor', '=', filter.actor!))
    // A family is its kinds, each exact: the kind's index serves a list, and a range of text would
    // compare by the database's collation, which passes over the dot.
    .$if(kind !== undefined, (query) => {
      const kinds = kindsMatching(kind!);
      return kinds.length === 0
        ? query.where(sql<boolean>`false`)
        : query.where('e.kind', 'in', kinds);
    })
    .$if(filter.subject !== undefined, (query) => query.where('e.subject', '=', filter.subject!))
    .$if(filter.space !== undefined, (query) => query.where('e.space', '=', filter.space!))
    .$if(filter.from !== undefined, (query) => query.where('e.at', '>=', filter.from!))
    .$if(filter.to !== undefined, (query) =>
      // An instant is read to the millisecond, as a reader sees it; the log holds microseconds.
      query.where('e.at', '<', new Date(filter.to!.getTime() + 1)),
    )
    .orderBy('e.sequence', order)
    .limit(limit + 1)
    .execute();
  const items = rows.slice(0, limit).map((row): AuditEntry => ({
    sequence: row.sequence,
    at: row.at,
    kind: row.kind,
    actorKind: row.actor_kind,
    actor: row.actor,
    token: row.token,
    subject:
      row.subject_kind === null
        ? null
        : { kind: row.subject_kind, id: row.subject, version: row.subject_version },
    space: row.space,
    outcome: row.outcome,
    detail: row.detail,
    traceId: row.trace_id,
    labels: row.labels,
  }));
  return {
    items,
    next: rows.length > limit ? items.at(-1)!.sequence : null,
    snapshot,
  };
}

/** An event as the API shows it and an export writes each line: its instant in ISO 8601, UTC. */
export function auditEntryJson(entry: AuditEntry) {
  return {
    sequence: entry.sequence,
    at: entry.at.toISOString(),
    kind: entry.kind,
    actorKind: entry.actorKind,
    actor: entry.actor,
    token: entry.token,
    subject: entry.subject && { ...entry.subject },
    space: entry.space,
    outcome: entry.outcome,
    detail: { ...entry.detail },
    traceId: entry.traceId,
    labels: Object.fromEntries(
      Object.entries(entry.labels).map(([role, label]) => [role, { ...label }]),
    ),
  };
}
