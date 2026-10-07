import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUE_VERSIONS,
  DEFAULT_THEME,
  DEFAULT_THEME_VERSION,
  defaultLayout as productDefaultLayout,
  FIFTH_DEFAULT_CATALOGUE_VERSIONS,
  LAYOUT_SCHEMA_VERSION,
  SEVENTH_DEFAULT_LAYOUT,
  EIGHTH_DEFAULT_LAYOUT,
  SIXTH_DEFAULT_THEME,
  SIXTH_DEFAULT_THEME_VERSION,
  type Layout,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createDocument } from './documents.js';
import { DEFAULT_LAYOUT_ID, defaultLayout } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { publicationInputs, requestPublication } from './publishing.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import {
  addCatalogueVersion,
  addThemeVersion,
  DEFAULT_CATALOGUE_IDS,
  DEFAULT_THEME_ID,
  defaultTheme,
} from './themes.js';
import { recordVersion } from './versions.js';

/**
 * Migration 0055 (the TB1 plan, TB1-F and TB1-G): the table catalogue's fifth version, the default
 * theme's 0.7 naming it and the default layout's 0.8, each only over the product's own chain, so an
 * environment that recorded a theme, a table catalogue or a layout of its own keeps it.
 */
describe('migration 0055, which gives the default theme and layout what a bound table reads', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;
  let through: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration before 0055 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0055-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 55;
      },
    });
    // And every one through 0055, so this is 0055's alone, whatever comes after it.
    through = await mkdtemp(join(tmpdir(), 'aw-through-0055-'));
    await cp(new URL('../migrations/', import.meta.url), through, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) <= 55;
      },
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await rm(through, { recursive: true, force: true });
    await db?.drop();
  });

  /** A tenant standing before 0055, with Ada in it. */
  const beforeTables = async (name: string) => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant: Tenant = { ...provisioned, id };
    const ada = await service.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    return { tenant, ada };
  };

  const migrated = async (tenant: Tenant) =>
    expect(
      (await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${through}/`) })).tenants[
        tenant.id
      ],
    ).toEqual(['0055_bound_tables']);

  /** Every version of one artifact, by identifier and number, in the chain's order. */
  const chainOf = (tenant: Tenant, artifactId: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['id', 'version_no', 'author_id', 'schema_version'])
        .where('artifact_id', '=', artifactId)
        .orderBy('revision_no')
        .orderBy('version_no')
        .execute(),
    );

  const ask = async (trx: TenantTransaction, ada: string) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const made = await createDocument(trx, {
      spaceId: general.id,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    const asked = await requestPublication(trx, {
      documentId: made.version.artifactId,
      version: made.version.id,
      formats: ['pdf'],
      requester: ada,
    });
    if (asked.answer !== 'requested') throw new Error(asked.answer);
    return asked.request.id;
  };

  it("gives an environment still at the product's own the table catalogue's fifth, the theme's 0.7 and the layout's 0.8: a request waiting keeps what it was made under", async () => {
    const { tenant, ada } = await beforeTables('Still 0.6');
    const { waiting, layoutBefore } = await service.withTenant(tenant, async (trx) => ({
      waiting: await ask(trx, ada),
      layoutBefore: (await defaultLayout(trx)).versionId,
    }));
    await migrated(tenant);

    expect((await chainOf(tenant, DEFAULT_CATALOGUE_IDS.table)).at(-1)).toEqual({
      id: DEFAULT_CATALOGUE_VERSIONS.table,
      version_no: 5,
      author_id: null,
      schema_version: 3,
    });
    expect((await chainOf(tenant, DEFAULT_THEME_ID)).slice(-2)).toEqual([
      { id: SIXTH_DEFAULT_THEME_VERSION, version_no: 6, author_id: null, schema_version: 1 },
      { id: DEFAULT_THEME_VERSION, version_no: 7, author_id: null, schema_version: 1 },
    ]);
    expect((await chainOf(tenant, DEFAULT_LAYOUT_ID)).at(-1)).toMatchObject({
      version_no: 8,
      author_id: null,
      schema_version: 7,
    });

    const { theme, layout, handed, made } = await service.withTenant(tenant, async (trx) => {
      const now = await ask(trx, ada);
      return {
        theme: await defaultTheme(trx),
        layout: await defaultLayout(trx),
        handed: await publicationInputs(trx, waiting),
        made: await publicationInputs(trx, now),
      };
    });
    expect(theme).toMatchObject({ versionId: DEFAULT_THEME_VERSION, number: '0.7' });
    expect(theme.theme.tableStyles.get('table')).toMatchObject({
      fields: DEFAULT_CATALOGUES.table.styles[0]!.fields,
      unitBrackets: 'parentheses',
    });
    expect(layout).toMatchObject({ number: '0.8', layout: EIGHTH_DEFAULT_LAYOUT });
    // The request waiting keeps the 0.6 and the 0.7 it was made under; one made now records the new.
    expect(handed!.theme!.versionId).toBe(SIXTH_DEFAULT_THEME_VERSION);
    expect(handed!.layout).toEqual({
      versionId: layoutBefore,
      layout: { ...SEVENTH_DEFAULT_LAYOUT, schemaVersion: LAYOUT_SCHEMA_VERSION },
    });
    expect(made!.theme!.versionId).toBe(DEFAULT_THEME_VERSION);
    expect(made!.layout!.versionId).toBe(layout.versionId);
  });

  it('leaves a theme and a layout an environment recorded after the product its own, giving neither a version on top', async () => {
    const { tenant, ada } = await beforeTables('Own theme and layout');
    const own = await service.withTenant(tenant, async (trx) => {
      const theme = await addThemeVersion(trx, {
        artifactId: DEFAULT_THEME_ID,
        openedFrom: (await defaultTheme(trx)).versionId,
        author: ada,
        theme: { ...SIXTH_DEFAULT_THEME, name: 'Our own' },
      });
      const layout = await recordVersion(trx, {
        artifactId: DEFAULT_LAYOUT_ID,
        openedFrom: (await defaultLayout(trx)).versionId,
        author: ada,
        substance: {
          kind: 'layout',
          content: {
            ...productDefaultLayout,
            words: { ...productDefaultLayout.words, contents: 'Table of contents' },
          } satisfies Layout,
        },
      });
      if (theme.answer !== 'recorded' || layout.answer !== 'recorded') throw new Error('refused');
      return { theme: theme.version.id, layout: layout.version.id };
    });
    await migrated(tenant);
    expect((await chainOf(tenant, DEFAULT_THEME_ID)).at(-1)!.id).toBe(own.theme);
    expect((await chainOf(tenant, DEFAULT_LAYOUT_ID)).at(-1)!.id).toBe(own.layout);
    // The table catalogue's fifth goes in all the same: it is named by nothing until a theme names it.
    expect((await chainOf(tenant, DEFAULT_CATALOGUE_IDS.table)).at(-1)!.id).toBe(
      DEFAULT_CATALOGUE_VERSIONS.table,
    );
    expect(
      (await service.withTenant(tenant, (trx) => defaultTheme(trx))).theme.tableStyles.get('table'),
    ).not.toHaveProperty('fields');
  });

  it('gives no 0.7 where the environment recorded a table catalogue of its own, so the fifth did not go in', async () => {
    const { tenant, ada } = await beforeTables('Own table catalogue');
    const own = await service.withTenant(tenant, async (trx) => {
      const recorded = await addCatalogueVersion(trx, {
        artifactId: DEFAULT_CATALOGUE_IDS.table,
        openedFrom: FIFTH_DEFAULT_CATALOGUE_VERSIONS.table,
        author: ada,
        catalogue: {
          ...DEFAULT_CATALOGUES.table,
          styles: DEFAULT_CATALOGUES.table.styles.map((style) => ({ ...style, padding: 6 })),
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version.id;
    });
    await migrated(tenant);
    expect((await chainOf(tenant, DEFAULT_CATALOGUE_IDS.table)).at(-1)!.id).toBe(own);
    expect((await chainOf(tenant, DEFAULT_THEME_ID)).at(-1)!.id).toBe(SIXTH_DEFAULT_THEME_VERSION);
  });

  it('leaves an environment upgraded to it alike a fresh one: the theme, its table catalogue and the layout', async () => {
    const { tenant: upgraded } = await beforeTables('Upgraded');
    await migrate(db.migratorUrl);
    const fresh = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Fresh' },
      hostnames: ['fresh.acme.alloy.test'],
    });
    const shape = async (tenant: Tenant) => ({
      // Past each 0.1, whose identifier each environment was left to give it.
      theme: (await chainOf(tenant, DEFAULT_THEME_ID)).slice(1),
      table: await chainOf(tenant, DEFAULT_CATALOGUE_IDS.table),
      layout: (await chainOf(tenant, DEFAULT_LAYOUT_ID)).map((each) => ({ ...each, id: null })),
      declared: (await service.withTenant(tenant, (trx) => defaultTheme(trx))).content,
    });
    const shaped = await shape(upgraded);
    expect(shaped).toEqual(await shape(fresh));
    expect(shaped.declared).toEqual(DEFAULT_THEME);
  });
});
