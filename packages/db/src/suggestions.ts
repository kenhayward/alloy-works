import { randomBytes } from 'node:crypto';
import {
  applySuggestion,
  blockIdentifierFrom,
  canonicaliseVersionContent,
  carryForward,
  definitionsFor,
  labelFor,
  validate,
  type ContentDocument,
  type MetadataFailure,
  type StalePlace,
  type VersionSubstance,
} from '@alloy-works/domain';
import { personView, type PersonView } from './person-view.js';
import { sql } from 'kysely';
import { AUDIT_LOG_KEPT, labelled, labels, recordEvent } from './audit.js';
import { componentFieldsNow } from './component-values.js';
import { readLock, serialise, type LockState } from './editing.js';
import type { TenantTransaction } from './tables.js';
import { sha256Hex } from './version-digest.js';
import { latestVersion, readVersion, recordVersion, type StoredVersion } from './versions.js';

/** How many suggestions one person may have pending on one component (SG-A). */
export const PENDING_PER_AUTHOR = 20;

type Person = PersonView;

/** A suggestion as stored (collaboration.md, Suggestions): the draft whole, and how it ended. */
export interface StoredSuggestion {
  readonly id: string;
  readonly component: string;
  readonly madeAgainst: string;
  readonly proposed: ContentDocument;
  readonly madeBy: Person;
  readonly madeAt: Date;
  readonly resolution: {
    readonly act: 'accepted' | 'rejected' | 'withdrawn';
    readonly by: Person;
    readonly at: Date;
    readonly version: string | null;
  } | null;
}

export type MakeAnswer =
  | { readonly answer: 'made'; readonly suggestion: string }
  /** The version is not one of the component's. */
  | { readonly answer: 'missing' }
  /** The draft is the version it was made against (SG-B). */
  | { readonly answer: 'suggestion.empty' }
  /** The maker has too many pending on this component (SG-A). */
  | { readonly answer: 'suggestion.limit' }
  /** The same draft was sent before and is resolved: it is not made again (the SG final review). */
  | { readonly answer: 'suggestion.resolved' };

export type ResolveAnswer =
  | { readonly answer: 'accepted'; readonly version: StoredVersion }
  | { readonly answer: 'rejected' }
  | { readonly answer: 'withdrawn' }
  | { readonly answer: 'missing' }
  | { readonly answer: 'suggestion.resolved' }
  | { readonly answer: 'suggestion.not_yours' }
  /** Another holds the component (COL-042). */
  | { readonly answer: 'lock.held'; readonly lock: LockState }
  /** The caller holds it, with saved work after the current version (SG-F). */
  | { readonly answer: 'edits.pending' }
  | { readonly answer: 'suggestion.stale'; readonly stale: readonly StalePlace[] }
  | { readonly answer: 'values.invalid'; readonly failures: readonly MetadataFailure[] };

/** The draft's digest: a second send of one draft is the first (SG-A). */
export function proposedDigest(content: ContentDocument): string {
  return sha256Hex(
    canonicaliseVersionContent({
      kind: 'component',
      content,
      values: {},
      notCarried: [],
      definitions: [],
    } as VersionSubstance),
  );
}

async function recordSuggestionEvent(
  trx: TenantTransaction,
  kind: 'suggestion.made' | 'suggestion.accepted' | 'suggestion.rejected' | 'suggestion.withdrawn',
  suggestion: string,
  detail: Readonly<Record<string, unknown>>,
): Promise<void> {
  const row = await trx
    .selectFrom('suggestion as g')
    .innerJoin('artifact_version as v', 'v.id', 'g.made_against')
    .innerJoin('artifact as a', 'a.id', 'g.component_id')
    .leftJoin('space as s', 's.id', 'a.space_id')
    .select([
      'g.component_id',
      'g.made_against',
      'v.content',
      'a.space_id',
      's.name as space_name',
      AUDIT_LOG_KEPT.as('logged'),
    ])
    .where('g.id', '=', suggestion)
    .executeTakeFirstOrThrow();
  if (row.logged === false) return;
  await recordEvent(
    trx,
    {
      kind,
      subject: { kind: 'component', id: row.component_id, version: row.made_against },
      space: row.space_id,
      detail,
    },
    labels(
      labelled(
        'subject',
        labelFor('component', row.content as Record<string, unknown>),
        row.component_id,
      ),
      labelled('space', row.space_name, row.space_id),
    ),
  );
}

