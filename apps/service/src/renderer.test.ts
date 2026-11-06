import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapCluster, createTenant, migrate, type TenantDatabase } from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { rendererPolicy } from './renderer.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { TEST_SEALING_KEY } from './test/sign-in.js';

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
    tenantDb = testTenantDatabase(db.serviceUrl);
    const common = {
      db: tenantDb,
      logLevel: 'silent' as const,
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    };
    app = buildApp({ ...common, rendererRoot: root, storeOrigin: 'https://files.alloy.test' });
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
    expect((await get('/v1/tenant')).json()).toMatchObject({ name: 'Production' });
    const missing = await get('/v1/nothing-here');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'not_found' });
  });

  it('serves nothing but the API when it has no renderer to serve', async () => {
    const response = await get('/', plain);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'not_found' });
  });

  it('serves the page under a policy naming what it may load, at the root and every address it owns', async () => {
    for (const url of ['/', '/documents/x', '/assets/app.js']) {
      expect((await get(url)).headers['content-security-policy'], url).toBe(
        rendererPolicy('https://files.alloy.test'),
      );
    }
  });
});

describe('the policy the renderer is served under', () => {
  const directives = (policy: string) =>
    new Map(
      policy.split('; ').map((part) => {
        const [name, ...values] = part.split(' ');
        return [name!, values] as const;
      }),
    );

  it('runs only its own scripts, and is framed by nothing', () => {
    const policy = directives(rendererPolicy(undefined));
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('script-src')).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
  });

  it('lets the store in where a signed link is shown, read or downloaded, and nowhere else', () => {
    const policy = directives(rendererPolicy('https://files.alloy.test'));
    for (const name of ['img-src', 'connect-src', 'frame-src', 'media-src']) {
      expect(policy.get(name), name).toContain('https://files.alloy.test');
    }
    expect(policy.get('script-src')).not.toContain('https://files.alloy.test');
    expect(policy.get('style-src')).not.toContain('https://files.alloy.test');
  });
});
