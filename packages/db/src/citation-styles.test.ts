import {
  CitationStyleRefused,
  DEFAULT_CATALOGUE_VERSIONS,
  DEFAULT_CITATION_STYLE,
  SEEDED_CITATION_STYLES,
  SEEDED_REQUIRES,
  type CitationStyle,
} from '@alloy-works/domain';
import { SEEDED_STYLE_FILES } from '@alloy-works/domain/citations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  createStyle,
  listStyles,
  readStyle,
  readStyleVersion,
  recordStyleVersion,
} from './citation-styles.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import { addCatalogueVersion, DEFAULT_CATALOGUE_IDS, defaultTheme } from './themes.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { versionDigests } from './version-digest.js';

const ISSUER = 'https://idp.example';

/** Harvard renamed: a style an administrator uploads, as any published CSL style is. */
const coastal = (): CitationStyle => ({
  schemaVersion: 1,
  name: 'Coastal Studies',
  csl: SEEDED_STYLE_FILES['harvard-cite-them-right'].replace(
    /<title>[^<]*<\/title>/,
    '<title>Journal of Coastal Studies</title>',
  ),
  requires: { 'article-journal': ['title', 'container-title', 'volume'] },
});

describe('a citation style', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    ada = await service.withTenant(production, (trx) => person(trx, 'ada', 'Ada'));
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('CNT-102 STY-021 every tenant holds Harvard, Vancouver and CSE, unauthored, their digests those the migration states', async () => {
    const styles = await service.withTenant(production, (trx) => listStyles(trx));
    expect(styles.map((each) => each.style.name)).toEqual(['CSE', 'Harvard', 'Vancouver']);
    for (const seeded of SEEDED_CITATION_STYLES) {
      const style = styles.find((each) => each.id === seeded.id)!;
      expect(style).toMatchObject({
        seeded: true,
        style: {
          schemaVersion: 1,
          name: seeded.name,
          csl: SEEDED_STYLE_FILES[seeded.file],
          requires: SEEDED_REQUIRES,
        },
        version: { id: seeded.version, author: null, revision: 0, version: 1 },
      });
      expect(versionDigests({ kind: 'citationStyle', content: style.style })).toEqual({
        contentHash: style.version.contentHash,
        versionDigest: style.version.versionDigest,
      });
    }
  });

  it("names Harvard, at its seeded version, as the default theme's style, and reads a style at that version", async () => {
    await service.withTenant(production, async (trx) => {
      const theme = await defaultTheme(trx);
      expect(theme.theme.citationStyle).toEqual({
        id: DEFAULT_CITATION_STYLE.id,
        version: DEFAULT_CITATION_STYLE.version,
      });
      expect(theme.theme.catalogues.citation).toBe(DEFAULT_CATALOGUE_VERSIONS.citation);
      const at = await readStyleVersion(trx, DEFAULT_CITATION_STYLE.version);
      expect(at).toMatchObject({ id: DEFAULT_CITATION_STYLE.id, style: { name: 'Harvard' } });
      // A version of anything else is no style's.
      expect(await readStyleVersion(trx, DEFAULT_CATALOGUE_VERSIONS.citation)).toBeUndefined();
      expect(await readStyleVersion(trx, 'not-a-version')).toBeUndefined();
    });
  });

  it('STY-023 is added as a CSL file and versioned without a release', async () => {
    await service.withTenant(production, async (trx) => {
      const made = await createStyle(trx, { author: ada, style: coastal() });
      if (made.answer !== 'created') throw new Error(made.answer);
      expect(made.style).toMatchObject({
        seeded: false,
        style: { name: 'Coastal Studies' },
        version: { author: ada, revision: 0, version: 1 },
      });
      const next = await recordStyleVersion(trx, {
        author: ada,
        id: made.style.id,
        openedFrom: made.style.version.id,
        style: { ...coastal(), requires: { book: ['title'] } },
      });
      expect(next).toMatchObject({ answer: 'recorded', style: { version: { version: 2 } } });
      // A writer who opened the first version is told of the second.
      const stale = await recordStyleVersion(trx, {
        author: ada,
        id: made.style.id,
        openedFrom: made.style.version.id,
        style: coastal(),
      });
      expect(stale.answer).toBe('version.precondition');
      expect((await readStyle(trx, made.style.id))?.style.requires).toEqual({ book: ['title'] });
      expect(await readStyle(trx, DEFAULT_CATALOGUE_IDS.citation)).toBeUndefined();
    });
  });

  it('STY-020 refuses at write a file that is not CSL 1.0.2 with both forms, and one with no requires', async () => {
    await service.withTenant(production, async (trx) => {
      const refused = await createStyle(trx, {
        author: ada,
        style: {
          ...coastal(),
          csl: coastal().csl.replace(/<bibliography[\s\S]*<\/bibliography>/, ''),
        },
      });
      expect(refused).toEqual({
        answer: 'style.refused',
        problems: [
          {
            rule: 'style_invalid',
            path: 'csl',
            message: 'The style declares no bibliography form',
          },
        ],
      });
      const unrequired: Record<string, unknown> = { ...coastal() };
      delete unrequired['requires'];
      expect(await createStyle(trx, { author: ada, style: unrequired })).toMatchObject({
        answer: 'style.refused',
        problems: [{ path: 'requires' }],
      });
      // Never through the general writer either.
      const { createArtifact } = await import('./versions.js');
      await expect(
        createArtifact(trx, {
          author: ada,
          substance: { kind: 'citationStyle', content: { ...coastal(), csl: '<style/>' } },
        }),
      ).rejects.toBeInstanceOf(CitationStyleRefused);
    });
  });

  it("refuses a citation catalogue naming a version that is not that style's", async () => {
    await service.withTenant(production, async (trx) => {
      const [vancouver] = SEEDED_CITATION_STYLES.filter((each) => each.name === 'Vancouver');
      const answer = await addCatalogueVersion(trx, {
        author: ada,
        artifactId: DEFAULT_CATALOGUE_IDS.citation,
        openedFrom: DEFAULT_CATALOGUE_VERSIONS.citation,
        catalogue: {
          schemaVersion: 4,
          kind: 'citation',
          style: { id: vancouver!.id, version: DEFAULT_CITATION_STYLE.version },
        },
      });
      expect(answer).toMatchObject({
        answer: 'refused',
        refusals: [{ code: 'citation_style_missing' }],
      });
      const named = await addCatalogueVersion(trx, {
        author: ada,
        artifactId: DEFAULT_CATALOGUE_IDS.citation,
        openedFrom: DEFAULT_CATALOGUE_VERSIONS.citation,
        catalogue: {
          schemaVersion: 4,
          kind: 'citation',
          style: { id: vancouver!.id, version: vancouver!.version },
        },
      });
      expect(named.answer).toBe('recorded');
    });
  });
});
