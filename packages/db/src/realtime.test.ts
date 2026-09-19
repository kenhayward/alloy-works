import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  listenToTenants,
  notifyTenant,
  tenantChannel,
  type TenantEvent,
  type TenantListener,
} from './realtime.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { holdQueries, type QueryHold } from './testing/query-hold.js';

/**
 * Subscribes, waits until the subscription is heard, and hands back the next event it hears. A test
 * that announced before the wait would race the LISTEN, and lose (issue #137).
 */
async function hear(
  listener: TenantListener,
  tenantId: string,
): Promise<{ readonly next: Promise<TenantEvent> }> {
  let deliver: (event: TenantEvent) => void = () => {};
  const next = new Promise<TenantEvent>((resolve) => {
    deliver = resolve;
  });
  const { stop, ready } = listener.subscribe(tenantId, (event) => {
    stop();
    deliver(event);
  });
  await ready;
  return { next };
}

/** Whether a promise has settled, read without waiting for it. */
function watch(promise: Promise<unknown>): { settled: boolean } {
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
}

/** Lets everything already due run. Nothing waiting on the database can be due. */
const aMoment = () => new Promise((resolve) => setImmediate(resolve));

describe('what an environment says has happened', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let listener: TenantListener;
  let hold: QueryHold;
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    a = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    b = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    listener = listenToTenants(db.serviceUrl);
    hold = await holdQueries(db.serviceUrl);
  });

  afterAll(async () => {
    await hold.close();
    await listener.close();
    await service.close();
    await db.drop();
  });

  const announce = (tenant: Tenant, id: string) =>
    service.withTenant(tenant, (trx) => notifyTenant(trx, { kind: 'sample', id, state: 'done' }));

  /** A listener whose statements go through the hold, so a test can stop one on its way. */
  async function throughTheHold<T>(work: (held: TenantListener) => Promise<T>): Promise<T> {
    const held = listenToTenants(hold.url);
    try {
      return await work(held);
    } finally {
      hold.release();
      await held.close();
    }
  }

  it('names a channel after the tenant, and refuses anything else', () => {
    expect(tenantChannel('acmedev')).toBe('aw_t_acmedev');
    expect(() => tenantChannel('acme; drop')).toThrow(/tenant/i);
  });

  it('sends one query at a time on its connection, however fast watchers come and go', async () => {
    // pg 8 queues an overlapping query and warns once per process; pg 9 refuses it. So this runs
    // before anything else here could have used up the warning.
    const warnings: Error[] = [];
    const record = (warning: Error) => warnings.push(warning);
    process.on('warning', record);
    try {
      const subscriptions = ['burst1', 'burst2', 'burst3', 'burst4'].map((id) =>
        listener.subscribe(id, () => {}),
      );
      for (const subscription of subscriptions) subscription.stop();
      const { next } = await hear(listener, a.id);
      await announce(a, '11111111-2222-4333-8444-444444444444');
      await next;
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('warning', record);
    }
    expect(warnings.map((warning) => warning.message)).toEqual([]);
  });

  it('carries a kind, an id and a state to whoever is listening', async () => {
    const { next } = await hear(listener, a.id);
    await announce(a, '11111111-2222-4333-8444-555555555555');
    expect(await next).toEqual({
      kind: 'sample',
      id: '11111111-2222-4333-8444-555555555555',
      state: 'done',
    });
  });

  it('reaches nobody listening to another environment', async () => {
    const wrong: unknown[] = [];
    const other = listener.subscribe(b.id, (event) => wrong.push(event));
    await other.ready;
    const { next } = await hear(listener, a.id);
    await announce(a, '11111111-2222-4333-8444-666666666666');
    await next;
    other.stop();
    expect(wrong).toEqual([]);
  });

  it('listens while somebody is watching, and stops when the last one goes', () => {
    const first = listener.subscribe(a.id, () => {});
    const second = listener.subscribe(a.id, () => {});
    expect(listener.listening()).toContain(tenantChannel(a.id));
    first.stop();
    expect(listener.listening()).toContain(tenantChannel(a.id));
    second.stop();
    expect(listener.listening()).not.toContain(tenantChannel(a.id));
  });

  it('is not ready until its LISTEN has reached the database, and hears everything after (#137)', async () => {
    await throughTheHold(async (held) => {
      const got: string[] = [];
      let heardLate = () => {};
      const late = new Promise<void>((resolve) => {
        heardLate = resolve;
      });
      const reached = hold.hold('listen ');
      const first = held.subscribe(a.id, (event) => {
        got.push(event.id);
        if (event.id === '11111111-2222-4333-8444-999999999999') heardLate();
      });
      await reached;
      // A second watcher arriving while the LISTEN is on its way is no more heard than the first.
      const second = held.subscribe(a.id, () => {});
      const firstReady = watch(first.ready);
      const secondReady = watch(second.ready);
      // Committed while the LISTEN is held: the database has not been asked to listen, so this
      // reaches nobody. A subscription that said it was ready now would be claiming to hear it.
      await announce(a, '11111111-2222-4333-8444-888888888888');
      await aMoment();
      expect({ first: firstReady.settled, second: secondReady.settled }).toEqual({
        first: false,
        second: false,
      });
      hold.release();
      await Promise.all([first.ready, second.ready]);
      await announce(a, '11111111-2222-4333-8444-999999999999');
      await late;
      expect(got).toEqual(['11111111-2222-4333-8444-999999999999']);
    });
  });

  it('is not ready, joining a channel whose LISTEN waits behind its UNLISTEN, until the LISTEN lands (#137)', async () => {
    await throughTheHold(async (held) => {
      const before = held.subscribe(a.id, () => {});
      await before.ready;
      const reached = hold.hold('unlisten ');
      before.stop();
      await reached;
      let heard: (id: string) => void = () => {};
      const next = new Promise<string>((resolve) => {
        heard = resolve;
      });
      const after = held.subscribe(a.id, (event) => heard(event.id));
      const afterReady = watch(after.ready);
      await aMoment();
      expect(afterReady.settled).toBe(false);
      hold.release();
      await after.ready;
      await announce(a, '11111111-2222-4333-8444-aaaaaaaaaaaa');
      expect(await next).toBe('11111111-2222-4333-8444-aaaaaaaaaaaa');
    });
  });

  it('is ready without asking the database again, joining a channel already heard', async () => {
    await throughTheHold(async (held) => {
      const first = held.subscribe(a.id, () => {});
      await first.ready;
      // Anything it sent from now would be held, so waiting on the database would never end.
      void hold.hold('listen ');
      const second = held.subscribe(a.id, () => {});
      await second.ready;
    });
  });

  it('refuses to say it is heard once it is closed, rather than leave a watcher waiting (#137)', async () => {
    const closing = listenToTenants(db.serviceUrl);
    const queued = closing.subscribe(a.id, () => {});
    await closing.close();
    await expect(queued.ready).rejects.toThrow(/closed/i);
    const late = closing.subscribe(a.id, () => {});
    await expect(late.ready).rejects.toThrow(/closed/i);
  });

  it('refuses to say it is heard when it cannot reach the database (#137)', async () => {
    // Somewhere that takes a connection and drops it at once.
    const refusing = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => refusing.listen(0, '127.0.0.1', resolve));
    const { port } = refusing.address() as net.AddressInfo;
    const errors: unknown[] = [];
    const nowhere = listenToTenants(`postgres://aw_service:unused@127.0.0.1:${port}/nowhere`, {
      onError: (error) => errors.push(error),
    });
    try {
      await expect(nowhere.subscribe(a.id, () => {}).ready).rejects.toThrow();
      expect(errors).not.toEqual([]);
    } finally {
      await nowhere.close();
      await new Promise((resolve) => refusing.close(resolve));
    }
  });

  it('hears again after its connection is lost', async () => {
    let cutOff = () => {};
    const lost = new Promise<void>((resolve) => {
      cutOff = resolve;
    });
    const own = listenToTenants(db.serviceUrl, { onError: () => cutOff() });
    try {
      await own.subscribe(a.id, () => {}).ready;
      // Only this database's listeners: the cluster is shared with every suite running beside this
      // one, and cutting their listeners would lose their events instead.
      const cut = await queryAs(
        db.adminUrl,
        `select pg_terminate_backend(pid) from pg_stat_activity
          where application_name = 'alloy-works-listener' and datname = current_database()
            and pid <> pg_backend_pid()`,
      );
      // Proves the test cuts something: matching nothing would make this pass for the wrong reason.
      expect(cut.rows.length).toBeGreaterThan(0);
      // Waiting for the listener to notice, rather than for a length of time.
      await lost;
      // A watcher from now on is told it is heard only once the new connection listens.
      const { next } = await hear(own, a.id);
      await announce(a, '11111111-2222-4333-8444-777777777777');
      expect(await next).toMatchObject({ id: '11111111-2222-4333-8444-777777777777' });
    } finally {
      await own.close();
    }
  });
});
