import { sql } from 'kysely';
import {
  createFromResolution,
  resolvedFrom,
  resolveForDocument,
  type TemplateResolution,
} from './documents.js';
import { outlineDocumentSchema } from '@alloy-works/domain';
import { loadReadableSet } from './access-facts.js';
import {
  checkedLimit,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { enqueueJob } from './queue.js';
import { mayReadArtifact } from './queryDefinitions.js';
import { inSavepoint } from './savepoint.js';
import type { StoredJob } from './jobs.js';
import { readJob } from './jobs.js';
import type { TenantTransaction } from './tables.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The most rows one cohort takes (the R7 plan, R7-B). */
export const COHORT_ROWS_MAX = 1000;

/** Where a cohort's rows came from (R7-B). */
export type CohortSource = { readonly rows: number } | { readonly dataset: string };

export type CohortRowState = 'pending' | 'made' | 'failed';

/** Why a row was not made: the refusal's code and what it names (REU-033; R7-E). */
export interface CohortRowFailure {
  readonly code: string;
  readonly message: string;
  readonly [detail: string]: unknown;
}

export interface CohortRow {
  readonly row: number;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly state: CohortRowState;
  readonly document: string | null;
  readonly failure: CohortRowFailure | null;
  readonly attempts: number;
}

/** A cohort, found again (REU-034; R7-G): what it was made from, and every row's outcome. */
export interface StoredCohort {
  readonly id: string;
  readonly spaceId: string;
  readonly template: { readonly id: string; readonly version: string };
  readonly resolution: TemplateResolution;
  readonly title: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly source: CohortSource;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly rows: readonly CohortRow[];
}

export type CohortAnswer =
  | { readonly answer: 'submitted'; readonly cohort: StoredCohort; readonly job: StoredJob }
  | { readonly answer: 'space.missing' }
  | { readonly answer: 'content.invalid' }
  | { readonly answer: 'template.missing' }
  | { readonly answer: 'template.unresolved'; readonly unresolved: readonly unknown[] }
  | { readonly answer: 'rows.invalid'; readonly detail: string }
  /** Its required components run queries, which a worker holding no connector cannot (R9-F). */
  | { readonly answer: 'cohort.bound'; readonly queries: readonly string[] };

/** A job over a cohort's pending rows, queued in the caller's transaction (R7-E, R7-F). */
async function runRows(
  trx: TenantTransaction,
  cohort: string,
  by: string,
  rows: number,
): Promise<StoredJob> {
  const { rows: made } = await sql<{ id: string }>`
    insert into api_job (kind, subject_id, parameters, requested_by)
    values ('cohort', ${cohort}, ${JSON.stringify({ rows })}::jsonb, ${by})
    returning id`.execute(trx);
  const id = made[0]!.id;
  await enqueueJob(trx, 'cohort', id);
  return (await readJob(trx, id, by))!;
}

/**
 * A cohort asked for (REU-031, REU-032, REU-051; the R7 plan, R7-A to R7-D): its template resolved now,
 * once, and kept with it; its rows recorded, every one pending; and the job that makes them queued, in
 * the caller's transaction. Who may create in the space is the caller's to have decided. Refused before
 * anything is written where the template cannot be read or resolved, or the rows are none, too many, or
 * not each a set of parameters.
 */
export async function submitCohort(
  trx: TenantTransaction,
  input: {
    readonly by: string;
    readonly spaceId: string;
    readonly template: string;
    readonly title: string;
    readonly language: string;
    readonly direction: 'ltr' | 'rtl';
    readonly rows: readonly Readonly<Record<string, unknown>>[];
    readonly source: CohortSource;
  },
): Promise<CohortAnswer> {
  if (!UUID.test(input.spaceId)) return { answer: 'space.missing' };
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };
  // Every row's document takes these, so they are held to the outline's own rules once, here: a run
  // would otherwise fail every row on them, and not as a refusal (the R7 final review).
  if (
    !outlineDocumentSchema.shape.language.safeParse(input.language).success ||
    !outlineDocumentSchema.shape.direction.safeParse(input.direction).success
  ) {
    return { answer: 'content.invalid' };
  }
  if (input.rows.length === 0) return { answer: 'rows.invalid', detail: 'none' };
  if (input.rows.length > COHORT_ROWS_MAX) {
    return { answer: 'rows.invalid', detail: `more than ${COHORT_ROWS_MAX}` };
  }
  const resolved = await resolveForDocument(trx, input.by, input.template);
  if (resolved.answer !== 'resolved') return resolved;
  // The worker holds no connector (DAT-088): a template whose components run queries waits (R9-F).
  const computed = resolvedFrom(resolved.resolution);
  if (computed.ok && computed.querySet.length > 0) {
    return { answer: 'cohort.bound', queries: computed.querySet };
  }
  const { rows: made } = await sql<{ id: string }>`
    insert into cohort (space_id, template_id, resolution, title, language, direction, source,
                        requested_by)
    values (${input.spaceId}, ${resolved.resolution.template.id},
            ${JSON.stringify(resolved.resolution)}::jsonb, ${input.title}, ${input.language},
            ${input.direction}, ${JSON.stringify(input.source)}::jsonb, ${input.by})
    returning id`.execute(trx);
  const cohort = made[0]!.id;
  await trx
    .insertInto('cohort_row')
    .values(
      input.rows.map((parameters, at) => ({
        cohort_id: cohort,
        row_no: at + 1,
        parameters: JSON.stringify(parameters),
      })),
    )
    .execute();
  const job = await runRows(trx, cohort, input.by, input.rows.length);
  return { answer: 'submitted', cohort: (await readCohort(trx, cohort))!, job };
}

