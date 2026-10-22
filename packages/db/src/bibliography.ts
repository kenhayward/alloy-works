import {
  admitCsl,
  entryIdentities,
  entryKey,
  EntryRefused,
  ENTRY_SCHEMA_VERSION,
  keyCandidate,
  mergeCsl,
  parseEntry,
  type CslItem,
  type Entry,
  type EntryProblem,
  type IdentityBy,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { actOn, archivedAs, isArchived, notArchivedAs, type ArchivalAnswer } from './archival.js';
import {
  checkedLimit,
  countOf,
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
import { mayReadArtifact } from './queryDefinitions.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import { readableAmong } from './uses.js';
import { createArtifact, latestVersion, recordVersion, type StoredVersion } from './versions.js';

/**
 * Bibliography entries (citations.md, "The entry"; the CI plan, CI-B): an authored artifact in one
 * space, every change a version on the chain. Who may make or change one is the route's to decide;
 * its shape, its key and its identities are checked and indexed on every path a version is written by.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What a caller gives for an entry: everything but its key, which is the entry's own (LIB-046). */
export interface EntryInput {
  readonly csl: CslItem;
  readonly obtained?: { readonly from: string; readonly at: string };
  readonly checkedAt?: string;
}

/** An entry at its latest version. */
export interface StoredEntry {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: StoredVersion;
  readonly entry: Entry;
  readonly archived: boolean;
}

/** One entry as a listing, a match and an export show it. */
export interface EntrySummary {
  readonly id: string;
  readonly key: string;
  readonly csl: CslItem;
  readonly version: { readonly id: string; readonly revision: number; readonly version: number };
  readonly changedAt: Date;
}

/** An entry found to be the same source (LIB-045), and which identity found it. */
export interface EntryMatch {
  readonly by: IdentityBy;
  readonly entry: EntrySummary;
}

async function stored(trx: TenantTransaction, version: StoredVersion): Promise<StoredEntry> {
  const space = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['s.id', 's.name'])
    .where('a.id', '=', version.artifactId)
    .executeTakeFirstOrThrow();
  return {
    id: version.artifactId,
    space,
    version,
    entry: parseEntry(version.content),
    archived: await isArchived(trx, version.artifactId),
  };
}

/** An entry at its latest version, or undefined where this tenant holds none by that id. */
export async function readEntry(
  trx: TenantTransaction,
  id: string,
): Promise<StoredEntry | undefined> {
  if (!UUID.test(id)) return undefined;
  const version = await latestVersion(trx, id);
  if (!version || version.kind !== 'bibliographyEntry') return undefined;
  return stored(trx, version);
}

/** Each entry's latest version as a summary, in the order asked. */
async function summaries(
  trx: TenantTransaction,
  ids: readonly string[],
): Promise<Map<string, EntrySummary>> {
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom('artifact_version')
    .distinctOn('artifact_id')
    .select(['artifact_id', 'id', 'revision_no', 'version_no', 'created_at', 'content'])
    .where('artifact_id', 'in', [...ids])
    .where('kind', '=', 'bibliographyEntry')
    .orderBy('artifact_id')
    .orderBy('revision_no', 'desc')
    .orderBy('version_no', 'desc')
    .execute();
  return new Map(
    rows.map((row) => {
      const entry = parseEntry(row.content);
      return [
        row.artifact_id,
        {
          id: row.artifact_id,
          key: entry.key,
          csl: entry.csl,
          version: { id: row.id, revision: row.revision_no, version: row.version_no },
          changedAt: new Date(row.created_at),
        },
      ];
    }),
  );
}

/**
 * The space's entries that are the same source as this one (LIB-045): by its canonical identifiers
 * where it holds any, else by its title, year and first author, each match saying which found it.
 * Only those `by` may read are answered; archived ones among them, since they are the same source.
 */
export async function findEntryMatches(
  trx: TenantTransaction,
  by: string,
  spaceId: string,
  csl: CslItem,
  except?: string,
): Promise<EntryMatch[]> {
  const identities = entryIdentities(csl);
  if (identities.length === 0) return [];
  const rows = await trx
    .selectFrom('bibliography_identity')
    .select(['entry_id', 'by'])
    .where('space_id', '=', spaceId)
    .where((eb) =>
      eb.or(
        identities.map((each) => eb.and([eb('by', '=', each.by), eb('value', '=', each.value)])),
      ),
    )
    .$if(except !== undefined, (query) => query.where('entry_id', '<>', except!))
    .execute();
  const order: readonly IdentityBy[] = ['doi', 'pmid', 'isbn', 'issn', 'work'];
  const first = new Map<string, IdentityBy>();
  for (const row of [...rows].sort((a, b) => order.indexOf(a.by) - order.indexOf(b.by))) {
    if (!first.has(row.entry_id)) first.set(row.entry_id, row.by);
  }
  const readable = await loadReadableSet(trx, by);
  const found = await summaries(trx, [...first.keys()]);
  return [...first.entries()]
    .filter(
      ([id]) =>
        readable !== undefined && mayReadArtifact(readable, { id, spaceId }) && found.has(id),
    )
    .map(([id, identity]) => ({ by: identity, entry: found.get(id)! }))
    .sort((a, b) => order.indexOf(a.by) - order.indexOf(b.by) || compare(a.entry.key, b.entry.key));
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export type EntryAnswer =
  | {
      readonly answer: 'created' | 'recorded' | 'version.unchanged';
      readonly entry: StoredEntry;
      readonly matches: readonly EntryMatch[];
    }
  /** Not made: the same source is already in the space, offered rather than refused (LIB-044). */
  | { readonly answer: 'matched'; readonly matches: readonly EntryMatch[] }
  | { readonly answer: 'version.precondition'; readonly current: StoredEntry }
  | { readonly answer: 'entry.refused'; readonly problems: readonly EntryProblem[] }
  | { readonly answer: 'space.missing' }
  | { readonly answer: 'entry.missing' };

function refusal(error: unknown): EntryAnswer {
  if (error instanceof EntryRefused) return { answer: 'entry.refused', problems: error.problems };
  throw error;
}

/** What an entry was given, with other CSL. */
const inputOf = (entry: Entry, csl: CslItem): EntryInput => ({
  csl,
  ...(entry.obtained === undefined ? {} : { obtained: entry.obtained }),
  ...(entry.checkedAt === undefined ? {} : { checkedAt: entry.checkedAt }),
});

/** The entry's version content: what was given, and its key. */
const contentOf = (input: EntryInput, key: string): Entry => ({
  schemaVersion: ENTRY_SCHEMA_VERSION,
  csl: input.csl,
  key,
  ...(input.obtained === undefined ? {} : { obtained: input.obtained }),
  ...(input.checkedAt === undefined ? {} : { checkedAt: input.checkedAt }),
});

/**
 * The first key free in the space from the one the fields make (LIB-046), under a lock on the space's
 * keys so two made at once never take the same one.
 */
async function freeKey(trx: TenantTransaction, spaceId: string, csl: CslItem): Promise<string> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`bibliography:${spaceId}`}, 0))`.execute(
    trx,
  );
  const base = entryKey(csl);
  const taken = new Set(
    (
      await trx
        .selectFrom('bibliography_key')
        .select('key')
        .where('space_id', '=', spaceId)
        .where('key', 'like', `${base}%`)
        .execute()
    ).map((row) => row.key),
  );
  let n = 0;
  while (taken.has(keyCandidate(base, n))) n += 1;
  return keyCandidate(base, n);
}

/**
 * Makes an entry at 0.1 in a space (LIB-044): the same search as an import first, and where it finds
 * the same source, the match offered and nothing made, unless the caller makes it despite them.
 */
export async function createEntry(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly spaceId: string;
    readonly entry: EntryInput;
    readonly despiteMatches?: boolean;
  },
): Promise<EntryAnswer> {
  if (!UUID.test(input.spaceId)) return { answer: 'space.missing' };
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };
  try {
    // The shape first, so a match is never offered for what could not be made.
    parseEntry(contentOf(input.entry, 'entry'));
  } catch (error) {
    return refusal(error);
  }
  const matches = await findEntryMatches(trx, input.author, input.spaceId, input.entry.csl);
  if (matches.length > 0 && input.despiteMatches !== true) return { answer: 'matched', matches };
  try {
    const key = await freeKey(trx, input.spaceId, input.entry.csl);
    const version = await createArtifact(trx, {
      spaceId: input.spaceId,
      author: input.author,
      substance: { kind: 'bibliographyEntry', content: contentOf(input.entry, key) },
    });
    return { answer: 'created', entry: await stored(trx, version), matches };
  } catch (error) {
    return refusal(error);
  }
}

/** Cuts an entry's next version from the one its author opened, its key carried (LIB-046). */
export async function recordEntryVersion(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly id: string;
    readonly openedFrom: string;
    readonly entry: EntryInput;
  },
): Promise<EntryAnswer> {
  const current = await readEntry(trx, input.id);
  if (!current) return { answer: 'entry.missing' };
  let answer;
  try {
    answer = await recordVersion(trx, {
      artifactId: input.id,
      openedFrom: input.openedFrom,
      author: input.author,
      substance: { kind: 'bibliographyEntry', content: contentOf(input.entry, current.entry.key) },
    });
  } catch (error) {
    return refusal(error);
  }
  switch (answer.answer) {
    case 'recorded':
    case 'version.unchanged': {
      const entry = await stored(
        trx,
        answer.answer === 'recorded' ? answer.version : answer.current,
      );
      return { answer: answer.answer, entry, matches: [] };
    }
    case 'version.precondition':
      return { answer: 'version.precondition', current: await stored(trx, answer.current) };
    case 'artifact.missing':
      return { answer: 'entry.missing' };
  }
}

/**
 * The entries of a space a principal may read, a page at a time by keyset over the sort asked for and
 * then the id, as of the snapshot the walk's first page took: archived ones left out, or only they
 * where asked. Undefined when the tenant holds no such principal.
 */
export async function listEntries(
  trx: TenantTransaction,
  principalId: string,
  spaceId: string,
  request: ListingRequest<SortOf<'bibliography'>> = { limit: 100 },
  filter: { readonly archived?: boolean } = {},
): Promise<(Listed<EntrySummary> & { readonly total: number }) | undefined> {
  const limit = checkedLimit(request.limit);
  const sort = request.sort ?? 'key';
  const { types, order: byDefault } = listingSorts.bibliography[sort];
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const snapshot = await snapshotFor(trx, request.snapshot);
  const base = () =>
    trx
      .selectFrom('artifact as a')
      .innerJoin('bibliography_key as k', 'k.entry_id', 'a.id')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('artifact_version as v')
            .select(['v.id as version_id', 'v.revision_no', 'v.version_no', 'v.created_at'])
            .select('v.content')
            .whereRef('v.artifact_id', '=', 'a.id')
            .where(visibleIn('v.written_by', snapshot))
            .orderBy('v.revision_no', 'desc')
            .orderBy('v.version_no', 'desc')
            .limit(1)
            .as('latest'),
        (join) => join.onTrue(),
      )
      .select(['a.id', 'k.key', 'latest.content'])
      .select(['latest.version_id', 'latest.revision_no', 'latest.version_no', 'latest.created_at'])
      .select(sortColumns([sort === 'key' ? sql`k.key` : sql`latest.created_at`]))
      .where('a.kind', '=', 'bibliographyEntry')
      .where('a.space_id', '=', spaceId)
      .where((eb) => readableArtifacts(eb, readable))
      .where(filter.archived === true ? archivedAs('a', snapshot) : notArchivedAs('a', snapshot));
  const { rows, next } = await keysetPage<{
    id: string;
    key: string;
    content: unknown;
    version_id: string;
    revision_no: number;
    version_no: number;
    created_at: Date;
  }>(trx, base(), types, request.order ?? byDefault, limit, request.after);
  return {
    items: rows.map((row) => ({
      id: row.id,
      key: row.key,
      csl: parseEntry(row.content).csl,
      version: { id: row.version_id, revision: row.revision_no, version: row.version_no },
      changedAt: new Date(row.created_at),
    })),
    next,
    snapshot,
    total: await countOf(trx, base()),
  };
}

/** Where an entry is cited, named where the reader may read it, else only flagged. */
export interface EntryUses {
  /** Components whose latest version cites it, which a change reaches at the next publish. */
  readonly components: {
    readonly named: readonly { readonly id: string; readonly title: string }[];
    readonly unreadable: boolean;
  };
  /** Baselines pinning a component version that cites it, which a change never reaches (LIB-047). */
  readonly baselines: {
    readonly named: readonly {
      readonly id: string;
      readonly name: string;
      readonly document: string;
    }[];
    readonly unreadable: boolean;
  };
}

/** The citation path over a version's content, the entry passed as `$entry`. */
const CITES = 'strict $.** ? (@.type == "citation" && @.entry == $entry)';

/**
 * Where an entry is used (citations.md, "Kept while cited"): the components whose latest version
 * cites it, from the reference index, and the baselines pinning a component version that does. What
 * `by` may not read, or is deleted, is never named, and only whether there is any is said.
 */
export async function entryUses(
  trx: TenantTransaction,
  by: string,
  entryId: string,
): Promise<EntryUses> {
  const readable = await loadReadableSet(trx, by);
  const { rows: components } = await sql<{ id: string; space_id: string; title: string | null }>`
    select distinct a.id, a.space_id, v.content ->> 'title' as title
      from reference r
      join artifact a on a.id = r.from_id and a.kind = 'component'
      join artifact_version v on v.id = r.from_version
     where r.to_id = ${entryId} and r.to_kind = 'bibliographyEntry'
     order by title, a.id`.execute(trx);
  const shown = await readableAmong(trx, readable, components);
  const { rows: baselines } = await sql<{
    id: string;
    name: string;
    document: string;
    space_id: string;
  }>`
    select distinct b.id, b.name, b.document_id as document, a.space_id
      from baseline b
      join artifact a on a.id = b.document_id
      join baseline_pin p on p.baseline_id = b.id and p.kind = 'component'
      join artifact_version v on v.id = p.version_id
     where jsonb_path_exists(v.content, ${CITES}::jsonpath, jsonb_build_object('entry', ${entryId}::text))
     order by b.name, b.id`.execute(trx);
  const seen = await readableAmong(
    trx,
    readable,
    baselines.map((row) => ({ ...row, subject: row.document })),
  );
  return {
    components: {
      named: shown.map(({ id, title }) => ({ id, title: title ?? '' })),
      unreadable: shown.length < shown.total,
    },
    baselines: {
      named: seen.map(({ id, name, document }) => ({ id, name, document })),
      unreadable: seen.length < seen.total,
    },
  };
}

/**
 * Whether anything cites the entry, whoever may read it: a component's latest version, deleted or
 * not, or a version a baseline pins. What keeps it from being archived (LIB-006).
 */
export async function entryCited(trx: TenantTransaction, entryId: string): Promise<boolean> {
  const { rows } = await sql<{ cited: boolean }>`
    select exists (
      select from reference r where r.to_id = ${entryId} and r.to_kind = 'bibliographyEntry'
    ) or exists (
      select from baseline_pin p join artifact_version v on v.id = p.version_id
       where p.kind = 'component'
         and jsonb_path_exists(v.content, ${CITES}::jsonpath, jsonb_build_object('entry', ${entryId}::text))
    ) as cited`.execute(trx);
  return rows[0]?.cited === true;
}

/**
 * Archives an entry, refused while anything cites it (LIB-006; citations.md, "Kept while cited"), or
 * unarchives one. Undefined for anything but an entry. The caller has decided `retire`.
 */
export async function archiveEntry(
  trx: TenantTransaction,
  entryId: string,
  by: string,
  act: 'archived' | 'unarchived',
): Promise<ArchivalAnswer | 'cited' | undefined> {
  if (!(await readEntry(trx, entryId))) return undefined;
  if (act === 'archived' && (await entryCited(trx, entryId))) return 'cited';
  return actOn(trx, entryId, by, act, ['bibliographyEntry']);
}

/** What import did with one record (LIB-009, LIB-010). */
export type ImportedRecord =
  | {
      readonly outcome: 'created';
      readonly entry: StoredEntry;
      /** The record's fields an entry could not hold, by name. */
      readonly dropped: readonly string[];
    }
  | {
      readonly outcome: 'merged';
      readonly entry: StoredEntry;
      readonly by: IdentityBy;
      /** The fields the match lacked and was given, by name; none where it lacked nothing. */
      readonly merged: readonly string[];
      readonly dropped: readonly string[];
    }
  | {
      readonly outcome: 'refused';
      readonly dropped: readonly string[];
      readonly message: string;
    };

/**
 * Imports records as entries of a space (LIB-009, LIB-010): each admitted as CSL, what it could not
 * hold named; matched as making one by hand is (LIB-045), and where it matches, the match given the
 * fields it lacks and a new version cut, else a new entry made. A record matching one made earlier in
 * the same import merges into it.
 */
export async function importEntries(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly spaceId: string;
    readonly records: readonly unknown[];
    readonly obtained?: { readonly from: string; readonly at: string };
  },
): Promise<ImportedRecord[] | undefined> {
  if (!UUID.test(input.spaceId)) return undefined;
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return undefined;
  const done: ImportedRecord[] = [];
  for (const record of input.records) {
    const { csl, dropped } = admitCsl(record);
    if (csl === undefined) {
      done.push({
        outcome: 'refused',
        dropped,
        message: 'The record has no source type CSL holds',
      });
      continue;
    }
    const [match] = await findEntryMatches(trx, input.author, input.spaceId, csl);
    if (match !== undefined) {
      const current = (await readEntry(trx, match.entry.id))!;
      const { csl: merged, merged: fields } = mergeCsl(current.entry.csl, csl);
      const answer =
        fields.length === 0
          ? undefined
          : await recordEntryVersion(trx, {
              author: input.author,
              id: current.id,
              openedFrom: current.version.id,
              entry: inputOf(current.entry, merged),
            });
      if (answer !== undefined && answer.answer !== 'recorded') {
        done.push({ outcome: 'refused', dropped, message: 'The merge could not be recorded' });
        continue;
      }
      done.push({
        outcome: 'merged',
        entry: answer?.entry ?? current,
        by: match.by,
        merged: fields,
        dropped,
      });
      continue;
    }
    const answer = await createEntry(trx, {
      author: input.author,
      spaceId: input.spaceId,
      entry: { csl, ...(input.obtained === undefined ? {} : { obtained: input.obtained }) },
      despiteMatches: true,
    });
    if (answer.answer === 'created')
      done.push({ outcome: 'created', entry: answer.entry, dropped });
    else if (answer.answer === 'entry.refused') {
      done.push({
        outcome: 'refused',
        dropped,
        message: answer.problems.map((each) => `${each.path}: ${each.message}`).join('; '),
      });
    } else throw new Error(`An import's entry was answered ${answer.answer}`);
  }
  return done;
}

/**
 * The entries of a space a principal may read, archived or not, for export (LIB-009), each by its key
 * and CSL, in key order; only those named where `ids` is given.
 */
export async function entriesForExport(
  trx: TenantTransaction,
  principalId: string,
  spaceId: string,
  ids?: readonly string[],
): Promise<readonly { readonly key: string; readonly csl: CslItem }[] | undefined> {
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  if (ids !== undefined && ids.length === 0) return [];
  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoin('bibliography_key as k', 'k.entry_id', 'a.id')
    .select(['a.id', 'k.key'])
    .where('a.kind', '=', 'bibliographyEntry')
    .where('a.space_id', '=', spaceId)
    .where((eb) => readableArtifacts(eb, readable))
    .$if(ids !== undefined, (query) => query.where('a.id', 'in', [...ids!]))
    .orderBy('k.key')
    .execute();
  const found = await summaries(
    trx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ key: row.key, csl: found.get(row.id)!.csl }));
}
