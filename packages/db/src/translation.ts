import {
  DEFAULT_TRANSLATION_POLICY,
  effectiveRevision,
  speaksFor,
  blockText,
  parseContentDocument,
  sourceChangesBetween,
  translationLanguageRefusal,
  type SourceChange,
  type TranslationPolicy,
  type TranslationStatus,
} from '@alloy-works/domain';
import { sql, type RawBuilder } from 'kysely';
import { artifactPlace, recordEvent } from './audit.js';
import { datesStored } from './dates.js';
import { loadReadableSet } from './access-facts.js';
import { deletionStored, notDeletedAs } from './deletion.js';
import { diverge, readLine, translationStored, type Line } from './lines.js';
import {
  checkedLimit,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  visibleIn,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { readableArtifactsAs } from './readable-artifacts.js';
import { revisionScopes } from './scopes.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion, readVersion, type StoredVersion } from './versions.js';
import { latestRevision } from './workflow.js';

/**
 * **Translation** (docs/design/translation.md; the TR plan): a component's variant in a language is a
 * line of its own (TR-A), begun from the source's latest designated revision (TR-B); each version cut
 * on it records the main-line version it translates (TR-C); a main-line version may declare it needs
 * no retranslating (TR-D); a variant's status is computed from both, never stored (TR-E). Whether the
 * caller may is theirs to have decided.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type BeginAnswer =
  | { readonly answer: 'begun'; readonly line: Line }
  | {
      readonly answer:
        | 'artifact.missing'
        | 'translation.language_invalid'
        | 'translation.same_language'
        | 'translation.exists'
        | 'translation.needs_revision'
        | 'line.name_taken'
        | 'revision.missing';
    };

/**
 * Begins a component's translation into `language` (TR-B; LOC-007): a language line from the main
 * line's latest designated revision, named by its tag, audited `line.diverged` with the language. It
 * cuts no version, so the variant is untranslated until its first cut.
 */
export async function beginTranslation(
  trx: TenantTransaction,
  input: { readonly artifactId: string; readonly language: string; readonly by: string },
): Promise<BeginAnswer> {
  if (!UUID.test(input.artifactId) || !(await translationStored(trx))) {
    return { answer: 'artifact.missing' };
  }
  const source = await latestVersion(trx, input.artifactId);
  if (!source || source.kind !== 'component') return { answer: 'artifact.missing' };
  const refused = translationLanguageRefusal(
    parseContentDocument(source.content).language,
    input.language,
  );
  if (refused) return { answer: refused };
  const held = await trx
    .selectFrom('artifact_line')
    .select('id')
    .where('artifact_id', '=', input.artifactId)
    .where('language', '=', input.language)
    .executeTakeFirst();
  if (held) return { answer: 'translation.exists' };
  const revision = await latestRevision(trx, input.artifactId);
  if (!revision) return { answer: 'translation.needs_revision' };
  const begun = await diverge(trx, {
    artifactId: input.artifactId,
    revision: revision.number,
    name: input.language,
    by: input.by,
    language: input.language,
  });
  return begun.answer === 'diverged' ? { answer: 'begun', line: begun.line } : begun;
}

export type TranslatesRefusal =
  /** A cut on a language line names no source version (TR-C). */
  | { readonly answer: 'translation.source_required' }
  /** The source version named is no version of the component's main line. */
  | { readonly answer: 'translation.source_invalid' };

/**
 * Checks the source version a write on a language line says it translates (TR-C): a version of the
 * same component's main line - its approved revision, as a translator is shown it, or a later one -
 * else refused. Never only the latest: a translation of the approved revision stands beside drafts
 * of the source made since (the TR final review).
 */
export async function checkTranslates(
  trx: TenantTransaction,
  artifactId: string,
  translates: string | undefined,
): Promise<TranslatesRefusal | null> {
  if (translates === undefined) return { answer: 'translation.source_required' };
  if (!UUID.test(translates)) return { answer: 'translation.source_invalid' };
  const version = await trx
    .selectFrom('artifact_version')
    .select('id')
    .where('id', '=', translates)
    .where('artifact_id', '=', artifactId)
    .where('line_id', 'is', null)
    .executeTakeFirst();
  return version ? null : { answer: 'translation.source_invalid' };
}

/**
 * The source version a translation is made against (TR-C; the TR final review): the main line's
 * latest designated revision, which an approved reference reads, else its latest version.
 */
export async function translationSource(
  trx: TenantTransaction,
  artifactId: string,
): Promise<StoredVersion | undefined> {
  const approved = await latestRevision(trx, artifactId);
  if (approved) return readVersion(trx, approved.versionId);
  return latestVersion(trx, artifactId);
}

/** Records what a version on a language line translates (TR-C), checked by `checkTranslates` first. */
export async function recordTranslates(
  trx: TenantTransaction,
  input: {
    readonly line: string;
    readonly version: string;
    readonly translates: string;
    readonly by: string;
  },
): Promise<void> {
  await trx
    .insertInto('translation_state')
    .values({
      line_id: input.line,
      version_id: input.version,
      translates: input.translates,
      by: input.by,
    })
    .execute();
}

/** The main-line version a language line's version was last recorded translating, or undefined. */
export async function translatedBy(
  trx: TenantTransaction,
  version: string,
): Promise<string | undefined> {
  if (!(await translationStored(trx))) return undefined;
  const state = await trx
    .selectFrom('translation_state')
    .select('translates')
    .where('version_id', '=', version)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return state?.translates;
}

export type MarkCurrentAnswer =
  | { readonly answer: 'marked' }
  | { readonly answer: 'line.missing' | 'line.closed' | 'translation.untranslated' }
  | TranslatesRefusal;

/**
 * **Mark current** (TR-C): a language line's newest version recorded against the source's latest,
 * without cutting a version, for a source change that needed no new words. Audited
 * `translation.marked_current`.
 */
export async function markCurrent(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly line: string;
    readonly translates: string;
    readonly by: string;
  },
): Promise<MarkCurrentAnswer> {
  const line = await readLine(trx, input.artifactId, input.line);
  if (!line || line.language === null) return { answer: 'line.missing' };
  if (line.closed) return { answer: 'line.closed' };
  const head = await trx
    .selectFrom('artifact_version')
    .select('id')
    .where('line_id', '=', line.id)
    .orderBy('version_no', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!head) return { answer: 'translation.untranslated' };
  const refused = await checkTranslates(trx, input.artifactId, input.translates);
  if (refused) return refused;
  await recordTranslates(trx, {
    line: line.id,
    version: head.id,
    translates: input.translates,
    by: input.by,
  });
  const place = await artifactPlace(trx, input.artifactId);
  await recordEvent(
    trx,
    {
      kind: 'translation.marked_current',
      subject: { kind: 'component', id: input.artifactId, version: place.version },
      space: place.space,
      detail: {
        line: line.id,
        language: line.language,
        version: head.id,
        translates: input.translates,
      },
    },
    place.labels,
  );
  return { answer: 'marked' };
}

