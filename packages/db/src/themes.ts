import {
  readCatalogue,
  readTheme,
  type Catalogue,
  type CatalogueKind,
  type ResolvedTheme,
  type Theme,
  type ThemeReadOutcome,
  type ThemeRefusalCode,
} from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';
import {
  latestVersion,
  lockArtifact,
  recordReadVersion,
  type Authorship,
  type RecordAnswer,
} from './versions.js';

/**
 * The theme every environment starts with, seeded by 0024 as 0018 seeds the layout: a definition in no
 * space, identified by its artifact row, with no author because nobody made it.
 */
export const DEFAULT_THEME_ID = '4ae73bd5-48cb-422a-a4f8-2183f0f72866';

/**
 * The artifacts the default theme's six catalogues are versions of, one of each kind (STY-003), each in
 * no space. Their first versions' identifiers are the domain's `DEFAULT_CATALOGUE_VERSIONS`, which the
 * theme's content names; these are the artifacts behind them, which nothing names but the store.
 */
export const DEFAULT_CATALOGUE_IDS: Readonly<Record<CatalogueKind, string>> = {
  paragraph: 'd743fbe7-68f8-4530-8e93-46494d0fcdc2',
  character: '8b0a2505-f6b7-4974-a09d-153321415236',
  table: '72afa788-3ff2-41c2-b9b6-46ad8ddf4a61',
  image: 'd159b153-47f0-4822-b662-8244f3e60d03',
  admonition: 'd4e8b3fe-5d6e-4866-8cd9-b2d7aac3c853',
  citation: '1ec1fdfa-590b-4487-84a0-7960d9982be3',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A theme at one version, as the chain holds it and as it reads. */
export interface StoredTheme {
  readonly artifactId: string;
  readonly versionId: string;
  /** `revision.version`, as VER-009 presents it. */
  readonly number: string;
  /** The theme as stored, naming its catalogues by version: what the next version is written from. */
  readonly content: Theme;
  /** The theme and its catalogues read through `readTheme`: what `assemble` sets a publication from. */
  readonly theme: ResolvedTheme;
}

/**
 * What the store refuses beyond what the reader does: a catalogue version bringing back a style
 * identifier an earlier version of the same catalogue dropped (STY-005). A version of a catalogue of one
 * kind that is a catalogue of another is the reader's own `catalogue_wrong_kind`.
 */
export type ThemeStoreRefusalCode = ThemeRefusalCode | 'style_reused';

export interface ThemeStoreRefusal {
  readonly code: ThemeStoreRefusalCode;
  readonly message: string;
}

/**
 * What writing a theme or a catalogue version answers: `recordVersion`'s answers, or every refusal at
 * once, and nothing written. A refusal is the author's to fix and is never thrown; a broken store is.
 */
export type ThemeStoreAnswer =
  RecordAnswer | { readonly answer: 'refused'; readonly refusals: readonly ThemeStoreRefusal[] };

/**
 * The catalogue versions a theme names, by version, as `readTheme` is to be handed them. Only versions
 * of catalogues are read - a theme naming a layout's version finds nothing there, and the reader says
 * the catalogue is missing - and a name that is not an identifier at all is left for the reader to
 * refuse, rather than handed to Postgres, which would abort the transaction on it.
 */
async function cataloguesNamedBy(
  trx: TenantTransaction,
  theme: unknown,
): Promise<ReadonlyMap<string, unknown>> {
  const named =
    typeof theme === 'object' && theme !== null && 'catalogues' in theme
      ? (theme as { catalogues: unknown }).catalogues
      : undefined;
  const ids =
    typeof named === 'object' && named !== null
      ? Object.values(named).filter(
          (each): each is string => typeof each === 'string' && UUID.test(each),
        )
      : [];
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom('artifact_version')
    .select(['id', 'content'])
    .where('id', 'in', ids)
    .where('kind', '=', 'catalogue')
    .execute();
  return new Map(rows.map((row) => [row.id, row.content]));
}

/** A stored theme's content read with the catalogues it names, as they are stored. */
async function readStoredTheme(
  trx: TenantTransaction,
  content: unknown,
): Promise<ThemeReadOutcome> {
  return readTheme(content, await cataloguesNamedBy(trx, content));
}

/** `an` before the two kinds that begin with a vowel, as the reader's own messages say it. */
function article(kind: CatalogueKind): string {
  return kind === 'admonition' || kind === 'image' ? 'an' : 'a';
}

function brokenTheme(artifactId: string, versionId: string, outcome: ThemeReadOutcome): Error {
  const reasons = outcome.ok ? [] : outcome.refusals.map((each) => each.message);
  return new Error(`The theme ${artifactId} at ${versionId} does not read: ${reasons.join('; ')}`);
}

/**
 * The environment's declared theme at its latest version, read through `readTheme` as `defaultLayout`
 * reads through `readLayout`. Throws if it does not read, or if the environment declares none: both are
 * a broken store, since 0024 declares one in every environment and its writers refuse any version the
 * reader would.
 */
export async function defaultTheme(trx: TenantTransaction): Promise<StoredTheme> {
  const declared = await trx.selectFrom('theme_default').select('theme_id').executeTakeFirst();
  if (!declared) throw new Error('This environment declares no theme');
  const stored = await latestVersion(trx, declared.theme_id);
  if (!stored) throw new Error(`The declared theme ${declared.theme_id} has no version`);
  const read = await readStoredTheme(trx, stored.content);
  if (!read.ok) throw brokenTheme(stored.artifactId, stored.id, read);
  return {
    artifactId: stored.artifactId,
    versionId: stored.id,
    number: `${stored.revision}.${stored.version}`,
    // Read above, so it is a theme: the reader parses without filling anything in.
    content: stored.content as Theme,
    theme: read.theme,
  };
}

/**
 * The theme at the version a request recorded, resolved - never the declared theme's latest. Throws if
 * this tenant holds no theme version of that id or it does not read: a broken store, as a layout or a
 * component version that does not read is to `publicationInputs`.
 */
export async function themeAt(trx: TenantTransaction, versionId: string): Promise<ResolvedTheme> {
  const stored = UUID.test(versionId)
    ? await trx
        .selectFrom('artifact_version')
        .select(['artifact_id', 'content'])
        .where('id', '=', versionId)
        .where('kind', '=', 'theme')
        .executeTakeFirst()
    : undefined;
  if (!stored) throw new Error(`This environment holds no theme version ${versionId}`);
  const read = await readStoredTheme(trx, stored.content);
  if (!read.ok) throw brokenTheme(stored.artifact_id, versionId, read);
  return read.theme;
}

/** The next version of a catalogue, opened from its latest. */
export interface NextCatalogueVersion extends Authorship {
  readonly artifactId: string;
  readonly openedFrom: string;
  readonly catalogue: Catalogue;
}

/**
 * Records the next version of a catalogue, in the caller's transaction: one of the two TypeScript writers
 * of a theme's parts (themes 1, ruling R4), since `recordVersion` takes neither kind. Refuses, all at
 * once and writing nothing, whatever `readCatalogue` refuses; a version of another kind than the
 * catalogue's; and a style identifier an earlier version of this catalogue dropped (STY-005), because an
 * identifier is allocated once - a document naming it meant the style that was dropped, and reading it as
 * a new one would set that document in a style nobody chose for it. Otherwise answers as
 * `recordVersion` does.
 *
 * The catalogue's earlier versions are read under the artifact's lock, so a version recorded at the same
 * moment is among them or has already made this one's `openedFrom` stale.
 */
export async function addCatalogueVersion(
  trx: TenantTransaction,
  input: NextCatalogueVersion,
): Promise<ThemeStoreAnswer> {
  const read = readCatalogue(input.catalogue);
  if (!read.ok) return { answer: 'refused', refusals: read.refusals };
  if (!UUID.test(input.artifactId)) return { answer: 'artifact.missing' };

  await lockArtifact(trx, input.artifactId);
  const history = await trx
    .selectFrom('artifact_version')
    .select(['id', 'kind', 'content'])
    .where('artifact_id', '=', input.artifactId)
    .orderBy('revision_no')
    .orderBy('version_no')
    .execute();
  if (history.length === 0) return { answer: 'artifact.missing' };
  const [first] = history;
  if (first!.kind !== 'catalogue') {
    throw new Error(`Artifact ${input.artifactId} is a ${first!.kind}, not a catalogue`);
  }

  // Every identifier some version held and a later one did not: each one dropped, never to return.
  const seen = new Set<string>();
  const dropped = new Set<string>();
  let kind: CatalogueKind | undefined;
  for (const version of history) {
    const earlier = readCatalogue(version.content);
    // Written by this function or seeded by 0024, so it reads: one that does not is a broken store.
    if (!earlier.ok) {
      throw new Error(`The catalogue ${input.artifactId} at ${version.id} does not read`);
    }
    kind = earlier.catalogue.kind;
    const held = new Set(earlier.catalogue.styles.map((style) => style.id));
    for (const id of seen) if (!held.has(id)) dropped.add(id);
    for (const id of held) seen.add(id);
  }

  const refusals: ThemeStoreRefusal[] = [];
  if (read.catalogue.kind !== kind) {
    refusals.push({
      code: 'catalogue_wrong_kind',
      message: `The catalogue ${input.artifactId} is ${article(kind!)} ${kind} catalogue, and a version of it cannot be ${article(read.catalogue.kind)} ${read.catalogue.kind} catalogue`,
    });
  }
  for (const style of read.catalogue.styles) {
    if (dropped.has(style.id)) {
      refusals.push({
        code: 'style_reused',
        message: `The style identifier ${style.id} was dropped by an earlier version of this catalogue, and is never used again`,
      });
    }
  }
  if (refusals.length > 0) return { answer: 'refused', refusals };

  return recordReadVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: input.openedFrom,
    author: input.author,
    ...(input.note === undefined ? {} : { note: input.note }),
    substance: { kind: 'catalogue', content: read.catalogue },
  });
}

/** The next version of a theme, opened from its latest. */
export interface NextThemeVersion extends Authorship {
  readonly artifactId: string;
  readonly openedFrom: string;
  readonly theme: Theme;
}

/**
 * Records the next version of a theme, in the caller's transaction: the other of the two writers. The
 * theme is read with the catalogue versions it names, as stored, through `readTheme` - the reader
 * `assemble` reads it through - and refused, all at once and writing nothing, wherever it refuses: among
 * much else, body text below its contrast minimum against the paper or against a style's own background
 * (STY-069), decided here when the theme is saved rather than found in a publication. Otherwise answers
 * as `recordVersion` does. The catalogue versions it names are immutable, so what was read is what the
 * theme binds for as long as it exists.
 */
export async function addThemeVersion(
  trx: TenantTransaction,
  input: NextThemeVersion,
): Promise<ThemeStoreAnswer> {
  const read = await readStoredTheme(trx, input.theme);
  if (!read.ok) return { answer: 'refused', refusals: read.refusals };
  return recordReadVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: input.openedFrom,
    author: input.author,
    ...(input.note === undefined ? {} : { note: input.note }),
    substance: { kind: 'theme', content: input.theme },
  });
}
