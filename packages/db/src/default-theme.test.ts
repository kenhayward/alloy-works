import {
  CATALOGUE_KINDS,
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_CATALOGUE_VERSIONS,
  DEFAULT_THEME,
  DEFAULT_THEME_VERSION,
  FIRST_DEFAULT_CATALOGUES,
  FIRST_DEFAULT_CATALOGUE_VERSIONS,
  FIRST_DEFAULT_THEME,
  readTheme,
  SECOND_DEFAULT_THEME,
  SECOND_DEFAULT_THEME_VERSION,
  type CatalogueKind,
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
  const read = readTheme(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('; '));
  return read.theme;
}

/**
 * The catalogues the theme's 0.2 gave a version of their own (themes 2, ruling R3), by 0025; the other
 * three are bound at the 0.1 0024 seeded.
 */
const REVISED: readonly CatalogueKind[] = ['paragraph', 'table', 'image'];

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

  it('STY-024 is a versioned artifact in every environment, at 0.3, binding one catalogue version of each of the six kinds', async () => {
    for (const tenant of [acme, other]) {
      const declared = await service.withTenant(tenant, (trx) => defaultTheme(trx));
      const theme = await held(tenant, DEFAULT_THEME_ID);
      expect(theme.artifact).toMatchObject({ kind: 'theme', space_id: null });
      // 0.1 as 0024 seeded it, 0.2 on top, as 0025 seeded it under its fixed identifier, and 0.3 on
      // top of that, as 0026 did.
      expect(theme.versions).toHaveLength(3);
      const [first, second, third] = theme.versions;
      const seeded = { ...unauthored, kind: 'theme', revision_no: 0, schema_version: 1 };
      expect(first).toMatchObject({ ...seeded, version_no: 1 });
      expect(second).toMatchObject({ ...seeded, id: SECOND_DEFAULT_THEME_VERSION, version_no: 2 });
      expect(third).toMatchObject({ ...seeded, id: DEFAULT_THEME_VERSION, version_no: 3 });
      expect(declared).toEqual({
        artifactId: DEFAULT_THEME_ID,
        versionId: DEFAULT_THEME_VERSION,
        number: '0.3',
        content: DEFAULT_THEME,
        theme: productDefaultTheme(),
      });

      // It binds six catalogue versions, one of each kind, each a version of an artifact of its own:
      // three at the 0.2 0025 gave them, at catalogue/2, and three at 0024's 0.1, at catalogue/1.
      expect(Object.keys(declared.theme.catalogues).sort()).toEqual([...CATALOGUE_KINDS].sort());
      for (const kind of CATALOGUE_KINDS) {
        const catalogue = await held(tenant, DEFAULT_CATALOGUE_IDS[kind]);
        const revised = REVISED.includes(kind);
        expect(catalogue.artifact, kind).toMatchObject({ kind: 'catalogue', space_id: null });
        expect(catalogue.versions, kind).toHaveLength(revised ? 2 : 1);
        const stored = { ...unauthored, kind: 'catalogue', revision_no: 0 };
        expect(catalogue.versions[0], kind).toMatchObject({
          ...stored,
          id: FIRST_DEFAULT_CATALOGUE_VERSIONS[kind],
          version_no: 1,
          schema_version: 1,
        });
        if (revised) {
          expect(catalogue.versions[1], kind).toMatchObject({
            ...stored,
            id: DEFAULT_CATALOGUE_VERSIONS[kind],
            version_no: 2,
            schema_version: 2,
          });
        }
        for (const version of catalogue.versions) {
          expect((version.content as { kind: string }).kind, kind).toBe(kind);
        }
        expect(declared.theme.catalogues[kind]).toBe(DEFAULT_CATALOGUE_VERSIONS[kind]);
      }
    }
  });

  it("holds each of the domain's default themes and their catalogues exactly, with the digests the domain computes", async () => {
    // Every row, by its fixed identifier, against the domain's data for it: 0.1's seven as 0024 seeded
    // them, 0.2's four as 0025 did, and 0.3's theme as 0026 did.
    const theme = await held(acme, DEFAULT_THEME_ID);
    const expected = new Map<string, { kind: 'theme' | 'catalogue'; content: unknown }>([
      [theme.versions[0]!.id, { kind: 'theme', content: FIRST_DEFAULT_THEME }],
      [SECOND_DEFAULT_THEME_VERSION, { kind: 'theme', content: SECOND_DEFAULT_THEME }],
      [DEFAULT_THEME_VERSION, { kind: 'theme', content: DEFAULT_THEME }],
    ]);
    for (const kind of CATALOGUE_KINDS) {
      expected.set(FIRST_DEFAULT_CATALOGUE_VERSIONS[kind], {
        kind: 'catalogue',
        content: FIRST_DEFAULT_CATALOGUES[kind],
      });
      expected.set(DEFAULT_CATALOGUE_VERSIONS[kind], {
        kind: 'catalogue',
        content: DEFAULT_CATALOGUES[kind],
      });
    }
    const rows = [
      ...theme.versions,
      ...(
        await Promise.all(CATALOGUE_KINDS.map((kind) => held(acme, DEFAULT_CATALOGUE_IDS[kind])))
      ).flatMap((each) => each.versions),
    ];
    // Three theme versions, and nine catalogue versions: six at 0.1, three at 0.2.
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((row) => row.id))).toEqual(new Set(expected.keys()));
    for (const version of rows) {
      const substance = expected.get(version.id)!;
      const name = `${version.id} (${version.kind} 0.${version.version_no})`;
      expect(version.content, name).toEqual(substance.content);
      const digests = versionDigests(substance as Parameters<typeof versionDigests>[0]);
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
          substance: { kind: 'theme', content: { ...DEFAULT_THEME, name: 'Another' } },
        }),
      ).rejects.toThrow(/addThemeVersion/);
      await expect(
        recordVersion(trx, {
          artifactId: DEFAULT_CATALOGUE_IDS.table,
          openedFrom: DEFAULT_CATALOGUE_VERSIONS.table,
          author: ada.id,
          substance: { kind: 'catalogue', content: { ...DEFAULT_CATALOGUES.table, styles: [] } },
        }),
      ).rejects.toThrow(/addCatalogueVersion/);
      await expect(
        createArtifact(trx, {
          author: ada.id,
          substance: { kind: 'theme', content: DEFAULT_THEME },
        }),
      ).rejects.toThrow(/by its migration/);
    });
  });
});
