import {
  DEFAULT_PROMPT_LIBRARY_ID,
  LibraryRefused,
  parsePrompt,
  parsePromptLibrary,
  type LibraryProblem,
  type Prompt,
  type PromptLibrary,
} from '@alloy-works/domain';
import { loadReadableSet } from './access-facts.js';
import { mayReadArtifact } from './queryDefinitions.js';
import type { TenantTransaction } from './tables.js';
import { documentTemplate } from './templates.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  type StoredVersion,
} from './versions.js';
import { latestRevisionsOf } from './workflow.js';

/**
 * Prompt libraries (generation.md, "Prompts"; the G4 plan, G4-F and G4-G): the tenant's, in no space,
 * each a versioned list of prompts by identity. A library floats: each prompt runs at its latest
 * approved revision, read here when it is asked for, and one never approved runs at none.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The most libraries a tenant's listing answers: a tenant's handful, never paged. */
export const LIBRARIES_LISTED_MOST = 200;

/** A library at its latest version. */
export interface StoredLibrary {
  readonly id: string;
  readonly version: StoredVersion;
  readonly library: PromptLibrary;
  /** Whether it is the tenant's declared default, the one a template naming none binds. */
  readonly isDefault: boolean;
}

export type LibraryAnswer =
  | {
      readonly answer: 'created' | 'recorded' | 'version.unchanged';
      readonly library: StoredLibrary;
    }
  | { readonly answer: 'version.precondition'; readonly current: StoredLibrary }
  | { readonly answer: 'library.refused'; readonly problems: readonly LibraryProblem[] }
  | { readonly answer: 'library.missing' };

/** The tenant's declared default library. */
export async function defaultLibraryId(trx: TenantTransaction): Promise<string> {
  const row = await trx
    .selectFrom('prompt_library_default')
    .select('library_id')
    .executeTakeFirst();
  return row?.library_id ?? DEFAULT_PROMPT_LIBRARY_ID;
}

async function stored(trx: TenantTransaction, version: StoredVersion): Promise<StoredLibrary> {
  return {
    id: version.artifactId,
    version,
    library: parsePromptLibrary(version.content),
    isDefault: version.artifactId === (await defaultLibraryId(trx)),
  };
}

/** A library at its latest version, or undefined where this tenant holds none by that id. */
export async function readLibrary(
  trx: TenantTransaction,
  id: string,
): Promise<StoredLibrary | undefined> {
  if (!UUID.test(id)) return undefined;
  const version = await latestVersion(trx, id);
  if (!version || version.kind !== 'promptLibrary') return undefined;
  return stored(trx, version);
}

/**
 * The prompts newly listed that `author` may not read, or that are no prompt here, refused alike so a
 * refusal tells nothing of a prompt the author cannot see; one already listed may stay (G4-F).
 */
async function unreadableAdded(
  trx: TenantTransaction,
  author: string,
  listed: readonly unknown[],
  before: readonly string[],
): Promise<LibraryProblem[]> {
  const added = listed.flatMap((id, at) =>
    typeof id === 'string' && UUID.test(id) && !before.includes(id) ? [{ id, at }] : [],
  );
  if (added.length === 0) return [];
  const readable = await loadReadableSet(trx, author);
  const rows = await trx
    .selectFrom('artifact')
    .select(['id', 'space_id'])
    .where(
      'id',
      'in',
      added.map((each) => each.id),
    )
    .where('kind', '=', 'prompt')
    .execute();
  const allowed = new Set(
    rows
      .filter((row) => readable && mayReadArtifact(readable, { id: row.id, spaceId: row.space_id }))
      .map((row) => row.id),
  );
  return added
    .filter((each) => !allowed.has(each.id))
    .map((each) => ({
      rule: 'library_invalid' as const,
      path: `prompts.${each.at}`,
      message: 'This names no prompt you may read',
    }));
}

const promptsOf = (library: unknown): readonly unknown[] => {
  const prompts = (library as { readonly prompts?: unknown } | null)?.prompts;
  return Array.isArray(prompts) ? prompts : [];
};

function refusal(error: unknown): LibraryAnswer {
  if (error instanceof LibraryRefused) {
    return { answer: 'library.refused', problems: error.problems };
  }
  throw error;
}

/** Makes a library at 0.1, listing prompts of the tenant's. */
export async function createLibrary(
  trx: TenantTransaction,
  input: { readonly author: string; readonly library: unknown },
): Promise<LibraryAnswer> {
  const unreadable = await unreadableAdded(trx, input.author, promptsOf(input.library), []);
  if (unreadable.length > 0) return { answer: 'library.refused', problems: unreadable };
  try {
    const version = await createArtifact(trx, {
      author: input.author,
      substance: { kind: 'promptLibrary', content: input.library as PromptLibrary },
    });
    return { answer: 'created', library: await stored(trx, version) };
  } catch (error) {
    return refusal(error);
  }
}

