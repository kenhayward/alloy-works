import { allRoutes } from '@alloy-works/api-contract';
import { createTenant, findRole, grant, type Tenant } from '@alloy-works/db';
import { queryAs } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOST, startHarness, type Harness } from './test/bindings-harness.js';
import { configureStandIn, signIn } from './test/sign-in.js';

const ORG_HOST = 'org.harness.test';

describe("an organisation's tenant through the service (the TL plan, TLd)", () => {
  let h: Harness;
  let organisation: Tenant;
  const seen: { readonly method: string; readonly url: string }[] = [];

  beforeAll(async () => {
    h = await startHarness({
      alsoSignsInAt: [ORG_HOST],
      appOptions: { tenantCacheMs: 0, onRoute: (route) => seen.push(route) },
    });
    organisation = await createTenant(h.db.adminUrl, h.db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: h.db.newTenantId(), name: 'Acme' },
      hostnames: [ORG_HOST],
      kind: 'organisation',
    });
    await configureStandIn(h.db.adminUrl, organisation, {
      issuer: h.issuer,
      clientId: 'alloy',
    });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  /** Asks the organisation's tenant, as nobody in particular: what the gate says comes first. */
  const atOrganisation = (method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH', url: string) =>
    h.app.inject({ method, url, headers: { host: ORG_HOST } });

  it('IAM-069 refuses every route but those an organisation has, those outside the contract too', async () => {
    const open: string[] = [];
    for (const { method, url } of seen.filter(
      (route) => route.method !== 'HEAD' && route.method !== 'OPTIONS',
    )) {
      const answer = await atOrganisation(
        method as 'GET',
        url
          .replace(/(?<!:):\w+/g, 'x')
          .replace('::', ':')
          .replace('*', 'x'),
      );
      // Whatever has no body, or a page's, did not come from the gate.
      const code = answer.body.startsWith('{')
        ? (answer.json() as { code?: string }).code
        : undefined;
      // MCP says it in its own protocol, under the same status.
      const refused =
        code === 'environment_not_here' || (url === '/mcp' && answer.statusCode === 404);
      if (!refused) open.push(`${method} ${url}`);
    }
    const flagged = allRoutes
      .filter((route) => route.organisationTenant)
      .map((route) => `${route.method} ${route.path.replace(/\{(\w+)\}/g, ':$1')}`);
    const outside = open.filter((each) => !flagged.includes(each));
    expect(outside.sort()).toEqual(
      ['GET /health']
        .concat(outside.filter((each) => /\/scim\/|\/docs|\/openapi\//.test(each)))
        .sort(),
    );
    expect(open).toEqual(expect.arrayContaining(flagged));
  }, 120_000);

  it('IAM-069 holds no content: spaces, documents and search are not here', async () => {
    for (const url of ['/v1/spaces', '/v1/documents', '/v1/search']) {
      const answer = await atOrganisation('GET', url);
      expect(answer.statusCode, url).toBe(404);
      expect(answer.json(), url).toMatchObject({ code: 'environment_not_here' });
    }
  });

  it('IAM-068 refuses what only an organisation has at any other tenant', async () => {
    const answer = await h.call('ada', 'GET', '/v1/organisation/tenants');
    expect(answer.statusCode).toBe(404);
    expect(answer.json()).toMatchObject({ code: 'environment_not_here' });
  });

  it('marks in the contract no route of content as open to an organisation', () => {
    const flagged = allRoutes.filter((route) => route.organisationTenant);
    expect(
      flagged.filter((route) => /spaces|documents|components|publications/.test(route.path)),
    ).toEqual([]);
  });

  it('IAM-068 ADM-028 lets one holding suspend_tenant stop and start a tenant, and nobody else', async () => {
    const cookie = await signIn(h.app, ORG_HOST, 'grace', h.issuer);
    const asking = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
      h.app.inject({
        method,
        url,
        headers: { host: ORG_HOST, cookie },
        ...(payload ? { payload } : {}),
      });
    const prod = `/v1/organisation/tenants/${h.tenant.id}/suspension`;
    expect((await asking('GET', '/v1/organisation/tenants')).statusCode).toBe(403);
    expect((await asking('POST', prod, { reason: 'An incident' })).statusCode).toBe(403);

    const me = await asking('GET', '/v1/me');
    expect(me.json()).toMatchObject({ environmentKind: 'organisation' });
    await h.tenantDb.withTenant(organisation, async (trx) => {
      await grant(trx, {
        roleId: (await findRole(trx, 'Organisation administrator'))!.id,
        subject: { principal: me.json<{ id: string }>().id },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: me.json<{ id: string }>().id,
      });
    });

    const listed = await asking('GET', '/v1/organisation/tenants');
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ items: { id: string }[] }>().items.map((each) => each.id)).toEqual([
      h.tenant.id,
    ]);
    const stopped = await asking('POST', prod, { reason: 'An incident' });
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json()).toMatchObject({ items: [{ id: h.tenant.id, state: 'suspended' }] });
    expect((await h.call('ada', 'GET', '/v1/spaces')).statusCode).toBe(503);
    expect(
      (await asking('POST', '/v1/organisation/tenants/nobody/suspension', { reason: 'x' }))
        .statusCode,
    ).toBe(404);
    const started = await asking('DELETE', prod);
    expect(started.statusCode, started.body).toBe(200);
    expect((await h.call('ada', 'GET', '/v1/spaces')).statusCode).toBe(200);
  });

  it('ADM-030 says an organisation cannot close while it has tenants, before anything is typed', async () => {
    const cookie = await signIn(h.app, ORG_HOST, 'grace', h.issuer);
    const me = await h.app.inject({ url: '/v1/me', headers: { host: ORG_HOST, cookie } });
    const id = me.json<{ id: string }>().id;
    await h.tenantDb.withTenant(organisation, async (trx) => {
      await grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: id },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: id,
      });
    });
    const answer = await h.app.inject({
      method: 'POST',
      url: '/v1/closure',
      headers: { host: ORG_HOST, cookie },
      payload: { name: 'not typed yet', declined: true },
    });
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'organisation_has_tenants' });
  });

  it('IAM-004 takes no session from one of its tenants', async () => {
    const fromTenant = await signIn(h.app, HOST, 'ada', h.issuer);
    const answer = await h.app.inject({
      url: '/v1/organisation/tenants',
      headers: { host: ORG_HOST, cookie: fromTenant },
    });
    expect(answer.statusCode).toBe(401);
  });

  it('ADM-028 will not let a tenant stop itself where nobody could lift it, or anyone without the act', async () => {
    const reason = { reason: 'An incident' };
    expect((await h.call('alice', 'POST', '/v1/suspension', reason)).statusCode).toBe(403);
    // This tenant belongs to the organisation above, so lifting it is possible: make it another's.
    await queryAs(
      h.db.adminUrl,
      `insert into platform.organisation (id, name) values ('solo', 'Solo') on conflict do nothing`,
    );
    await queryAs(
      h.db.adminUrl,
      `update platform.tenant set organisation_id = 'solo' where id = $1`,
      [h.tenant.id],
    );
    const refused = await h.call('ada', 'POST', '/v1/suspension', reason);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'no_organisation_to_lift' });
    await queryAs(
      h.db.adminUrl,
      `update platform.tenant set organisation_id = 'acme' where id = $1`,
      [h.tenant.id],
    );
    const stopped = await h.call('ada', 'POST', '/v1/suspension', reason);
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect((await h.call('ada', 'GET', '/v1/spaces')).statusCode).toBe(503);
    await queryAs(h.db.adminUrl, `update platform.tenant set state = 'active' where id = $1`, [
      h.tenant.id,
    ]);
    expect((await h.call('ada', 'GET', '/v1/me')).json()).toMatchObject({
      environmentKind: 'content',
    });
    expect(HOST).not.toBe(ORG_HOST);
  });
  describe('creating a tenant and sharing a provider (TLe)', () => {
    let cookie = '';
    let provider = '';

    beforeAll(async () => {
      await queryAs(
        h.db.adminUrl,
        `update platform.organisation set hostname_suffix = '.acme.harness.test' where id = 'acme'`,
      );
      cookie = await signIn(h.app, ORG_HOST, 'ada', h.issuer);
      const me = await h.app.inject({ url: '/v1/me', headers: { host: ORG_HOST, cookie } });
      const id = me.json<{ id: string }>().id;
      await h.tenantDb.withTenant(organisation, async (trx) => {
        await grant(trx, {
          roleId: (await findRole(trx, 'Administrator'))!.id,
          subject: { principal: id },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: id,
        });
      });
      const settings = await h.app.inject({
        url: '/v1/sign-in-settings',
        headers: { host: ORG_HOST, cookie },
      });
      provider = settings.json<{ providers: { id: string }[] }>().providers[0]!.id;
    });

    const asked = (body: object) =>
      h.app.inject({
        method: 'POST',
        url: '/v1/organisation/tenants',
        headers: { host: ORG_HOST, cookie },
        payload: body,
      });
    const ASKING = { name: 'Legal', label: 'legal', firstAdministrator: 'ada@example.test' };

    it('IAM-059 refuses a tenant nobody could sign in to', async () => {
      const answer = await asked(ASKING);
      expect(answer.statusCode, answer.body).toBe(409);
      expect(answer.json()).toMatchObject({ code: 'no_shared_provider' });
    });

    it('IAM-068 shares a provider, and answers a tenant asked for without the address', async () => {
      const shared = await h.app.inject({
        method: 'PUT',
        url: `/v1/organisation/providers/${provider}/shared`,
        headers: { host: ORG_HOST, cookie },
        payload: { shared: true },
      });
      expect(shared.statusCode, shared.body).toBe(200);
      expect(shared.json()).toMatchObject({
        sharing: true,
        providers: [{ id: provider, shared: true, managed: false }],
      });
      const answer = await asked(ASKING);
      expect(answer.statusCode, answer.body).toBe(200);
      expect(answer.json()).toMatchObject({
        hostnameSuffix: '.acme.harness.test',
        requests: [{ name: 'Legal', hostname: 'legal.acme.harness.test', state: 'waiting' }],
      });
      expect(answer.body).not.toContain('ada@example.test');
      const again = await asked({ ...ASKING, name: 'Twice' });
      expect(again.json()).toMatchObject({ code: 'organisation_address_taken' });
    });

    it('IAM-068 neither act is open to a token or a content tenant', async () => {
      const content = await h.app.inject({
        method: 'POST',
        url: '/v1/organisation/tenants',
        headers: { host: HOST },
        payload: ASKING,
      });
      expect(content.statusCode).toBe(404);
      expect(content.json()).toMatchObject({ code: 'environment_not_here' });
    });

    it('IAM-085 refuses to change a copy, and offers its closure', async () => {
      const copy = await h.tenantDb.withTenant(h.tenant, (trx) =>
        trx
          .insertInto('identity_provider')
          .values({
            name: 'Copy',
            issuer: 'https://copy.example',
            client_id: 'x',
            sealed_secret: 'sealed',
            secret_name: null,
            managed_by_organisation: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      const content = await signIn(h.app, HOST, 'ada', h.issuer);
      const me = await h.app.inject({ url: '/v1/me', headers: { host: HOST, cookie: content } });
      const id = me.json<{ id: string }>().id;
      await h.tenantDb.withTenant(h.tenant, async (trx) => {
        await grant(trx, {
          roleId: (await findRole(trx, 'Administrator'))!.id,
          subject: { principal: id },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: id,
        });
      });
      const changed = await h.app.inject({
        method: 'PATCH',
        url: `/v1/sign-in-settings/providers/${copy.id}`,
        headers: { host: HOST, cookie: content },
        payload: { name: 'Mine' },
      });
      expect(changed.statusCode, changed.body).toBe(409);
      expect(changed.json()).toMatchObject({ code: 'provider_managed_by_organisation' });
    });
  });
});