/**
 * A suggestion made (COL-020, COL-021): the reviewer's draft of `component`, made against one of its
 * versions, kept beside it with no lock (COL-025). The caller has parsed the draft and run the save's
 * checks on it (SG-B). A second send of one draft answers the first.
 */
export async function makeSuggestion(
  trx: TenantTransaction,
  input: {
    readonly component: string;
    readonly version: string;
    readonly proposed: ContentDocument;
    readonly by: string;
  },
): Promise<MakeAnswer> {
  const version = await readVersion(trx, input.version);
  if (!version || version.kind !== 'component' || version.artifactId !== input.component) {
    return { answer: 'missing' };
  }
  const digest = proposedDigest(input.proposed);
  if (digest === proposedDigest(version.content as ContentDocument)) {
    return { answer: 'suggestion.empty' };
  }
  await serialise(trx, input.component);
  const again = await trx
    .selectFrom('suggestion as g')
    .leftJoin('suggestion_resolution as r', 'r.suggestion_id', 'g.id')
    .select(['g.id', 'r.act'])
    .where('g.component_id', '=', input.component)
    .where('g.made_by', '=', input.by)
    .where('g.made_against', '=', input.version)
    .where('g.proposed_digest', '=', digest)
    .executeTakeFirst();
  if (again) {
    return again.act === null
      ? { answer: 'made', suggestion: again.id }
      : { answer: 'suggestion.resolved' };
  }
  const pending = await trx
    .selectFrom('suggestion as g')
    .leftJoin('suggestion_resolution as r', 'r.suggestion_id', 'g.id')
    .select((eb) => eb.fn.countAll<string>().as('pending'))
    .where('g.component_id', '=', input.component)
    .where('g.made_by', '=', input.by)
    .where('r.suggestion_id', 'is', null)
    .executeTakeFirstOrThrow();
  if (Number(pending.pending) >= PENDING_PER_AUTHOR) return { answer: 'suggestion.limit' };
  const made = await trx
    .insertInto('suggestion')
    .values({
      component_id: input.component,
      made_against: input.version,
      proposed: JSON.stringify(input.proposed),
      proposed_digest: digest,
      made_by: input.by,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await recordSuggestionEvent(trx, 'suggestion.made', made.id, {
    suggestion: made.id,
    against: input.version,
  });
  return { answer: 'made', suggestion: made.id };
}

const suggestionColumns = [
  'g.id',
  'g.component_id',
  'g.made_against',
  'g.proposed',
  'g.made_by',
  'm.display_name as made_name',
  'm.kind as made_kind',
  'g.made_at',
  'r.act',
  'r.resolved_by',
  'rp.display_name as resolved_name',
  'rp.kind as resolved_kind',
  'r.resolved_at',
  'r.version_id',
] as const;

function suggestionsFrom(trx: TenantTransaction) {
  return trx
    .selectFrom('suggestion as g')
    .innerJoin('principal as m', 'm.id', 'g.made_by')
    .leftJoin('suggestion_resolution as r', 'r.suggestion_id', 'g.id')
    .leftJoin('principal as rp', 'rp.id', 'r.resolved_by')
    .select(suggestionColumns);
}

type Row = Awaited<ReturnType<ReturnType<typeof suggestionsFrom>['execute']>>[number];

const storedOf = (row: Row): StoredSuggestion => ({
  id: row.id,
  component: row.component_id,
  madeAgainst: row.made_against,
  proposed: row.proposed as ContentDocument,
  madeBy: personView(row.made_by, row.made_name, row.made_kind),
  madeAt: row.made_at,
  resolution:
    row.act === null
      ? null
      : {
          act: row.act,
          by: personView(row.resolved_by!, row.resolved_name, row.resolved_kind),
          at: row.resolved_at!,
          version: row.version_id,
        },
});

/** A suggestion read whole, or none. */
export async function readSuggestion(
  trx: TenantTransaction,
  id: string,
): Promise<StoredSuggestion | undefined> {
  const row = await suggestionsFrom(trx).where('g.id', '=', id).executeTakeFirst();
  return row && storedOf(row);
}

/** What a suggestion is on, which a route on it is decided on, or none. */
export async function suggestionOn(
  trx: TenantTransaction,
  id: string,
): Promise<string | undefined> {
  const row = await trx
    .selectFrom('suggestion')
    .select('component_id')
    .where('id', '=', id)
    .executeTakeFirst();
  return row?.component_id;
}

/**
 * The suggestions on these components (COL-022), newest first and paged by when made and id,
 * filtered by state and by who made them. Who may read which is the caller's to have decided.
 */
export async function listSuggestions(
  trx: TenantTransaction,
  input: {
    readonly on: readonly string[];
    readonly state?: 'pending' | 'resolved';
    readonly author?: string;
    readonly after?: { readonly at: Date; readonly id: string };
    readonly limit?: number;
  },
): Promise<StoredSuggestion[]> {
  if (input.on.length === 0) return [];
  // Keyed to the millisecond a cursor can carry, not Postgres' microsecond.
  const made = sql<Date>`date_trunc('milliseconds', g.made_at)`;
  let query = suggestionsFrom(trx).where('g.component_id', 'in', [...input.on]);
  if (input.state === 'pending') query = query.where('r.suggestion_id', 'is', null);
  if (input.state === 'resolved') query = query.where('r.suggestion_id', 'is not', null);
  if (input.author !== undefined) query = query.where('g.made_by', '=', input.author);
  if (input.after !== undefined) {
    query = query.where(
      sql<boolean>`(${made}, g.id) < (${input.after.at}, ${input.after.id}::uuid)`,
    );
  }
  if (input.limit !== undefined) query = query.limit(input.limit);
  const rows = await query.orderBy(made, 'desc').orderBy('g.id', 'desc').execute();
  return rows.map(storedOf);
}

/** How many suggestions are pending on each of these components (SG-M). */
export async function pendingCounts(
  trx: TenantTransaction,
  components: readonly string[],
): Promise<Map<string, number>> {
  if (components.length === 0) return new Map();
  const rows = await trx
    .selectFrom('suggestion as g')
    .leftJoin('suggestion_resolution as r', 'r.suggestion_id', 'g.id')
    .select(['g.component_id', (eb) => eb.fn.countAll<string>().as('pending')])
    .where('g.component_id', 'in', [...components])
    .where('r.suggestion_id', 'is', null)
    .groupBy('g.component_id')
    .execute();
  return new Map(rows.map((row) => [row.component_id, Number(row.pending)]));
}

/**
 * Whether a suggestion applies to its component as it is now, and how (COL-052): the merge, or each
 * place it no longer fits. Never stored (SG-D).
 */
export async function applying(
  trx: TenantTransaction,
  suggestion: StoredSuggestion,
): Promise<
  | {
      readonly current: StoredVersion;
      readonly base: StoredVersion;
      readonly applied: ReturnType<typeof applySuggestion>;
    }
  | undefined
> {
  const [current, base] = await Promise.all([
    latestVersion(trx, suggestion.component),
    readVersion(trx, suggestion.madeAgainst),
  ]);
  if (!current || !base) return undefined;
  return {
    current,
    base,
    applied: applySuggestion(
      base.content as ContentDocument,
      suggestion.proposed,
      current.content as ContentDocument,
      () => blockIdentifierFrom(randomBytes(16)),
    ),
  };
}

/**
 * The checks every resolving act makes first, serialised on the component (SG-F, SG-G): the
 * suggestion pending, and nobody else holding the lock (COL-042); for accepting, the caller holding it
 * with nothing saved after the current version.
 */
async function resolving(
  trx: TenantTransaction,
  id: string,
  by: string,
  accepting: boolean,
): Promise<{ suggestion: StoredSuggestion } | ResolveAnswer> {
  const component = await suggestionOn(trx, id);
  if (component === undefined) return { answer: 'missing' };
  await serialise(trx, component);
  const suggestion = await readSuggestion(trx, id);
  if (!suggestion) return { answer: 'missing' };
  if (suggestion.resolution !== null) return { answer: 'suggestion.resolved' };
  const lock = await readLock(trx, component);
  if (lock && lock.holder !== by) return { answer: 'lock.held', lock };
  if (lock && accepting) {
    const current = await latestVersion(trx, component);
    const saved = await trx
      .selectFrom('iteration')
      .select('sequence')
      .where('artifact_id', '=', component)
      .where('principal_id', '=', by)
      .where('session_id', '=', lock.session)
      .where('opened_from', '=', current!.id)
      .limit(1)
      .executeTakeFirst();
    if (saved) return { answer: 'edits.pending' };
  }
  return { suggestion };
}

async function resolve(
  trx: TenantTransaction,
  suggestion: string,
  act: 'accepted' | 'rejected' | 'withdrawn',
  by: string,
  version: string | null,
): Promise<void> {
  await trx
    .insertInto('suggestion_resolution')
    .values({ suggestion_id: suggestion, act, version_id: version, resolved_by: by })
    .execute();
}

/**
 * Accepts a suggestion (COL-022 to COL-024, COL-041 to COL-043): its merge into the component as it is
 * now, cut as a version by `by` with the current version's values carried forward and checked again,
 * as a cut is (SG-G). `check` runs the save's checks on the merge for the accepter (SG-B). A merge that
 * changes nothing stands in the current version. Stale refuses with every place (COL-052).
 */
export async function acceptSuggestion(
  trx: TenantTransaction,
  input: {
    readonly suggestion: string;
    readonly by: string;
    readonly check?: (content: ContentDocument, current: StoredVersion) => Promise<void>;
  },
): Promise<ResolveAnswer> {
  const ready = await resolving(trx, input.suggestion, input.by, true);
  if ('answer' in ready) return ready;
  const { suggestion } = ready;
  const merged = await applying(trx, suggestion);
  if (!merged) return { answer: 'missing' };
  const { current, applied } = merged;
  if (!applied.applies) return { answer: 'suggestion.stale', stale: applied.stale };
  await input.check?.(applied.content, current);
  const { definitions, effective } = await componentFieldsNow(trx, current);
  const carried = carryForward(current.values, effective);
  const fixed = validate(effective, carried.values).filter((each) => each.rule === 'fixed');
  if (fixed.length > 0) return { answer: 'values.invalid', failures: fixed };
  const recorded = await recordVersion(trx, {
    artifactId: suggestion.component,
    openedFrom: current.id,
    author: input.by,
    substance: {
      kind: 'component',
      content: applied.content,
      values: carried.values,
      notCarried: carried.notCarried,
      definitions: definitionsFor(definitions.type, definitions.schemas, definitions.fields),
    },
  });
  if (recorded.answer !== 'recorded' && recorded.answer !== 'version.unchanged') {
    throw new Error(`Accepting ${suggestion.id} could not record: ${recorded.answer}`);
  }
  const version = recorded.answer === 'recorded' ? recorded.version : current;
  await resolve(trx, suggestion.id, 'accepted', input.by, version.id);
  await recordSuggestionEvent(trx, 'suggestion.accepted', suggestion.id, {
    suggestion: suggestion.id,
    author: suggestion.madeBy.id,
    version: version.id,
  });
  return { answer: 'accepted', version };
}

/** Rejects a suggestion (COL-022, COL-042): pending, and nobody else holding the component. */
export async function rejectSuggestion(
  trx: TenantTransaction,
  input: { readonly suggestion: string; readonly by: string },
): Promise<ResolveAnswer> {
  const ready = await resolving(trx, input.suggestion, input.by, false);
  if ('answer' in ready) return ready;
  const { suggestion } = ready;
  await resolve(trx, suggestion.id, 'rejected', input.by, null);
  await recordSuggestionEvent(trx, 'suggestion.rejected', suggestion.id, {
    suggestion: suggestion.id,
    author: suggestion.madeBy.id,
  });
  return { answer: 'rejected' };
}

/** Withdraws a suggestion (COL-048): its author alone, while it is pending; it is kept. */
export async function withdrawSuggestion(
  trx: TenantTransaction,
  input: { readonly suggestion: string; readonly by: string },
): Promise<ResolveAnswer> {
  const component = await suggestionOn(trx, input.suggestion);
  if (component === undefined) return { answer: 'missing' };
  await serialise(trx, component);
  const suggestion = await readSuggestion(trx, input.suggestion);
  if (!suggestion) return { answer: 'missing' };
  if (suggestion.resolution !== null) return { answer: 'suggestion.resolved' };
  if (suggestion.madeBy.id !== input.by) return { answer: 'suggestion.not_yours' };
  await resolve(trx, suggestion.id, 'withdrawn', input.by, null);
  await recordSuggestionEvent(trx, 'suggestion.withdrawn', suggestion.id, {
    suggestion: suggestion.id,
  });
  return { answer: 'withdrawn' };
}