/**
 * A cohort as a reader is shown it (REU-034; R7-G, the R7 final review): each made row's document
 * named only where the reader may read it, null otherwise.
 */
export async function readCohortAs(
  trx: TenantTransaction,
  id: string,
  by: string,
): Promise<StoredCohort | undefined> {
  const cohort = await readCohort(trx, id);
  if (!cohort) return undefined;
  const readable = await loadReadableSet(trx, by);
  return {
    ...cohort,
    rows: cohort.rows.map((each) =>
      each.document !== null &&
      (readable === undefined ||
        !mayReadArtifact(readable, { id: each.document, spaceId: cohort.spaceId }))
        ? { ...each, document: null }
        : each,
    ),
  };
}

/** A cohort and its rows in order, or undefined where this environment holds none by that id. */
export async function readCohort(
  trx: TenantTransaction,
  id: string,
): Promise<StoredCohort | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx.selectFrom('cohort').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) return undefined;
  const rows = await trx
    .selectFrom('cohort_row')
    .selectAll()
    .where('cohort_id', '=', id)
    .orderBy('row_no')
    .execute();
  const resolution = row.resolution as TemplateResolution;
  return {
    id: row.id,
    spaceId: row.space_id,
    template: resolution.template,
    resolution,
    title: row.title,
    language: row.language,
    direction: row.direction as 'ltr' | 'rtl',
    source: row.source as CohortSource,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    rows: rows.map((each) => ({
      row: each.row_no,
      parameters: each.parameters as Record<string, unknown>,
      state: each.state as CohortRowState,
      document: each.document_id,
      failure: (each.failure ?? null) as CohortRowFailure | null,
      attempts: each.attempts,
    })),
  };
}

/** Whether a run of the cohort is waiting or running: it will make the cohort's pending rows. */
async function running(trx: TenantTransaction, cohort: string): Promise<boolean> {
  const { rows } = await sql<{ id: string }>`
    select id from api_job
     where kind = 'cohort' and subject_id = ${cohort} and state in ('accepted', 'running')
     limit 1`.execute(trx);
  return rows.length > 0;
}

/**
 * The failed rows run again (REU-035; R7-F): each set pending, from the same resolution, by a new job,
 * with the corrected parameters given for it, if any; a made row is never touched. Rows a cancelled or
 * failed run left pending are run too, where no run is waiting or running to make them (the R7 final
 * review). `none.failed` where there is nothing to run; `rows.invalid` where a correction names a row
 * that has not failed.
 */
export async function rerunCohort(
  trx: TenantTransaction,
  id: string,
  by: string,
  corrections: Readonly<Record<number, Readonly<Record<string, unknown>>>> = {},
): Promise<
  | { readonly answer: 'submitted'; readonly job: StoredJob }
  | { readonly answer: 'missing' }
  | { readonly answer: 'none.failed' }
  | { readonly answer: 'rows.invalid'; readonly detail: string }