export type DeclareAnswer =
  { readonly answer: 'declared' } | { readonly answer: 'version.missing' };

/**
 * Declares whether a main-line version needs retranslating (TR-D; LOC-015, LOC-031), at its cut or
 * afterwards: the newest declaration a version's stands. Audited `translation.declared`.
 */
export async function declareSourceChange(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly version: string;
    readonly retranslate: boolean;
    readonly by: string;
  },
): Promise<DeclareAnswer> {
  if (!UUID.test(input.version) || !(await translationStored(trx))) {
    return { answer: 'version.missing' };
  }
  const version = await trx
    .selectFrom('artifact_version')
    .select('id')
    .where('id', '=', input.version)
    .where('artifact_id', '=', input.artifactId)
    .where('line_id', 'is', null)
    .executeTakeFirst();
  if (!version) return { answer: 'version.missing' };
  await trx
    .insertInto('source_change')
    .values({ version_id: input.version, retranslate: input.retranslate, by: input.by })
    .execute();
  const place = await artifactPlace(trx, input.artifactId);
  await recordEvent(
    trx,
    {
      kind: 'translation.declared',
      subject: { kind: 'component', id: input.artifactId, version: place.version },
      space: place.space,
      detail: { version: input.version, retranslate: input.retranslate },
    },
    place.labels,
  );
  return { answer: 'declared' };
}

