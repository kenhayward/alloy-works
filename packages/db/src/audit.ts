import {
  AuditContext,
  parseAuditDetail,
  type AuditKind,
  type AuditContext as Context,
} from '@alloy-works/domain';
import { CompiledQuery, sql } from 'kysely';
import type pg from 'pg';
import type { TenantTransaction } from './tables.js';

/**
 * Writing the audit log (audit.md, "Writing"; the AU1 plan, AU1-D): an event in the act's own
 * transaction, attributed by the transaction's audit context, which `withTenant` writes once. An event
 * with no context is refused, so none is ever unattributed.
 */

/** The setting that carries a transaction's audit context, local to the transaction. */
export const AUDIT_SETTING = 'alloy.audit';

/** What an event is about: a kind of thing, its id where it has one, and the version acted on. */
export interface AuditSubject {
  readonly kind: string;
  readonly id?: string | null;
  readonly version?: string | null;
}

export interface AuditEvent {
  readonly kind: AuditKind;
  readonly subject?: AuditSubject;
  readonly space?: string | null;
  /** Done, unless a refusal. */
  readonly outcome?: 'done' | 'refused';
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** A name or title as it was, kept beside the event; `refersTo` is whom or what it names. */
export interface AuditLabel {
  readonly role: string;
  readonly text: string;
  readonly refersTo?: string | null;
}

/** An event asked for in a transaction that names nobody: a bug in the caller, never the request's. */
export class AuditContextMissing extends Error {
  constructor(kind: string) {
    super(`The ${kind} event was recorded in a transaction with no audit context`);
  }
}

const ROLE = /^[a-z][a-z_]{0,31}$/;

/** The context as the setting holds it, checked first: a context of the wrong shape is never set. */
export function auditContextSetting(context: Context): string {
  return JSON.stringify(AuditContext.parse(context));
}

/** Writes the transaction's audit context. Local to the transaction, so a pooled connection keeps none. */
export async function setAuditContext(trx: TenantTransaction, context: Context): Promise<void> {
  await sql`select set_config(${AUDIT_SETTING}, ${auditContextSetting(context)}, true)`.execute(
    trx,
  );
}

/**
 * One statement: the event, from the context the transaction holds, and its labels, the actor's among
 * them where the context names one. A system context's `requestedBy` joins the detail. With no
 * context the actor's kind is null, which its column refuses.
 */
const RECORD = `
with context as (
  select nullif(current_setting('${AUDIT_SETTING}', true), '')::jsonb as c
), event as (
  insert into audit_event
    (kind, actor_kind, actor, token, subject_kind, subject, subject_version, space, outcome, detail,
     trace_id)
  select $1, c ->> 'actorKind', (c ->> 'actor')::uuid, (c ->> 'token')::uuid, $2, $3::uuid, $4::uuid,
    $5::uuid, $6, $7::jsonb || case when c ? 'requestedBy'
      then jsonb_build_object('requestedBy', c -> 'requestedBy') else '{}'::jsonb end,
    c ->> 'traceId'
  from context
  returning sequence
), labelled as (
  insert into audit_label (sequence, role, text, refers_to)
  select event.sequence, l.role, l.text, l.refers_to
  from event, (
    select role, text, refers_to
    from jsonb_to_recordset($8::jsonb) as given(role text, text text, refers_to uuid)
    union all
    select 'actor', c ->> 'actorLabel', (c ->> 'actor')::uuid
    from context where c ? 'actorLabel'
  ) l
)
select sequence::text as sequence from event`;

function statement(event: AuditEvent, labels: readonly AuditLabel[]): unknown[] {
  const detail = parseAuditDetail(event.kind, event.detail ?? {});
  for (const label of labels) {
    if (!ROLE.test(label.role) || label.role === 'actor') {
      throw new Error(`An audit label's role must be a plain name other than actor: ${label.role}`);
    }
    if (label.text.trim() === '') throw new Error(`The ${label.role} label of an event is empty`);
  }
  return [
    event.kind,
    event.subject?.kind ?? null,
    event.subject?.id ?? null,
    event.subject?.version ?? null,
    event.space ?? null,
    event.outcome ?? 'done',
    JSON.stringify(detail),
    JSON.stringify(
      labels.map((label) => ({
        role: label.role,
        text: label.text,
        refers_to: label.refersTo ?? null,
      })),
    ),
  ];
}

function missing(kind: string, error: unknown): Error {
  const failed = error as { code?: string; column?: string };
  return failed.code === '23502' && failed.column === 'actor_kind'
    ? new AuditContextMissing(kind)
    : (error as Error);
}

/**
 * Records an event in the act's transaction, after the act's write and before its commit: the two
 * commit together or not at all. Its detail is checked against its kind's shape before anything is
 * written. Returns the event's sequence.
 */
export async function recordEvent(
  trx: TenantTransaction,
  event: AuditEvent,
  labels: readonly AuditLabel[] = [],
): Promise<string> {
  const values = statement(event, labels);
  try {
    const result = await trx.executeQuery<{ sequence: string }>(CompiledQuery.raw(RECORD, values));
    return result.rows[0]!.sequence;
  } catch (error) {
    throw missing(event.kind, error);
  }
}

/**
 * `recordEvent` through a raw client, for the paths with no Kysely transaction (the first
 * administrator's naming): the client must be inside a transaction on the tenant's search path, with
 * its audit context set.
 */
export async function recordEventSql(
  client: pg.ClientBase,
  event: AuditEvent,
  labels: readonly AuditLabel[] = [],
): Promise<string> {
  const values = statement(event, labels);
  try {
    const result = await client.query<{ sequence: string }>(RECORD, values);
    return result.rows[0]!.sequence;
  } catch (error) {
    throw missing(event.kind, error);
  }
}

/**
 * Erases a person's labels (VER-038; the AU1 plan, AU1-C): every label referring to them takes a fixed
 * word, and the erasure is an event of its own. Returns how many labels it erased.
 */
export async function eraseLabels(trx: TenantTransaction, principalId: string): Promise<number> {
  const { rows } = await sql<{ erased: number }>`
    select erase_labels(${principalId}::uuid) as erased
  `.execute(trx);
  return rows[0]!.erased;
}
