import { reviewPolicy } from '@alloy-works/domain';
import { sql } from 'kysely';
import { isArchived } from './archival.js';
import { artifactPlace, recordEvent } from './audit.js';
import { isDeleted } from './deletion.js';
import type { TenantTransaction } from './tables.js';
import { lockArtifact } from './versions.js';
import { latestVersionId, moved, newestDefinition, workflowStanding } from './workflow.js';

/**
 * **Dates** (workflow.md; the WF5 plan): a component's or document's effective and review-by dates and
 * the owner prompted to review it, set as acts; a revision approved to take effect later fixed as the
 * gate passes and taking effect by the sweep; and a review date passing unmet acted on once, as the
 * workflow declares.
 */

/** An instant as its setter set it: the instant, and their offset from UTC in minutes (LIF-062). */
export interface LocalInstant {
  readonly at: Date;
  readonly offset: number;
}

export interface ArtifactDates {
  readonly effective: LocalInstant | null;
  /** A calendar day, `YYYY-MM-DD`. */
  readonly reviewBy: string | null;
  readonly owner: string | null;
  readonly by: string;
  readonly at: Date;
}

const datesKnown = new WeakMap<TenantTransaction, boolean>();

/** Whether this schema has 0099's tables: migration tests run this code on older ones. */
export async function datesStored(trx: TenantTransaction): Promise<boolean> {
  const known = datesKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('artifact_dates') is not null as present`.execute(trx);
  const present = rows[0]?.present === true;
  datesKnown.set(trx, present);
  return present;
}

/** An instant written as its setter's local time with their offset: `2026-11-01T09:00:00.000+01:00`. */
export function localIso({ at, offset }: LocalInstant): string {
  const local = new Date(at.getTime() + offset * 60_000).toISOString().slice(0, 23);
  const sign = offset < 0 ? '-' : '+';
  const whole = Math.abs(offset);
  const hours = String(Math.floor(whole / 60)).padStart(2, '0');
  const minutes = String(whole % 60).padStart(2, '0');
  return `${local}${sign}${hours}:${minutes}`;
}

/** An ISO instant with an offset, read as one: null where it carries none or does not read. */
export function readLocalInstant(iso: string): LocalInstant | null {
  const match = /([+-])(\d{2}):(\d{2})$|Z$/.exec(iso);
  const at = new Date(iso);
  if (match === null || Number.isNaN(at.getTime())) return null;
  const offset =
    match[0] === 'Z' ? 0 : (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  return { at, offset };
}

/** Today in UTC, `YYYY-MM-DD`: a review date is past once it is before this. */
export const dayOf = (now: Date) => now.toISOString().slice(0, 10);

/** Each of these artifacts' dates now, where any were set. */
export async function readDates(
  trx: TenantTransaction,
  artifactIds: readonly string[],
): Promise<Map<string, ArtifactDates>> {
  if (artifactIds.length === 0 || !(await datesStored(trx))) return new Map();
  const rows = await trx
    .selectFrom('artifact_dates')
    .distinctOn('artifact_id')
    .select([
      'artifact_id',
      'effective_at',
      'effective_offset',
      sql<string | null>`review_by::text`.as('review_by'),
      'owner',
      'by',
      'at',
    ])
    .where('artifact_id', 'in', [...artifactIds])
    .orderBy('artifact_id')
    .orderBy('id', 'desc')
    .execute();
  return new Map(
    rows.map((row) => [
      row.artifact_id,
      {
        effective:
          row.effective_at === null || row.effective_offset === null
            ? null
            : { at: row.effective_at, offset: row.effective_offset },
        reviewBy: row.review_by,
        owner: row.owner,
        by: row.by,
        at: row.at,
      },
    ]),
  );
}

export type SetDatesAnswer =
  | { readonly answer: 'set' | 'unchanged'; readonly dates: ArtifactDates | null }
  | { readonly answer: 'artifact.missing' | 'artifact.archived' };

/**
 * Sets a component's or document's dates (LIF-015, LIF-016; WF5-A) under its lock, as an act, audited
 * `dates.set`: the caller has decided they may edit it, and that the owner may read it. The same dates
 * again change nothing.
 */
export async function setDates(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly kind: 'component' | 'document';
    readonly effective: LocalInstant | null;
    readonly reviewBy: string | null;
    readonly owner: string | null;
    readonly by: string;
  },
): Promise<SetDatesAnswer> {
  await lockArtifact(trx, input.artifactId);
  const artifact = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', input.artifactId)
    .executeTakeFirst();
  if (artifact?.kind !== input.kind || (await isDeleted(trx, input.artifactId))) {
    return { answer: 'artifact.missing' };
  }
  if (await isArchived(trx, input.artifactId)) return { answer: 'artifact.archived' };
  const was = (await readDates(trx, [input.artifactId])).get(input.artifactId) ?? null;
  const same =
    (was?.effective?.at.getTime() ?? null) === (input.effective?.at.getTime() ?? null) &&
    (was?.effective?.offset ?? null) === (input.effective?.offset ?? null) &&
    (was?.reviewBy ?? null) === input.reviewBy &&
    (was?.owner ?? null) === input.owner;
  if (same) return { answer: 'unchanged', dates: was };
  await trx
    .insertInto('artifact_dates')
    .values({
      artifact_id: input.artifactId,
      kind: input.kind,
      effective_at: input.effective?.at ?? null,
      effective_offset: input.effective?.offset ?? null,
      review_by: input.reviewBy,
      owner: input.owner,
      by: input.by,
    })
    .execute();
  const place = await artifactPlace(trx, input.artifactId);
  await recordEvent(
    trx,
    {
      kind: 'dates.set',
      subject: { kind: input.kind, id: input.artifactId, version: place.version },
      space: place.space,
      detail: {
        kind: input.kind,
        effectiveAt: input.effective === null ? null : localIso(input.effective),
        reviewBy: input.reviewBy,
        owner: input.owner,
      },
    },
    place.labels,
  );
  return {
    answer: 'set',
    dates: (await readDates(trx, [input.artifactId])).get(input.artifactId)!,
  };
}

/**
 * As a gate designates a revision (WF5-B; LIF-060): where the artifact's effective date is still to
 * come, the revision takes it, fixed; otherwise it is effective as it is approved.
 */
export async function fixEffective(
  trx: TenantTransaction,
  input: { readonly artifactId: string; readonly version: string; readonly now?: Date },
): Promise<void> {
  if (!(await datesStored(trx))) return;
  const dates = (await readDates(trx, [input.artifactId])).get(input.artifactId);
  const effective = dates?.effective;
  if (!effective || effective.at.getTime() <= (input.now ?? new Date()).getTime()) return;
  await trx
    .insertInto('revision_effective')
    .values({
      version_id: input.version,
      artifact_id: input.artifactId,
      effective_at: effective.at,
    })
    .execute();
}

/**
 * The sweep's first half (WF5-D; LIF-060): each revision whose effective date has passed and has not
 * yet been recorded as taking effect is, audited `revision.effective`, by the system. How many.
 */
export async function recordEffected(
  trx: TenantTransaction,
  now: Date = new Date(),
): Promise<number> {
  if (!(await datesStored(trx))) return 0;
  const due = await trx
    .selectFrom('revision_effective as e')
    .innerJoin('revision_designation as d', 'd.version_id', 'e.version_id')
    .leftJoin('revision_effected as x', 'x.version_id', 'e.version_id')
    .select(['e.version_id', 'e.artifact_id', 'e.effective_at', 'd.kind', 'd.revision_no'])
    .where('e.effective_at', '<=', now)
    .where('x.version_id', 'is', null)
    .orderBy('e.effective_at')
    .execute();
  for (const row of due) {
    await trx.insertInto('revision_effected').values({ version_id: row.version_id }).execute();
    const place = await artifactPlace(trx, row.artifact_id);
    const kind = row.kind === 'document' ? 'document' : 'component';
    await recordEvent(
      trx,
      {
        kind: 'revision.effective',
        subject: { kind, id: row.artifact_id, version: row.version_id },
        space: place.space,
        detail: {
          kind,
          revision: row.revision_no,
          version: row.version_id,
          effectiveAt: row.effective_at.toISOString(),
        },
      },
      place.labels,
    );
  }
  return due.length;
}

/**
 * The sweep's second half (WF5-G; LIF-059): each component or document whose review date has passed
 * unmet, and was not yet acted on for that date, is, as its kind's newest workflow declares: shown
 * alone, moved to a state by nobody, or escalated to a person. Archived or deleted ones wait. How many.
 */
export async function recordLapses(
  trx: TenantTransaction,
  now: Date = new Date(),
): Promise<number> {
  if (!(await datesStored(trx))) return 0;
  const today = dayOf(now);
  const { rows } = await sql<{
    artifact_id: string;
    kind: 'component' | 'document';
    review_by: string;
  }>`
    select d.artifact_id, d.kind, d.review_by::text as review_by
    from (
      select distinct on (artifact_id) artifact_id, kind, review_by from artifact_dates
      order by artifact_id, id desc
    ) d
    where d.review_by is not null and d.review_by < ${today}::date
      and not exists (
        select 1 from review_lapse l where l.artifact_id = d.artifact_id and l.review_by = d.review_by
      )
    order by d.review_by, d.artifact_id
  `.execute(trx);
  let acted = 0;
  for (const row of rows) {
    await lockArtifact(trx, row.artifact_id);
    if ((await isDeleted(trx, row.artifact_id)) || (await isArchived(trx, row.artifact_id)))
      continue;
    const definition = await newestDefinition(trx, row.kind);
    const lapse = reviewPolicy(definition.body).lapse;
    await trx
      .insertInto('review_lapse')
      .values({
        artifact_id: row.artifact_id,
        kind: row.kind,
        review_by: row.review_by,
        action: lapse.kind,
        escalated_to: lapse.kind === 'escalate' ? lapse.to : null,
      })
      .execute();
    if (lapse.kind === 'move') {
      const standing = await workflowStanding(trx, row.artifact_id);
      if (standing && standing.state.key !== lapse.to) {
        await moved(trx, standing, {
          artifactId: row.artifact_id,
          version: await latestVersionId(trx, row.artifact_id),
          transition: null,
          to: lapse.to,
          reason: null,
          by: null,
        });
      }
    }
    const place = await artifactPlace(trx, row.artifact_id);
    await recordEvent(
      trx,
      {
        kind: 'review.lapsed',
        subject: { kind: row.kind, id: row.artifact_id, version: place.version },
        space: place.space,
        detail: {
          kind: row.kind,
          reviewBy: row.review_by,
          action: lapse.kind,
          ...(lapse.kind === 'visibility' ? {} : { to: lapse.to }),
        },
      },
      place.labels,
    );
    acted += 1;
  }
  return acted;
}