/** Whether 0163 has run; a tenant before it holds no job. */
export async function jobsStored(trx: TenantTransaction): Promise<boolean> {
  const known = jobsKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('translation_job') is not null as present`.execute(trx);
  const present = rows[0]?.present === true;
  jobsKnown.set(trx, present);
  return present;
}
const jobsKnown = new WeakMap<TenantTransaction, boolean>();

/** Whether 0165 has run, so lines may be marked machine drafted (XL-I): asked once a transaction. */
async function machineDraftsKnown(trx: TenantTransaction): Promise<boolean> {
  const known = draftsKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('machine_draft') is not null as present`.execute(trx);
  const present = rows[0]?.present === true;
  draftsKnown.set(trx, present);
  return present;
}
const draftsKnown = new WeakMap<TenantTransaction, boolean>();

/** A component's translation into one language, as read (TR-E). */
export interface Translation {
  readonly line: string;
  readonly language: string;
  /** The line's newest version recorded against a source, or null while untranslated. */
  readonly head: string | null;
  /** The main-line version that head translates, or null. */
  readonly translates: string | null;
  readonly status: TranslationStatus;
}

/**
 * `translationStatus` as SQL (the TE plan, TE-C), so a report filters and pages on it; a parity test
 * holds the two together over every case. `later` is each later source version's `retranslate`.
 */
export function translationStatusSql(row: {
  readonly translates: RawBuilder<unknown>;
  readonly later: RawBuilder<unknown>;
  readonly inTranslation: RawBuilder<unknown>;
  readonly machineDrafted: RawBuilder<unknown>;
}): { readonly status: RawBuilder<string>; readonly retranslate: RawBuilder<boolean> } {
  return {
    status: sql<string>`case
      when ${row.machineDrafted} then 'machineDrafted'
      when ${row.translates} is not null and cardinality(${row.later}) = 0 then 'translated'
      when ${row.inTranslation} then 'inTranslation'
      when ${row.translates} is null then 'untranslated'
      else 'outOfDate' end`,
    retranslate: sql<boolean>`coalesce(true = any(${row.later}), false)`,
  };
}

/** What a report's translations may be narrowed to (TE-C): a language, a status, or both. */
export interface TranslationFilter {
  readonly language?: string | undefined;
  readonly status?: TranslationStatus['status'] | undefined;
}

/**
 * Every open translation with its status, a row a line (TR-E; TE-C): `line`, `artifact_id`,
 * `language`, `head`, `translates`, `status` and `retranslate`. Out of date the moment a main-line
 * version follows what it translates, needing retranslation where any such version is declared so or
 * declares nothing; in translation while an open job's item holds it out (XL-E).
 */
async function translationLines(trx: TenantTransaction): Promise<RawBuilder<unknown>> {
  const { status, retranslate } = translationStatusSql({
    translates: sql`y.translates`,
    later: sql`y.later`,
    inTranslation: sql`y.in_translation`,
    machineDrafted: sql`y.machine_drafted`,
  });
  const lines = sql`
    select l.id as line, l.artifact_id, l.language, s.version_id as head, s.translates,
           coalesce((
             select array_agg(coalesce((
                      select c.retranslate from source_change c
                       where c.version_id = v.id order by c.id desc limit 1), true))
               from artifact_version v
               join artifact_version t on t.id = s.translates
              where v.artifact_id = l.artifact_id and v.line_id is null
                and (v.revision_no, v.version_no) > (t.revision_no, t.version_no)
           ), '{}') as later,
           ${
             (await jobsStored(trx))
               ? sql`exists (
                   select 1 from translation_job_item i
                     join translation_job j on j.id = i.job_id
                    where i.line_id = l.id and (i.outcome is null or i.outcome = 'held')
                      and j.closed_at is null)`
               : sql`false`
           } as in_translation,
           ${
             (await machineDraftsKnown(trx))
               ? sql`exists (select 1 from machine_draft d where d.line_id = l.id and d.accepted_at is null)`
               : sql`false`
           } as machine_drafted
      from artifact_line l
      left join lateral (
        select version_id, translates from translation_state
         where line_id = l.id order by id desc limit 1
      ) s on true
     where l.language is not null
       and not exists (select 1 from line_closed c where c.line_id = l.id)`;
  return sql`select y.line, y.artifact_id, y.language, y.head, y.translates,
                    ${status} as status, ${retranslate} as retranslate
               from (${lines}) as y`;
}