> {
  const cohort = await readCohort(trx, id);
  if (!cohort) return { answer: 'missing' };
  const failed = new Set(
    cohort.rows.filter((each) => each.state === 'failed').map((each) => each.row),
  );
  const stray = Object.keys(corrections)
    .map(Number)
    .filter((row) => !failed.has(row));
  if (stray.length > 0)
    return { answer: 'rows.invalid', detail: `not failed: ${stray.join(', ')}` };
  for (const [row, parameters] of Object.entries(corrections)) {
    await trx
      .updateTable('cohort_row')
      .set({ parameters: JSON.stringify(parameters) })
      .where('cohort_id', '=', id)
      .where('row_no', '=', Number(row))
      .where('state', '=', 'failed')
      .execute();
  }
  const reset = await trx
    .updateTable('cohort_row')
    .set({ state: 'pending', failure: null })
    .where('cohort_id', '=', id)
    .where('state', '=', 'failed')
    .executeTakeFirst();
  const left = (await running(trx, id))
    ? 0
    : cohort.rows.filter((each) => each.state === 'pending').length;
  const count = Number(reset.numUpdatedRows) + left;
  if (count === 0) return { answer: 'none.failed' };
  return { answer: 'submitted', job: await runRows(trx, id, by, count) };
}

/** A title from the cohort's pattern: `{name}` is the row's value for the parameter, lists joined. */
export function titleFor(pattern: string, parameters: Readonly<Record<string, unknown>>): string {
  return pattern.replace(/\{([a-z][a-z0-9_]*)\}/gi, (_, name: string) => {
    const value = parameters[name];
    if (Array.isArray(value)) return value.map(String).join(', ');
    return value === undefined || value === null ? '' : String(value);
  });
}

/** What a refusal says of a row, in words the cohort's page shows by its code. */
const ROW_WORDS: Readonly<Record<string, string>> = {
  'content.invalid': 'Its title comes out empty or not one a document can take.',
  'parameter.unknown': 'It gives a value for a parameter the template does not declare.',
  'parameter.invalid': 'A value it gives does not fit its parameter.',
  'parameter.unused': 'The template has a parameter that feeds nothing.',
  'parameter.field': 'A parameter no longer fits the field it fills.',
  'template.unresolved': 'What the template names no longer resolves.',
};

/**
 * One pending row made (REU-033, TPL-039; R7-E): its document from the cohort's resolution, in a
 * savepoint, so a refusal leaves nothing of it and is recorded as the row's failure; the row's outcome
 * written beside it. Answers what became of it; a row no longer pending is left as it is.
 */
export async function makeCohortRow(
  trx: TenantTransaction,
  cohort: StoredCohort,
  row: number,
): Promise<CohortRowState | undefined> {
  const held = await trx
    .selectFrom('cohort_row')
    .select(['parameters', 'state', 'attempts'])
    .where('cohort_id', '=', cohort.id)
    .where('row_no', '=', row)
    .forUpdate()
    .executeTakeFirst();
  if (!held || held.state !== 'pending') return undefined;
  const parameters = held.parameters as Record<string, unknown>;
  const answer = await inSavepoint(trx, async () => {
    const made = await createFromResolution(
      trx,
      {
        spaceId: cohort.spaceId,
        title: titleFor(cohort.title, parameters),
        language: cohort.language,
        direction: cohort.direction,
        author: cohort.requestedBy,
        parameters,
      },
      cohort.resolution,
    );
    // A refusal wrote nothing, but is rolled back to here all the same: nothing of the row is kept.
    if (made.answer !== 'created') throw new RowRefused(made);
    return made;
  }).catch((cause: unknown) => {
    if (cause instanceof RowRefused) return cause.refusal;
    throw cause;
  });
  const attempts = held.attempts + 1;
  if ('version' in answer) {
    await trx
      .updateTable('cohort_row')
      .set({ state: 'made', document_id: answer.version.artifactId, failure: null, attempts })
      .where('cohort_id', '=', cohort.id)
      .where('row_no', '=', row)
      .execute();
    return 'made';
  }
  const { answer: code, ...detail } = answer as { answer: string } & Record<string, unknown>;
  const failure: CohortRowFailure = {
    ...detail,
    code,
    message: ROW_WORDS[code] ?? 'It could not be made.',
  };
  await trx
    .updateTable('cohort_row')
    .set({ state: 'failed', failure: JSON.stringify(failure), attempts })
    .where('cohort_id', '=', cohort.id)
    .where('row_no', '=', row)
    .execute();
  return 'failed';
}

/** A refusal carried out of the savepoint, so it is rolled back to and still answered. */
class RowRefused extends Error {
  constructor(readonly refusal: { readonly answer: string }) {
    super(refusal.answer);
  }
}

