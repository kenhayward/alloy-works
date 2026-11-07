import type { AuditContext, ModelEndpoint } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { tenantBoundary } from './boundary.js';
import { createConnection, setConnectionCredential } from './connections.js';
import { setMailChannel, setMailPassword } from './mail.js';
import { migrate } from './migrate.js';
import { makeModelEndpoint, setModelCredential, setModelRoute } from './model-endpoints.js';
import { createTenant, type Tenant } from './provision.js';
import { setReferenceSource } from './reference-sources.js';
import { createServiceIdentity } from './service-identities.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { createWebhookSubscription } from './webhooks.js';

const SYSTEM: AuditContext = { actorKind: 'system' };
const SEALED = `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(40)}`;
// An address can carry a key in its path or query: only its host is ever answered.
const HOOK = 'https://hooks.example.test/in/k3y-in-the-path?token=t0ken-in-the-query';

const endpoint = (name: string, boundary: 'inside' | 'outside'): ModelEndpoint => ({
  name,
  protocol: 'openai',
  baseUrl: `https://${name.toLowerCase()}.example.test/v1/pathkey`,
  model: 'test-model',
  contextWindow: 200_000,
  priceIn: 3,
  priceOut: 15,
  currency: 'USD',
  boundary,
});

describe('what this tenant has configured to leave it (the SA plan, SAe)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, SYSTEM);

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
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('ADM-041 starts with nothing on but the declared reference sources', async () => {
    const boundary = await as((trx) => tenantBoundary(trx));
    const on = Object.entries(boundary)
      .filter(([, each]) => each.on)
      .map(([way]) => way);
    expect(on).toEqual(['reference_source']);
    expect(boundary.reference_source.items.map((each) => [each.name, each.on])).toEqual([
      ['Crossref', true],
      ['PubMed', true],
    ]);
    expect(boundary.malware_scanning).toEqual({ on: false, items: [] });
  });

  it('ADM-041 answers each way as configured: names, on or off, and each endpoint’s boundary', async () => {
    await as(async (trx) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: 'ada@example.test',
            email_verified: true,
            display_name: 'Ada',
            kind: 'user',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const outside = await makeModelEndpoint(trx, endpoint('Hosted', 'outside'), ada);
      const inside = await makeModelEndpoint(trx, endpoint('Local', 'inside'), ada);
      if (outside.answer !== 'written' || inside.answer !== 'written') throw new Error('endpoint');
      await setModelCredential(trx, outside.endpoint, SEALED, ada);
      await setModelRoute(trx, 'drafting', outside.endpoint.id, ada);
      await setModelRoute(trx, 'embedding', inside.endpoint.id, ada);
      await setModelRoute(trx, 'translate', outside.endpoint.id, ada);
      // Machine translation allowed inside alone: an outside endpoint routed is sent nothing.
      await sql`update translation_policy set machine = 'inside'`.execute(trx);
      await setReferenceSource(trx, 'pubmed', false);

      const identity = await createServiceIdentity(trx, {
        name: 'Indexer',
        description: 'Reads for the search index.',
        by: ada,
      });
      await createWebhookSubscription(trx, {
        id: crypto.randomUUID(),
        serviceIdentity: identity.id,
        url: HOOK,
        description: '',
        eventTypes: ['content.version_cut'],
        sealed: SEALED,
        by: ada,
      });
      const channel = await setMailChannel(trx, {
        enabled: false,
        relay: 'own',
        host: 'smtp.example.test',
        port: 587,
        username: 'alloy',
        fromAddress: 'alloy@example.test',
        fromName: null,
        by: ada,
      });
      await setMailPassword(trx, channel.id, SEALED, ada);
      const space = (await createSpace(trx, 'Readings')).id;
      const made = await createConnection(trx, {
        author: ada,
        spaceId: space,
        settings: {
          schemaVersion: 1,
          name: 'Warehouse',
          description: 'The sites and their readings.',
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
        },
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      await setConnectionCredential(trx, {
        id: made.connection.id,
        sealed: SEALED,
        by: ada,
        sealedFor: made.connection.settings,
      });
    });

    const boundary = await as((trx) => tenantBoundary(trx));
    expect(boundary.model_endpoint).toMatchObject({
      on: true,
      items: [
        { name: 'Hosted', on: true, host: 'hosted.example.test', boundary: 'outside' },
        { name: 'Local', on: false, host: 'local.example.test', boundary: 'inside' },
      ],
    });
    expect(boundary.embedding).toMatchObject({
      on: true,
      items: [{ name: 'Local', on: true, boundary: 'inside' }],
    });
    expect(boundary.translation).toMatchObject({
      on: false,
      items: [{ name: 'Hosted', on: false, boundary: 'outside', detail: 'inside' }],
    });
    expect(boundary.reference_source.items.map((each) => [each.name, each.on])).toEqual([
      ['Crossref', true],
      ['PubMed', false],
    ]);
    expect(boundary.webhook).toMatchObject({
      on: true,
      items: [{ name: 'hooks.example.test', host: 'hooks.example.test', on: true }],
    });
    expect(boundary.mail).toMatchObject({
      on: false,
      items: [{ name: 'smtp.example.test', on: false, detail: 'own' }],
    });
    expect(boundary.data_connection).toMatchObject({
      on: true,
      items: [{ name: 'Warehouse', on: true, host: 'source-postgres', detail: 'postgres' }],
    });

    // Never a secret, nor the path or query of an address, which can carry one.
    const said = JSON.stringify(boundary);
    for (const never of [SEALED, 'k3y-in-the-path', 't0ken-in-the-query', 'pathkey', '/v1']) {
      expect(said).not.toContain(never);
    }
  });
});
