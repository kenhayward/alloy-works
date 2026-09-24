import {
  CATALOGUE_KINDS,
  FIRST_DEFAULT_CATALOGUES,
  FIRST_DEFAULT_CATALOGUES_BY_VERSION,
  FIRST_DEFAULT_CATALOGUE_VERSIONS,
  FIRST_DEFAULT_THEME,
  readTheme,
  type ResolvedTheme,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { DEFAULT_CATALOGUE_IDS, DEFAULT_THEME_ID, defaultTheme } from './themes.js';
import { versionDigests } from './version-digest.js';
import { createArtifact, recordVersion } from './versions.js';

/** The default theme as the domain reads it from its own data: what every environment must hold. */
function productDefaultTheme(): ResolvedTheme {
  const read = readTheme(FIRST_DEFAULT_THEME, FIRST_DEFAULT_CATALOGUES_BY_VERSION);
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('; '));
  return read.theme;
}

describe('the theme every environment starts with', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let acme: Tenant;
  let other: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    acme = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  /** Every version of one artifact, as the chain holds them, with the artifact's own row. */
  const held = (tenant: Tenant, artifactId: string) =>
    service.withTenant(tenant, async (trx) => ({
      artifact: await trx
        .selectFrom('artifact')
        .selectAll()
        .where('id', '=', artifactId)
        .executeTakeFirstOrThrow(),
      versions: await trx
        .selectFrom('artifact_version')
        .selectAll()
        .where('artifact_id', '=', artifactId)
        .orderBy('revision_no')
        .orderBy('version_no')
        .execute(),
    }));

  const unauthored = { author_id: null, note: null, component_type_version_id: null };

  it('STY-024 is a versioned artifact in every environment, at 0.1, binding one catalogue version of each of the six kinds', async () => {
    for (const tenant of [acme, other]) {
      const declared = await service.withTenant(tenant, (trx) => defaultTheme(trx));
      const theme = await held(tenant, DEFAULT_THEME_ID);
      expect(theme.artifact).toMatchObject({ kind: 'theme', space_id: null });
      expect(theme.versions).toHaveLength(1);
      const [version] = theme.versions;
      expect(version).toMatchObject({
        ...unauthored,
        kind: 'theme',
        revision_no: 0,
        version_no: 1,
        schema_version: 1,
      });
      expect(declared).toEqual({
        artifactId: DEFAULT_THEME_ID,
        versionId: version!.id,
        number: '0.1',
        content: FIRST_DEFAULT_THEME,
        theme: productDefaultTheme(),
      });

      // It binds six catalogue versions, one of each kind, each a version of an artifact of its own.
      expect(Object.keys(declared.theme.catalogues).sort()).toEqual([...CATALOGUE_KINDS].sort());
      for (const kind of CATALOGUE_KINDS) {
        const catalogue = await held(tenant, DEFAULT_CATALOGUE_IDS[kind]);
        expect(catalogue.artifact, kind).toMatchObject({ kind: 'catalogue', space_id: null });
        expect(catalogue.versions, kind).toHaveLength(1);
        expect(catalogue.versions[0], kind).toMatchObject({
          ...unauthored,
          id: FIRST_DEFAULT_CATALOGUE_VERSIONS[kind],
          kind: 'catalogue',
          revision_no: 0,
          version_no: 1,
          schema_version: 1,
        });
        expect((catalogue.versions[0]!.content as { kind: string }).kind, kind).toBe(kind);
        expect(declared.theme.catalogues[kind]).toBe(FIRST_DEFAULT_CATALOGUE_VERSIONS[kind]);
      }
    }
  });

  it("holds the domain's default theme and its six catalogues exactly, with the digests the domain computes", async () => {
    const theme = await held(acme, DEFAULT_THEME_ID);
    const cases = [
      [theme.versions[0]!, { kind: 'theme', content: FIRST_DEFAULT_THEME }] as const,
      ...(await Promise.all(
        CATALOGUE_KINDS.map(async (kind) => {
          const catalogue = await held(acme, DEFAULT_CATALOGUE_IDS[kind]);
          return [
            catalogue.versions[0]!,
            { kind: 'catalogue', content: FIRST_DEFAULT_CATALOGUES[kind] },
          ] as const;
        }),
      )),
    ];
    for (const [version, substance] of cases) {
      const name = substance.kind === 'theme' ? 'theme' : `${substance.content.kind} catalogue`;
      expect(version.content, name).toEqual(substance.content);
      const digests = versionDigests(substance);
      expect(version.content_hash, name).toBe(digests.contentHash);
      expect(version.version_digest, name).toBe(digests.versionDigest);
    }
  });

  it('gives the runtime role no update, delete or truncate on the declaration', async () => {
    for (const statement of [
      sql`update theme_default set theme_id = ${DEFAULT_THEME_ID}`,
      sql`delete from theme_default`,
      sql`truncate theme_default`,
    ]) {
      await expect(service.withTenant(acme, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("records a theme or a catalogue through neither of the chain's general writers", async () => {
    await service.withTenant(acme, async (trx) => {
      const ada = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const declared = await defaultTheme(trx);
      await expect(
        recordVersion(trx, {
          artifactId: DEFAULT_THEME_ID,
          openedFrom: declared.versionId,
          author: ada.id,
          substance: { kind: 'theme', content: { ...FIRST_DEFAULT_THEME, name: 'Another' } },
        }),
      ).rejects.toThrow(/addThemeVersion/);
      await expect(
        recordVersion(trx, {
          artifactId: DEFAULT_CATALOGUE_IDS.table,
          openedFrom: FIRST_DEFAULT_CATALOGUE_VERSIONS.table,
          author: ada.id,
          substance: {
            kind: 'catalogue',
            content: { ...FIRST_DEFAULT_CATALOGUES.table, styles: [] },
          },
        }),
      ).rejects.toThrow(/addCatalogueVersion/);
      await expect(
        createArtifact(trx, {
          author: ada.id,
          substance: { kind: 'theme', content: FIRST_DEFAULT_THEME },
        }),
      ).rejects.toThrow(/by its migration/);
    });
  });
});