/** Whether a translation aliased `t` is one `filter` leaves. */
const filtered = (filter: TranslationFilter): RawBuilder<unknown> =>
  sql`${filter.language === undefined ? sql`true` : sql`t.language = ${filter.language}`}
      and ${filter.status === undefined ? sql`true` : sql`t.status = ${filter.status}`}`;

/**
 * Each of these components' open translations with its status (TR-E; LOC-013, LOC-014, LOC-015), by
 * language, those `filter` leaves. Whether the caller may read them is theirs to have decided.
 */
export async function translationsOf(
  trx: TenantTransaction,
  artifactIds: readonly string[],
  filter: TranslationFilter = {},
): Promise<Map<string, Translation[]>> {
  const ids = [...new Set(artifactIds.filter((id) => UUID.test(id)))];
  if (ids.length === 0 || !(await translationStored(trx))) return new Map();
  const { rows } = await sql<{
    line: string;
    artifact_id: string;
    language: string;
    head: string | null;
    translates: string | null;
    status: TranslationStatus['status'];
    retranslate: boolean;
  }>`
    select t.* from (${await translationLines(trx)}) as t
     where t.artifact_id = any(${ids}::uuid[]) and ${filtered(filter)}
     order by t.artifact_id, t.language`.execute(trx);
  const found = new Map<string, Translation[]>();
  for (const row of rows) {
    const translation: Translation = {
      line: row.line,
      language: row.language,
      head: row.head,
      translates: row.translates,
      status:
        row.status === 'outOfDate'
          ? { status: 'outOfDate', retranslate: row.retranslate }
          : { status: row.status },
    };
    found.set(row.artifact_id, [...(found.get(row.artifact_id) ?? []), translation]);
  }
  return found;
}

/**
 * What changed in the source since a language line's translation (TR-F; LOC-040): the version it
 * translates, the source's latest, and each block between them. Undefined where it holds no such
 * open language line, or the line has translated nothing yet.
 */
export async function sourceChanges(
  trx: TenantTransaction,
  artifactId: string,
  lineId: string,
): Promise<
  | {
      readonly translates: string;
      readonly current: string;
      readonly changes: (SourceChange & { readonly words: string })[];
    }
  | undefined
> {
  const line = await readLine(trx, artifactId, lineId);
  if (!line || line.closed || line.language === null) return undefined;
  const state = await trx
    .selectFrom('translation_state')
    .select('translates')
    .where('line_id', '=', line.id)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const current = await latestVersion(trx, artifactId);
  if (!state || !current) return undefined;
  const was = await readVersion(trx, state.translates);
  if (!was) return undefined;
  const before = parseContentDocument(was.content);
  const after = parseContentDocument(current.content);
  const blocks = new Map([...before.content, ...after.content].map((block) => [block.id, block]));
  return {
    translates: was.id,
    current: current.id,
    changes: sourceChangesBetween(before, after).map((each) => ({
      ...each,
      words: blockText(blocks.get(each.block)!),
    })),
  };
}

/** The tenant's translation policy (TR-J; LOC-036): its default where 0160 has not run. */
export async function translationPolicy(trx: TenantTransaction): Promise<TranslationPolicy> {
  return (await translationPolicyNow(trx)).policy;
}

