import {
  CitationStyleRefused,
  parseCitationStyle,
  SEEDED_CITATION_STYLES,
  type CitationStyle,
  type StyleProblem,
} from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  type StoredVersion,
} from './versions.js';

/**
 * Citation styles (citations.md, "The style"; the CI plan, CI-D): the tenant's, in no space, as a
 * prompt library is, each a versioned CSL file and what it requires. Three are seeded by 0146 under
 * fixed identifiers; any other is uploaded (STY-023). Every write checks the CSL, in `versions.ts`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The most styles a tenant's listing answers: a tenant's handful, never paged. */
export const STYLES_LISTED_MOST = 200;

const SEEDED: ReadonlySet<string> = new Set(SEEDED_CITATION_STYLES.map((each) => each.id));

/** A style at one version. */
export interface StoredStyle {
  readonly id: string;
  readonly version: StoredVersion;
  readonly style: CitationStyle;
  /** One of the three every tenant is given. */
  readonly seeded: boolean;
}

export type StyleAnswer =
  | {
      readonly answer: 'created' | 'recorded' | 'version.unchanged';
      readonly style: StoredStyle;
    }
  | { readonly answer: 'version.precondition'; readonly current: StoredStyle }
  | { readonly answer: 'style.refused'; readonly problems: readonly StyleProblem[] }
  | { readonly answer: 'style.missing' };

const stored = (version: StoredVersion): StoredStyle => ({
  id: version.artifactId,
  version,
  style: parseCitationStyle(version.content),
  seeded: SEEDED.has(version.artifactId),
});

/** A style at its latest version, or undefined where this tenant holds none by that id. */
export async function readStyle(
  trx: TenantTransaction,
  id: string,
): Promise<StoredStyle | undefined> {
  if (!UUID.test(id)) return undefined;
  const version = await latestVersion(trx, id);
  return version?.kind === 'citationStyle' ? stored(version) : undefined;
}

/** A style at the version a theme names it by (CI-E), or undefined where that is no style's version. */
export async function readStyleVersion(
  trx: TenantTransaction,
  versionId: string,
): Promise<StoredStyle | undefined> {
  if (!UUID.test(versionId)) return undefined;
  const version = await readVersion(trx, versionId);
  return version?.kind === 'citationStyle' ? stored(version) : undefined;
}

function refusal(error: unknown): StyleAnswer {
  if (error instanceof CitationStyleRefused) {
    return { answer: 'style.refused', problems: error.problems };
  }
  throw error;
}

/** Makes a style at 0.1 from an uploaded file. */
export async function createStyle(
  trx: TenantTransaction,
  input: { readonly author: string; readonly style: unknown },
): Promise<StyleAnswer> {
  try {
    const version = await createArtifact(trx, {
      author: input.author,
      substance: { kind: 'citationStyle', content: input.style as CitationStyle },
    });
    return { answer: 'created', style: stored(version) };
  } catch (error) {
    return refusal(error);
  }
}

/** Cuts a style's next version from the one its writer opened. */
export async function recordStyleVersion(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly id: string;
    readonly openedFrom: string;
    readonly style: unknown;
  },
): Promise<StyleAnswer> {
  if (!(await readStyle(trx, input.id))) return { answer: 'style.missing' };
  let answer;
  try {
    answer = await recordVersion(trx, {
      artifactId: input.id,
      openedFrom: input.openedFrom,
      author: input.author,
      substance: { kind: 'citationStyle', content: input.style as CitationStyle },
    });
  } catch (error) {
    return refusal(error);
  }
  switch (answer.answer) {
    case 'recorded':
      return { answer: 'recorded', style: stored(answer.version) };
    case 'version.unchanged':
      return { answer: 'version.unchanged', style: stored(answer.current) };
    case 'version.precondition':
      return { answer: 'version.precondition', current: stored(answer.current) };
    case 'artifact.missing':
      return { answer: 'style.missing' };
  }
}

/** The tenant's styles, each at its latest version, by name, at most `STYLES_LISTED_MOST`. */
export async function listStyles(trx: TenantTransaction): Promise<StoredStyle[]> {
  const rows = await trx
    .selectFrom('artifact')
    .select('id')
    .where('kind', '=', 'citationStyle')
    .execute();
  const styles: StoredStyle[] = [];
  for (const row of rows) {
    const style = await readStyle(trx, row.id);
    if (style) styles.push(style);
  }
  return styles
    .sort((a, b) => a.style.name.localeCompare(b.style.name) || (a.id < b.id ? -1 : 1))
    .slice(0, STYLES_LISTED_MOST);
}
