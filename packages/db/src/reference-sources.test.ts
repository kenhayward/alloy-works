import type { ReferenceManifest } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  installedExtension,
  installExtension,
  removeExtension,
  setExtensionCredential,
  updateExtension,
} from './extensions.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  extensionTarget,
  referenceSourcesOn,
  setReferenceSource,
  tenantReferenceSources,
} from './reference-sources.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

describe("a tenant's reference sources (the XR plan, XR-C)", () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

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
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('holds each source on until it is switched off, and on again', async () => {
    expect(await tenant((trx) => referenceSourcesOn(trx))).toEqual({
      crossref: true,
      pubmed: true,
    });
    await tenant((trx) => setReferenceSource(trx, 'pubmed', false));
    expect(await tenant((trx) => referenceSourcesOn(trx))).toEqual({
      crossref: true,
      pubmed: false,
    });
    await tenant((trx) => setReferenceSource(trx, 'pubmed', true));
    expect((await tenant((trx) => referenceSourcesOn(trx))).pubmed).toBe(true);
  });

  /** An invented reference extension's manifest (the XR plan, XR-J). */
  const HERBARIUM: ReferenceManifest = {
    manifest: 1,
    name: 'Herbarium records',
    version: '0.3.0',
    publisher: 'Invented Herbarium',
    description: 'Specimen papers by catalogue number.',
    kind: 'reference',
    endpoint: 'https://herbarium.example.test/alloy',
    reference: { search: '/search', fetch: '/records' },
    authentication: { label: 'Access token' },
    outbound: [{ host: 'herbarium.example.test', purpose: 'The terms searched for' }],
  };

  it('LIB-032 joins a reference extension to the sources as ext and its id, on, with its secret sealed', async () => {
    const installed = await tenant((trx) =>
      installExtension(trx, {
        url: 'https://herbarium.example.test/manifest.json',
        digest: 'c'.repeat(64),
        manifest: HERBARIUM,
        by: null,
      }),
    );
    const key = `ext:${installed.id}`;
    const listed = await tenant((trx) => tenantReferenceSources(trx));
    expect(listed.map((each) => each.id)).toEqual(['crossref', 'pubmed', key]);
    expect(listed[2]).toEqual({
      id: key,
      name: 'Herbarium records',
      host: 'herbarium.example.test',
      identifier: 'Identifier',
      enabled: true,
      extension: {
        endpoint: HERBARIUM.endpoint,
        search: '/search',
        fetch: '/records',
        authenticated: true,
      },
    });
    await tenant((trx) => setExtensionCredential(trx, installed.id, 'v1.sealed', null));
    await tenant((trx) => setExtensionCredential(trx, installed.id, 'v1.newer', null));
    expect((await tenant((trx) => tenantReferenceSources(trx)))[2]?.extension?.sealed).toBe(
      'v1.newer',
    );
    expect((await tenant((trx) => referenceSourcesOn(trx)))[key]).toBe(true);
  });

  it('LIB-032 refuses removing a reference extension while it is on, and drops it from the sources once removed', async () => {
    const installed = await tenant((trx) =>
      installExtension(trx, {
        url: 'https://herbarium.example.test/other.json',
        digest: 'd'.repeat(64),
        manifest: { ...HERBARIUM, authentication: 'none' },
        by: null,
      }),
    );
    const key = `ext:${installed.id}` as const;
    expect(await tenant((trx) => removeExtension(trx, installed.id, null))).toEqual({
      switchedOn: true,
    });
    await tenant((trx) => setReferenceSource(trx, key, false));
    expect(await tenant((trx) => removeExtension(trx, installed.id, null))).toEqual({
      removed: true,
    });
    const listed = await tenant((trx) => tenantReferenceSources(trx));
    expect(listed.map((each) => each.id)).not.toContain(key);
    expect(await tenant((trx) => referenceSourcesOn(trx))).not.toHaveProperty(key);
  });

  it('reads a reference extension by its latest manifest', async () => {
    const installed = await tenant((trx) =>
      installExtension(trx, {
        url: 'https://herbarium.example.test/third.json',
        digest: 'e'.repeat(64),
        manifest: HERBARIUM,
        by: null,
      }),
    );
    await tenant((trx) =>
      updateExtension(trx, installed.id, {
        digest: 'f'.repeat(64),
        manifest: { ...HERBARIUM, name: 'Herbarium papers' },
        by: null,
      }),
    );
    const listed = await tenant((trx) => tenantReferenceSources(trx));
    expect(listed.find((each) => each.id === `ext:${installed.id}`)?.name).toBe('Herbarium papers');
  });

  it('sends no secret once the latest manifest declares no authentication', async () => {
    const installed = await tenant((trx) =>
      installExtension(trx, {
        url: 'https://herbarium.example.test/fourth.json',
        digest: '1'.repeat(64),
        manifest: HERBARIUM,
        by: null,
      }),
    );
    await tenant((trx) => setExtensionCredential(trx, installed.id, 'v1.sealed', null));
    await tenant((trx) =>
      updateExtension(trx, installed.id, {
        digest: '2'.repeat(64),
        manifest: { ...HERBARIUM, authentication: 'none' },
        by: null,
      }),
    );
    const source = (await tenant((trx) => tenantReferenceSources(trx))).find(
      (each) => each.id === `ext:${installed.id}`,
    );
    expect(source?.extension?.authenticated).toBe(false);
    expect(extensionTarget(source)).not.toHaveProperty('sealed');
  });

  it('holds the secret unset once the endpoint it was set for has moved', async () => {
    const installed = await tenant((trx) =>
      installExtension(trx, {
        url: 'https://herbarium.example.test/fifth.json',
        digest: '3'.repeat(64),
        manifest: HERBARIUM,
        by: null,
      }),
    );
    await tenant((trx) => setExtensionCredential(trx, installed.id, 'v1.sealed', null));
    expect((await tenant((trx) => installedExtension(trx, installed.id)))?.secretSet).toBe(true);
    await tenant((trx) =>
      updateExtension(trx, installed.id, {
        digest: '4'.repeat(64),
        manifest: { ...HERBARIUM, endpoint: 'https://moved.example.test/alloy' },
        by: null,
      }),
    );
    expect((await tenant((trx) => installedExtension(trx, installed.id)))?.secretSet).toBe(false);
    const source = (await tenant((trx) => tenantReferenceSources(trx))).find(
      (each) => each.id === `ext:${installed.id}`,
    );
    expect(source?.extension).not.toHaveProperty('sealed');
  });

  it('refuses a source the list does not declare', async () => {
    await expect(
      tenant((trx) => setReferenceSource(trx, 'Elsewhere' as 'crossref', false)),
    ).rejects.toThrow();
  });
});
