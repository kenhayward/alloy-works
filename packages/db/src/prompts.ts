import { parsePrompt, PromptRefused, type Prompt, type PromptProblem } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import {
  checkedLimit,
  countOf,
  facetOf,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  visibleIn,
  type FacetCount,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import { createArtifact, latestVersion, recordVersion, type StoredVersion } from './versions.js';

/**
 * Prompts (generation.md, "Prompts"; the G4 plan, G4-A): an authored artifact in one space, every
 * change a version on the chain every artifact uses. Who may make or change one is the route's to
 * decide; what one may hold, and what it may name, is checked on every path a version is written by.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A prompt at its latest version. */
export interface StoredPrompt {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: StoredVersion;
  readonly prompt: Prompt;
}

export type PromptAnswer =
  | { readonly answer: 'created' | 'recorded' | 'version.unchanged'; readonly prompt: StoredPrompt }
  /** The latest version is not the one the caller opened from: the prompt as it now stands. */
  | { readonly answer: 'version.precondition'; readonly current: StoredPrompt }
  /** A prompt that does not pass, each problem named; nothing is written. */
  | { readonly answer: 'prompt.refused'; readonly problems: readonly PromptProblem[] }
  | { readonly answer: 'space.missing' }
  | { readonly answer: 'prompt.missing' };

async function stored(trx: TenantTransaction, version: StoredVersion): Promise<StoredPrompt> {
  const space = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['s.id', 's.name'])
    .where('a.id', '=', version.artifactId)
    .executeTakeFirstOrThrow();
  // Read by the shape alone: a check widened later never makes a stored version unreadable.
  return { id: version.artifactId, space, version, prompt: parsePrompt(version.content) };
}

/** A prompt at its latest version, or undefined where this tenant holds none by that id. */
export async function readPrompt(
  trx: TenantTransaction,
  id: string,
): Promise<StoredPrompt | undefined> {
  if (!UUID.test(id)) return undefined;
  const version = await latestVersion(trx, id);
  if (!version || version.kind !== 'prompt') return undefined;
  return stored(trx, version);
}

/** A write's refusal as an answer, or the error it was. */
function refusal(error: unknown): PromptAnswer {
  if (error instanceof PromptRefused) return { answer: 'prompt.refused', problems: error.problems };
  throw error;
}

/** Makes a prompt at 0.1 in a space (GEN-001), from one that passes the shape and every check. */
export async function createPrompt(
  trx: TenantTransaction,
  input: { readonly author: string; readonly spaceId: string; readonly prompt: unknown },
): Promise<PromptAnswer> {
  if (!UUID.test(input.spaceId)) return { answer: 'space.missing' };
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };
  try {
    const version = await createArtifact(trx, {
      spaceId: input.spaceId,
      author: input.author,
      substance: { kind: 'prompt', content: input.prompt as Prompt },
    });
    return { answer: 'created', prompt: await stored(trx, version) };
  } catch (error) {
    return refusal(error);
  }
}

/** Cuts a prompt's next version from the one its author opened: whole, passing as a new one must. */
export async function recordPromptVersion(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly id: string;
    readonly openedFrom: string;
    readonly prompt: unknown;
  },
): Promise<PromptAnswer> {
  if (!(await readPrompt(trx, input.id))) return { answer: 'prompt.missing' };
  let answer;
  try {
    answer = await recordVersion(trx, {
      artifactId: input.id,
      openedFrom: input.openedFrom,
      author: input.author,
      substance: { kind: 'prompt', content: input.prompt as Prompt },
    });
  } catch (error) {
    return refusal(error);
  }
  switch (answer.answer) {
    case 'recorded':
      return { answer: 'recorded', prompt: await stored(trx, answer.version) };
    case 'version.unchanged':
      return { answer: 'version.unchanged', prompt: await stored(trx, answer.current) };
    case 'version.precondition':
      return { answer: 'version.precondition', current: await stored(trx, answer.current) };
    case 'artifact.missing':
      return { answer: 'prompt.missing' };
  }
}

/** One prompt as a listing shows it. */
export interface PromptSummary {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly purpose: string;
  readonly version: { readonly id: string; readonly revision: number; readonly version: number };
  /** When its latest version was made. */
  readonly changedAt: Date;
}

/**
 * The prompts a principal may read, a page at a time by keyset over the sort asked for and then the
 * id, as of the snapshot the walk's first page took, filtered by the readable set inside the query and
 * by space where asked. Undefined when the tenant holds no such principal.
 */
export async function listReadablePrompts(
  trx: TenantTransaction,
  principalId: string,
  request: ListingRequest<SortOf<'prompts'>> = { limit: 100 },
  filter: { readonly spaces?: readonly string[] } = {},
): Promise<
  | (Listed<PromptSummary> & {
      readonly total: number;
      readonly facets: { readonly spaces: readonly FacetCount[] };
    })
  | undefined
> {
  const limit = checkedLimit(request.limit);
  const sort = request.sort ?? 'title';
  const { types, order: byDefault } = listingSorts.prompts[sort];
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const snapshot = await snapshotFor(trx, request.snapshot);
  const base = (leaving?: 'spaces') =>
    trx
      .selectFrom('artifact as a')
      .innerJoin('space as s', 's.id', 'a.space_id')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('artifact_version as v')
            .select([
              'v.id as version_id',
              'v.revision_no',
              'v.version_no',
              'v.created_at',
              sql<string>`v.content ->> 'title'`.as('title'),
              sql<string>`v.content -> 'models' ->> 'purpose'`.as('purpose'),
            ])
            .whereRef('v.artifact_id', '=', 'a.id')
            .where(visibleIn('v.written_by', snapshot))
            .orderBy('v.revision_no', 'desc')
            .orderBy('v.version_no', 'desc')
            .limit(1)
            .as('latest'),
        (join) => join.onTrue(),
      )
      .select([
        'a.id',
        's.id as space_id',
        's.name as space_name',
        'latest.title',
        'latest.purpose',
      ])
      .select(['latest.version_id', 'latest.revision_no', 'latest.version_no', 'latest.created_at'])
      .select(sortColumns([sort === 'title' ? sql`latest.title` : sql`latest.created_at`]))
      .where('a.kind', '=', 'prompt')
      .where((eb) => readableArtifacts(eb, readable))
      .$if(filter.spaces !== undefined && leaving !== 'spaces', (query) =>
        filter.spaces!.length === 0
          ? query.where(sql<boolean>`false`)
          : query.where('a.space_id', 'in', [...filter.spaces!]),
      );
  const { rows, next } = await keysetPage<{
    id: string;
    title: string;
    purpose: string;
    space_id: string;
    space_name: string;
    version_id: string;
    revision_no: number;
    version_no: number;
    created_at: Date;
  }>(trx, base(), types, request.order ?? byDefault, limit, request.after, request.language);
  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      purpose: row.purpose,
      space: { id: row.space_id, name: row.space_name },
      version: { id: row.version_id, revision: row.revision_no, version: row.version_no },
      changedAt: new Date(row.created_at),
    })),
    next,
    snapshot,
    total: await countOf(trx, base()),
    facets: { spaces: await facetOf(trx, base('spaces'), 'space_id', 'space_name') },
  };
}