/** Whether a migration's table stands in this schema: the readers and writers ahead of it ask. */
async function tableStands(trx: TenantTransaction, table: string): Promise<boolean> {
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass(${table}) is not null as present`.execute(trx);
  return rows[0]?.present === true;
}

/** The latest history row's id: the clock orders them, as changes take turns under the lock. */
const LATEST_CHANGE = sql`select c.id from translation_policy_change c
                           order by c.at desc, c.id desc limit 1`;

/**
 * The policy as it stands and the history row naming it (TE-D; LOC-036), read in one statement so the
 * two agree: what a publish or a preview in a language is decided under. No row before 0170.
 */
export async function translationPolicyNow(
  trx: TenantTransaction,
): Promise<{ readonly policy: TranslationPolicy; readonly change: string | null }> {
  if (!(await tableStands(trx, 'translation_policy'))) {
    return { policy: DEFAULT_TRANSLATION_POLICY, change: null };
  }
  const kept = await tableStands(trx, 'translation_policy_change');
  const found = await sql<{
    fallback: TranslationPolicy['fallback'];
    out_of_date: TranslationPolicy['outOfDate'];
    note: Record<string, string>;
    conflict: TranslationPolicy['conflict'] | null;
    machine: TranslationPolicy['machine'] | null;
    change: string | null;
  }>`select fallback, out_of_date, note, to_jsonb(p) ->> 'conflict' as conflict,
            to_jsonb(p) ->> 'machine' as machine,
            ${kept ? sql`(${LATEST_CHANGE})` : sql`null::uuid`} as change
       from translation_policy p`.execute(trx);
  const row = found.rows[0];
  return row
    ? {
        policy: {
          fallback: row.fallback,
          outOfDate: row.out_of_date,
          note: row.note,
          // Before 0164, a conflicted return was not yet a thing: placed for review, its default.
          conflict: row.conflict ?? DEFAULT_TRANSLATION_POLICY.conflict,
          // Before 0165, nothing was sent to a machine: off, its default.
          machine: row.machine ?? DEFAULT_TRANSLATION_POLICY.machine,
        },
        change: row.change,
      }
    : { policy: DEFAULT_TRANSLATION_POLICY, change: null };
}

/**
 * The policy read under its row's lock (TE-D), held to the transaction's end, so two changes at once
 * take turns and the second reads, and compares against, what the first wrote. The update grant is
 * 0160's.
 */
export async function lockTranslationPolicy(trx: TenantTransaction): Promise<TranslationPolicy> {
  if (await tableStands(trx, 'translation_policy')) {
    await sql`select singleton from translation_policy for update`.execute(trx);
  }
  return translationPolicy(trx);
}

/**
 * The tenant's translation policy set, whole but for a conflict left out, which stays as it is; the
 * caller decided `administer` at the tenant. Its history gains the values whole, by `by`, where any
 * differs from the latest row's (TE-D; LOC-036), compared under the policy's lock.
 */
export async function setTranslationPolicy(
  trx: TenantTransaction,
  policy: Omit<TranslationPolicy, 'conflict' | 'machine'> & {
    readonly conflict?: TranslationPolicy['conflict'] | undefined;
    readonly machine?: TranslationPolicy['machine'] | undefined;
  },
  by?: string,
): Promise<TranslationPolicy> {
  await lockTranslationPolicy(trx);
  await sql`update translation_policy
               set fallback = ${policy.fallback}, out_of_date = ${policy.outOfDate},
                   note = ${JSON.stringify(policy.note)}::jsonb`.execute(trx);
  // Each only where its migration has run (0164, 0165), as the readers read them (the XL final review).
  const { rows: columns } = await sql<{ column_name: string }>`
    select column_name from information_schema.columns
     where table_schema = current_schema() and table_name = 'translation_policy'
       and column_name in ('conflict', 'machine')`.execute(trx);
  const has = new Set(columns.map((row) => row.column_name));
  if (policy.conflict !== undefined && has.has('conflict')) {
    await sql`update translation_policy set conflict = ${policy.conflict}`.execute(trx);
  }
  if (policy.machine !== undefined && has.has('machine')) {
    await sql`update translation_policy set machine = ${policy.machine}`.execute(trx);
  }
  // Only where 0170 has run, as `conflict` and `machine` are written only where theirs have.
  if (await tableStands(trx, 'translation_policy_change')) {
    await sql`insert into translation_policy_change (fallback, out_of_date, note, conflict, machine, by)
              select p.fallback, p.out_of_date, p.note, p.conflict, p.machine, ${by ?? null}::uuid
                from translation_policy p
               where not exists (
                 select 1 from translation_policy_change l
                  where l.id = (${LATEST_CHANGE})
                    and l.fallback = p.fallback and l.out_of_date = p.out_of_date
                    and l.note = p.note and l.conflict = p.conflict and l.machine = p.machine)`.execute(
      trx,
    );
  }
  return translationPolicy(trx);
}

/** One change to the translation policy (TE-D): its values whole, who made it and when. */
export interface TranslationPolicyChange {
  readonly id: string;
  readonly policy: TranslationPolicy;
  /** Nobody for 0170's row, the policy as that migration found it. */
  readonly by: { readonly id: string; readonly displayName: string | null } | null;
  readonly at: Date;
}

/**
 * The policy's history (TE-D; LOC-036), the newest first, paged by its keyset. Rows are only ever
 * inserted, and a later one sorts before any cursor, so a walk is over the rows as they stand. Empty
 * before 0170.
 */
export async function translationPolicyHistory(
  trx: TenantTransaction,
  request: ListingRequest<SortOf<'translationPolicy'>> = { limit: 50 },
): Promise<Listed<TranslationPolicyChange>> {
  const limit = checkedLimit(request.limit);
  const { types, order } = listingSorts.translationPolicy.changed;
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const snapshot = await snapshotFor(trx, request.snapshot);
  if (!(await tableStands(trx, 'translation_policy_change'))) {
    return { items: [], next: null, snapshot };
  }
  const inner = sql`select c.id, c.fallback, c.out_of_date, c.note, c.conflict, c.machine, c.by,
                           pr.display_name, c.at, c.at as sort_key_0, c.at::text as sort_text_0
                      from translation_policy_change c
                      left join principal pr on pr.id = c.by`;
  const { rows, next } = await keysetPage<{
    id: string;
    fallback: TranslationPolicy['fallback'];
    out_of_date: TranslationPolicy['outOfDate'];
    note: Record<string, string>;
    conflict: TranslationPolicy['conflict'];
    machine: TranslationPolicy['machine'];
    by: string | null;
    display_name: string | null;
    at: Date;
  }>(trx, inner, types, request.order ?? order, limit, request.after);
  return {
    items: rows.map((row) => ({
      id: row.id,
      policy: {
        fallback: row.fallback,
        outOfDate: row.out_of_date,
        note: row.note,
        conflict: row.conflict,
        machine: row.machine,
      },
      by: row.by === null ? null : { id: row.by, displayName: row.display_name },
      at: row.at,
    })),
    next,
    snapshot,
  };
}

/** How a reference reads its component (an outline reference's mode). */
export type ReferenceRead =
  | { readonly kind: 'latest' }
  | { readonly kind: 'approved' }
  | { readonly kind: 'pinned'; readonly version: string };

/** What one occurrence resolved to in a language (TR-I). */
export interface InLanguage {
  /** The version to publish: the variant's, or the source's where it falls back or is its own. */
  readonly version: string;
  /** Null where the component is in the language already; else what its variant is. */
  readonly translation: 'translated' | 'outOfDate' | 'untranslated' | null;
  /** The source's language, which a fallen-back component is published in. */
  readonly sourceLanguage: string;
}

/**
 * Each resolved occurrence read in `language` (the TR plan, TR-I; LOC-010): where its source version is
 * in another language, its language line's version for the reference's mode - latest its newest,
 * approved its newest designated, pinned the newest translating the pinned version or an earlier one
 * - else the source, `untranslated`. A variant is `outOfDate` where a source version after the one it
 * translates, up to the one the reference reads, needs retranslating (TR-E, TR-J): declared so, or
 * declaring nothing. The caller decided each source version as the publisher, so reads only those.
 */
export async function resolveInLanguage(
  trx: TenantTransaction,
  occurrences: readonly {
    readonly node: string;
    readonly component: string;
    readonly version: string;
    readonly read: ReferenceRead;
  }[],
  language: string,
  /** The profile the publish reads under, which an approved variant's scope is read in (R15-D). */
  profile: Readonly<Record<string, readonly string[]>> = {},
): Promise<Map<string, InLanguage>> {
  const answer = new Map<string, InLanguage>();
  if (occurrences.length === 0) return answer;
  const sources = await trx
    .selectFrom('artifact_version')
    .select(['id', sql<string>`content ->> 'language'`.as('language')])
    .where('id', 'in', [...new Set(occurrences.map((each) => each.version))])
    .execute();
  const languageOf = new Map(sources.map((row) => [row.id, row.language]));
  const lines = (await translationStored(trx))
    ? await trx
        .selectFrom('artifact_line as l')
        .select(['l.id', 'l.artifact_id', 'l.language'])
        .where('l.artifact_id', 'in', [...new Set(occurrences.map((each) => each.component))])
        .where('l.language', 'is not', null)
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('line_closed as c').select('c.line_id').whereRef('c.line_id', '=', 'l.id'),
            ),
          ),
        )
        .execute()
    : [];
  // A variant serves the language asked for where either is a range of the other, `fr-FR` serving
  // `fr` and `fr` serving `fr-FR`: its exact tag first, else the first by tag (TR-I).
  const serving = lines
    .filter((row) => speaksFor(row.language!, language) || speaksFor(language, row.language!))
    .sort(
      (a, b) =>
        Number(b.language!.toLowerCase() === language.toLowerCase()) -
          Number(a.language!.toLowerCase() === language.toLowerCase()) ||
        a.language!.localeCompare(b.language!),
    );
  const lineOf = new Map<string, string>();
  for (const row of serving) if (!lineOf.has(row.artifact_id)) lineOf.set(row.artifact_id, row.id);
  for (const each of occurrences) {
    const sourceLanguage = languageOf.get(each.version) ?? language;
    if (speaksFor(sourceLanguage, language) || speaksFor(language, sourceLanguage)) {
      answer.set(each.node, { version: each.version, translation: null, sourceLanguage });
      continue;
    }
    const line = lineOf.get(each.component);
    const variant =
      line === undefined
        ? undefined
        : await variantFor(
            trx,
            { id: line, artifact: each.component },
            each.read,
            each.version,
            profile,
          );
    if (!variant) {
      answer.set(each.node, { version: each.version, translation: 'untranslated', sourceLanguage });
      continue;
    }
    const stale = await needsRetranslating(trx, each.component, variant.translates, each.version);
    answer.set(each.node, {
      version: variant.version,
      translation: stale ? 'outOfDate' : 'translated',
      sourceLanguage,
    });
  }
  return answer;
}

/** A language line's version for a reference's mode, and what it translates; undefined if none. */
async function variantFor(
  trx: TenantTransaction,
  line: { readonly id: string; readonly artifact: string },
  read: ReferenceRead,
  source: string,
  profile: Readonly<Record<string, readonly string[]>>,
): Promise<{ readonly version: string; readonly translates: string } | undefined> {
  if (read.kind === 'approved') {
    // As the source's approved revision is read (latestRevisionsOf): one in effect now, and the one
    // effective in the profile's scope; and only a translation of the source version read or an
    // earlier one, never of words not yet approved (the TRb security review).
    const dated = await datesStored(trx);
    const { rows } = await sql<{ revision_no: number; version_id: string; translates: string }>`
      select d.revision_no, d.version_id, s.translates
        from revision_designation d
        join artifact_version v on v.id = d.version_id
        join lateral (
          select x.translates from translation_state x
           where x.line_id = ${line.id}::uuid and x.version_id = d.version_id
           order by x.id desc limit 1
        ) s on true
        join artifact_version t on t.id = s.translates
        join artifact_version r on r.id = ${source}::uuid
       where v.line_id = ${line.id}::uuid
         and (t.revision_no, t.version_no) <= (r.revision_no, r.version_no)
         ${
           dated
             ? sql`and not exists (select 1 from revision_effective e
                                   where e.version_id = d.version_id and e.effective_at > now())`
             : sql``
         }
       order by d.revision_no desc`.execute(trx);
    if (rows.length === 0) return undefined;
    const scopes = await revisionScopes(trx, [line.artifact]);
    const number = effectiveRevision(
      rows.map((row) => ({ number: row.revision_no, scopes: scopes.get(row.version_id) ?? [] })),
      profile,
    );
    const chosen = rows.find((row) => row.revision_no === number);
    return chosen && { version: chosen.version_id, translates: chosen.translates };
  }
  const state = await trx
    .selectFrom('translation_state as s')
    .innerJoin('artifact_version as t', 't.id', 's.translates')
    .select(['s.version_id', 's.translates'])
    .where('s.line_id', '=', line.id)
    .$if(read.kind === 'pinned', (query) =>
      query.where(
        sql<boolean>`(t.revision_no, t.version_no) <= (select p.revision_no, p.version_no from artifact_version p where p.id = ${(read as { version: string }).version}::uuid)`,
      ),
    )
    .orderBy('s.id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return state && { version: state.version_id, translates: state.translates };
}

/**
 * Whether a main-line version after `translates`, up to `source`, needs retranslating (TR-E): its
 * newest declaration says so, or it declares nothing.
 */
async function needsRetranslating(
  trx: TenantTransaction,
  component: string,
  translates: string,
  source: string,
): Promise<boolean> {
  const { rows } = await sql<{ stale: boolean }>`
    select exists (
      select 1
        from artifact_version v
        join artifact_version t on t.id = ${translates}::uuid
        join artifact_version s on s.id = ${source}::uuid
       where v.artifact_id = ${component}::uuid and v.line_id is null
         and (v.revision_no, v.version_no) > (t.revision_no, t.version_no)
         and (v.revision_no, v.version_no) <= (s.revision_no, s.version_no)
         and coalesce((select c.retranslate from source_change c
                        where c.version_id = v.id order by c.id desc limit 1), true)
    ) as stale`.execute(trx);
  return rows[0]?.stale === true;
}

/**
 * **A space's translations** (the TR plan, TR-M; the TE plan, TE-C; LOC-016): each component of it the
 * principal may read with a translation `filter` leaves, a page at a time by its title in the reader's
 * collation and then its id (UI-H), each with those translations. Read-filtered, and filtered by
 * language and status, in SQL before anything is paged (API-058), so no page but the last is short.
 */
export async function spaceTranslations(
  trx: TenantTransaction,
  spaceId: string,
  principalId: string,
  request: ListingRequest<SortOf<'translations'>>,
  filter: TranslationFilter = {},
): Promise<
  Listed<{
    readonly component: { readonly id: string; readonly title: string };
    readonly translations: readonly Translation[];
  }>
> {
  const limit = checkedLimit(request.limit);
  const { types, order } = listingSorts.translations.title;
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const snapshot = await snapshotFor(trx, request.snapshot);
  const readable = await loadReadableSet(trx, principalId);
  if (!UUID.test(spaceId) || !readable || !(await translationStored(trx))) {
    return { items: [], next: null, snapshot };
  }
  const inner = sql`
    select a.id, latest.title, ${sql.join(sortColumns([sql`latest.title`]))}
      from artifact a
      join lateral (
        select v.content ->> 'title' as title from artifact_version v
         where v.artifact_id = a.id and v.line_id is null and ${visibleIn('v.written_by', snapshot)}
         order by v.revision_no desc, v.version_no desc limit 1
      ) latest on true
     where a.space_id = ${spaceId}::uuid and a.kind = 'component'
       and ${readableArtifactsAs('a', readable)}
       and ${(await deletionStored(trx)) ? notDeletedAs('a') : sql`true`}
       and exists (select 1 from (${await translationLines(trx)}) as t
                    where t.artifact_id = a.id and ${filtered(filter)})`;
  const { rows, next } = await keysetPage<{ id: string; title: string }>(
    trx,
    inner,
    types,
    request.order ?? order,
    limit,
    request.after,
    request.language,
  );
  const statuses = await translationsOf(
    trx,
    rows.map((row) => row.id),
    filter,
  );
  return {
    items: rows.map((row) => ({
      component: { id: row.id, title: row.title },
      translations: statuses.get(row.id) ?? [],
    })),
    next,
    snapshot,
  };
}