/** The rows of a cohort still pending, in order: what a run makes. */
export async function pendingRows(trx: TenantTransaction, cohort: string): Promise<number[]> {
  const rows = await trx
    .selectFrom('cohort_row')
    .select('row_no')
    .where('cohort_id', '=', cohort)
    .where('state', '=', 'pending')
    .orderBy('row_no')
    .execute();
  return rows.map((each) => each.row_no);
}

/** A cohort as a listing shows it (SCH-065): what it is, where, from what, and how its rows stand. */
export interface CohortSummary {
  readonly id: string;
  readonly title: string;
  readonly template: { readonly id: string; readonly version: string; readonly name: string };
  readonly space: { readonly id: string; readonly name: string };
  readonly requestedAt: Date;
  readonly rows: { readonly made: number; readonly failed: number; readonly pending: number };
}

/** How a cohort stands: failed where a row failed, pending where one waits, else complete. */
export type CohortState = 'complete' | 'failed' | 'pending';

/**
 * **The cohorts a principal may read** (SCH-065, TPL-040; the R14 plan, R14-A): those in a space they
 * may read, a page at a time by keyset over the sort asked for and then the id, as of the walk's first
 * snapshot, filtered by template and by state. Undefined where the tenant holds no such principal.
 */
export async function listReadableCohorts(
  trx: TenantTransaction,
  principalId: string,
  request: ListingRequest<SortOf<'cohorts'>> = { limit: 100 },
  filter: { readonly template?: string; readonly state?: CohortState } = {},
): Promise<Listed<CohortSummary> | undefined> {
  const limit = checkedLimit(request.limit);
  const sort = request.sort ?? 'requested';
  const { types, order: byDefault } = listingSorts.cohorts[sort];
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const snapshot = await snapshotFor(trx, request.snapshot);
  const spaces = [...readable.spaces];
  const counted = sql<number>`(select count(*) from cohort_row r where r.cohort_id = c.id`;
  let inner = trx
    .selectFrom('cohort as c')
    .innerJoin('space as s', 's.id', 'c.space_id')
    .select([
      'c.id',
      'c.title',
      'c.requested_at',
      's.id as space_id',
      's.name as space_name',
      sql<string>`c.resolution -> 'template' ->> 'id'`.as('template_id'),
      sql<string>`c.resolution -> 'template' ->> 'version'`.as('template_version'),
      sql<string>`coalesce(c.resolution -> 'definition' ->> 'name', '')`.as('template_name'),
      sql<number>`${counted} and r.state = 'made')::integer`.as('made'),
      sql<number>`${counted} and r.state = 'failed')::integer`.as('failed'),
      sql<number>`${counted} and r.state = 'pending')::integer`.as('pending'),
    ])
    .select(sortColumns([sort === 'title' ? sql`c.title` : sql`c.requested_at`]))
    // A cohort is made, never changed, so a later one is the only thing a walk could meet: it is left
    // to the keyset, which a newer row sorts before when the walk is newest first.
    .where(
      spaces.length === 0 ? sql<boolean>`false` : sql<boolean>`c.space_id = any(${spaces}::uuid[])`,
    );
  if (filter.template !== undefined) {
    inner = inner.where(sql<boolean>`c.resolution -> 'template' ->> 'id' = ${filter.template}`);
  }
  if (filter.state === 'failed') inner = inner.where(sql<boolean>`${counted} and r.state = 'failed') > 0`);
  if (filter.state === 'pending') {
    inner = inner.where(sql<boolean>`${counted} and r.state = 'failed') = 0 and ${counted} and r.state = 'pending') > 0`);
  }
  if (filter.state === 'complete') {
    inner = inner.where(sql<boolean>`${counted} and r.state <> 'made') = 0`);
  }
  const { rows, next } = await keysetPage<{
    id: string;
    title: string;
    requested_at: Date;
    space_id: string;
    space_name: string;
    template_id: string;
    template_version: string;
    template_name: string;
    made: number;
    failed: number;
    pending: number;
  }>(trx, inner, types, request.order ?? byDefault, limit, request.after);
  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      template: { id: row.template_id, version: row.template_version, name: row.template_name },
      space: { id: row.space_id, name: row.space_name },
      requestedAt: row.requested_at,
      rows: { made: row.made, failed: row.failed, pending: row.pending },
    })),
    next,
    snapshot,
  };
}
