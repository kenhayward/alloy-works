import {
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUE_VERSIONS,
  DEFAULT_THEME,
  upgradeCatalogue1,
  type ParagraphCatalogue,
  type Theme,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import {
  addCatalogueVersion,
  addThemeVersion,
  DEFAULT_CATALOGUE_IDS,
  DEFAULT_THEME_ID,
  defaultTheme,
  type ThemeStoreAnswer,
} from './themes.js';
import { latestVersion } from './versions.js';

const PARAGRAPHS = DEFAULT_CATALOGUE_IDS.paragraph;

/** The default paragraph catalogue with one style's stated properties replaced. */
function withStyle(
  catalogue: ParagraphCatalogue,
  id: string,
  properties: ParagraphCatalogue['styles'][number]['properties'],
): ParagraphCatalogue {
  return {
    ...catalogue,
    styles: catalogue.styles.map((style) =>
      style.id === id ? { ...style, properties: { ...style.properties, ...properties } } : style,
    ),
  };
}

/** The version an answer recorded, or a failure naming what it answered instead. */
function recorded(answer: ThemeStoreAnswer) {
  if (answer.answer !== 'recorded') throw new Error(JSON.stringify(answer));
  return answer.version;
}

describe("the theme's store", () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let tenants = 0;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  /** A fresh environment, at the default theme, with Ada in it: each test's own. */
  const environment = async (): Promise<Tenant> => {
    tenants += 1;
    return createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: `Themes ${tenants}` },
      hostnames: [`themes-${tenants}.acme.alloy.test`],
    });
  };

  const ada = (trx: TenantTransaction) =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const versionsOf = (trx: TenantTransaction, artifactId: string) =>
    trx
      .selectFrom('artifact_version')
      .select('id')
      .where('artifact_id', '=', artifactId)
      .execute()
      .then((rows) => rows.length);

  it('STY-005 refuses a catalogue version bringing back a style identifier an earlier version dropped', async () => {
    const tenant = await environment();
    await service.withTenant(tenant, async (trx) => {
      const author = await ada(trx);
      const first = DEFAULT_CATALOGUES.paragraph;

      // 0.2 drops `attribution` and allocates `epigraph` in its place.
      const second: ParagraphCatalogue = {
        ...first,
        styles: [
          ...first.styles.filter((style) => style.id !== 'attribution'),
          {
            id: 'epigraph',
            name: 'Epigraph',
            basedOn: 'body',
            appliesTo: ['attribution'],
            properties: {},
          },
        ],
      };
      const two = recorded(
        await addCatalogueVersion(trx, {
          artifactId: PARAGRAPHS,
          openedFrom: DEFAULT_CATALOGUE_VERSIONS.paragraph,
          author,
          catalogue: second,
        }),
      );

      // 0.3 bringing `attribution` back is refused, naming it, and nothing is written.
      expect(
        await addCatalogueVersion(trx, {
          artifactId: PARAGRAPHS,
          openedFrom: two.id,
          author,
          catalogue: {
            ...second,
            styles: [...second.styles, first.styles.find((s) => s.id === 'attribution')!],
          },
        }),
      ).toEqual({
        answer: 'refused',
        refusals: [
          {
            code: 'style_reused',
            message:
              'The style identifier attribution was dropped by an earlier version of this catalogue, and is never used again',
          },
        ],
      });
      expect(await versionsOf(trx, PARAGRAPHS)).toBe(3);

      // Every identifier the latest version holds keeps meaning what it meant, and a new one is
      // allocated beside them: 0.3 records.
      const three = recorded(
        await addCatalogueVersion(trx, {
          artifactId: PARAGRAPHS,
          openedFrom: two.id,
          author,
          catalogue: {
            ...second,
            styles: [
              ...second.styles,
              {
                id: 'pull-quote',
                name: 'Pull quote',
                basedOn: 'quotation',
                appliesTo: ['quotation'],
                properties: {},
              },
            ],
          },
        }),
      );
      expect(three).toMatchObject({ kind: 'catalogue', revision: 0, version: 4 });
    });
  });

  it('refuses a catalogue version the reader refuses, or one of another kind, writing nothing', async () => {
    const tenant = await environment();
    await service.withTenant(tenant, async (trx) => {
      const author = await ada(trx);
      const body = DEFAULT_CATALOGUES.paragraph.styles[0]!;
      const twice = await addCatalogueVersion(trx, {
        artifactId: PARAGRAPHS,
        openedFrom: DEFAULT_CATALOGUE_VERSIONS.paragraph,
        author,
        catalogue: {
          ...DEFAULT_CATALOGUES.paragraph,
          styles: [...DEFAULT_CATALOGUES.paragraph.styles, body],
        },
      });
      expect(twice).toMatchObject({ answer: 'refused', refusals: [{ code: 'style_duplicate' }] });

      const character = await addCatalogueVersion(trx, {
        artifactId: PARAGRAPHS,
        openedFrom: DEFAULT_CATALOGUE_VERSIONS.paragraph,
        author,
        catalogue: DEFAULT_CATALOGUES.character,
      });
      expect(character).toEqual({
        answer: 'refused',
        refusals: [
          {
            code: 'catalogue_wrong_kind',
            message: `The catalogue ${PARAGRAPHS} is a paragraph catalogue, and a version of it cannot be a character catalogue`,
          },
        ],
      });
      expect(await versionsOf(trx, PARAGRAPHS)).toBe(2);
    });
  });

  it('answers a catalogue version as the chain does: unchanged, stale, or no such catalogue', async () => {
    const tenant = await environment();
    await service.withTenant(tenant, async (trx) => {
      const author = await ada(trx);
      const same = await addCatalogueVersion(trx, {
        artifactId: PARAGRAPHS,
        openedFrom: DEFAULT_CATALOGUE_VERSIONS.paragraph,
        author,
        catalogue: DEFAULT_CATALOGUES.paragraph,
      });
      expect(same).toMatchObject({
        answer: 'version.unchanged',
        current: { id: DEFAULT_CATALOGUE_VERSIONS.paragraph },
      });
      const next = withStyle(DEFAULT_CATALOGUES.paragraph, 'caption', { italic: true });
      recorded(
        await addCatalogueVersion(trx, {
          artifactId: PARAGRAPHS,
          openedFrom: DEFAULT_CATALOGUE_VERSIONS.paragraph,
          author,
          catalogue: next,
        }),
      );
      expect(
        await addCatalogueVersion(trx, {
          artifactId: PARAGRAPHS,
          openedFrom: DEFAULT_CATALOGUE_VERSIONS.paragraph,
          author,
          catalogue: withStyle(next, 'caption', { bold: true }),
        }),
      ).toMatchObject({ answer: 'version.precondition' });
      expect(
        await addCatalogueVersion(trx, {
          artifactId: '00000000-0000-4000-8000-000000000000',
          openedFrom: DEFAULT_CATALOGUE_VERSIONS.paragraph,
          author,
          catalogue: next,
        }),
      ).toEqual({ answer: 'artifact.missing' });
    });
  });

  it('answers unchanged for a catalogue held at catalogue/1 saved again as it reads, at either version of the shape', async () => {
    const tenant = await environment();
    await service.withTenant(tenant, async (trx) => {
      const author = await ada(trx);
      // The character catalogue's 0.1 is still the row 0024 seeded, at catalogue/1. Saved as it is
      // held, or as the reader upgrades it, it is the same catalogue: the two are compared as both
      // read, never by the shape either is written in, so neither records a version.
      const characters = DEFAULT_CATALOGUE_IDS.character;
      for (const catalogue of [
        DEFAULT_CATALOGUES.character,
        upgradeCatalogue1(DEFAULT_CATALOGUES.character),
      ]) {
        expect(
          await addCatalogueVersion(trx, {
            artifactId: characters,
            openedFrom: DEFAULT_CATALOGUE_VERSIONS.character,
            author,
            catalogue,
          }),
          `catalogue/${catalogue.schemaVersion}`,
        ).toMatchObject({
          answer: 'version.unchanged',
          current: { id: DEFAULT_CATALOGUE_VERSIONS.character, schemaVersion: 1 },
        });
      }
      expect(await versionsOf(trx, characters)).toBe(1);

      // Opened from anything but its latest, it is stale before it is compared, as the chain answers.
      expect(
        await addCatalogueVersion(trx, {
          artifactId: characters,
          openedFrom: DEFAULT_CATALOGUE_VERSIONS.paragraph,
          author,
          catalogue: DEFAULT_CATALOGUES.character,
        }),
      ).toMatchObject({
        answer: 'version.precondition',
        current: { id: DEFAULT_CATALOGUE_VERSIONS.character },
      });

      // A change is still a change, and is written as it reads, at catalogue/2.
      const renamed = recorded(
        await addCatalogueVersion(trx, {
          artifactId: characters,
          openedFrom: DEFAULT_CATALOGUE_VERSIONS.character,
          author,
          catalogue: {
            ...DEFAULT_CATALOGUES.character,
            styles: DEFAULT_CATALOGUES.character.styles.map((style) =>
              style.id === 'strong' ? { ...style, name: 'Bold' } : style,
            ),
          },
        }),
      );
      expect(renamed).toMatchObject({ version: 2, schemaVersion: 2 });
    });
  });

  it('records a theme version binding a new catalogue version, and the environment is set from it', async () => {
    const tenant = await environment();
    await service.withTenant(tenant, async (trx) => {
      const author = await ada(trx);
      const declared = await defaultTheme(trx);
      const captions = recorded(
        await addCatalogueVersion(trx, {
          artifactId: PARAGRAPHS,
          openedFrom: DEFAULT_CATALOGUE_VERSIONS.paragraph,
          author,
          catalogue: withStyle(DEFAULT_CATALOGUES.paragraph, 'caption', { italic: true }),
        }),
      );
      const next: Theme = {
        ...declared.content,
        name: 'Italic captions',
        catalogues: { ...declared.content.catalogues, paragraph: captions.id },
      };
      const version = recorded(
        await addThemeVersion(trx, {
          artifactId: DEFAULT_THEME_ID,
          openedFrom: declared.versionId,
          author,
          note: 'Captions in italic',
          theme: next,
        }),
      );
      expect(version).toMatchObject({
        kind: 'theme',
        revision: 0,
        version: 4,
        author,
        content: next,
      });
      const now = await defaultTheme(trx);
      expect(now).toMatchObject({ versionId: version.id, number: '0.4', content: next });
      expect(now.theme.name).toBe('Italic captions');
      expect(now.theme.catalogues.paragraph).toBe(captions.id);
      expect(now.theme.paragraphStyles.get('caption')!.properties.italic).toBe(true);
    });
  });

  it("STY-069 refuses a theme whose text falls below its contrast minimum against its paper, or against a style's background, when it is saved", async () => {
    const tenant = await environment();
    await service.withTenant(tenant, async (trx) => {
      const author = await ada(trx);
      const declared = await defaultTheme(trx);
      const save = (theme: Theme) =>
        addThemeVersion(trx, {
          artifactId: DEFAULT_THEME_ID,
          openedFrom: declared.versionId,
          author,
          theme,
        });

      // Black body text on a dark grey paper.
      const onDarkPaper = await save({ ...DEFAULT_THEME, paper: '#333333' });
      expect(onDarkPaper.answer).toBe('refused');
      const paper = onDarkPaper.answer === 'refused' ? onDarkPaper.refusals : [];
      expect(paper.every((each) => each.code === 'contrast_too_low')).toBe(true);
      expect(paper.map((each) => each.message)).toContain(
        'The paragraph style body sets #000000 on the paper #333333 at 1.66:1, below the 4.5:1 its text needs',
      );

      // Preformatted text's own fill made near-black, under its black text: the catalogue is a
      // catalogue, and records; the theme binding it does not.
      const filled = recorded(
        await addCatalogueVersion(trx, {
          artifactId: PARAGRAPHS,
          openedFrom: DEFAULT_CATALOGUE_VERSIONS.paragraph,
          author,
          catalogue: withStyle(DEFAULT_CATALOGUES.paragraph, 'preformatted', {
            background: '#1a1a1a',
          }),
        }),
      );
      const onDarkFill = await save({
        ...DEFAULT_THEME,
        catalogues: { ...DEFAULT_THEME.catalogues, paragraph: filled.id },
      });
      expect(onDarkFill).toEqual({
        answer: 'refused',
        refusals: [
          {
            code: 'contrast_too_low',
            message:
              'The paragraph style preformatted sets #000000 on its background #1a1a1a at 1.20:1, below the 4.5:1 its text needs',
          },
        ],
      });

      // Neither was saved: the environment is set from the theme it was.
      expect(await versionsOf(trx, DEFAULT_THEME_ID)).toBe(3);
      expect((await latestVersion(trx, DEFAULT_THEME_ID))!.id).toBe(declared.versionId);
    });
  });

  it('refuses a theme naming a catalogue version the store does not hold as a catalogue', async () => {
    const tenant = await environment();
    await service.withTenant(tenant, async (trx) => {
      const author = await ada(trx);
      const declared = await defaultTheme(trx);
      const layout = await latestVersion(trx, DEFAULT_LAYOUT_ID);
      const answer = await addThemeVersion(trx, {
        artifactId: DEFAULT_THEME_ID,
        openedFrom: declared.versionId,
        author,
        theme: {
          ...DEFAULT_THEME,
          catalogues: { ...DEFAULT_THEME.catalogues, image: layout!.id },
        },
      });
      expect(answer).toEqual({
        answer: 'refused',
        refusals: [
          {
            code: 'catalogue_missing',
            message: `The theme's image catalogue, version ${layout!.id}, was not found`,
          },
        ],
      });
      expect(await versionsOf(trx, DEFAULT_THEME_ID)).toBe(3);
    });
  });
});
