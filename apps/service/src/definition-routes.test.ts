import {
  bootstrapCluster,
  createTenant,
  findRole,
  grant,
  migrate,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { DEFINITION_SCHEMA_VERSION } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

type Json = Record<string, unknown>;
interface DefinitionBody {
  id: string;
  kind: string;
  version: { id: string; number: string };
  definition: { name: string };
}

const field = (name: string, validation: Json = {}) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  name,
  dataType: 'text',
  multiplicity: 'one',
  validation,
});
const entry = (fieldId: string, value?: string) => ({
  field: fieldId,
  required: false,
  fixed: false,
  ...(value === undefined ? {} : { default: value }),
});

describe('definitions through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (as: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: Json) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[as]! },
      ...(payload ? { payload } : {}),
    });
  const make = (as: string, kind: string, definition: Json) =>
    call(as, 'POST', '/v1/definitions', { kind, definition });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
        },
      ],
    });
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureStandIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
    });
    tenantDb = testTenantDatabase(db.serviceUrl);
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    for (const user of ['ada', 'grace']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    // Grace manages definitions, and holds nothing else it would take; Ada does not manage them.
    await tenantDb.withTenant(tenant, async (trx) => {
      const manager = await findRole(trx, 'Definitions manager');
      await grant(trx, {
        roleId: manager!.id,
        subject: { principal: ids.grace! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('MET-024 decides making and changing a definition by managing definitions, at the tenant', async () => {
    // Ada holds roles in General and nothing at the tenant: she may not make a definition.
    expect((await make('ada', 'field', field('Custodian'))).statusCode).toBe(403);
    const made = await make('grace', 'field', field('Custodian'));
    expect(made.statusCode, made.body).toBe(200);
    const owner = made.json<DefinitionBody>();
    expect(owner).toMatchObject({ kind: 'field', version: { number: '0.1' } });
    // Nor change one; and reading one is `read`, which she does not hold at the tenant either, so
    // the listing is refused and one definition is answered as not there (access.md).
    expect(
      (
        await call('ada', 'POST', `/v1/definitions/${owner.id}/versions`, {
          openedFrom: owner.version.id,
          definition: field('Custodian of record'),
        })
      ).statusCode,
    ).toBe(404);
    expect((await call('ada', 'GET', '/v1/definitions')).statusCode).toBe(403);
    expect((await call('ada', 'GET', `/v1/definitions/${owner.id}`)).statusCode).toBe(404);
    const read = await call('grace', 'GET', `/v1/definitions/${owner.id}`);
    expect(read.json<DefinitionBody>().definition.name).toBe('Custodian');
    const listed = await call('grace', 'GET', '/v1/definitions');
    expect(listed.json<{ items: { name: string }[] }>().items.map((each) => each.name)).toContain(
      'Custodian',
    );
    const changed = await call('grace', 'POST', `/v1/definitions/${owner.id}/versions`, {
      openedFrom: owner.version.id,
      definition: field('Custodian of record'),
    });
    expect(changed.json<DefinitionBody>()).toMatchObject({ version: { number: '0.2' } });
  });

  it('refuses each check by its code, its rule and what it names', async () => {
    // A name taken (MET-031): the field the test before renamed Custodian of record.
    const taken = await make('grace', 'field', field('custodian OF record'));
    expect(taken.statusCode).toBe(400);
    expect(taken.json()).toMatchObject({ code: 'definition_name_taken', rule: 'MET-031' });
    // Two schemas a component type assigns disagreeing (MET-008).
    const status = (await make('grace', 'field', field('Status'))).json<DefinitionBody>();
    const drafting = (
      await make('grace', 'metadataSchema', {
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        name: 'Drafting',
        entries: [entry(status.id, 'draft')],
      })
    ).json<DefinitionBody>();
    const release = (
      await make('grace', 'metadataSchema', {
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        name: 'Release',
        entries: [entry(status.id, 'final')],
      })
    ).json<DefinitionBody>();
    const conflict = await make('grace', 'componentType', {
      schemaVersion: DEFINITION_SCHEMA_VERSION,
      name: 'Bulletin',
      assignments: [
        { schema: drafting.id, requires: [] },
        { schema: release.id, requires: [] },
      ],
    });
    expect(conflict.statusCode).toBe(400);
    expect(conflict.json()).toMatchObject({
      code: 'assignment_conflict',
      rule: 'MET-008',
      failures: [{ field: status.id, schemas: [drafting.id, release.id] }],
    });
    // A field version breaking a schema's default (MET-037).
    const broken = await call('grace', 'POST', `/v1/definitions/${status.id}/versions`, {
      openedFrom: status.version.id,
      definition: field('Status', { maxLength: 3 }),
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toMatchObject({
      code: 'field_breaks_default',
      rule: 'MET-037',
      // Both schemas' defaults are longer than three characters, and both are named.
      broken: [
        { schema: drafting.id, default: 'draft' },
        { schema: release.id, default: 'final' },
      ],
    });
    // A payload that is not a definition of its kind is the request's, and names no rule.
    const shapeless = await make('grace', 'field', { name: 'Nothing' });
    expect(shapeless.statusCode).toBe(400);
    expect(shapeless.json()).toMatchObject({ code: 'invalid_request' });
  });

  it("shows a component's type, fields and values, and saves values with an iteration, refusing what cannot be stored", async () => {
    const market = (await make('grace', 'field', field('Market'))).json<DefinitionBody>();
    const trial = (
      await make('grace', 'metadataSchema', {
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        name: 'Trial',
        entries: [{ field: market.id, required: false, fixed: true, default: 'uk' }],
      })
    ).json<DefinitionBody>();
    const sheet = (
      await make('grace', 'componentType', {
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        name: 'Trial sheet',
        assignments: [{ schema: trial.id, requires: [] }],
      })
    ).json<DefinitionBody>();
    const general = (await call('ada', 'GET', '/v1/spaces'))
      .json<{ items: { id: string; name: string }[] }>()
      .items.find((each) => each.name === 'General')!;
    const made = await call('ada', 'POST', `/v1/spaces/${general.id}/components`, {
      title: 'Dosing',
      language: 'en-GB',
      direction: 'ltr',
      componentType: sheet.id,
    });
    expect(made.statusCode, made.body).toBe(200);
    const component = made.json<{ id: string; version: { id: string } }>();

    const view = (await call('ada', 'GET', `/v1/components/${component.id}`)).json<{
      type: { id: string; name: string };
      fields: { id: string; name: string; fixed: boolean; fixedBy: string[]; default?: unknown }[];
      schemas: { id: string; name: string }[];
      values: Json;
    }>();
    expect(view.type).toEqual({ id: sheet.id, name: 'Trial sheet' });
    expect(view.fields).toMatchObject([
      { id: market.id, name: 'Market', fixed: true, fixedBy: [trial.id], default: 'uk' },
    ]);
    expect(view.schemas).toEqual([{ id: trial.id, name: 'Trial' }]);
    expect(view.values).toEqual({ [market.id]: 'uk' });

    const session = randomUUID();
    expect(
      (await call('ada', 'POST', `/v1/components/${component.id}/lock`, { session })).statusCode,
    ).toBe(200);
    const content = (await call('ada', 'GET', `/v1/components/${component.id}`)).json<{
      content: Json;
    }>().content;
    const save = (sequence: number, values: Json) =>
      call('ada', 'PUT', `/v1/components/${component.id}/iterations/${session}/${sequence}`, {
        openedFrom: component.version.id,
        content,
        values,
      });
    const refusedSave = await save(1, { [market.id]: 'us' });
    expect(refusedSave.statusCode).toBe(400);
    expect(refusedSave.json()).toMatchObject({
      code: 'values_invalid',
      failures: [{ field: market.id, rule: 'fixed', schemas: [trial.id] }],
    });
    expect((await save(1, { [market.id]: 'uk' })).statusCode).toBe(200);
  });

  it("lists the environment's people by name to anybody signed in, for a user field's picker", async () => {
    const people = await call('ada', 'GET', '/v1/people');
    expect(people.statusCode).toBe(200);
    const items = people.json<{ items: { id: string; name: string }[] }>().items;
    expect(items).toEqual(
      expect.arrayContaining([
        { id: ids.ada, name: 'Ada' },
        { id: ids.grace, name: 'Grace' },
      ]),
    );
  });
});
