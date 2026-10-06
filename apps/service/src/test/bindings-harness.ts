import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  bootstrapCluster,
  createComponent,
  createRole,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import {
  canonicalResultBytes,
  type CanonicalValue,
  type ConnectionSettings,
  type RunAnswer,
} from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { createOidcClient } from '../oidc.js';
import { environmentSecrets } from '../secrets.js';
import { FAKE_CONNECTOR_KEY, fakeConnector, type FakeConnector } from './fake-connector.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './sign-in.js';

/**
 * The world the D3 suites act in (the D3 plan, task 3): an environment with an object store and a
 * fake connector, a connection on it found read-only, and people holding what each test needs. Ada
 * administers the environment, authors in General and uses and writes SQL on its connections; Grace
 * authors in General and uses its connections; Alice reads General; Ivy holds nothing.
 */

export const HOST = 'acme.alloy.test';
export const SECRET = 'an-invented-canary-password';

type Json = Record<string, unknown>;
export type Cell = CanonicalValue;

export const settings = (over: Partial<ConnectionSettings> = {}): ConnectionSettings => ({
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
  ...over,
});

/** A definition as the page writes one: a site's name by its id. */
export const definitionBody = (connection: string, over: Json = {}) => ({
  schemaVersion: 1,
  title: 'Site by id',
  description: 'One site, by its id.',
  connection,
  parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
  fetch: { kind: 'sql', text: 'select id, name from sample.site where id = {{site}} order by id' },
  columns: [
    { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
    { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
  ],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'valid',
  limits: { rows: 1000, bytes: 1_048_576, seconds: 30 },
  retired: false,
  ...over,
});

/** A run's answer as the connector gives one, its checksum over the canonical bytes. */
export const ranOk = (
  rows: Cell[][],
  sql = 'select id, name from sample.site where id = $1::int8 order by id',
): RunAnswer => {
  const result = {
    columns: [
      ['id', 'integer'],
      ['name', 'text'],
    ] as [string, 'integer' | 'text'][],
    rows,
  };
  return {
    outcome: 'ok',
    result,
    checksum: sha256(canonicalResultBytes(result)),
    rowCount: rows.length,
    ran: { sql },
    durationMs: 12,
  };
};

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A binding as a component holds one, taking a site's name by its id unless told otherwise. */
export const binding = (id: string, query: string, over: Json = {}) => ({
  type: 'binding',
  id,
  query,
  parameters: { site: { literal: '1' } },
  mode: 'checked',
  take: { column: 'name' },
  ...over,
});

export interface Harness {
  readonly db: TestDatabase;
  readonly store: TestObjectStore;
  readonly stores: ObjectStores;
  readonly tenantDb: TenantDatabase;
  readonly tenant: Tenant;
  readonly app: FastifyInstance;
  readonly connector: FakeConnector;
  readonly general: string;
  readonly quality: string;
  readonly ids: Readonly<Record<string, string>>;
  readonly cookies: Record<string, string>;
  readonly roles: Readonly<Record<string, string>>;
  /** Every line the service logged. */
  readonly lines: string[];
  call(
    as: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse>;
  /** Calls as `call` does, to a service of the same environment given no object store. */
  callWithout(): Harness['call'];
  /** Grants a role, allowed, and answers the grant's id. */
  allow(principal: string, role: string, level: Json): Promise<string>;
  /** A connection Ada makes in a space, its credential set and its test passed clean. */
  connection(name: string, space?: string): Promise<{ id: string; version: string }>;
  /** A query definition Ada makes on a connection. */
  definition(
    connection: string,
    over?: Json,
    space?: string,
  ): Promise<{ id: string; version: string }>;
  /** A definition's next version, from its latest, as Ada. */
  nextDefinition(id: string, openedFrom: string, body: Json): Promise<string>;
  /** A component in a space, at 0.1: one empty paragraph. */
  component(space: string, title: string): Promise<{ id: string; version: string }>;
  /**
   * Cuts the component's next version through the editing routes, as a client of the API would: a
   * paragraph `p1` holding these inlines. Answers the version cut, and moves `component.version`.
   */
  place(component: { id: string; version: string }, ...inlines: unknown[]): Promise<string>;
  /** As `place`, the component's content these blocks rather than one paragraph. */
  placeBlocks(component: { id: string; version: string }, ...blocks: unknown[]): Promise<string>;
  /** A document in a space referencing these components, made by Ada through the routes. */
  documentReferencing(
    components: readonly string[],
    space?: string,
  ): Promise<{ id: string; version: string; nodes: string[] }>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /** The stores the service is given, made from the real ones: a decorator a test counts through. */
  readonly objects?: (stores: ObjectStores) => ObjectStores;
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const db = await freshDatabase();
  const store = await testObjectStore();
  await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
  await migrate(db.migratorUrl);
  const idp: StandInProvider = await startStandInProvider({
    clients: [
      {
        clientId: 'alloy',
        clientSecret: 'stand-in-secret',
        redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
      },
    ],
  });
  const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
    organisation: { id: 'acme', name: 'Acme' },
    tenant: { id: db.newTenantId(), name: 'Production' },
    hostnames: [HOST],
  });
  await configureStandIn(db.adminUrl, tenant, { issuer: idp.issuer, clientId: 'alloy' });
  await store.setUp(db.adminUrl, tenant);
  const stores = createObjectStores(store.settings, store.sealingKey);
  const tenantDb = createTenantDatabase(db.serviceUrl);
  const connector = fakeConnector();
  const lines: string[] = [];
  const appWith = (objects: ObjectStores | undefined) =>
    buildApp({
      db: tenantDb,
      logLevel: 'info',
      logStream: new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString('utf8'));
          done();
        },
      }),
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
      ...(objects === undefined ? {} : { objects }),
      connector: {
        url: 'http://connector.test:8090',
        key: FAKE_CONNECTOR_KEY,
        fetch: connector.fetch,
      },
    });
  const app = appWith(options.objects ? options.objects(stores) : stores);
  const others: FastifyInstance[] = [];
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roles: Record<string, string> = {};

  const callOn =
    (on: FastifyInstance): Harness['call'] =>
    (as, method, url, payload) =>
      on.inject({
        method,
        url,
        headers: { host: HOST, cookie: cookies[as]! },
        ...(payload === undefined ? {} : { payload: payload as Json }),
      });
  const call = callOn(app);
  const allow: Harness['allow'] = (principal, role, level) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const answer = await grant(trx, {
        roleId: role,
        subject: { principal },
        level: level as never,
        effect: 'allow',
        grantedBy: ids.ada ?? principal,
      });
      if ('refused' in answer) throw new Error(answer.refused);
      return answer.granted.id;
    });

  for (const user of ['ada', 'grace', 'alice', 'ivy']) {
    cookies[user] = await signIn(app, HOST, user, idp.issuer);
    ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
  }
  let general = '';
  let quality = '';
  await tenantDb.withTenant(tenant, async (trx) => {
    general = (
      await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow()
    ).id;
    quality = (await createSpace(trx, 'Quality')).id;
    for (const [name, permissions] of [
      ['Connection user', ['read', 'use_connection']],
      ['SQL writer', ['read', 'write_sql']],
    ] as const) {
      const made = await createRole(trx, name, [...permissions]);
      if (!('role' in made)) throw new Error(made.refused);
      roles[name] = made.role.id;
    }
    for (const name of ['Administrator', 'Author', 'Reader']) {
      roles[name] = (await findRole(trx, name))!.id;
    }
  });
  await allow(ids.ada!, roles.Administrator!, { kind: 'tenant' });
  await allow(ids.ada!, roles.Author!, { kind: 'space', id: general });
  await allow(ids.ada!, roles['Connection user']!, { kind: 'space', id: general });
  await allow(ids.ada!, roles['SQL writer']!, { kind: 'space', id: general });
  await allow(ids.grace!, roles.Author!, { kind: 'space', id: general });
  await allow(ids.grace!, roles['Connection user']!, { kind: 'space', id: general });
  await allow(ids.alice!, roles.Reader!, { kind: 'space', id: general });

  const harness: Harness = {
    db,
    store,
    stores,
    tenantDb,
    tenant,
    app,
    connector,
    general,
    quality,
    ids,
    cookies,
    roles,
    lines,
    call,
    allow,

    callWithout() {
      const other = appWith(undefined);
      others.push(other);
      return callOn(other);
    },

    async connection(name, space = general) {
      const made = await call('ada', 'POST', `/v1/spaces/${space}/connections`, {
        settings: settings({ name }),
      });
      if (made.statusCode !== 200) throw new Error(`${made.statusCode} ${made.body}`);
      const { id, version } = made.json<{ id: string; version: { id: string } }>();
      const mode = connector.mode;
      const test = connector.test;
      connector.mode = 'answer';
      connector.test = { outcome: 'ok', findings: [] };
      const set = await call('ada', 'PUT', `/v1/connections/${id}/credential`, { secret: SECRET });
      connector.mode = mode;
      connector.test = test;
      if (set.statusCode !== 200) throw new Error(`${set.statusCode} ${set.body}`);
      return { id, version: version.id };
    },

    async definition(connection, over = {}, space = general) {
      const made = await call('ada', 'POST', `/v1/spaces/${space}/query-definitions`, {
        definition: definitionBody(connection, over),
      });
      if (made.statusCode !== 200) throw new Error(`${made.statusCode} ${made.body}`);
      const { id, version } = made.json<{ id: string; version: { id: string } }>();
      return { id, version: version.id };
    },

    async nextDefinition(id, openedFrom, body) {
      const made = await call('ada', 'POST', `/v1/query-definitions/${id}/versions`, {
        openedFrom,
        definition: body,
      });
      if (made.statusCode !== 200) throw new Error(`${made.statusCode} ${made.body}`);
      return made.json<{ version: { id: string } }>().version.id;
    },

    async component(space, title) {
      const made = await tenantDb.withTenant(tenant, (trx) =>
        createComponent(trx, {
          spaceId: space,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ids.ada!,
        }),
      );
      if (made.answer !== 'created') throw new Error(made.answer);
      return { id: made.version.artifactId, version: made.version.id };
    },

    place(component, ...inlines) {
      return harness.placeBlocks(component, {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: inlines,
      });
    },

    async placeBlocks(component, ...blocks) {
      const session = randomUUID();
      const claimed = await call('ada', 'POST', `/v1/components/${component.id}/lock`, {
        session,
        move: true,
      });
      if (claimed.statusCode !== 200) throw new Error(`${claimed.statusCode} ${claimed.body}`);
      const saved = await call(
        'ada',
        'PUT',
        `/v1/components/${component.id}/iterations/${session}/1`,
        {
          openedFrom: component.version,
          content: {
            schemaVersion: 1,
            title: 'Readings',
            language: 'en-GB',
            direction: 'ltr',
            content: blocks,
          },
        },
      );
      if (saved.statusCode !== 200) throw new Error(`${saved.statusCode} ${saved.body}`);
      const released = await call(
        'ada',
        'DELETE',
        `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version}`,
      );
      if (released.statusCode !== 200) throw new Error(`${released.statusCode} ${released.body}`);
      component.version = released.json<{ version: { id: string } }>().version.id;
      return component.version;
    },

    async documentReferencing(components, space = general) {
      const made = (
        await call('ada', 'POST', `/v1/spaces/${space}/documents`, {
          title: 'The readings report',
          language: 'en-GB',
          direction: 'ltr',
        })
      ).json<{ id: string; version: { id: string } }>();
      let version = made.version.id;
      for (const [at, component] of components.entries()) {
        const edited = await call('ada', 'POST', `/v1/documents/${made.id}/outline`, {
          openedFrom: version,
          operation: {
            operation: 'insert',
            parent: null,
            position: at,
            node: { type: 'reference', component, mode: { kind: 'latest' } },
          },
        });
        if (edited.statusCode !== 200) throw new Error(`${edited.statusCode} ${edited.body}`);
        version = edited.json<{ version: { id: string } }>().version.id;
      }
      const body = (await call('ada', 'GET', `/v1/documents/${made.id}`)).json<{
        outline: { nodes: { id: string }[] };
      }>();
      return { id: made.id, version, nodes: body.outline.nodes.map((node) => node.id) };
    },

    async close() {
      for (const other of others) await other.close();
      await app.close();
      await tenantDb.close();
      await idp.close();
      await store.drop();
      await db.drop();
    },
  };
  return harness;
}
