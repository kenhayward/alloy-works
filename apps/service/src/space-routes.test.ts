import {
  bootstrapCluster,
  createRole,
  createTenant,
  createTenantDatabase,
  DEFAULT_LAYOUT_ID,
  DEFAULT_THEME_ID,
  findRole,
  grant,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { permissions, TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const MISSING = '00000000-0000-4000-8000-000000000000';

interface SpaceView {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  readonly archivedAt: string | null;
  readonly archivedBy: string | null;
}

/** A template definition any environment resolves: the default theme and layout, one section. */
const aTemplate = () => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  name: 'Report',
  theme: DEFAULT_THEME_ID,
  layout: DEFAULT_LAYOUT_ID,
  schemas: [],
  outline: {
    sections: [
      {
        key: 'introduction',
        title: [{ type: 'text', value: 'Introduction', marks: [] }],
        required: false,
        numbered: true,
        matter: 'body',
        pageBreak: 'none',
        children: [],
      },
    ],
  },
  changes: { add: true, remove: true, reorder: true },
});

const aConnection = () => ({
  schemaVersion: 1,
  name: 'Readings',
  description: '',
  type: 'postgres',
  source: {
    host: 'source-postgres',
    port: 5432,
    database: 'readings',
    account: 'reader',
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
});

const aQueryDefinition = (connection: string) => ({
  schemaVersion: 1,
  title: 'Depths',
  description: '',
  connection,
  parameters: [],
  // Built, not written: SQL would be refused on a connection never tested clean.
  fetch: {
    kind: 'builder',
    format: 1,
    query: {
      sources: [{ alias: 's', table: { schema: 'sample', name: 'site' } }],
      joins: [],
      select: [{ name: 'id', of: { source: 's', column: 'id' } }],
      groupBy: [],
    },
  },
  columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'valid',
  limits: { rows: 10, bytes: 1024, seconds: 5 },
  retired: false,
});

describe('spaces: made, renamed, archived and restored (the SP1 plan)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;
  let general = '';
  let grace = '';
  let graceCookie = '';
  let adaCookie = '';
  let adaSpace = '';

  const call = (
    credential: { cookie: string } | { authorization: string },
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...credential },
      ...(payload ? { payload } : {}),
    });
  const asGrace = () => ({ cookie: graceCookie });
  const asAda = () => ({ cookie: adaCookie });

  const make = async (name: string) => {
    const made = await call(asGrace(), 'POST', '/v1/spaces', { name });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<SpaceView>();
  };
  const patch = (id: string, payload: Record<string, unknown>) =>
    call(asGrace(), 'PATCH', `/v1/spaces/${id}`, payload);
  const listed = async (query = '') => {
    const answer = await call(asGrace(), 'GET', `/v1/spaces?limit=100${query}`);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{
      items: { id: string; name: string; archived: boolean; mayCreate: boolean }[];
    }>().items;
  };

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
      users: [
        { id: 'ada', name: 'Ada', email: 'ada@example.com' },
        { id: 'grace', name: 'Grace', email: 'grace@example.com' },
      ],
    });
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureStandIn(db.adminUrl, production, { issuer: idp.issuer, clientId: 'alloy' });
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    graceCookie = await signIn(app, HOST, 'grace', idp.issuer);
    grace = (await call(asGrace(), 'GET', '/v1/me')).json<{ id: string }>().id;
    adaCookie = await signIn(app, HOST, 'ada', idp.issuer);
    const ada = (await call(asAda(), 'GET', '/v1/me')).json<{ id: string }>().id;
    ({ general, adaSpace } = await tenantDb.withTenant(production, async (trx) => {
      // Grace administers the environment and may do everything in it; Ada administers one space.
      const administrator = await findRole(trx, 'Administrator');
      const everything = await createRole(trx, 'Everything', permissions);
      if (!('role' in everything)) throw new Error(everything.refused);
      for (const roleId of [administrator!.id, everything.role.id]) {
        const answer = await grant(trx, {
          roleId,
          subject: { principal: grace },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: grace,
        });
        if (!('granted' in answer)) throw new Error(answer.refused);
      }
      const own = await trx
        .insertInto('space')
        .values({ name: 'Ada administers' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const answer = await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: own.id },
        effect: 'allow',
        grantedBy: grace,
      });
      if (!('granted' in answer)) throw new Error(answer.refused);
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return { general: space.id, adaSpace: own.id };
    }));
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('ADM-049 lets an administrator of the environment make, rename, archive and restore a space through the API', async () => {
    const made = await make('Regulatory');
    expect(made).toMatchObject({
      name: 'Regulatory',
      archived: false,
      archivedAt: null,
      archivedBy: null,
    });

    const renamed = await patch(made.id, { name: 'Regulatory affairs' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ id: made.id, name: 'Regulatory affairs' });

    const archived = await patch(made.id, { archived: true });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json()).toMatchObject({ archived: true, archivedBy: grace });
    expect(archived.json<SpaceView>().archivedAt).toEqual(expect.any(String));

    const restored = await patch(made.id, { archived: false });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ archived: false, archivedAt: null, archivedBy: null });
  });

  it('ADM-049 refuses each act to one who administers only a space, and to a token without administer', async () => {
    const theirs = await call(asAda(), 'POST', '/v1/spaces', { name: 'Ada made' });
    expect(theirs.statusCode, theirs.body).toBe(403);
    for (const payload of [{ name: 'Ada renamed' }, { archived: true }, { archived: false }]) {
      const changed = await call(asAda(), 'PATCH', `/v1/spaces/${adaSpace}`, payload);
      expect(changed.statusCode, changed.body).toBe(403);
    }

    const issued = await call(asGrace(), 'POST', '/v1/tokens', {
      name: 'Creating only',
      scopes: ['create'],
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(issued.statusCode, issued.body).toBe(200);
    const bearer = { authorization: `Bearer ${issued.json<{ secret: string }>().secret}` };
    expect((await call(bearer, 'POST', '/v1/spaces', { name: 'By token' })).statusCode).toBe(403);
    expect(
      (await call(bearer, 'PATCH', `/v1/spaces/${general}`, { name: 'By token' })).statusCode,
    ).toBe(403);
  });

  it('refuses a name taken, empty, overlong or with a control character, and stores one normalised', async () => {
    await make('Quality');
    const taken = await call(asGrace(), 'POST', '/v1/spaces', { name: '  Quality ' });
    expect(taken.statusCode, taken.body).toBe(409);
    expect(taken.json()).toMatchObject({ code: 'space_name_taken' });
    for (const name of ['', '   ', 'x'.repeat(201), 'Bell\u0007']) {
      const refused = await call(asGrace(), 'POST', '/v1/spaces', { name });
      expect(refused.statusCode, name).toBe(400);
      expect(refused.json(), name).toMatchObject({ code: 'space_name_invalid' });
    }
    // Decomposed on the way in, composed when stored: the two spellings are one name.
    const composed = await make('Café');
    expect(composed.name).toBe('Café');
    const again = await call(asGrace(), 'POST', '/v1/spaces', { name: 'Café' });
    expect(again.json()).toMatchObject({ code: 'space_name_taken' });
    // Case matters, as the table compares.
    await expect(make('quality')).resolves.toMatchObject({ name: 'quality' });

    const renamed = await patch(composed.id, { name: 'Quality' });
    expect(renamed.statusCode).toBe(409);
    expect(renamed.json()).toMatchObject({ code: 'space_name_taken' });
    expect((await patch(MISSING, { name: 'Nowhere' })).statusCode).toBe(404);
    expect((await patch(composed.id, {})).statusCode).toBe(400);
  });

  it('lists an archived space marked and never to create in, and leaves it out when asked', async () => {
    const shelved = await make('Shelved');
    expect((await patch(shelved.id, { archived: true })).statusCode).toBe(200);
    expect((await listed()).find((each) => each.id === shelved.id)).toEqual({
      id: shelved.id,
      name: 'Shelved',
      archived: true,
      mayCreate: false,
    });
    expect((await listed()).find((each) => each.id === general)).toMatchObject({
      archived: false,
      mayCreate: true,
    });
    const live = await listed('&archived=false');
    expect(live.map((each) => each.id)).not.toContain(shelved.id);
    expect(live.map((each) => each.id)).toContain(general);
  });

  it('refuses a component, a document, blank or from a template, a template, a connection and a query definition made in an archived space', async () => {
    const shelf = await make('Shelf');
    const template = await call(asGrace(), 'POST', `/v1/spaces/${general}/templates`, {
      definition: aTemplate(),
    });
    expect(template.statusCode, template.body).toBe(200);
    const connection = await call(asGrace(), 'POST', `/v1/spaces/${shelf.id}/connections`, {
      settings: aConnection(),
    });
    expect(connection.statusCode, connection.body).toBe(200);
    const connectionId = connection.json<{ id: string }>().id;
    expect((await patch(shelf.id, { archived: true })).statusCode).toBe(200);

    const attempts: [string, string, Record<string, unknown>][] = [
      ['component', 'components', { title: 'Late', language: 'en-GB', direction: 'ltr' }],
      ['blank document', 'documents', { title: 'Late', language: 'en-GB', direction: 'ltr' }],
      [
        'document from a template',
        'documents',
        {
          title: 'Late',
          language: 'en-GB',
          direction: 'ltr',
          template: template.json<{ id: string }>().id,
        },
      ],
      ['template', 'templates', { definition: aTemplate() }],
      ['connection', 'connections', { settings: aConnection() }],
      ['query definition', 'query-definitions', { definition: aQueryDefinition(connectionId) }],
    ];
    for (const [what, path, payload] of attempts) {
      const refused = await call(asGrace(), 'POST', `/v1/spaces/${shelf.id}/${path}`, payload);
      expect(refused.statusCode, `${what}: ${refused.body}`).toBe(409);
      expect(refused.json(), what).toMatchObject({ code: 'space_archived' });
    }

    // Restored, the same creation goes through.
    expect((await patch(shelf.id, { archived: false })).statusCode).toBe(200);
    const made = await call(asGrace(), 'POST', `/v1/spaces/${shelf.id}/components`, {
      title: 'Late',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(made.statusCode, made.body).toBe(200);
  });

  it('refuses archiving the last space not archived', async () => {
    const live = (await listed('&archived=false')).map((each) => each.id);
    for (const id of live.filter((each) => each !== general)) {
      expect((await patch(id, { archived: true })).statusCode).toBe(200);
    }
    const last = await patch(general, { archived: true });
    expect(last.statusCode, last.body).toBe(409);
    expect(last.json()).toMatchObject({ code: 'space_last' });
  });
});
