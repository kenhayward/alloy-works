import {
  addCatalogueVersion,
  addThemeVersion,
  createTenantDatabase,
  DEFAULT_CATALOGUE_IDS,
  DEFAULT_THEME_ID,
  type ThemeStoreAnswer,
} from '@alloy-works/db';
import {
  DEFAULT_CATALOGUE_VERSIONS,
  DEFAULT_THEME_VERSION,
  type Catalogue,
  type CatalogueKind,
  type Theme,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { API } from './addresses.js';

/**
 * **Where the suite writes a theme** (the W13 plan's B-C, its one exception): nothing in T1 makes a
 * theme through a route, so the themes W13.4 measures are written into the stack's own database by
 * `@alloy-works/db`'s theme writers, `addCatalogueVersion` and `addThemeVersion` - the store's own,
 * which refuse whatever the reader refuses, contrast among it (STY-069) - under the development
 * environment's tenant, found by the address the fixtures reach it at. The login is the service's own,
 * the compose stack's local default, which may take the tenant's role as the service does.
 */
export const DATABASE =
  process.env.ALLOY_BROWSER_DATABASE ??
  'postgres://aw_service:aw_service_dev@127.0.0.1:5432/alloy_dev';

/** The catalogues a theme written here brings of its own; the other two are the default's. */
export const OWN_KINDS = ['paragraph', 'character', 'table', 'image'] as const;
export type OwnKind = (typeof OWN_KINDS)[number];

/**
 * A theme to write: its content but for the catalogues it binds, which are written first and named by
 * the versions they become, and its four catalogues of its own at `catalogue/3`.
 */
export interface ThemeToWrite {
  readonly theme: Omit<Theme, 'catalogues'>;
  readonly catalogues: { readonly [K in OwnKind]: Extract<Catalogue, { kind: K }> };
}

/**
 * The artifacts a theme is written to: the theme's and one for each catalogue of its own, fixed, so
 * that a later run finds them and writes nothing where the theme has not changed.
 */
export interface ThemeArtifacts {
  readonly theme: string;
  readonly catalogues: Readonly<Record<OwnKind, string>>;
}

/**
 * The versions a new artifact starts from, the default theme's and its catalogues' as the stack holds
 * them, copied under the new artifact as its 0.1 - what a migration does for the default, since
 * nothing else makes a theme or a catalogue (`createArtifact` refuses both kinds). The version this
 * suite measures is the next one, written by the store's own writer.
 */
const SEEDS: Readonly<
  Record<'theme' | OwnKind, { readonly artifact: string; readonly version: string }>
> = {
  theme: { artifact: DEFAULT_THEME_ID, version: DEFAULT_THEME_VERSION },
  paragraph: {
    artifact: DEFAULT_CATALOGUE_IDS.paragraph,
    version: DEFAULT_CATALOGUE_VERSIONS.paragraph,
  },
  character: {
    artifact: DEFAULT_CATALOGUE_IDS.character,
    version: DEFAULT_CATALOGUE_VERSIONS.character,
  },
  table: { artifact: DEFAULT_CATALOGUE_IDS.table, version: DEFAULT_CATALOGUE_VERSIONS.table },
  image: { artifact: DEFAULT_CATALOGUE_IDS.image, version: DEFAULT_CATALOGUE_VERSIONS.image },
};

function refused(what: string, answer: ThemeStoreAnswer): Error {
  const why =
    answer.answer === 'refused'
      ? answer.refusals.map((each) => `${each.code}: ${each.message}`).join('\n')
      : answer.answer;
  return new Error(`The store refused ${what}:\n${why}`);
}

/**
 * Writes `written` to `artifacts` in the development environment, as Ada: each catalogue of its own,
 * then the theme naming the versions they are at. Answers the theme's artifact, for a template to
 * name. A theme or a catalogue the store refuses fails the test with every refusal the store gave,
 * which is how a generator it will not take is found and narrowed (the W13 plan's question 3).
 */
export async function writeTheme(
  artifacts: ThemeArtifacts,
  written: ThemeToWrite,
): Promise<string> {
  const database = createTenantDatabase(DATABASE, { max: 1 });
  try {
    const tenant = await database.resolveHostname(new URL(API).hostname);
    if (!tenant) throw new Error(`No environment answers to ${new URL(API).hostname}`);
    return await database.withTenant(tenant, async (trx) => {
      const ada = await trx
        .selectFrom('principal')
        .select('id')
        .where('subject', '=', 'ada')
        .executeTakeFirstOrThrow();

      /** The artifact's latest version, seeding it from the default's first where it is new. */
      const latest = async (kind: 'theme' | OwnKind, artifact: string): Promise<string> => {
        const found = await sql<{ id: string }>`
          select id from artifact_version where artifact_id = ${artifact}
          order by revision_no desc, version_no desc limit 1`.execute(trx);
        if (found.rows[0]) return found.rows[0].id;
        const seed = SEEDS[kind];
        await sql`insert into artifact (id, kind, space_id)
          values (${artifact}, ${kind === 'theme' ? 'theme' : 'catalogue'}, null)`.execute(trx);
        const made = await sql<{ id: string }>`
          insert into artifact_version (
            artifact_id, kind, revision_no, version_no, author_id, note, schema_version, content,
            content_hash, metadata_values, not_carried, component_type_version_id, version_digest)
          select ${artifact}, kind, 0, 1, null, 'Seeded by the browser suite from the default',
            schema_version, content, content_hash, metadata_values, not_carried, null, version_digest
          from artifact_version where id = ${seed.version} and artifact_id = ${seed.artifact}
          returning id`.execute(trx);
        if (!made.rows[0])
          throw new Error(`The default's ${kind} version ${seed.version} is not held`);
        return made.rows[0].id;
      };

      const bound: Record<CatalogueKind, string> = { ...DEFAULT_CATALOGUE_VERSIONS };
      for (const kind of OWN_KINDS) {
        const artifactId = artifacts.catalogues[kind];
        const answer = await addCatalogueVersion(trx, {
          artifactId,
          openedFrom: await latest(kind, artifactId),
          author: ada.id,
          catalogue: written.catalogues[kind],
        });
        if (answer.answer === 'recorded') bound[kind] = answer.version.id;
        else if (answer.answer === 'version.unchanged') bound[kind] = answer.current.id;
        else throw refused(`the ${kind} catalogue of ${written.theme.name}`, answer);
      }
      const theme: Theme = { ...written.theme, catalogues: bound };
      const answer = await addThemeVersion(trx, {
        artifactId: artifacts.theme,
        openedFrom: await latest('theme', artifacts.theme),
        author: ada.id,
        theme,
      });
      if (answer.answer !== 'recorded' && answer.answer !== 'version.unchanged') {
        throw refused(`the theme ${written.theme.name}`, answer);
      }
      return artifacts.theme;
    });
  } finally {
    await database.close();
  }
}
