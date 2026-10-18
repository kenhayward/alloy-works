import type { ModelEndpoint } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import {
  changeModelEndpoint,
  endRun,
  listModelEndpoints,
  listModelRoutes,
  makeModelEndpoint,
  modelKeyState,
  readRun,
  retireModelEndpoint,
  setModelCredential,
  setModelRoute,
  startRun,
  usableModelKey,
  type StoredModelEndpoint,
} from './model-endpoints.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const ISSUER = 'https://idp.example';
const SEALED = `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(40)}`;

const drafting: ModelEndpoint = {
  name: 'Drafting',
  protocol: 'anthropic',
  baseUrl: 'https://models.example.test',
  model: 'claude-test',
  contextWindow: 200_000,
  priceIn: 3,
  priceOut: 15,
  currency: 'USD',
  boundary: 'outside',
};

describe('model endpoints', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const made = async (
    trx: TenantTransaction,
    endpoint: ModelEndpoint,
  ): Promise<StoredModelEndpoint> => {
    const written = await makeModelEndpoint(trx, endpoint, ada);
    if (written.answer !== 'written') throw new Error(written.answer);
    return written.endpoint;
  };

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
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('GEN-027 holds any number of endpoints, of either protocol, each name once among those in use', async () => {
    await service.withTenant(production, async (trx) => {
      const one = await made(trx, drafting);
      await made(trx, {
        ...drafting,
        name: 'Local',
        protocol: 'openai',
        baseUrl: 'http://10.0.4.7:11434/v1',
        boundary: 'inside',
      });
      expect((await makeModelEndpoint(trx, { ...drafting, name: 'drafting' }, ada)).answer).toBe(
        'name.taken',
      );
      await retireModelEndpoint(trx, one.id);
      expect((await makeModelEndpoint(trx, drafting, ada)).answer).toBe('written');
      const listed = await listModelEndpoints(trx);
      expect(listed.map((each) => [each.name, each.protocol, each.retiredAt === null])).toEqual([
        ['Drafting', 'anthropic', true],
        ['Local', 'openai', true],
        ['Drafting', 'anthropic', false],
      ]);
      expect(listed[0]).toMatchObject({ priceIn: 3, priceOut: 15, boundary: 'outside' });
    });
  });

  it('IAM-076 keeps each tenant its own endpoints: another sees none of them', async () => {
    await service.withTenant(production, async (trx) => {
      expect((await listModelEndpoints(trx)).length).toBeGreaterThan(0);
    });
    await service.withTenant(development, async (trx) => {
      expect(await listModelEndpoints(trx)).toEqual([]);
    });
  });

  it('holds a key sealed for where the endpoint points, and says it needs setting once the origin moves', async () => {
    await service.withTenant(production, async (trx) => {
      const endpoint = await made(trx, { ...drafting, name: 'Keyed' });
      expect(await modelKeyState(trx, endpoint)).toEqual({ set: false });
      await setModelCredential(trx, endpoint, SEALED, ada);
      expect(await modelKeyState(trx, endpoint)).toMatchObject({ set: true, needsSetting: false });
      expect(await usableModelKey(trx, endpoint)).toBe(SEALED);
      // A path moved under the same origin keeps it; another host does not.
      const pathed = await changeModelEndpoint(trx, endpoint.id, {
        ...drafting,
        name: 'Keyed',
        baseUrl: 'https://models.example.test/v2',
      });
      if (pathed.answer !== 'written') throw new Error(pathed.answer);
      expect(await usableModelKey(trx, pathed.endpoint)).toBe(SEALED);
      const moved = await changeModelEndpoint(trx, endpoint.id, {
        ...drafting,
        name: 'Keyed',
        baseUrl: 'https://elsewhere.example.test',
      });
      if (moved.answer !== 'written') throw new Error(moved.answer);
      expect(await modelKeyState(trx, moved.endpoint)).toMatchObject({
        set: true,
        needsSetting: true,
      });
      expect(await usableModelKey(trx, moved.endpoint)).toBeUndefined();
      expect(
        (
          await changeModelEndpoint(trx, endpoint.id, {
            ...drafting,
            name: 'Keyed',
            protocol: 'openai',
          })
        ).answer,
      ).toBe('protocol.fixed');
      const { rows } = await sql<{
        kind: string;
        detail: unknown;
      }>`select kind, detail from audit_event
        where subject = ${endpoint.id} order by sequence`.execute(trx);
      expect(rows.map((row) => row.kind)).toEqual([
        'model_endpoint.made',
        'model_endpoint.credential_set',
        'model_endpoint.changed',
        'model_endpoint.changed',
      ]);
      expect(rows[2]!.detail).toEqual({ settings: ['baseUrl'] });
      expect(JSON.stringify(rows)).not.toContain(SEALED);
    });
  });

  it('GEN-028 routes each purpose to one endpoint, or none, and a retired endpoint routes nothing', async () => {
    await service.withTenant(production, async (trx) => {
      const one = await made(trx, { ...drafting, name: 'Routed' });
      const two = await made(trx, { ...drafting, name: 'Summaries' });
      await setModelRoute(trx, 'drafting', one.id, ada);
      await setModelRoute(trx, 'summarising', two.id, ada);
      await setModelRoute(trx, 'drafting', two.id, ada);
      expect(
        (await listModelRoutes(trx)).map((route) => [route.purpose, route.endpointId]),
      ).toEqual([
        ['drafting', two.id],
        ['summarising', two.id],
      ]);
      await setModelRoute(trx, 'summarising', null, ada);
      expect((await listModelRoutes(trx)).map((route) => route.purpose)).toEqual(['drafting']);
      await retireModelEndpoint(trx, two.id);
      expect(await listModelRoutes(trx)).toEqual([]);
    });
  });

  it('keeps a run whole: ended once, never changed after, never deleted', async () => {
    await service.withTenant(production, async (trx) => {
      const endpoint = await made(trx, { ...drafting, name: 'Run' });
      const id = await startRun(trx, {
        purpose: 'test',
        endpoint,
        parameters: { maxTokens: 16 },
        contextDigest: 'f'.repeat(64),
        by: ada,
      });
      const ended = await endRun(trx, id, {
        outcome: 'finished',
        model: 'claude-test-20260101',
        usage: { in: 1_000_000, out: 2 },
      });
      // 3 per million in, 15 per million out: 3 and 30 millionths, so 3,000,030 millionths.
      expect(ended).toMatchObject({
        outcome: 'finished',
        model: 'claude-test-20260101',
        tokensIn: 1_000_000,
        tokensOut: 2,
        costMicros: 3_000_030n,
        endpoint: { name: 'Run', priceIn: 3 },
      });
      // The endpoint's prices changing later rewrites nothing the run cost.
      await changeModelEndpoint(trx, endpoint.id, { ...drafting, name: 'Run', priceIn: 30 });
      expect((await readRun(trx, id))?.costMicros).toBe(3_000_030n);
    });
    // A person deleted leaves their ended runs, unnamed: the one change one takes.
    await service.withTenant(production, async (trx) => {
      const { rows } = await sql<{ id: string }>`select id from generation_run limit 1`.execute(
        trx,
      );
      await sql`update generation_run set requested_by = null where id = ${rows[0]!.id}`.execute(
        trx,
      );
      expect((await readRun(trx, rows[0]!.id))?.requestedBy).toBeNull();
    });
    for (const attempt of [
      (id: string) => sql`update generation_run set outcome = 'failed' where id = ${id}`,
      (id: string) => sql`update generation_run set tokens_in = 1 where id = ${id}`,
      (id: string) => sql`delete from generation_run where id = ${id}`,
    ]) {
      await expect(
        service.withTenant(production, async (trx) => {
          const { rows } = await sql<{ id: string }>`select id from generation_run limit 1`.execute(
            trx,
          );
          await attempt(rows[0]!.id).execute(trx);
        }),
      ).rejects.toThrow(/generation_run: a run is/);
    }
  });
});
