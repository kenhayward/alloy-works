import type { AuditContext, ModelEndpoint } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { grant } from './grants.js';
import { listInbox } from './inbox.js';
import { setMailChannel, setMailPassword } from './mail.js';
import { migrate } from './migrate.js';
import {
  endRun,
  makeModelEndpoint,
  setModelCredential,
  setModelRoute,
  startRun,
  type StoredModelEndpoint,
} from './model-endpoints.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { secretsFailing, tenantSecrets } from './secrets.js';
import { createServiceIdentity } from './service-identities.js';
import { silentFailuresOf, tellSilentFailures } from './silent-failures.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { createWebhookSubscription, rotateWebhookSecret } from './webhooks.js';

const SYSTEM: AuditContext = { actorKind: 'system' };
const SEALED = `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(40)}`;
const RESEALED = `v1.${'d'.repeat(16)}.${'e'.repeat(22)}.${'f'.repeat(40)}`;
const HASH = '9'.repeat(64);

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

describe("a tenant's secrets and what uses each (secrets.md; the SA plan, SAd)", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let endpoint: StoredModelEndpoint;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, SYSTEM);

  const run = (outcome: string) =>
    as(async (trx) => {
      const id = await startRun(trx, {
        purpose: 'drafting',
        endpoint,
        parameters: {},
        contextDigest: 'e'.repeat(64),
        by: ada,
      });
      await endRun(trx, id, { outcome });
    });

  const told = () =>
    as(async (trx) =>
      (await listInbox(trx, ada, { limit: 100 })).notifications
        .filter((each) => each.kind === 'diagnostics')
        .map((each) => each.diagnostics),
    );

  const sweep = () => as(async (trx) => tellSilentFailures(trx, await silentFailuresOf(trx)));

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
      await grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      const written = await makeModelEndpoint(trx, drafting, ada);
      if (written.answer !== 'written') throw new Error(written.answer);
      endpoint = written.endpoint;
      await setModelCredential(trx, endpoint, SEALED, ada);
      await setModelRoute(trx, 'drafting', endpoint.id, ada);
      await setModelRoute(trx, 'translate', endpoint.id, ada);
      await sql`update translation_policy set machine = 'any'`.execute(trx);

      const identity = await createServiceIdentity(trx, {
        name: 'Indexer',
        description: 'Reads for the search index.',
        by: ada,
      });
      await trx
        .insertInto('api_token')
        .values({
          principal_id: identity.id,
          name: 'Indexer key',
          token_hash: HASH,
          scopes: [],
          expires_at: new Date(Date.now() + 30 * 86_400_000),
        })
        .execute();
      const hook = await createWebhookSubscription(trx, {
        id: crypto.randomUUID(),
        serviceIdentity: identity.id,
        url: 'https://hooks.example.test/in',
        description: 'Search index',
        eventTypes: ['content.version_cut'],
        sealed: SEALED,
        by: ada,
      });
      await rotateWebhookSecret(trx, hook.id, RESEALED);

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
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('ADM-047 lists each secret with what it belongs to, when last replaced and everything that uses it', async () => {
    const held = await as((trx) => tenantSecrets(trx));
    const byKind = Object.fromEntries(held.map((each) => [each.kind, each]));
    expect(byKind['model_endpoint_key']).toMatchObject({
      of: { id: endpoint.id, name: 'Drafting' },
      previousUntil: null,
      consumers: [
        { kind: 'purpose', id: 'drafting', name: 'drafting' },
        { kind: 'purpose', id: 'translate', name: 'translate' },
        { kind: 'translation_policy', id: null, name: null },
      ],
    });
    expect(byKind['model_endpoint_key']!.replacedAt).toBeInstanceOf(Date);
    const hook = byKind['webhook_signing_secret']!;
    expect(hook.consumers).toEqual([
      { kind: 'webhook_subscription', id: hook.of.id, name: 'Search index' },
    ]);
    // The old one signs beside it for 24 hours.
    const hours = (hook.previousUntil!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(byKind['mail_relay_password']).toMatchObject({
      of: { name: 'smtp.example.test' },
      consumers: [{ kind: 'mail_delivery' }],
    });
    expect(byKind['mail_relay_password']!.replacedAt).toBeInstanceOf(Date);
    expect(byKind['service_identity_token']).toMatchObject({
      of: { name: 'Indexer key' },
      consumers: [{ kind: 'service_identity', name: 'Indexer' }],
    });
    // Never a value, sealed or hashed.
    const said = JSON.stringify(held);
    for (const secret of [SEALED, RESEALED, HASH]) expect(said).not.toContain(secret);
  });

  it('ADM-047 tells a break after a replacement once, against the secret, naming every consumer', async () => {
    await run('finished');
    expect((await as((trx) => secretsFailing(trx))).filter((each) => each.failing)).toEqual([]);
    expect(await sweep()).toBe(0);

    await run('model_unavailable');
    expect(await sweep()).toBe(1);
    expect(await sweep()).toBe(0);
    const [notice] = await told();
    expect(notice).toMatchObject({
      kind: 'secret_failing',
      secret: {
        kind: 'model_endpoint_key',
        name: 'Drafting',
        consumers: ['drafting', 'translate', 'translation_policy'],
      },
    });

    // Replaced again: the break before is forgotten, and the next one told again.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await as((trx) => setModelCredential(trx, endpoint, RESEALED, ada));
    expect(await sweep()).toBe(0);
    await run('model_unavailable');
    expect(await sweep()).toBe(1);
    expect(await told()).toHaveLength(2);
  });
});
