import {
  DEFAULT_TRANSLATION_POLICY,
  effectiveRevision,
  speaksFor,
  blockText,
  parseContentDocument,
  sourceChangesBetween,
  translationLanguageRefusal,
  translationStatus,
  type SourceChange,
  type TranslationPolicy,
  type TranslationStatus,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { artifactPlace, recordEvent } from './audit.js';
import { datesStored } from './dates.js';
import { readableComponents } from './documents.js';
import { diverge, readLine, translationStored, type Line } from './lines.js';
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

/** Whether 0165 has run, so lines may be marked machine drafted (XL-I). */
async function machineDraftsKnown(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('machine_draft') is not null as present`.execute(trx);
  return rows[0]?.present === true;
}

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
 * Each of these components' open translations with its status (TR-E; LOC-013, LOC-014, LOC-015), by
 * language: out of date the moment a main-line version follows what it translates, needing
 * retranslation where any such version is declared so or declares nothing; in translation while an
 * open job's item holds it out (XL-E).
 */
export async function translationsOf(
  trx: TenantTransaction,
  artifactIds: readonly string[],
): Promise<Map<string, Translation[]>> {
  const ids = [...new Set(artifactIds.filter((id) => UUID.test(id)))];
  if (ids.length === 0 || !(await translationStored(trx))) return new Map();
  const { rows } = await sql<{
    line: string;
    artifact_id: string;
    language: string;
    head: string | null;
    translates: string | null;
    later: boolean[];
    in_translation: boolean;
    machine_drafted: boolean;
  }>`
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
     where l.artifact_id = any(${ids}::uuid[]) and l.language is not null
       and not exists (select 1 from line_closed c where c.line_id = l.id)
     order by l.artifact_id, l.language`.execute(trx);
  const found = new Map<string, Translation[]>();
  for (const row of rows) {
    const translation: Translation = {
      line: row.line,
      language: row.language,
      head: row.head,
      translates: row.translates,
      status: translationStatus({
        translates: row.translates,
        laterSource: row.later.map((retranslate) => ({ retranslate })),
        inTranslation: row.in_translation,
        machineDrafted: row.machine_drafted,
      }),
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
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('translation_policy') is not null as present`.execute(trx);
  if (rows[0]?.present !== true) return DEFAULT_TRANSLATION_POLICY;
  const found = await sql<{
    fallback: TranslationPolicy['fallback'];
    out_of_date: TranslationPolicy['outOfDate'];
    note: Record<string, string>;
    conflict: TranslationPolicy['conflict'] | null;
    machine: TranslationPolicy['machine'] | null;
  }>`select fallback, out_of_date, note, to_jsonb(p) ->> 'conflict' as conflict,
            to_jsonb(p) ->> 'machine' as machine
       from translation_policy p`.execute(trx);
  const row = found.rows[0];
  return row
    ? {
        fallback: row.fallback,
        outOfDate: row.out_of_date,
        note: row.note,
        // Before 0164, a conflicted return was not yet a thing: placed for review, its default.
        conflict: row.conflict ?? DEFAULT_TRANSLATION_POLICY.conflict,
        // Before 0165, nothing was sent to a machine: off, its default.
        machine: row.machine ?? DEFAULT_TRANSLATION_POLICY.machine,
      }
    : DEFAULT_TRANSLATION_POLICY;
}

/**
 * The tenant's translation policy set, whole but for a conflict left out, which stays as it is; the
 * caller decided `administer` at the tenant.
 */
export async function setTranslationPolicy(
  trx: TenantTransaction,
  policy: Omit<TranslationPolicy, 'conflict' | 'machine'> & {
    readonly conflict?: TranslationPolicy['conflict'] | undefined;
    readonly machine?: TranslationPolicy['machine'] | undefined;
  },
): Promise<TranslationPolicy> {
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
  return translationPolicy(trx);
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

/** The most components a space's translation report names (API-058): capped, and said so. */
export const TRANSLATION_REPORT_MOST = 500;

/**
 * **A space's translations** (the TR plan, TR-M; LOC-016): each component of it the principal may
 * read that has a translation, by its title, with each translation's status - filtered to what may
 * be read before anything is counted or capped - at most `TRANSLATION_REPORT_MOST`, and whether more.
 */
export async function spaceTranslations(
  trx: TenantTransaction,
  spaceId: string,
  principalId: string,
): Promise<{
  readonly items: readonly {
    readonly component: { readonly id: string; readonly title: string };
    readonly translations: readonly Translation[];
  }[];
  readonly capped: boolean;
}> {
  if (!UUID.test(spaceId) || !(await translationStored(trx))) return { items: [], capped: false };
  const held = await trx
    .selectFrom('artifact_line as l')
    .innerJoin('artifact as a', 'a.id', 'l.artifact_id')
    .select('l.artifact_id')
    .distinct()
    .where('a.space_id', '=', spaceId)
    .where('l.language', 'is not', null)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('line_closed as c').select('c.line_id').whereRef('c.line_id', '=', 'l.id'),
        ),
      ),
    )
    .execute();
  const readable = await readableComponents(
    trx,
    principalId,
    held.map((row) => row.artifact_id),
  );
  const ids = [...readable];
  const titles = await trx
    .selectFrom('artifact_version as v')
    .select(['v.artifact_id', sql<string>`v.content ->> 'title'`.as('title')])
    .distinctOn('v.artifact_id')
    .where('v.artifact_id', 'in', ids.length === 0 ? ['00000000-0000-4000-8000-000000000000'] : ids)
    .where('v.line_id', 'is', null)
    .orderBy('v.artifact_id')
    .orderBy('v.revision_no', 'desc')
    .orderBy('v.version_no', 'desc')
    .execute();
  // Ordered and capped before any status is read, so the cap bounds the work (the TR final review).
  const ordered = [...titles].sort(
    (a, b) => a.title.localeCompare(b.title) || a.artifact_id.localeCompare(b.artifact_id),
  );
  const named = ordered.slice(0, TRANSLATION_REPORT_MOST);
  const statuses = await translationsOf(
    trx,
    named.map((row) => row.artifact_id),
  );
  return {
    items: named.map((row) => ({
      component: { id: row.artifact_id, title: row.title },
      translations: statuses.get(row.artifact_id) ?? [],
    })),
    capped: ordered.length > TRANSLATION_REPORT_MOST,
  };
}
