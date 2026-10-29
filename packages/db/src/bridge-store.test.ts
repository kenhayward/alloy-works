import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { objectInUse } from './assets.js';
import { bootstrapCluster } from './bootstrap.js';
import {
  elementsOf,
  finishDelivery,
  readBridgeSettings,
  readDelivery,
  recordElements,
  recordNonce,
  refuseDelivery,
  startDelivery,
  writeBridgeSettings,
  type NewDelivery,
} from './bridge-store.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

describe('the bridge store', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let tenant: Tenant;
  let space: string;
  let person: string;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = testTenantDatabase(db.serviceUrl);
    const id = db.newTenantId();
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
    await as(async (trx) => {
      space = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      person = (
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
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  const delivery = (key: string, over: Partial<NewDelivery> = {}): NewDelivery => ({
    key,
    spaceId: space,
    family: 'document',
    tokenId: randomUUID(),
    packageKey: null,
    provenance: { source: 'report.docx', sha256: 'a'.repeat(64) },
    ...over,
  });

  const bridgeKinds = (trx: TenantTransaction) =>
    trx
      .selectFrom('audit_event')
      .select('kind')
      .where('kind', 'like', 'bridge.%')
      .orderBy('sequence')
      .execute()
      .then((rows) => rows.map((row) => row.kind));

  it('API-068 a written key answers its first receipt', async () => {
    const first = await as((trx) => startDelivery(trx, delivery('written-key')));
    if (first.answer !== 'started') throw new Error(first.answer);
    const receipt = { document: randomUUID(), versions: 2 };
    const done = await as((trx) => finishDelivery(trx, first.id, receipt, [{ name: 'colour' }]));
    expect(done?.state).toBe('written');

    const again = await as((trx) => startDelivery(trx, delivery('written-key')));
    expect(again).toEqual({ answer: 'written', receipt });
    const stored = await as((trx) => readDelivery(trx, first.id));
    expect(stored).toMatchObject({ state: 'written', carried: [{ name: 'colour' }], receipt });
    expect(stored?.finishedAt).toBeInstanceOf(Date);
    // Finished once: a second finish changes nothing.
    expect(await as((trx) => finishDelivery(trx, first.id, { other: 1 }, []))).toBeUndefined();
    expect((await as((trx) => readDelivery(trx, first.id)))?.receipt).toEqual(receipt);
  });

  it('API-068 a running key answers the same delivery', async () => {
    const first = await as((trx) => startDelivery(trx, delivery('running-key')));
    if (first.answer !== 'started') throw new Error(first.answer);
    const again = await as((trx) => startDelivery(trx, delivery('running-key')));
    expect(again).toEqual({ answer: 'running', id: first.id });
  });

  it('API-068 two starts at once with one key give one started and one running', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let begun!: () => void;
    const firstBegun = new Promise<void>((resolve) => (begun = resolve));
    const first = as(async (trx) => {
      const answer = await startDelivery(trx, delivery('race-key'));
      begun();
      // Open, with the key taken but not committed, while the second arrives.
      await held;
      return answer;
    });
    await firstBegun;
    const second = as((trx) => startDelivery(trx, delivery('race-key')));
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(one.answer).toBe('started');
    expect(two.answer).toBe('running');
    if (one.answer !== 'started' || two.answer !== 'running') return;
    expect(two.id).toBe(one.id);
  });

  it('API-067 a refused delivery frees its key', async () => {
    const first = await as((trx) =>
      startDelivery(trx, delivery('refused-key', { packageKey: `t_x/sha256/${'b'.repeat(64)}` })),
    );
    if (first.answer !== 'started') throw new Error(first.answer);
    const refused = await as((trx) =>
      refuseDelivery(trx, first.id, {
        class: 'permanent',
        code: 'content_rejected',
        message: 'No component type is set.',
        details: { reason: 'not_configured' },
      }),
    );
    expect(refused).toMatchObject({ state: 'refused', key: null, packageKey: null });

    // The record stays, and the key starts a fresh delivery.
    const stored = await as((trx) => readDelivery(trx, first.id));
    expect(stored?.refusal).toMatchObject({ code: 'content_rejected' });
    const retry = await as((trx) => startDelivery(trx, delivery('refused-key')));
    expect(retry.answer).toBe('started');
    if (retry.answer === 'started') expect(retry.id).not.toBe(first.id);
    // A refusal is final too.
    expect(
      await as((trx) =>
        refuseDelivery(trx, first.id, { class: 'permanent', code: 'internal', message: 'x' }),
      ),
    ).toBeUndefined();
  });

  it('API-071 records a written and a refused delivery as audit events', async () => {
    const ok = await as((trx) => startDelivery(trx, delivery('audit-ok')));
    const no = await as((trx) => startDelivery(trx, delivery('audit-no', { family: 'data' })));
    if (ok.answer !== 'started' || no.answer !== 'started') throw new Error('not started');
    const before = (await as(bridgeKinds)).length;
    await as((trx) => finishDelivery(trx, ok.id, {}, [], { persistentId: randomUUID() }));
    await as((trx) =>
      refuseDelivery(trx, no.id, { class: 'transient', code: 'sink_unavailable', message: 'down' }),
    );
    expect((await as(bridgeKinds)).slice(before)).toEqual(['bridge.delivered', 'bridge.refused']);
    expect((await as((trx) => readDelivery(trx, ok.id)))?.persistentId).not.toBeNull();
  });

  it('a nonce seen twice is replayed', async () => {
    const nonce = randomUUID();
    expect(await as((trx) => recordNonce(trx, nonce))).toBe('new');
    expect(await as((trx) => recordNonce(trx, nonce))).toBe('replayed');
    expect(await as((trx) => recordNonce(trx, randomUUID()))).toBe('new');
  });

  it('API-069 keeps the elements a persistent identity made, and takes a re-recorded one over', async () => {
    const persistent = randomUUID();
    const artifacts = await as(async (trx) => {
      const ids: string[] = [];
      for (let count = 0; count < 2; count++) {
        const made = await trx
          .insertInto('artifact')
          .values({ id: randomUUID(), kind: 'component', space_id: space })
          .returning('id')
          .executeTakeFirstOrThrow();
        ids.push(made.id);
      }
      return ids;
    });
    expect(await as((trx) => elementsOf(trx, persistent))).toEqual([]);
    await as((trx) =>
      recordElements(trx, persistent, [
        { element: 'e1', artifactId: artifacts[0]!, node: 'node1' },
        { element: 'e2', artifactId: artifacts[1]!, node: null },
      ]),
    );
    await as((trx) =>
      recordElements(trx, persistent, [
        { element: 'e1', artifactId: artifacts[1]!, node: 'node2' },
      ]),
    );
    expect(await as((trx) => elementsOf(trx, persistent))).toEqual([
      { element: 'e1', artifactId: artifacts[1], node: 'node2' },
      { element: 'e2', artifactId: artifacts[1], node: null },
    ]);
  });

  it('API-071 keeps a space bridge settings and records what changed', async () => {
    expect(await as((trx) => readBridgeSettings(trx, space))).toBeUndefined();
    const base = {
      spaceId: space,
      componentType: randomUUID(),
      template: null,
      propertyMap: {},
      connectionId: null,
      tableSchema: null,
      changedBy: person,
    };
    await as((trx) => writeBridgeSettings(trx, base));
    const template = randomUUID();
    await as((trx) =>
      writeBridgeSettings(trx, { ...base, template, propertyMap: { Title: randomUUID() } }),
    );
    const stored = await as((trx) => readBridgeSettings(trx, space));
    expect(stored).toMatchObject({
      template,
      componentType: base.componentType,
      changedBy: person,
    });
    expect(Object.keys(stored!.propertyMap)).toEqual(['Title']);
    const events = await as((trx) =>
      trx
        .selectFrom('audit_event')
        .select('detail')
        .where('kind', '=', 'bridge.settings_changed')
        .orderBy('sequence')
        .execute(),
    );
    expect(events.map((row) => row.detail)).toEqual([
      { changed: ['componentType'] },
      { changed: ['template', 'propertyMap'] },
    ]);
  });

  it('API-068 holds a package an open delivery names, and lets go of it once finished', async () => {
    const key = `t_x/sha256/${'c'.repeat(64)}`;
    const started = await as((trx) =>
      startDelivery(trx, delivery('package-key', { packageKey: key })),
    );
    if (started.answer !== 'started') throw new Error(started.answer);
    expect(await as((trx) => objectInUse(trx, key, randomUUID()))).toBe(true);
    await as((trx) => finishDelivery(trx, started.id, {}, []));
    expect(await as((trx) => objectInUse(trx, key, randomUUID()))).toBe(false);
  });
});
