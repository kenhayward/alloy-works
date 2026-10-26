import type { ContentDocument } from '@alloy-works/domain';
import { sql } from 'kysely';
import { artifactPlace, recordEvent } from './audit.js';
import { readLine } from './lines.js';
import { cutReturned, type ReturnedAnswer } from './promotion.js';
import type { TenantTransaction } from './tables.js';

/**
 * **Machine drafts** (docs/design/translation.md, "Machine drafts"; the XL plan, XL-I): a version a
 * machine drafted, cut by the one write path for words that come from outside (`cutReturned`) and
 * marked with the runs that made it and the terms it missed. The mark is carried to every later
 * version of its line - an edit or Mark current does not lift it - until a person with approve
 * accepts the line. Whether the caller may is theirs to have decided.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether 0165 has run; a tenant before it holds no draft. */
export async function machineDraftsStored(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('machine_draft') is not null as present`.execute(trx);
  return rows[0]?.present === true;
}

/** A machine draft's version cut on its line and marked (XL-H, XL-I). */
export async function recordMachineDraft(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly line: string;
    readonly content: ContentDocument;
    readonly translates: string;
    readonly runs: readonly string[];
    readonly missedTerms: readonly string[];
    readonly by: string;
    /** The line's head and the source as the draft read them: a cut on anything else is refused. */
    readonly expect?: { readonly head: string | null; readonly source: string };
  },
): Promise<ReturnedAnswer> {
  const cut = await cutReturned(trx, input);
  if (cut.answer !== 'recorded') return cut;
  await trx
    .insertInto('machine_draft')
    .values({
      version_id: cut.version.id,
      line_id: input.line,
      runs: [...input.runs],
      missed_terms: [...input.missedTerms],
      by: input.by,
    })
    .execute();
  return cut;
}

/** A line's newest machine draft not yet accepted: its version, and the terms it missed. */
export async function openMachineDraft(
  trx: TenantTransaction,
  line: string,
): Promise<{ readonly version: string; readonly missedTerms: readonly string[] } | undefined> {
  if (!UUID.test(line) || !(await machineDraftsStored(trx))) return undefined;
  const row = await trx
    .selectFrom('machine_draft as d')
    .innerJoin('artifact_version as v', 'v.id', 'd.version_id')
    .select(['d.version_id', 'd.missed_terms'])
    .where('d.line_id', '=', line)
    .where('d.accepted_at', 'is', null)
    .orderBy('v.version_no', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row && { version: row.version_id, missedTerms: row.missed_terms };
}

export type AcceptDraftsAnswer =
  | { readonly answer: 'accepted'; readonly drafts: number }
  | { readonly answer: 'line.missing' | 'translation.nothing_drafted' };

/**
 * **A line's machine drafts accepted** (XL-I; LOC-024, LOC-041) by a person with approve on the
 * component: every one not yet accepted, so the line's versions are no longer marked. Audited
 * `translation.machine_accepted`.
 */
export async function acceptMachineDrafts(
  trx: TenantTransaction,
  input: { readonly artifactId: string; readonly line: string; readonly by: string },
): Promise<AcceptDraftsAnswer> {
  const line = await readLine(trx, input.artifactId, input.line);
  if (!line || line.closed || line.language === null) return { answer: 'line.missing' };
  if (!(await machineDraftsStored(trx))) return { answer: 'translation.nothing_drafted' };
  const accepted = await trx
    .updateTable('machine_draft')
    .set({ accepted_by: input.by, accepted_at: new Date() })
    .where('line_id', '=', line.id)
    .where('accepted_at', 'is', null)
    .returning('version_id')
    .execute();
  if (accepted.length === 0) return { answer: 'translation.nothing_drafted' };
  const place = await artifactPlace(trx, input.artifactId);
  await recordEvent(
    trx,
    {
      kind: 'translation.machine_accepted',
      subject: { kind: 'component', id: input.artifactId, version: place.version },
      space: place.space,
      detail: { line: line.id, language: line.language, drafts: accepted.length },
    },
    place.labels,
  );
  return { answer: 'accepted', drafts: accepted.length };
}

/**
 * Of these versions, those a machine drafted or that follow one on its line not yet accepted (XL-I):
 * what a publish refuses (`translation_machine_drafted`).
 */
export async function machineMarked(
  trx: TenantTransaction,
  versions: readonly string[],
): Promise<ReadonlySet<string>> {
  const asked = [...new Set(versions.filter((id) => UUID.test(id)))];
  if (asked.length === 0 || !(await machineDraftsStored(trx))) return new Set();
  const { rows } = await sql<{ id: string }>`
    select v.id from artifact_version v
     where v.id = any(${asked}::uuid[]) and v.line_id is not null
       and exists (
         select 1 from machine_draft d
           join artifact_version m on m.id = d.version_id
          where d.line_id = v.line_id and d.accepted_at is null
            and m.version_no <= v.version_no)`.execute(trx);
  return new Set(rows.map((row) => row.id));
}
