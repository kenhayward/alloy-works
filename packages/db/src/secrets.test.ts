import type { AuditContext, ModelEndpoint } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createConnection, setConnectionCredential } from './connections.js';
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
import { createSpace } from './spaces.js';
import { silentFailuresOf, tellSilentFailures } from './silent-failures.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  queryAs,
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

  it('lists each secret with what it belongs to, when last replaced and everything that uses it', async () => {
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

  it('tells a break after a replacement once, against the secret, naming every consumer', async () => {
    await run('finished');
    expect((await as((trx) => secretsFailing(trx))).filter((each) => each.failing)).toEqual([]);
    expect(await sweep()).toBe(0);

    await run('model_unavailable');
    expect(await sweep()).toBe(1);
    expect(await sweep()).toBe(0);
    const [notice] = await told();
    expect(notice).toMatchObject({
      kind: 'secret_failing',
      replaced: {
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

  it('tells a break once for its replacement, however it comes and goes, until the next', async () => {
    await run('finished');
    expect(await sweep()).toBe(0);
    await run('model_unavailable');
    expect(await sweep()).toBe(0);
    expect(await told()).toHaveLength(2);
  });

  it('names a webhook with no description by its host, never its address, wherever it is said', async () => {
    const hook = await as(async (trx) => {
      const identity = await createServiceIdentity(trx, {
        name: 'Receiver',
        description: 'Takes events.',
        by: ada,
      });
      return createWebhookSubscription(trx, {
        id: crypto.randomUUID(),
        serviceIdentity: identity.id,
        url: 'https://receiver.example.test/private-path?key=hidden-query',
        description: '',
        eventTypes: ['content.version_cut'],
        sealed: SEALED,
        by: ada,
      });
    });
    await queryAs(
      db.adminUrl,
      `with d as (
         insert into "${tenant.schema}".webhook_delivery (id, subscription_id, type, sequence, payload)
         values (gen_random_uuid(), $1, 'content.version_cut', 'audit:999999', '{}') returning id)
       insert into "${tenant.schema}".webhook_attempt (delivery_id, status, latency_ms)
       select id, 401, 5 from d`,
      [hook.id],
    );
    const listed = (await as((trx) => tenantSecrets(trx))).find((each) => each.of.id === hook.id)!;
    expect(listed.of.name).toBe('receiver.example.test');
    const failing = (await as((trx) => secretsFailing(trx))).find((each) =>
      each.key.includes(hook.id),
    )!;
    expect(failing.failing).toBe(true);
    await sweep();
    const said = JSON.stringify([listed, failing, await told()]);
    for (const part of ['private-path', 'hidden-query']) expect(said).not.toContain(part);
  });

  it('lists the SCIM token of a provider whose secret is named, not sealed', async () => {
    const identity = await as((trx) =>
      createServiceIdentity(trx, { name: 'SCIM: Named', description: 'Provisions.', by: ada }),
    );
    const { rows } = await queryAs(
      db.adminUrl,
      `insert into "${tenant.schema}".identity_provider (issuer, name, client_id, secret_name, scim_identity)
       values ('https://named.example.test', 'Named', 'alloy', 'named_secret', $1) returning id`,
      [identity.id],
    );
    const provider = (rows[0] as { id: string }).id;
    await as((trx) =>
      trx
        .insertInto('api_token')
        .values({
          principal_id: identity.id,
          name: 'SCIM: Named',
          token_hash: '8'.repeat(64),
          scopes: [],
          expires_at: new Date(Date.now() + 30 * 86_400_000),
        })
        .execute(),
    );
    const held = await as((trx) => tenantSecrets(trx));
    expect(held.find((each) => each.kind === 'scim_token')).toMatchObject({
      of: { id: provider, name: 'Named' },
      consumers: [{ kind: 'provisioning', id: provider, name: 'Named' }],
    });
    // Its token is SCIM's, not a service identity's of its own.
    expect(
      held.filter((each) => each.kind === 'service_identity_token').map((each) => each.of.name),
    ).not.toContain('SCIM: Named');
  });

  it("reads a connection's break from its runs since the credential was replaced", async () => {
    const id = await as(async (trx) => {
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
      const set = await setConnectionCredential(trx, {
        id: made.connection.id,
        sealed: SEALED,
        by: ada,
        sealedFor: made.connection.settings,
      });
      if (set.answer !== 'set') throw new Error(set.answer);
      return made.connection.id;
    });
    const failing = async () =>
      (await as((trx) => secretsFailing(trx))).find((each) => each.key.includes(id));
    expect((await failing())?.failing).toBe(false);
    await as((trx) =>
      sql`insert into query_run (act, principal_id, connection_id, duration_ms, outcome, failure)
          values ('sample', ${ada}, ${id}, 10, 'failed', 'connection_failed')`.execute(trx),
    );
    expect(await failing()).toMatchObject({
      failing: true,
      secret: { kind: 'connection_credential', name: 'Warehouse' },
    });
  });
});
