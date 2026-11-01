import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { routeEmbedding } from './embeddings.js';
import { migrate } from './migrate.js';
import {
  listModelEndpoints,
  makeModelEndpoint,
  readModelEndpoint,
  setModelRoute,
} from './model-endpoints.js';
import { provisionTenant, type Tenant } from './provision.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import type { TenantTransaction } from './tables.js';

/**
 * Migration 0182: an endpoint's kind, timeout and what its model supports. An endpoint embedding is
 * routed to, or that serves or waits to serve meaning, is an embedding model; every other an LLM that
 * calls tools, reads no images and keeps the default timeout.
 */
describe('migration 0182, which gives every endpoint made before it a kind', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    before = await mkdtemp(join(tmpdir(), 'aw-before-0182-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 182;
      },
    });
    service = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  const made = async (trx: TenantTransaction, name: string, by: string) => {
    const written = await makeModelEndpoint(
      trx,
      {
        name,
        protocol: 'openai',
        baseUrl: 'http://10.0.4.7:1234/v1',
        model: `stand-in-${name.toLowerCase()}`,
        contextWindow: 8192,
        priceIn: 0,
        priceOut: 0,
        currency: 'USD',
        boundary: 'inside',
      },
      by,
    );
    if (written.answer !== 'written') throw new Error(written.answer);
    return written.endpoint.id;
  };

  it('marks the endpoints embedding goes to as embedding models, and the rest as LLMs', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant: Tenant = { ...provisioned, id };

    const ids = await service.withTenant(tenant, async (trx) => {
      const ada = (
        await trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.test', subject: 'ada', email: null, display_name: 'Ada' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const routed = await made(trx, 'Routed', ada);
      const waiting = await made(trx, 'Waiting', ada);
      const talker = await made(trx, 'Talker', ada);
      await setModelRoute(trx, 'embedding', routed, ada);
      // Routed elsewhere since, but still waiting to serve meaning.
      await routeEmbedding(trx, { id: waiting, model: 'stand-in-waiting' });
      await setModelRoute(trx, 'chat', talker, ada);
      return { routed, waiting, talker };
    });

    await migrate(db.migratorUrl);

    const kinds = await service.withTenant(tenant, async (trx) =>
      Object.fromEntries((await listModelEndpoints(trx)).map((each) => [each.name, each])),
    );
    expect(kinds['Routed']).toMatchObject({ kind: 'embedding' });
    expect(kinds['Waiting']).toMatchObject({ kind: 'embedding' });
    expect(kinds['Talker']).toMatchObject({
      kind: 'llm',
      supportsTools: true,
      supportsImages: false,
    });
    expect(kinds['Talker']).not.toHaveProperty('timeoutSeconds');
    const read = await service.withTenant(tenant, (trx) => readModelEndpoint(trx, ids.talker));
    expect(read?.id).toBe(ids.talker);
  });
});
