import { randomUUID } from 'node:crypto';

import type { ContentDocument, ModelEndpoint } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapCluster } from './bootstrap.js';
import { actOnProposal, makeProposal, readProposal } from './generation-proposals.js';
import { migrate } from './migrate.js';
import {
  endRun,
  makeModelEndpoint,
  noteStep,
  readRun,
  startRun,
  sweepAbandonedRuns,
  type StoredModelEndpoint,
} from './model-endpoints.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const endpointSettings: ModelEndpoint = {
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

const proposed = {
  schemaVersion: 1,
  title: 'Sites',
  language: 'en-GB',
  direction: 'ltr',
  content: [],
} as unknown as ContentDocument;

describe("an assistant run's proposals and steps", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let endpoint: StoredModelEndpoint;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(tenant, async (trx) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const made = await makeModelEndpoint(trx, endpointSettings, ada);
      if (made.answer !== 'written') throw new Error(made.answer);
      endpoint = made.endpoint;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  const run = (trx: TenantTransaction) =>
    startRun(trx, {
      purpose: 'drafting',
      endpoint,
      parameters: { maxTokens: 64 },
      contextDigest: 'a'.repeat(64),
      by: ada,
      documentId: randomUUID(),
    });

  it('GEN-010 keeps each step as it is made, and the digest and what was read set once, as the run ends', async () => {
    await service.withTenant(tenant, async (trx) => {
      const id = await run(trx);
      await noteStep(trx, id, { tool: 'read_outline', ok: true });
      await noteStep(trx, id, { tool: 'read_component', ok: true });
      expect((await readRun(trx, id))?.steps).toEqual([
        { tool: 'read_outline', ok: true },
        { tool: 'read_component', ok: true },
      ]);
      const ended = await endRun(trx, id, {
        outcome: 'finished',
        contextDigest: 'b'.repeat(64),
        context: [{ component: 'c1', blocks: ['p1'] }],
      });
      expect(ended).toMatchObject({
        contextDigest: 'b'.repeat(64),
        context: [{ component: 'c1', blocks: ['p1'] }],
        steps: [{ tool: 'read_outline' }, { tool: 'read_component' }],
      });
      // Nothing is added once it has ended.
      await noteStep(trx, id, { tool: 'late', ok: true });
      expect((await readRun(trx, id))?.steps).toHaveLength(2);
    });
    // A running run's digest is not rewritten.
    await expect(
      service.withTenant(tenant, async (trx) => {
        const id = await run(trx);
        await sql`update generation_run set context_digest = ${'c'.repeat(64)} where id = ${id}`.execute(
          trx,
        );
      }),
    ).rejects.toThrow(/a run is ended once/);
  });

  it('GEN-040 GEN-041 acts on a proposal once, keeping it, and never deletes one', async () => {
    const id = await service.withTenant(tenant, async (trx) => {
      const proposal = await makeProposal(trx, {
        run: await run(trx),
        component: randomUUID(),
        against: randomUUID(),
        proposed,
      });
      expect(proposal).toMatchObject({ number: 1, state: 'open', requestedBy: ada });
      await actOnProposal(trx, { proposal, act: 'discarded', by: ada });
      const discarded = await readProposal(trx, proposal.id);
      expect(discarded).toMatchObject({ state: 'discarded', actedBy: ada, proposed });
      const { rows } = await sql<{
        kind: string;
        detail: unknown;
      }>`select kind, detail from audit_event
        where kind = 'generation.discarded' order by sequence desc limit 1`.execute(trx);
      expect(rows[0]?.detail).toEqual({ run: proposal.runId, proposal: proposal.id });
      return proposal.id;
    });
    for (const attempt of [
      sql`update generation_proposal set state = 'open', acted_at = null, acted_by = null where id = ${id}`,
      sql`update generation_proposal set proposed = '{}'::jsonb where id = ${id}`,
      sql`delete from generation_proposal where id = ${id}`,
    ]) {
      await expect(service.withTenant(tenant, (trx) => attempt.execute(trx))).rejects.toThrow(
        /generation_proposal: a proposal is/,
      );
    }
  });

  it("LIB-040 keeps a citation proposal's source record beside it, an object, never on a creation", async () => {
    const cites = {
      source: 'crossref' as const,
      identifier: '10.5555/weir.1',
      csl: { type: 'article-journal' as const, title: 'Spring floods' },
      at: '2026-10-22T09:00:00.000Z',
    };
    const id = await service.withTenant(tenant, async (trx) => {
      const proposal = await makeProposal(trx, {
        run: await run(trx),
        component: randomUUID(),
        against: randomUUID(),
        proposed,
        cites,
      });
      expect((await readProposal(trx, proposal.id))?.cites).toEqual(cites);
      return proposal.id;
    });
    for (const attempt of [
      sql`insert into generation_proposal (run_id, number, creates, proposed, cites)
        select run_id, 2, '{}'::jsonb, proposed, cites from generation_proposal where id = ${id}`,
      sql`insert into generation_proposal (run_id, number, component_id, made_against, proposed, cites)
        select run_id, 3, component_id, made_against, proposed, '[]'::jsonb
        from generation_proposal where id = ${id}`,
    ]) {
      await expect(service.withTenant(tenant, (trx) => attempt.execute(trx))).rejects.toThrow(
        /generation_proposal/,
      );
    }
  });

  it('ends a run left running an hour as abandoned, its steps kept', async () => {
    const stale = await service.withTenant(tenant, async (trx) => {
      const id = await run(trx);
      await noteStep(trx, id, { tool: 'read_outline', ok: true });
      return id;
    });
    // Its start moved two hours back, as the hours passing would, past the trigger as its owner.
    const table = `"${tenant.schema}".generation_run`;
    await queryAs(db.adminUrl, `alter table ${table} disable trigger generation_run_kept`);
    try {
      await queryAs(
        db.adminUrl,
        `update ${table} set started_at = now() - interval '2 hours' where id = $1`,
        [stale],
      );
    } finally {
      await queryAs(db.adminUrl, `alter table ${table} enable trigger generation_run_kept`);
    }
    await service.withTenant(tenant, async (trx) => {
      expect(await sweepAbandonedRuns(trx)).toBe(1);
      expect(await readRun(trx, stale)).toMatchObject({
        outcome: 'abandoned',
        steps: [{ tool: 'read_outline' }],
      });
    });
  });
});
