import { Writable } from 'node:stream';
import { allRoutes } from '@alloy-works/api-contract';
import {
  addHostnames,
  bootstrapCluster,
  createTenant,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type Handlers } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { TEST_SEALING_KEY } from './test/sign-in.js';

/**
 * Type-only, never called: a permission-checked handler receives no `FastifyReply` at all -
 * `permissionChecked` (app.ts) never passes one to it - so it has nothing to send early with,
 * whatever its own return type would infer. A return-type restriction alone does not hold this:
 * `FastifyReply` has its own `then` (`fastify/types/reply.d.ts`,
 * `then(fulfilled: () => void, rejected: (err: Error) => void): void`), so an un-annotated async
 * handler that returns `reply` or `reply.send(...)` has that value unwrapped as a thenable, and
 * because `then`'s callback takes no value parameter to infer from, `Awaited<FastifyReply>` resolves
 * to something assignable to anything - silently. This is the shape that fooled the first version of
 * this guard: a bare literal for a handler that still expects a `reply` parameter.
 */
const illegalHandlers: Pick<Handlers, 'getAccess'> = {
  // @ts-expect-error a permission-checked handler takes no `reply`; there is nothing here to send with
  getAccess: async (_request, reply, { target }) => reply.status(200).send({ target }),
};
void illegalHandlers;

describe('the service', () => {
  let db: TestDatabase;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;
  const lines: string[] = [];
  // Every route the app registers, as Fastify registers it, a HEAD beside each GET included.
  const registered: { method: string; url: string }[] = [];

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
    tenantDb = testTenantDatabase(db.serviceUrl);
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
      sealingKey: TEST_SEALING_KEY,
      onRoute: (route) => registered.push(route),
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await db.drop();
  });

  it('API-003 registers exactly the routes the contract declares, and no other', async () => {
    await app.ready();
    const key = (method: string, url: string) => `${method} ${url}`;
    const declared = allRoutes.map((route) =>
      key(route.method, route.path.replace(/\{(\w+)\}/g, ':$1')),
    );
    // HEAD is Fastify's own, answered beside every GET; it is no route of the service's.
    const served = registered
      .filter(
        (route) =>
          route.method !== 'HEAD' &&
          !route.url.startsWith('/docs') &&
          route.url !== '/openapi/v1.json',
      )
      .map((route) => key(route.method, route.url));
    expect(served.sort()).toEqual(declared.sort());
  });

  it('API-062 serves the authoritative v1 document and reference only on an environment hostname', async () => {
    const at = (url: string, host = 'acme.alloy.test') => app.inject({ url, headers: { host } });
    const json = await at('/openapi/v1.json');
    expect(json.statusCode).toBe(200);
    expect(json.headers['content-type']).toContain('application/vnd.oai.openapi+json');
    expect(json.json()).toHaveProperty('openapi', '3.1.0');
    expect(json.headers.etag).toBeDefined();
    expect(json.headers['x-content-type-options']).toBe('nosniff');
    const redirect = await at('/docs');
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe('/docs/v1/');
    const html = await at('/docs/v1/');
    expect(html.statusCode).toBe(200);
    // What the page says to a person carries plain hyphens and dots, as every product string does.
    expect(html.body).not.toMatch(/[\u2013\u2014\u2026]/);
    const scalarPath = html.body.match(/\/docs\/v1\/scalar-[0-9a-f]{16}\.js/)?.[0];
    expect(scalarPath).toBeDefined();
    expect(html.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(html.headers['referrer-policy']).toBe('no-referrer');
    const asset = await at(scalarPath!);
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await at('/openapi/v1.json', 'nobody.alloy.test')).json()).toMatchObject({
      code: 'tenant_not_found',
    });
    const infrastructure = registered
      .filter(
        (route) =>
          route.method !== 'HEAD' &&
          (route.url.startsWith('/docs') || route.url === '/openapi/v1.json'),
      )
      .map((route) => `${route.method} ${route.url}`)
      .sort();
    expect(infrastructure).toEqual([
      'GET /docs',
      'GET /docs/v1/',
      `GET ${scalarPath}`,
      'GET /openapi/v1.json',
    ]);
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

  it("IAM-053 reaches each environment at its own hostname, two-level names included, and a customer's own domain once it is added, with no restart", async () => {
    const at = (host: string) => app.inject({ url: '/v1/tenant', headers: { host } });
    // An environment under the customer's name, and the customer's name itself.
    expect((await at('dev.acme.alloy.test')).json()).toEqual({ name: 'Development' });
    expect((await at('acme.alloy.test')).json()).toEqual({ name: 'Production' });

    // A domain of the customer's own: unknown, then added to the running service's database - no
    // code, no configuration and no restart - and answered by the environment it was added to.
    expect((await at('docs.customer.example')).statusCode).toBe(404);
    await addHostnames(db.adminUrl, production.id, ['docs.customer.example']);
    expect((await at('docs.customer.example')).json()).toEqual({ name: 'Production' });
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
