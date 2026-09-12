import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  migrate,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';

const HOST = 'acme.alloy.test';

describe('the renderer, served by the service', () => {
  let db: TestDatabase;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let plain: FastifyInstance;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    const root = await mkdtemp(join(tmpdir(), 'aw-renderer-'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Alloy Works</title>');
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'app.js'), 'export const hello = 1;');
    tenantDb = createTenantDatabase(db.serviceUrl);
    const common = {
      db: tenantDb,
      logLevel: 'silent' as const,
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
    };
    app = buildApp({ ...common, rendererRoot: root });
    plain = buildApp(common);
  });

  afterAll(async () => {
    await app.close();
    await plain.close();
    await tenantDb.close();
    await db.drop();
  });

  const get = (url: string, instance = app) => instance.inject({ url, headers: { host: HOST } });

  it('answers the page at the root', async () => {
    const response = await get('/');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Alloy Works');
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('answers its assets', async () => {
    const response = await get('/assets/app.js');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('hello');
  });

  it('answers the page for an address the renderer owns, not a 404', async () => {
    const response = await get('/samples/11111111-2222-4333-8444-555555555555');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Alloy Works');
  });

  it('leaves the API its own answers', async () => {
    expect((await get('/v1/tenant')).json()).toEqual({ name: 'Production' });
    const missing = await get('/v1/nothing-here');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'not_found' });
  });

  it('serves nothing but the API when it has no renderer to serve', async () => {
    const response = await get('/', plain);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'not_found' });
  });
});
