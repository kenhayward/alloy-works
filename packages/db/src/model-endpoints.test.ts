import type { ModelEndpoint } from '@alloy-works/domain';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapCluster } from './bootstrap.js';
import { setBudget } from './generation-budget.js';
import { grant } from './grants.js';
import { findRole } from './roles.js';
import { usageByMonth } from './model-usage.js';
import { migrate } from './migrate.js';
import {
  changeModelEndpoint,
  readModelEndpoint,
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

  it('keeps the model turns and tool calls a run on an endpoint may make, each changed alone (issue #872)', async () => {
    await service.withTenant(production, async (trx) => {
      const limited = await made(trx, {
        ...drafting,
        name: 'Limited',
        turnsPerRun: 8,
        toolCallsPerRun: 30,
      });
      expect(limited).toMatchObject({ turnsPerRun: 8, toolCallsPerRun: 30 });
      const changed = await changeModelEndpoint(trx, limited.id, {
        ...drafting,
        name: 'Limited',
        turnsPerRun: 8,
        toolCallsPerRun: 250,
      });
      if (changed.answer !== 'written') throw new Error(changed.answer);
      expect(await readModelEndpoint(trx, limited.id)).toMatchObject({
        turnsPerRun: 8,
        toolCallsPerRun: 250,
      });
      // Left out, the default: none stored.
      const plain = await made(trx, { ...drafting, name: 'Plain' });
      expect(plain).not.toHaveProperty('turnsPerRun');
      expect(plain).not.toHaveProperty('toolCallsPerRun');
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

  it("keeps a run's transcript: the ask as it starts, the reply once as it ends, neither changed after", async () => {
    const id = await service.withTenant(production, async (trx) =>
      startRun(trx, {
        purpose: 'drafting',
        endpoint: await made(trx, { ...drafting, name: 'Transcript' }),
        parameters: {},
        contextDigest: 'e'.repeat(64),
        by: ada,
        ask: 'What floods?',
      }),
    );
    const refused = (statement: ReturnType<typeof sql>) =>
      expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /ended once/,
      );
    // While it runs, its words stay as asked, and its reply is set only by its ending.
    await refused(sql`update generation_run set ask = 'Something else' where id = ${id}`);
    await refused(sql`update generation_run set reply = 'Early' where id = ${id}`);
    const ended = await service.withTenant(production, (trx) =>
      endRun(trx, id, { outcome: 'finished', model: 'claude-test', reply: 'The north weir.' }),
    );
    expect(ended).toMatchObject({ ask: 'What floods?', reply: 'The north weir.' });
    await refused(sql`update generation_run set reply = 'Rewritten' where id = ${id}`);
    expect(await service.withTenant(production, (trx) => readRun(trx, id))).toMatchObject({
      ask: 'What floods?',
      reply: 'The north weir.',
    });
  });

  it('ends a run whose budget alert could not be sent, saying so, and sends nothing (the G6 plan, G6-D)', async () => {
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await service.withTenant(production, async (trx) => {
        await setBudget(trx, { currency: 'USD', limitMicros: 1n, thresholds: [50] }, ada);
        // Somebody to tell: Ada, administering the environment.
        const answer = await grant(trx, {
          roleId: (await findRole(trx, 'Administrator'))!.id,
          subject: { principal: ada },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: ada,
        });
        if ('refused' in answer) throw new Error(answer.refused);
        await sql`insert into generation_budget_recipient (principal_id) values (${ada})`.execute(
          trx,
        );
      });
      // Any alert's record refused, as a failing store would.
      await admin.query(
        `alter table "${production.schema}".generation_budget_alert
           add constraint refuse_every_alert check (threshold < 0) not valid`,
      );
      const id = await service.withTenant(production, async (trx) =>
        startRun(trx, {
          purpose: 'drafting',
          endpoint: await made(trx, { ...drafting, name: 'Alerting' }),
          parameters: {},
          contextDigest: 'f'.repeat(64),
          by: ada,
        }),
      );
      const ended = await service.withTenant(production, (trx) =>
        endRun(trx, id, { outcome: 'finished', model: 'claude-test', usage: { in: 10, out: 10 } }),
      );
      expect(ended).toMatchObject({ outcome: 'finished', alertFailed: true });
      expect(await service.withTenant(production, (trx) => readRun(trx, id))).toMatchObject({
        outcome: 'finished',
        costMicros: 180n,
      });
    } finally {
      await admin.query(
        `alter table "${production.schema}".generation_budget_alert drop constraint if exists refuse_every_alert`,
      );
      await service.withTenant(production, (trx) => setBudget(trx, null, ada));
      await admin.end();
    }
  });

  it('totals model runs by UTC month and purpose over the months asked, a month long past among them (the G6 plan, G6-F)', async () => {
    await service.withTenant(production, async (trx) => {
      const endpoint = await made(trx, { ...drafting, name: 'Trend' });
      for (const back of [5, 5, 12]) {
        await sql`insert into generation_run (purpose, endpoint_id, endpoint, parameters,
              context_digest, requested_by, started_at, outcome, tokens_in, tokens_out,
              cost_micros, finished_at)
            values ('summarising', ${endpoint.id}, ${JSON.stringify({ ...drafting })}::jsonb,
              '{}'::jsonb, ${'a'.repeat(64)}, ${ada},
              date_trunc('month', now()) - make_interval(months => ${back}), 'finished', 40, 10, 270,
              date_trunc('month', now()) - make_interval(months => ${back}))`.execute(trx);
      }
      const { rows } = await sql<{ month: string }>`
        select to_char((date_trunc('month', now() at time zone 'utc')
          - interval '5 months'), 'YYYY-MM') as month`.execute(trx);
      const usage = await usageByMonth(trx, 12);
      const summarising = usage.models.filter((each) => each.purpose === 'summarising');
      // Twelve months back is outside twelve months, and inside thirteen.
      expect(summarising).toEqual([
        {
          month: rows[0]!.month,
          purpose: 'summarising',
          runs: 2,
          tokensIn: 80,
          tokensOut: 20,
          tokensCached: 0,
          costs: [{ currency: 'USD', micros: 540n }],
        },
      ]);
      expect(
        (await usageByMonth(trx, 13)).models.filter((each) => each.purpose === 'summarising'),
      ).toHaveLength(2);
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
