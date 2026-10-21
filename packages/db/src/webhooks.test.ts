import { randomUUID } from 'node:crypto';
import { webhookAuditTypes, type AuditContext } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordEvent } from './audit.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createServiceIdentity, disableServiceIdentity } from './service-identities.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import {
  changeWebhookSubscription,
  createWebhookSubscription,
  listWebhookSubscriptions,
  removeWebhookSubscription,
  rotateWebhookSecret,
} from './webhooks.js';

const SYSTEM: AuditContext = { actorKind: 'system' };

describe('webhook subscriptions and the deliveries their trigger queues (the WB plan)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let robot = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, SYSTEM);

  const subscribe = (types: string[], description = 'Receiver') =>
    as((trx) =>
      createWebhookSubscription(trx, {
        id: randomUUID(),
        serviceIdentity: robot,
        url: 'https://receiver.example.test/hooks',
        description,
        eventTypes: types as never,
        sealed: 'sealed-for-the-test',
        by: ada,
      }),
    );

  const deliveries = (subscription: string) =>
    as((trx) =>
      trx
        .selectFrom('webhook_delivery')
        .select(['type', 'sequence', 'artifact_id', 'payload', 'state'])
        .where('subscription_id', '=', subscription)
        .orderBy('created_at')
        .execute(),
    );

  /** An audited act of this kind about an artifact, as its emitter would record it. */
  const act = (kind: 'artifact.archived' | 'artifact.unarchived', subject: string) =>
    as((trx) => recordEvent(trx, { kind, subject: { kind: 'component', id: subject } }));

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
    ada = (
      await as((trx) =>
        trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      )
    ).id;
    robot = (
      await as((trx) => createServiceIdentity(trx, { name: 'Robot', description: '', by: ada }))
    ).id;
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('LIF-071 records every change to a subscription, never its URL', async () => {
    const made = await subscribe(['artifact.archived'], 'Archive feed');
    await as((trx) =>
      changeWebhookSubscription(trx, made.id, {
        eventTypes: ['artifact.archived', 'artifact.unarchived'],
      }),
    );
    await as((trx) => rotateWebhookSecret(trx, made.id, 'sealed-again'));
    await as((trx) => removeWebhookSubscription(trx, made.id));
    const events = await as((trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'detail'])
        .where('subject', '=', made.id)
        .orderBy('sequence')
        .execute(),
    );
    expect(events).toEqual([
      { kind: 'webhook.changed', detail: { change: 'made', types: ['artifact.archived'] } },
      {
        kind: 'webhook.changed',
        detail: {
          change: 'changed',
          types: ['artifact.archived', 'artifact.unarchived'],
          urlChanged: false,
        },
      },
      { kind: 'webhook.changed', detail: { change: 'rotated' } },
      { kind: 'webhook.changed', detail: { change: 'removed' } },
    ]);
    expect(JSON.stringify(events)).not.toContain('receiver.example.test');
  });

  it('refuses a URL that is not HTTPS, and never answers the sealed secret', async () => {
    await expect(
      as((trx) =>
        trx
          .insertInto('webhook_subscription')
          .values({
            service_identity: robot,
            url: 'http://receiver.example.test',
            event_types: ['artifact.archived'],
            sealed: 'x',
          })
          .execute(),
      ),
    ).rejects.toThrow(/webhook_subscription_url_check/);
    const listed = await as((trx) => listWebhookSubscriptions(trx, { limit: 100 }));
    expect(JSON.stringify(listed)).not.toContain('sealed');
  });

  it('queues a committed act once for each subscription wanting it, and nothing for an act rolled back or unwanted', async () => {
    const wanting = await subscribe(['artifact.archived']);
    const other = await subscribe(['artifact.unarchived']);
    const component = randomUUID();
    const sequence = await act('artifact.archived', component);
    await expect(
      service.withTenant(
        tenant,
        async (trx) => {
          await recordEvent(trx, {
            kind: 'artifact.archived',
            subject: { kind: 'component', id: randomUUID() },
          });
          throw new Error('rolled back');
        },
        SYSTEM,
      ),
    ).rejects.toThrow('rolled back');
    const queued = await deliveries(wanting.id);
    expect(queued).toEqual([
      {
        type: 'artifact.archived',
        sequence: `audit:${sequence}`,
        artifact_id: component,
        payload: {
          type: 'artifact.archived',
          id: expect.any(String),
          sequence: `audit:${sequence}`,
          at: expect.any(String),
          subject: { kind: 'component', id: component, version: null },
          detail: {},
        },
        state: 'pending',
      },
    ]);
    expect(await deliveries(other.id)).toEqual([]);
  });

  it('queues nothing for a disabled subscription, and disables a service identity disabled', async () => {
    const made = await subscribe(['artifact.archived']);
    await as((trx) => disableServiceIdentity(trx, robot));
    const held = (await as((trx) => listWebhookSubscriptions(trx, { limit: 100 }))).items.find(
      (each) => each.id === made.id,
    );
    expect(held).toMatchObject({
      disabledReason: 'identity_disabled',
      disabledAt: expect.any(Date),
    });
    await act('artifact.archived', randomUUID());
    expect(await deliveries(made.id)).toEqual([]);
  });

  it("holds the trigger's audit kinds to domain's list of event types", async () => {
    const { rows } = await as((trx) =>
      sql<{
        source: string;
      }>`select prosrc as source from pg_proc where proname = 'webhook_queue_audit'`.execute(trx),
    );
    const listed = [...rows[0]!.source.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((match) => match[1]);
    expect(listed.toSorted()).toEqual([...webhookAuditTypes].toSorted());
  });
});
