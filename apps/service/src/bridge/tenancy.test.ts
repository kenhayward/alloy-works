import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  createDeliveredStore,
  createJobQueue,
  createServiceIdentity,
  createTenant,
  deliveredNames,
  findRole,
  grant,
  issueApiToken,
  writeBridgeSettings,
  type DeliveredStore,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { queryAs, testTenantDatabase } from '@alloy-works/db/testing';
import { signRequest, type BridgePackage, type Receipt } from '@kenhayward/bridge-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The worker's own handler and loop, reached by path as the conformance test does.
import { bridgeDeliverJob } from '../../../worker/src/jobs/bridge-deliver.js';
import { processNext, type JobHandler } from '../../../worker/src/worker.js';
import { hashToken } from '../sessions.js';
import { HOST, startHarness, type Harness } from '../test/bindings-harness.js';
import { newTokenSecret } from '../tokens.js';

/** The throwaway Postgres of the CS plan; the delivery store's database in it is made below. */
const DELIVERED_URL = 'postgres://postgres:postgres@127.0.0.1:5436/delivered_test';
/** The second tenant's address, in the same organisation as the harness's `acme.alloy.test`. */
const DEV_HOST = 'dev.acme.alloy.test';

const inAMonth = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

/** The contract's own wire fixtures, as CT Studio sends them. */
const fixtures = join(
  dirname(createRequire(import.meta.url).resolve('@kenhayward/bridge-contract')),
  '..',
  'test',
  'fixtures',
);
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as BridgePackage;

type Method = 'GET' | 'POST';

/** One tenant as the bridge sees it: its address, instance, token, space and delivery store. */
interface Side {
  readonly host: string;
  readonly tenant: Tenant;
  readonly token: string;
  readonly space: string;
  readonly schema: string;
  readonly account: string;
  readonly password: string;
}

