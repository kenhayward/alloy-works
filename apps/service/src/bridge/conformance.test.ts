import { randomBytes } from 'node:crypto';
import {
  createDeliveredStore,
  createJobQueue,
  deliveredNames,
  type DeliveredStore,
  type JobQueue,
  type TenantDatabase,
} from '@alloy-works/db';
import { queryAs, testTenantDatabase } from '@alloy-works/db/testing';
import { conformanceSuite, type CheckResult } from '@kenhayward/bridge-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The worker's own handler and loop, so a delivery the suite asks for is written as it is deployed:
// the service has no dependency on the worker, and its tests reach the two modules by path.
import { bridgeDeliverJob } from '../../../worker/src/jobs/bridge-deliver.js';
import { processNext, type WorkerLog } from '../../../worker/src/worker.js';
import { HOST, startHarness, type Harness } from '../test/bindings-harness.js';
import { DELIVERED_URL, dropDelivered, ensureDeliveredDatabase } from '../test/delivered.js';

const inAMonth = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

describe("CT Studio's conformance suite against the bridge, deliveries run by the worker", () => {
  let h: Harness;
  let delivered: DeliveredStore;
  let worker: TenantDatabase;
  let queue: JobQueue;
  // Made here for the test alone.
  const key = randomBytes(32).toString('hex');
  let token = '';
  /** What the worker logged of jobs that did not finish, to say why a check failed. */
  const failures: string[] = [];
  const log: WorkerLog = {
    info: () => {},
    warn: (details, message) => failures.push(`${message} ${JSON.stringify(details)}`),
    error: (details, message) => failures.push(`${message} ${JSON.stringify(details)}`),
  };

  /** Every job queued, worked to the end, as the worker's loop would between the suite's calls. */
  const drain = async (handlers: Parameters<typeof processNext>[0]['handlers']) => {
    for (let n = 0; n < 20; n += 1) {
      const outcome = await processNext({
        queue,
        db: worker,
        handlers,
        workerId: 'conformance',
        leaseMs: 60_000,
        log,
      });
      if (outcome === 'idle') return;
    }
    throw new Error('the queue never emptied');
  };

  beforeAll(async () => {
    await ensureDeliveredDatabase();

    h = await startHarness({
      secrets: { SINK_BRIDGE_KEYS: key, SECRET_DELIVERED_URL: DELIVERED_URL },
    });
    delivered = createDeliveredStore(DELIVERED_URL);
    worker = testTenantDatabase(h.db.workerUrl);
    queue = createJobQueue(h.db.workerUrl);

    const made = await h.call('ada', 'POST', '/v1/service-identities', {
      name: 'CT Studio',
      description: 'The delivery bridge',
    });
    expect(made.statusCode, made.body).toBe(200);
    const identity = made.json<{ id: string }>().id;
    const issued = await h.call('ada', 'POST', `/v1/service-identities/${identity}/tokens`, {
      name: 'Bridge',
      scopes: ['create', 'edit'],
      expiresAt: inAMonth(),
    });
    expect(issued.statusCode, issued.body).toBe(200);
    token = issued.json<{ secret: string }>().secret;
    await h.allow(identity, h.roles.Author!, { kind: 'space', id: h.general });
    // Documents and data both delivered to General, as an administrator sets it up.
    const set = await h.call('ada', 'PUT', `/v1/spaces/${h.general}/bridge-settings`, {
      componentType: null,
      template: null,
      propertyMap: {},
      data: true,
    });
    expect(set.statusCode, set.body).toBe(200);
  }, 120_000);

  afterAll(async () => {
    if (h) await dropDelivered(h.tenant.id);
    await delivered?.close();
    await queue?.close();
    await worker?.close();
    await h?.close();
  });

  it('API-066 passes the bridge conformance suite, document checks included', async () => {
    const handlers = {
      bridge_deliver: bridgeDeliverJob({ db: worker, stores: h.stores, delivered }),
    };
    /** The suite's requests to the service in process; a delivery it posts is worked before it polls. */
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? 'GET') as 'GET' | 'POST';
      const answer = await h.app.inject({
        method,
        url: `${url.pathname}${url.search}`,
        headers: { ...(init?.headers as Record<string, string>), host: url.host },
        ...(init?.body === undefined ? {} : { payload: init.body as string }),
      });
      if (method === 'POST' && url.pathname === '/bridge/deliveries') await drain(handlers);
      return new Response(answer.body, {
        status: answer.statusCode,
        headers: { 'content-type': String(answer.headers['content-type'] ?? 'application/json') },
      });
    }) as typeof fetch;

    const results: CheckResult[] = await conformanceSuite({
      url: `http://${HOST}/bridge`,
      key,
      instanceId: h.tenant.id,
      credential: { token },
      destination: { space: h.general },
      fetchImpl,
      pollTimeoutMs: 5_000,
    });

    const failed = results.filter((each) => !each.ok);
    expect(failed, failures.join('\n')).toEqual([]);
    // Every check run: the suite skips only what this sink's describe says it does not do, and it
    // browses, replaces, takes files, data and decomposed documents, so nothing is skipped.
    const skipped = results.filter((each) => each.detail?.startsWith('skipped'));
    expect(skipped).toEqual([]);
    expect(results.map((each) => each.name)).toEqual([
      'describe',
      'unsigned refused',
      'replay refused',
      'tampered body refused',
      'connections:test',
      'browse',
      'deliver',
      'same key again',
      'document: create',
      'document: read back',
      'document: same key again',
      'document: update with a wrong version is refused',
      'document: update with matching versions',
      'document: update retried with the same key',
      "document: replayed create key returns the create's receipt",
      'errors',
    ]);

    // The worker wrote them: the data package's table and the document, its update, and the one
    // update expecting a version it never had refused.
    const deliveries = await h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .selectFrom('bridge_delivery')
        .select(['family', 'state', 'refusal'])
        .orderBy('created_at')
        .execute(),
    );
    expect(deliveries.map((each) => [each.family, each.state])).toEqual([
      ['data', 'written'],
      ['document', 'written'],
      ['document', 'refused'],
      ['document', 'written'],
    ]);
    expect(deliveries[2]!.refusal).toMatchObject({ code: 'changed_in_target' });
    const { schema } = deliveredNames(h.tenant.id);
    const tables = await queryAs(
      DELIVERED_URL,
      'select table_name from information_schema.tables where table_schema = $1',
      [schema],
    );
    expect(tables.rowCount).toBeGreaterThan(0);
    for (const { table_name } of tables.rows as { table_name: string }[]) {
      const rows = await queryAs(
        DELIVERED_URL,
        `select count(*)::int as n from "${schema}"."${table_name}"`,
      );
      expect(rows.rows).toEqual([{ n: 1 }]);
    }
  });
});