/** Cuts a library's next version from the one its writer opened. */
export async function recordLibraryVersion(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly id: string;
    readonly openedFrom: string;
    readonly library: unknown;
  },
): Promise<LibraryAnswer> {
  const current = await readLibrary(trx, input.id);
  if (!current) return { answer: 'library.missing' };
  const unreadable = await unreadableAdded(
    trx,
    input.author,
    promptsOf(input.library),
    current.library.prompts,
  );
  if (unreadable.length > 0) return { answer: 'library.refused', problems: unreadable };
  let answer;
  try {
    answer = await recordVersion(trx, {
      artifactId: input.id,
      openedFrom: input.openedFrom,
      author: input.author,
      substance: { kind: 'promptLibrary', content: input.library as PromptLibrary },
    });
  } catch (error) {
    return refusal(error);
  }
  switch (answer.answer) {
    case 'recorded':
      return { answer: 'recorded', library: await stored(trx, answer.version) };
    case 'version.unchanged':
      return { answer: 'version.unchanged', library: await stored(trx, answer.current) };
    case 'version.precondition':
      return { answer: 'version.precondition', current: await stored(trx, answer.current) };
    case 'artifact.missing':
      return { answer: 'library.missing' };
  }
}

/** The tenant's libraries, each at its latest version, by name, at most `LIBRARIES_LISTED_MOST`. */
export async function listLibraries(trx: TenantTransaction): Promise<StoredLibrary[]> {
  const rows = await trx
    .selectFrom('artifact as a')
    .select('a.id')
    .where('a.kind', '=', 'promptLibrary')
    .execute();
  const libraries: StoredLibrary[] = [];
  for (const row of rows) {
    const library = await readLibrary(trx, row.id);
    if (library) libraries.push(library);
  }
  return libraries
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.library.name.localeCompare(b.library.name) ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, LIBRARIES_LISTED_MOST);
}

/** One prompt a library lists, as a reader of the library sees it. */
export type ListedPrompt =
  | {
      readonly id: string;
      readonly state: 'approved';
      /** Its latest approved revision: what a run of it runs. */
      readonly revision: { readonly number: number; readonly versionId: string };
      readonly prompt: Prompt;
      readonly space: { readonly id: string; readonly name: string };
    }
  /** Readable, never approved: it runs nothing until it is (G4-F). */
  | {
      readonly id: string;
      readonly state: 'unapproved';
      readonly title: string;
      readonly space: { readonly id: string; readonly name: string };
    }
  /** One the reader may not read, or that is no prompt any more: counted, never named. */
  | { readonly id: string; readonly state: 'hidden' };

/**
 * A library's prompts as `principal` may read them (G4-F), in the library's order: each at its latest
 * approved revision, its prompt as that revision says it; one never approved said so; one they may not
 * read hidden.
 */
export async function libraryPrompts(
  trx: TenantTransaction,
  principal: string,
  library: PromptLibrary,
): Promise<ListedPrompt[]> {
  if (library.prompts.length === 0) return [];
  const readable = await loadReadableSet(trx, principal);
  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['a.id', 'a.space_id', 's.name as space_name'])
    .where('a.id', 'in', [...library.prompts])
    .where('a.kind', '=', 'prompt')
    .execute();
  const found = new Map(rows.map((row) => [row.id, row]));
  const revisions = await latestRevisionsOf(trx, library.prompts);
  const versions = [...revisions.values()].map((each) => each.versionId);
  const contents =
    versions.length === 0
      ? []
      : await trx
          .selectFrom('artifact_version')
          .select(['id', 'content'])
          .where('id', 'in', versions)
          .execute();
  const contentOf = new Map(contents.map((row) => [row.id, row.content]));
  const listed: ListedPrompt[] = [];
  for (const id of library.prompts) {
    const row = found.get(id);
    if (!row || !readable || !mayReadArtifact(readable, { id, spaceId: row.space_id })) {
      listed.push({ id, state: 'hidden' });
      continue;
    }
    const space = { id: row.space_id!, name: row.space_name };
    const revision = revisions.get(id);
    if (revision === undefined) {
      const latest = await latestVersion(trx, id);
      listed.push({
        id,
        state: 'unapproved',
        title: latest ? parsePrompt(latest.content).title : '',
        space,
      });
      continue;
    }
    listed.push({
      id,
      state: 'approved',
      revision: { number: revision.number, versionId: revision.versionId },
      prompt: parsePrompt(contentOf.get(revision.versionId)),
      space,
    });
  }
  return listed;
}

/**
 * The library a document's prompts come from (TPL-061, TPL-071): the one its template's version names,
 * or the environment's default for a template naming none and for a document made blank.
 */
export async function documentLibrary(trx: TenantTransaction, documentId: string): Promise<string> {
  const bound = await documentTemplate(trx, documentId);
  const version = bound && (await readVersion(trx, bound.version));
  const named = (version?.content as { readonly prompts?: unknown } | undefined)?.prompts;
  return typeof named === 'string' && UUID.test(named) ? named : defaultLibraryId(trx);
}
