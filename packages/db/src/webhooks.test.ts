import { randomUUID } from 'node:crypto';
import { webhookAuditTypes, type AuditContext } from '@alloy-works/domain';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordEvent } from './audit.js';
import { bootstrapCluster } from './bootstrap.js';
import {
  finishDelivery,
  refuseDelivery,
  startDelivery,
  writeBridgeSettings,
} from './bridge-store.js';
import { readableOf } from './inbox.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { grant } from './grants.js';
import { findRole } from './roles.js';
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
  claimDeliveries,
  recordAttempt,
  rotateWebhookSecret,
  sweepWebhookDeliveries,
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

  it('queues one act for many subscriptions wanting it, each its own delivery (issue #750)', async () => {
    // Enough subscriptions, their statistics taken, that the planner may hold a per-statement value.
    const many = [];
    for (let each = 0; each < 40; each += 1) {
      many.push(await subscribe(['artifact.unarchived'], `Receiver ${each}`));
    }
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await admin.query(`analyze ${admin.escapeIdentifier(tenant.schema)}.webhook_subscription`);
    } finally {
      await admin.end();
    }
    await act('artifact.unarchived', randomUUID());
    const ids: string[] = [];
    for (const subscription of many) {
      for (const each of await deliveries(subscription.id)) {
        ids.push((each.payload as { id: string }).id);
      }
    }
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
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

  it('API-071 queues a bridge delivery and a bridge refusal for a subscriber, and a settings change for none', async () => {
    const wanting = await subscribe(['bridge.delivered', 'bridge.refused']);
    const space = (
      await as((trx) =>
        trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow(),
      )
    ).id;
    const input = (key: string) => ({
      key,
      spaceId: space,
      family: 'document' as const,
      tokenId: randomUUID(),
      packageKey: null,
      provenance: {},
    });
    const document = randomUUID();
    const ok = await as((trx) => startDelivery(trx, input('hook-ok')));
    const no = await as((trx) => startDelivery(trx, input('hook-no')));
    if (ok.answer !== 'started' || no.answer !== 'started') throw new Error('not started');
    await as((trx) => finishDelivery(trx, ok.id, {}, [], { subject: document }));
    await as((trx) =>
      refuseDelivery(trx, no.id, { class: 'permanent', code: 'content_rejected', message: 'x' }),
    );
    await as((trx) =>
      writeBridgeSettings(trx, {
        spaceId: space,
        componentType: null,
        template: null,
        propertyMap: {},
        connectionId: null,
        tableSchema: null,
        changedBy: ada,
      }),
    );
    const queued = await deliveries(wanting.id);
    expect(queued.map((each) => [each.type, each.artifact_id])).toEqual([
      ['bridge.delivered', document],
      ['bridge.refused', space],
    ]);
  });

  it('API-071 reaches a refused delivery’s subscriber who can read the space, and no other', async () => {
    const space = (
      await as((trx) =>
        trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow(),
      )
    ).id;
    const reader = (
      await as((trx) =>
        createServiceIdentity(trx, { name: 'Reader bot', description: '', by: ada }),
      )
    ).id;
    const stranger = (
      await as((trx) =>
        createServiceIdentity(trx, { name: 'Stranger bot', description: '', by: ada }),
      )
    ).id;
    const author = (await as((trx) => findRole(trx, 'Author')))!;
    await as((trx) =>
      grant(trx, {
        roleId: author.id,
        subject: { principal: reader },
        level: { kind: 'space', id: space },
        effect: 'allow',
        grantedBy: ada,
      }),
    );
    expect((await as((trx) => readableOf(trx, reader, [space]))).has(space)).toBe(true);
    expect((await as((trx) => readableOf(trx, stranger, [space]))).has(space)).toBe(false);
  });

  /** A live identity's subscription, and one act queued for it: its delivery's id. */
  const queued = async (types: string[] = ['artifact.archived']) => {
    const identity = (
      await as((trx) => createServiceIdentity(trx, { name: 'Courier', description: '', by: ada }))
    ).id;
    const made = await as((trx) =>
      createWebhookSubscription(trx, {
        id: randomUUID(),
        serviceIdentity: identity,
        url: 'https://receiver.example.test/hooks',
        description: 'Courier feed',
        eventTypes: types as never,
        sealed: 'sealed-for-the-test',
        by: ada,
      }),
    );
    await act('artifact.archived', randomUUID());
    const [delivery] = await as((trx) =>
      trx
        .selectFrom('webhook_delivery')
        .select('id')
        .where('subscription_id', '=', made.id)
        .execute(),
    );
    return { subscription: made.id, delivery: delivery!.id };
  };

  const deliveryRow = (id: string) =>
    as((trx) =>
      trx
        .selectFrom('webhook_delivery')
        .select(['state', 'attempts', 'next_at', 'locked_until'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );

  const failed = { kind: 'answered', status: 503, latencyMs: 12, reply: 'busy' } as const;

  it('API-046 queues every event once whatever order their transactions commit in', async () => {
    const made = await subscribe(['artifact.archived']);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let recorded = () => {};
    const first = new Promise<void>((resolve) => {
      recorded = resolve;
    });
    // The earlier sequence commits last.
    const early = service.withTenant(
      tenant,
      async (trx) => {
        await recordEvent(trx, {
          kind: 'artifact.archived',
          subject: { kind: 'component', id: randomUUID() },
        });
        recorded();
        await held;
      },
      SYSTEM,
    );
    await first;
    await act('artifact.archived', randomUUID());
    release();
    await early;
    const sequences = (await deliveries(made.id)).map((each) =>
      Number(each.sequence.slice('audit:'.length)),
    );
    expect(sequences).toHaveLength(2);
    expect(new Set(sequences).size).toBe(2);
  });

  it('leases a claimed delivery, so no other worker sends it at once', async () => {
    const { delivery } = await queued();
    const first = await as((trx) => claimDeliveries(trx, 50, 60_000));
    expect(first.map((each) => each.id)).toContain(delivery);
    const second = await as((trx) => claimDeliveries(trx, 50, 60_000));
    expect(second.map((each) => each.id)).not.toContain(delivery);
    const claimed = first.find((each) => each.id === delivery)!;
    expect(claimed).toMatchObject({ sealed: ['sealed-for-the-test'] });
    expect(JSON.parse(claimed.body)).toMatchObject({ type: 'artifact.archived', id: delivery });
  });

  it('API-028 retries with backoff, gives up after a day, and delivers on a 2xx', async () => {
    const { subscription, delivery } = await queued();
    await as((trx) => recordAttempt(trx, delivery, failed));
    const once = await deliveryRow(delivery);
    expect(once).toMatchObject({ state: 'pending', attempts: 1, locked_until: null });
    const firstWait = once.next_at.getTime() - Date.now();
    expect(firstWait).toBeGreaterThan(25_000);
    expect(firstWait).toBeLessThanOrEqual(31_000);
    await as((trx) =>
      recordAttempt(trx, delivery, { kind: 'failed', failure: 'timeout', latencyMs: 10_000 }),
    );
    const secondWait = (await deliveryRow(delivery)).next_at.getTime() - Date.now();
    expect(secondWait).toBeGreaterThan(55_000);
    await as((trx) =>
      trx
        .updateTable('webhook_delivery')
        .set({ first_attempt_at: sql<Date>`now() - interval '25 hours'` })
        .where('id', '=', delivery)
        .execute(),
    );
    await as((trx) => recordAttempt(trx, delivery, failed));
    expect(await deliveryRow(delivery)).toMatchObject({ state: 'given_up', attempts: 3 });
    const attempts = await as((trx) =>
      trx
        .selectFrom('webhook_attempt')
        .select(['status', 'failure', 'reply'])
        .where('delivery_id', '=', delivery)
        .execute(),
    );
    expect(attempts).toEqual([
      { status: 503, failure: null, reply: 'busy' },
      { status: null, failure: 'timeout', reply: null },
      { status: 503, failure: null, reply: 'busy' },
    ]);
    const next = await queued();
    await as((trx) =>
      recordAttempt(trx, next.delivery, { kind: 'answered', status: 204, latencyMs: 8, reply: '' }),
    );
    expect(await deliveryRow(next.delivery)).toMatchObject({ state: 'delivered' });
    void subscription;
  });

  it('API-028 disables a subscription failing three days since its last success, and records it', async () => {
    const { subscription, delivery } = await queued();
    await as((trx) => recordAttempt(trx, delivery, failed));
    await as((trx) =>
      trx
        .updateTable('webhook_subscription')
        .set({ failing_since: sql<Date>`now() - interval '3 days 1 minute'` })
        .where('id', '=', subscription)
        .execute(),
    );
    expect(await as((trx) => recordAttempt(trx, delivery, failed))).toEqual({
      disabled: subscription,
    });
    const disabled = await as((trx) =>
      trx
        .selectFrom('webhook_subscription')
        .select(['disabled_reason'])
        .where('id', '=', subscription)
        .executeTakeFirstOrThrow(),
    );
    expect(disabled.disabled_reason).toBe('failing');
    const changes = await as((trx) =>
      trx
        .selectFrom('audit_event')
        .select('detail')
        .where('subject', '=', subscription)
        .orderBy('sequence')
        .execute(),
    );
    expect(changes.at(-1)?.detail).toEqual({ change: 'disabled', reason: 'failing' });
    // Its maker told, where they administer the environment (WB-E); Ada holds no grant here.
    const told = await as((trx) =>
      trx.selectFrom('notification').select('kind').where('recipient', '=', ada).execute(),
    );
    expect(told).toEqual([]);
    // A quiet endpoint's one failure is no reason: the clock starts at its first failure.
    const quiet = await queued();
    expect(await as((trx) => recordAttempt(trx, quiet.delivery, failed))).toEqual({});
  });

  it('drops a delivery its service identity may not read, and frees one the connector was too busy for', async () => {
    const { delivery } = await queued();
    await as((trx) => recordAttempt(trx, delivery, { kind: 'busy' }));
    expect(await deliveryRow(delivery)).toMatchObject({
      state: 'pending',
      attempts: 0,
      locked_until: null,
    });
    await as((trx) => recordAttempt(trx, delivery, { kind: 'unreadable' }));
    expect(await deliveryRow(delivery)).toMatchObject({ state: 'dropped', attempts: 0 });
    await as((trx) =>
      trx
        .updateTable('webhook_delivery')
        .set({ created_at: sql<Date>`now() - interval '31 days'` })
        .where('id', '=', delivery)
        .execute(),
    );
    expect(await as((trx) => sweepWebhookDeliveries(trx))).toBeGreaterThanOrEqual(1);
  });

  it('tells the administrator who made a subscription that it was disabled for failing', async () => {
    const administrator = (await as((trx) => findRole(trx, 'Administrator')))!;
    const granted = await as((trx) =>
      grant(trx, {
        roleId: administrator.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      }),
    );
    expect('granted' in granted).toBe(true);
    const { subscription, delivery } = await queued();
    await as((trx) => recordAttempt(trx, delivery, failed));
    await as((trx) =>
      trx
        .updateTable('webhook_subscription')
        .set({ failing_since: sql<Date>`now() - interval '4 days'` })
        .where('id', '=', subscription)
        .execute(),
    );
    await as((trx) => recordAttempt(trx, delivery, failed));
    const told = await as((trx) =>
      trx
        .selectFrom('notification')
        .select(['kind', 'counts', 'actor', 'artifact_id'])
        .where('recipient', '=', ada)
        .execute(),
    );
    expect(told).toEqual([
      { kind: 'webhook', counts: { webhook: subscription }, actor: null, artifact_id: null },
    ]);
  });

  /** A live identity and its subscription wanting these types: the identity and the subscription. */
  const feed = async (types: string[]) => {
    const identity = (
      await as((trx) => createServiceIdentity(trx, { name: 'Feed', description: '', by: ada }))
    ).id;
    const made = await as((trx) =>
      createWebhookSubscription(trx, {
        id: randomUUID(),
        serviceIdentity: identity,
        url: 'https://receiver.example.test/hooks',
        description: 'Feed',
        eventTypes: types as never,
        sealed: 'sealed-for-the-test',
        by: ada,
      }),
    );
    return { identity, subscription: made.id };
  };

  it('API-060 queues content, workflow, review and publication events alike, each with its version', async () => {
    const { subscription } = await feed([...webhookAuditTypes]);
    const version = randomUUID();
    for (const kind of webhookAuditTypes) {
      await as((trx) =>
        sql`insert into audit_event (kind, actor_kind, subject_kind, subject, subject_version, outcome)
            values (${kind}, 'system', 'document', ${randomUUID()}, ${version}, 'done')`.execute(
          trx,
        ),
      );
    }
    const queued = await deliveries(subscription);
    expect(queued.map((each) => each.type).toSorted()).toEqual([...webhookAuditTypes].toSorted());
    for (const each of queued) {
      expect((each.payload as { subject: { version: string } }).subject.version).toBe(version);
    }
  });

  it('COL-037 queues a notification addressed to the subscription’s service identity, and nobody else’s', async () => {
    const { identity, subscription } = await feed(['notification.created']);
    for (const recipient of [identity, ada]) {
      await as((trx) =>
        sql`insert into notification (recipient, kind, counts)
            values (${recipient}, 'budget', '{}'::jsonb)`.execute(trx),
      );
    }
    const queued = await deliveries(subscription);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'notification.created',
      sequence: expect.stringMatching(/^notification:\d+$/),
      payload: { type: 'notification.created', detail: { kind: 'budget' } },
    });
  });

  it('keeps its backoff an hour at most however many attempts a delivery has had', async () => {
    const { delivery } = await queued();
    await as((trx) =>
      trx
        .updateTable('webhook_delivery')
        .set({ attempts: 40 })
        .where('id', '=', delivery)
        .execute(),
    );
    await as((trx) => recordAttempt(trx, delivery, failed));
    const wait = (await deliveryRow(delivery)).next_at.getTime() - Date.now();
    expect(wait).toBeGreaterThan(3_500_000);
    expect(wait).toBeLessThanOrEqual(3_601_000);
  });

  it('records nothing for a worker whose lease was claimed past, nor for a delivery already done', async () => {
    const { delivery } = await queued();
    const [stale] = (await as((trx) => claimDeliveries(trx, 1000, 60_000))).filter(
      (each) => each.id === delivery,
    );
    await as((trx) =>
      trx
        .updateTable('webhook_delivery')
        .set({ locked_until: null })
        .where('id', '=', delivery)
        .execute(),
    );
    const [fresh] = (await as((trx) => claimDeliveries(trx, 1000, 60_000))).filter(
      (each) => each.id === delivery,
    );
    expect(fresh!.lease).not.toBe(stale!.lease);
    await as((trx) => recordAttempt(trx, delivery, failed, stale!.lease));
    expect(await deliveryRow(delivery)).toMatchObject({ attempts: 0, state: 'pending' });
    await as((trx) =>
      recordAttempt(
        trx,
        delivery,
        { kind: 'answered', status: 200, latencyMs: 3, reply: '' },
        fresh!.lease,
      ),
    );
    await as((trx) => recordAttempt(trx, delivery, failed));
    expect(await deliveryRow(delivery)).toMatchObject({ attempts: 1, state: 'delivered' });
  });

  it('counts a quiet endpoint’s failures afresh, gives up what waits once disabled, and turns it on again', async () => {
    const { subscription, delivery } = await queued();
    await as((trx) => recordAttempt(trx, delivery, failed));
    // Its last failure four days ago, and nothing since: a quiet endpoint, not a failing one.
    await as(async (trx) => {
      await sql`update webhook_attempt set at = now() - interval '4 days'
                where delivery_id = ${delivery}`.execute(trx);
      await sql`update webhook_subscription set failing_since = now() - interval '4 days'
                where id = ${subscription}`.execute(trx);
    });
    expect(await as((trx) => recordAttempt(trx, delivery, failed))).toEqual({});
    await act('artifact.archived', randomUUID());
    await as((trx) =>
      trx
        .updateTable('webhook_subscription')
        .set({ failing_since: sql<Date>`now() - interval '4 days'` })
        .where('id', '=', subscription)
        .execute(),
    );
    expect(await as((trx) => recordAttempt(trx, delivery, failed))).toEqual({
      disabled: subscription,
    });
    const waiting = await as((trx) =>
      trx
        .selectFrom('webhook_delivery')
        .select('state')
        .where('subscription_id', '=', subscription)
        .execute(),
    );
    expect(waiting.every((each) => each.state !== 'pending')).toBe(true);
    const enabled = await as((trx) =>
      changeWebhookSubscription(trx, subscription, { enable: true }),
    );
    expect(enabled).toMatchObject({ disabledAt: null, failingSince: null });
  });
});