describe('tenants kept apart by the bridge (API-065, API-068)', () => {
  let h: Harness;
  let delivered: DeliveredStore;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let handlers: Record<string, JobHandler>;
  // One signing key for the deployment, as the bridge holds one per sink: the token and the hostname
  // are what tell the tenants apart.
  const key = randomBytes(32).toString('hex');
  let acme: Side;
  let dev: Side;

  const signed = (host: string, method: Method, path: string, body?: unknown) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    return h.app.inject({
      method,
      url: `/bridge${path}`,
      headers: {
        host,
        ...signRequest(key, { method, path, body: payload }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload }),
    });
  };

  const drain = async () => {
    for (let n = 0; n < 20; n += 1) {
      const outcome = await processNext({
        queue,
        db: worker,
        handlers,
        workerId: 'tenancy',
        leaseMs: 60_000,
        log: { info: () => {}, warn: () => {}, error: () => {} },
      });
      if (outcome === 'idle') return;
    }
    throw new Error('the queue never emptied');
  };

  /** A delivery asked of a side's own address with its own token, worked, and its receipt. */
  const deliver = async (side: Side, pkg: BridgePackage, idempotencyKey: string) => {
    const asked = await signed(side.host, 'POST', '/deliveries', {
      instanceId: side.tenant.id,
      credential: { token: side.token },
      destination: { space: side.space },
      idempotencyKey,
      actingUser: null,
      package: pkg,
    });
    expect(asked.statusCode, asked.body).toBe(200);
    const { sinkJobId } = asked.json<{ sinkJobId: string }>();
    await drain();
    const status = await signed(side.host, 'GET', `/deliveries/${sinkJobId}`);
    expect(status.json(), status.body).toMatchObject({ status: 'succeeded' });
    return { sinkJobId, receipt: status.json<{ receipt: Receipt }>().receipt };
  };

  const artifactIds = (tenant: Tenant) =>
    h.tenantDb.withTenant(tenant, async (trx) =>
      (await trx.selectFrom('artifact').select('id').execute()).map((each) => each.id),
    );
  const deliveryIds = (tenant: Tenant) =>
    h.tenantDb.withTenant(tenant, async (trx) =>
      (await trx.selectFrom('bridge_delivery').select('id').execute()).map((each) => each.id),
    );
  /** A query on the delivery store signed in as a side's read-only account. */
  const readAs = (side: Side, text: string) => {
    const url = new URL(DELIVERED_URL);
    url.username = side.account;
    url.password = side.password;
    return queryAs(url.toString(), text);
  };

  beforeAll(async () => {
    const server = DELIVERED_URL.replace('delivered_test', 'postgres');
    const found = await queryAs(
      server,
      "select 1 from pg_database where datname = 'delivered_test'",
    );
    if (found.rowCount === 0) await queryAs(server, 'create database delivered_test');

    h = await startHarness({
      secrets: { SECRET_BRIDGE_KEYS: key, SECRET_DELIVERED_URL: DELIVERED_URL },
    });
    delivered = createDeliveredStore(DELIVERED_URL);
    worker = testTenantDatabase(h.db.workerUrl);
    queue = createJobQueue(h.db.workerUrl);
    handlers = { bridge_deliver: bridgeDeliverJob({ db: worker, stores: h.stores, delivered }) };

    // Production, at acme.alloy.test: set up through the routes, as its administrator would.
    const made = await h.call('ada', 'POST', '/v1/service-identities', {
      name: 'CT Studio',
      description: 'The delivery bridge',
    });
    expect(made.statusCode, made.body).toBe(200);
    const identity = made.json<{ id: string }>().id;
    const issued = await h.call('ada', 'POST', `/v1/service-identities/${identity}/tokens`, {
      name: 'Bridge',
      scopes: ['create', 'edit'],
      expiresAt: inAMonth(),
    });
    expect(issued.statusCode, issued.body).toBe(200);
    await h.allow(identity, h.roles.Author!, { kind: 'space', id: h.general });
    const set = await h.call('ada', 'PUT', `/v1/spaces/${h.general}/bridge-settings`, {
      componentType: null,
      template: null,
      propertyMap: {},
      data: true,
    });
    expect(set.statusCode, set.body).toBe(200);
    // The read password the service sealed for the delivery connection, as the connector was given it.
    const sealed = h.connector.asked
      .filter((each) => each.path === '/v1/seal')
      .map((each) => (each.body as { secret: string }).secret);
    acme = {
      host: HOST,
      tenant: h.tenant,
      token: issued.json<{ secret: string }>().secret,
      space: h.general,
      ...deliveredNames(h.tenant.id),
      password: sealed.at(-1)!,
    };

    // Development, at dev.acme.alloy.test: the same organisation, its own schema, store and identity.
    const tenant = await createTenant(h.db.adminUrl, h.db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: h.db.newTenantId(), name: 'Development' },
      hostnames: [DEV_HOST],
    });
    await h.store.setUp(h.db.adminUrl, tenant);
    const access = await delivered.provision(tenant.id);
    const secret = newTokenSecret();
    const space = await h.tenantDb.withTenant(tenant, async (trx) => {
      const general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      const them = await createServiceIdentity(trx, {
        name: 'CT Studio',
        description: 'The delivery bridge',
        by: null,
      });
      await issueApiToken(trx, {
        principalId: them.id,
        name: 'Bridge',
        tokenHash: hashToken(secret),
        scopes: ['create', 'edit'],
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      });
      const granted = await grant(trx, {
        roleId: (await findRole(trx, 'Author'))!.id,
        subject: { principal: them.id },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: them.id,
      });
      if ('refused' in granted) throw new Error(granted.refused);
      await writeBridgeSettings(trx, {
        spaceId: general,
        componentType: null,
        template: null,
        propertyMap: {},
        // A connection this tenant's people would read through; the job asks only that one is named.
        connectionId: randomUUID(),
        tableSchema: access.schema,
        changedBy: them.id,
      });
      return general;
    });
    dev = { host: DEV_HOST, tenant, token: secret, space, ...access };
  }, 120_000);

  afterAll(async () => {
    for (const side of [acme, dev]) {
      if (!side) continue;
      await queryAs(DELIVERED_URL, `drop schema if exists "${side.schema}" cascade`);
      const role = await queryAs(DELIVERED_URL, 'select 1 from pg_roles where rolname = $1', [
        side.account,
      ]);
      if (role.rowCount) {
        await queryAs(DELIVERED_URL, `drop owned by "${side.account}"`);
        await queryAs(DELIVERED_URL, `drop role "${side.account}"`);
      }
    }
    await delivered?.close();
    await queue?.close();
    await worker?.close();
    await h?.close();
  });

  it("one tenant's key, token or hostname never reaches another's documents or tables", async () => {
    // Each address answers its own tenant alone.
    for (const [side, other] of [
      [acme, dev],
      [dev, acme],
    ] as const) {
      const described = await signed(side.host, 'GET', '/describe');
      expect(described.json()).toMatchObject({ instances: [{ id: side.tenant.id }] });
      // Its own token at its own address, then at the other's: refused there, under either instance.
      const tested = (host: string, instanceId: string) =>
        signed(host, 'POST', '/connections:test', {
          instanceId,
          credential: { token: side.token },
        });
      expect((await tested(side.host, side.tenant.id)).statusCode).toBe(200);
      expect((await tested(other.host, other.tenant.id)).json()).toMatchObject({
        code: 'credential_rejected',
      });
      expect((await tested(other.host, side.tenant.id)).json()).toMatchObject({
        code: 'instance_not_allowed',
      });
      // A delivery at the other's address with this token, to either tenant's space, starts nothing.
      for (const space of [side.space, other.space]) {
        const crossing = await signed(other.host, 'POST', '/deliveries', {
          instanceId: other.tenant.id,
          credential: { token: side.token },
          destination: { space },
          idempotencyKey: randomBytes(32).toString('hex'),
          actingUser: null,
          package: fixture('package-decomposed.json'),
        });
        expect(crossing.json()).toMatchObject({ code: 'credential_rejected' });
      }
      // The other's own token cannot name this tenant's space: no such space there.
      const elsewhere = await signed(other.host, 'POST', '/deliveries', {
        instanceId: other.tenant.id,
        credential: { token: other.token },
        destination: { space: side.space },
        idempotencyKey: randomBytes(32).toString('hex'),
        actingUser: null,
        package: fixture('package-decomposed.json'),
      });
      expect(elsewhere.json()).toMatchObject({ code: 'not_found' });
    }
    expect(await deliveryIds(acme.tenant)).toEqual([]);
    expect(await deliveryIds(dev.tenant)).toEqual([]);

    // Production delivers a document and data; Development's documents and tables are untouched.
    const devArtifacts = await artifactIds(dev.tenant);
    const sharedKey = randomBytes(32).toString('hex');
    const document = await deliver(acme, fixture('package-decomposed.json'), sharedKey);
    const data = await deliver(
      acme,
      fixture('package-document.json'),
      randomBytes(32).toString('hex'),
    );
    const written = document.receipt.document!;
    expect(await artifactIds(acme.tenant)).toContain(written.persistentId);
    expect(await artifactIds(dev.tenant)).toEqual(devArtifacts);
    expect(
      (
        await queryAs(
          DELIVERED_URL,
          `select count(*)::int as n from information_schema.tables where table_schema = $1`,
          [dev.schema],
        )
      ).rows,
    ).toEqual([{ n: 0 }]);

    // Production's delivery ids are nothing at Development's address.
    for (const id of [document.sinkJobId, data.sinkJobId]) {
      const asked = await signed(dev.host, 'GET', `/deliveries/${id}`);
      expect(asked.json()).toMatchObject({ code: 'not_found' });
      expect(asked.body).not.toContain(written.persistentId);
    }
    // The same idempotency key at Development is its own delivery, never Production's receipt.
    const theirs = await deliver(dev, fixture('package-decomposed.json'), sharedKey);
    expect(theirs.sinkJobId).not.toBe(document.sinkJobId);
    expect(theirs.receipt.document!.persistentId).not.toBe(written.persistentId);
    expect(await artifactIds(acme.tenant)).not.toContain(theirs.receipt.document!.persistentId);
    // An update at Development naming Production's document finds nothing to update there.
    const update = await signed(dev.host, 'POST', '/deliveries', {
      instanceId: dev.tenant.id,
      credential: { token: dev.token },
      destination: { space: dev.space },
      idempotencyKey: randomBytes(32).toString('hex'),
      actingUser: null,
      update: { persistentId: written.persistentId, expected: written.components },
      package: fixture('package-decomposed.json'),
    });
    expect(update.statusCode, update.body).toBe(200);
    await drain();
    const updated = await signed(
      dev.host,
      'GET',
      `/deliveries/${update.json<{ sinkJobId: string }>().sinkJobId}`,
    );
    expect(updated.json()).toMatchObject({
      status: 'failed',
      error: { code: 'not_found', details: { reason: 'document_missing' } },
    });
    expect(await artifactIds(acme.tenant)).toContain(written.persistentId);
    await deliver(dev, fixture('package-document.json'), randomBytes(32).toString('hex'));

    // Each read role reads its own tenant's tables and never the other's, nor its schema.
    const tablesOf = async (side: Side) => {
      const tables = await queryAs(
        DELIVERED_URL,
        'select table_name from information_schema.tables where table_schema = $1 order by 1',
        [side.schema],
      );
      expect(tables.rowCount).toBeGreaterThan(0);
      return (tables.rows as { table_name: string }[]).map(
        (each) => `"${side.schema}"."${each.table_name}"`,
      );
    };
    for (const [side, other] of [
      [acme, dev],
      [dev, acme],
    ] as const) {
      for (const table of await tablesOf(side)) {
        expect((await readAs(side, `select count(*)::int as n from ${table}`)).rows).toEqual([
          { n: 1 },
        ]);
      }
      for (const table of await tablesOf(other)) {
        await expect(readAs(side, `select * from ${table}`)).rejects.toThrow(/permission denied/);
      }
      const seen = await readAs(
        side,
        `select count(*)::int as n from information_schema.tables where table_schema = '${other.schema}'`,
      );
      expect(seen.rows).toEqual([{ n: 0 }]);
    }
  });
});
