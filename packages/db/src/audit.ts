import {
  AuditContext,
  isLabelledKind,
  labelFor,
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

/**
 * Whether an emitter that runs a lookup anyway records its event: where the schema keeps an audit log,
 * as every tenant's does from 0060 on, or where the transaction names who acts, which then fails
 * loudly on a log that is not there. Only a transaction naming nobody, on a schema before 0060 - a
 * migration's own test writing to an environment it stood as it was - records nothing.
 */
export const AUDIT_LOG_KEPT = sql<boolean>`(to_regclass('audit_event') is not null
  or nullif(current_setting(${AUDIT_SETTING}, true), '') is not null)`;

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

/**
 * A principal's label, as `role`: their display name, or the address an invitation holds for somebody
 * who has not signed in yet. Undefined for a principal the tenant does not hold. Refers to them, so
 * erasure reaches it.
 */
export async function principalLabel(
  trx: TenantTransaction,
  role: string,
  principalId: string,
): Promise<AuditLabel | undefined> {
  const row = await trx
    .selectFrom('principal')
    .select(['display_name', 'email'])
    .where('id', '=', principalId)
    .executeTakeFirst();
  return labelled(role, row && (row.display_name ?? row.email), principalId);
}

/** A label, where there is text to keep. */
export function labelled(
  role: string,
  text: string | null | undefined,
  refersTo: string | null = null,
): AuditLabel | undefined {
  const kept = text?.trim().slice(0, 400);
  return kept ? { role, text: kept, refersTo } : undefined;
}

/** The labels that have text. */
export const labels = (...each: (AuditLabel | undefined)[]): AuditLabel[] =>
  each.filter((label): label is AuditLabel => label !== undefined);

/** An artifact as an event about it names it: its space, the version, and their labels. */
export interface ArtifactPlace {
  readonly space: string | null;
  readonly version: string | null;
  readonly labels: AuditLabel[];
}

/**
 * Where an artifact is and what it is called at a version - `version`, or its latest - for an event
 * about it: its space, the version's id, and the version's title or name and the space's name as
 * labels (audit.md, "Labels").
 */
export async function artifactPlace(
  trx: TenantTransaction,
  artifactId: string,
  version?: string,
): Promise<ArtifactPlace> {
  let query = trx
    .selectFrom('artifact_version as v')
    .innerJoin('artifact as a', 'a.id', 'v.artifact_id')
    .leftJoin('space as s', 's.id', 'a.space_id')
    .select(['v.id', 'v.kind', 'v.content', 'a.space_id', 's.name as space_name'])
    .where('v.artifact_id', '=', artifactId);
  query =
    version === undefined
      ? query.orderBy('v.revision_no', 'desc').orderBy('v.version_no', 'desc').limit(1)
      : query.where('v.id', '=', version);
  const row = await query.executeTakeFirst();
  if (!row) return { space: null, version: version ?? null, labels: [] };
  const title = isLabelledKind(row.kind)
    ? labelFor(row.kind, row.content as Record<string, unknown>)
    : undefined;
  return {
    space: row.space_id,
    version: row.id,
    labels: labels(
      labelled('subject', title, artifactId),
      labelled('space', row.space_name, row.space_id),
    ),
  };
}

/**
 * Counts a sign-in failure naming nobody (the AU1 review, H1): at most one event a minute per route and
 * failure, so an unauthenticated caller cannot write events without limit. Answers how many failures
 * the event to record now stands for, the held-back ones with this one, or undefined within the minute.
 */
export async function tallySignInFailure(
  trx: TenantTransaction,
  route: string,
  failure: string,
): Promise<number | undefined> {
  const { rows } = await sql<{ pending: number; due: boolean }>`
    insert into sign_in_failure_tally as t (route, failure, pending) values (${route}, ${failure}, 1)
    on conflict (route, failure) do update set pending = t.pending + 1
    returning t.pending, (t.recorded_at is null or t.recorded_at <= now() - interval '1 minute') as due
  `.execute(trx);
  const counted = rows[0]!;
  if (!counted.due) return undefined;
  await sql`
    update sign_in_failure_tally set pending = 0, recorded_at = now()
    where route = ${route} and failure = ${failure}
  `.execute(trx);
  return counted.pending;
}
