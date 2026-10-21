import { randomUUID } from 'node:crypto';
import {
  createComponent,
  createServiceIdentity,
  createSpace,
  createTenant,
  createWebhookSubscription,
  findRole,
  grant,
  migrate,
  prepareDatabase,
  recordEvent,
  removeGrant,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import type { DeliverAnswer, DeliverRequest } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Deliverer } from './deliverer.js';
import { deliverWebhooks } from './webhooks.js';
import type { WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('the webhook delivery loop (the WB plan, WB-B and WB-I)', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let tenant: Tenant;
  let ada = '';
  let space = '';
  let robot = '';
  let readerGrant = '';
  const sent: DeliverRequest[] = [];
  let answer: DeliverAnswer | 'busy' = { type: 'answered', status: 200, latencyMs: 9, reply: 'ok' };
  const deliverer: Deliverer = async (request) => {
    sent.push(request);
    return answer;
  };

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'system' });

  /** A component, archived: an event a subscription to `artifact.archived` is queued. */
  const archived = () =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title: 'Weir notes',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      await recordEvent(trx, {
        kind: 'artifact.archived',
        subject: { kind: 'component', id: made.version.artifactId },
      });
      return made.version.artifactId;
    });

  const stateOf = (artifact: string) =>
    as((trx) =>
      trx
        .selectFrom('webhook_delivery')
        .select(['state', 'attempts'])
        .where('artifact_id', '=', artifact)
        .executeTakeFirstOrThrow(),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    await as(async (trx) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: randomUUID(),
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      space = (await createSpace(trx, 'Published')).id;
      robot = (await createServiceIdentity(trx, { name: 'Receiver', description: '', by: ada })).id;
      const reader = (await findRole(trx, 'Reader'))!;
      const granted = await grant(trx, {
        roleId: reader.id,
        subject: { principal: robot },
        level: { kind: 'space', id: space },
        effect: 'allow',
        grantedBy: ada,
      });
      if ('refused' in granted) throw new Error(granted.refused);
      readerGrant = granted.granted.id;
      await createWebhookSubscription(trx, {
        id: randomUUID(),
        serviceIdentity: robot,
        url: 'https://receiver.example.test/hooks',
        description: 'Archive feed',
        eventTypes: ['artifact.archived'],
        sealed: 'sealed-for-the-test',
        by: ada,
      });
    });
  });

  afterAll(async () => {
    await service.close();
    await worker.close();
    await db.drop();
  });

  it('sends each delivery due once, as its payload, with its sealed secret, and records it delivered', async () => {
    const artifact = await archived();
    expect(await deliverWebhooks(worker, deliverer, quiet)).toBe(1);
    const request = sent.at(-1)!;
    expect(request).toMatchObject({
      tenant: tenant.id,
      url: 'https://receiver.example.test/hooks',
      sealed: ['sealed-for-the-test'],
    });
    expect(JSON.parse(request.body)).toMatchObject({
      type: 'artifact.archived',
      id: request.id,
      subject: { kind: 'component', id: artifact },
    });
    expect(await stateOf(artifact)).toEqual({ state: 'delivered', attempts: 1 });
    expect(await deliverWebhooks(worker, deliverer, quiet)).toBe(0);
  });

  it('makes no attempt where the connector is busy, and tries again', async () => {
    answer = 'busy';
    const artifact = await archived();
    await deliverWebhooks(worker, deliverer, quiet);
    expect(await stateOf(artifact)).toEqual({ state: 'pending', attempts: 0 });
    answer = { type: 'answered', status: 200, latencyMs: 9, reply: 'ok' };
  });

  it('drops, never sends, a delivery its service identity may no longer read', async () => {
    const artifact = await archived();
    await as((trx) => removeGrant(trx, readerGrant));
    const before = sent.length;
    await deliverWebhooks(worker, deliverer, quiet);
    expect(sent.length).toBe(before);
    expect(await stateOf(artifact)).toEqual({ state: 'dropped', attempts: 0 });
  });
});
