import { finishTenantExport } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

describe("the tenant's export through the service (the R21 plan, R21-B)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const events = async (kind: string) =>
    (await h.call('ada', 'GET', `/v1/audit?kind=${kind}&limit=100`)).json<{
      items: { subject: { id: string } | null; detail: Json }[];
    }>().items;

  it('API-044 asks for an export as a job, lists it among the past ones and records the asking', async () => {
    const asked = await h.call('ada', 'POST', '/v1/exports');
    expect(asked.statusCode, asked.body).toBe(200);
    const made = asked.json<{ export: { id: string; state: string } }>().export;
    expect(made.state).toBe('queued');
    const listed = (await h.call('ada', 'GET', '/v1/exports')).json<{
      items: { id: string }[];
    }>();
    expect(listed.items.map((each) => each.id)).toContain(made.id);
    expect((await events('export.produced')).map((each) => each.detail)).toContainEqual({
      export: made.id,
      of: 'tenant',
    });
    // Not ready until its job has written it.
    const early = await h.call('ada', 'GET', `/v1/exports/${made.id}/download`);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ code: 'export_not_ready' });
  });

  it('API-044 hands out a download of a written export, each one recorded, and says when it expires', async () => {
    const made = (await h.call('ada', 'POST', '/v1/exports')).json<{ export: { id: string } }>()
      .export;
    const tenantStore = await h.tenantDb.withTenant(h.tenant, (trx) =>
      h.stores.forTenant(trx, h.tenant),
    );
    const kept = await tenantStore.put(Buffer.from('PK'), 'application/zip');
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      finishTenantExport(trx, made.id, kept, { artifacts: 3 }),
    );
    const shown = (await h.call('ada', 'GET', `/v1/exports/${made.id}`)).json<{
      export: { state: string; finishedAt: string; expiresAt: string; counts: Json };
    }>().export;
    expect(shown).toMatchObject({ state: 'done', counts: { artifacts: 3 } });
    expect(Date.parse(shown.expiresAt) - Date.parse(shown.finishedAt)).toBe(7 * 86_400_000);
    const link = await h.call('ada', 'GET', `/v1/exports/${made.id}/download`);
    expect(link.statusCode, link.body).toBe(200);
    expect(link.json<{ download: string }>().download).toContain(`.tar`);
    expect((await events('export.downloaded')).map((each) => each.detail)).toContainEqual({
      export: made.id,
      of: 'tenant',
    });
  });

  it('IMP-024 asks for one part, naming it, and refuses a scope without its id or a space not there', async () => {
    const spaces = (await h.call('ada', 'GET', '/v1/spaces')).json<{ items: { id: string }[] }>();
    const space = spaces.items[0]!.id;
    const asked = await h.call('ada', 'POST', '/v1/exports', {
      scope: 'space',
      id: space,
      followReferences: true,
    });
    expect(asked.statusCode, asked.body).toBe(200);
    expect(asked.json<{ export: unknown }>().export).toMatchObject({
      scope: 'space',
      scopeId: space,
      followReferences: true,
    });
    const unnamed = await h.call('ada', 'POST', '/v1/exports', { scope: 'space' });
    expect(unnamed.json()).toMatchObject({ code: 'export_scope_invalid' });
    const stray = await h.call('ada', 'POST', '/v1/exports', { scope: 'configuration', id: space });
    expect(stray.json()).toMatchObject({ code: 'export_scope_invalid' });
    const missing = await h.call('ada', 'POST', '/v1/exports', {
      scope: 'space',
      id: '00000000-0000-4000-8000-000000000000',
    });
    expect(missing.statusCode).toBe(404);
    const configuration = await h.call('ada', 'POST', '/v1/exports', { scope: 'configuration' });
    expect(configuration.statusCode, configuration.body).toBe(200);
  });

  it('API-044 lets only an administrator export the environment or list its exports', async () => {
    for (const [method, url] of [
      ['POST', '/v1/exports'],
      ['GET', '/v1/exports'],
    ] as const) {
      expect((await h.call('alice', method, url)).statusCode, url).toBe(403);
    }
  });
});
