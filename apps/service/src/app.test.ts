import { Writable } from 'node:stream';
import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type Handlers } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';

/**
 * Type-only, never called: a route whose `access.check` is `'permission'` must resolve with its
 * body alone. Replying early (`reply.send(...)`) would ship a response before `permissionChecked`'s
 * transaction commits (app.ts, `permissionChecked`), so that must not typecheck. Declared with its
 * own explicit signature, rather than assigned inline, because TypeScript's contextual inference for
 * a bare function literal does not reliably check a return type against an indexed conditional type
 * like `Handlers['getAccess']` - an already-typed function value does.
 */
async function earlyReply(
  _request: Parameters<Handlers['getAccess']>[0],
  reply: Parameters<Handlers['getAccess']>[1],
): Promise<FastifyReply> {
  return reply.status(200).send({});
}
// @ts-expect-error a permission-checked handler may not resolve with a FastifyReply
const _illegalHandler: Handlers['getAccess'] = earlyReply;
void _illegalHandler;

describe('the service', () => {
  let db: TestDatabase;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;
  const lines: string[] = [];

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    app = buildApp({
      db: tenantDb,
      logLevel: 'info',
      logStream,
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await db.drop();
  });

  it('serves every route the contract declares', async () => {
    await app.ready();
    for (const route of allRoutes) {
      const url = route.path.replace(/\{(\w+)\}/g, ':$1');
      expect(app.hasRoute({ method: route.method, url }), route.operationId).toBe(true);
    }
  });

  it('answers the health check on any hostname', async () => {
    const response = await app.inject({ url: '/health', headers: { host: 'anything.example' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('names the environment a hostname serves, read from that tenant', async () => {
    const development = await app.inject({
      url: '/v1/tenant',
      headers: { host: 'dev.acme.alloy.test' },
    });
    expect(development.json()).toEqual({ name: 'Development' });

    const production = await app.inject({
      url: '/v1/tenant',
      headers: { host: 'ACME.alloy.test:8080' },
    });
    expect(production.json()).toEqual({ name: 'Production' });
  });

  it('refuses a hostname that serves no environment, before any tenant data is touched', async () => {
    const response = await app.inject({
      url: '/v1/tenant',
      headers: { host: 'nobody.alloy.test' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'tenant_not_found' });
  });

  it('labels the request log with the tenant', async () => {
    await app.inject({ url: '/v1/tenant', headers: { host: 'acme.alloy.test' } });
    const tenants = lines.map((line) => (JSON.parse(line) as { tenant?: string }).tenant);
    expect(tenants).toContain(production.id);
  });

  it('never writes the database password to its log', () => {
    expect(lines.join('')).not.toContain(TEST_PASSWORDS.service);
  });
});
