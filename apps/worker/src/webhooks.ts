import { randomUUID } from 'node:crypto';
import {
  claimDeliveries,
  readableOf,
  recordAttempt,
  type ClaimedDelivery,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import type { AuditContext } from '@alloy-works/domain';

import type { Deliverer } from './deliverer.js';
import type { WorkerLog } from './worker.js';

const SYSTEM: AuditContext = { actorKind: 'system' };

/** At most this many deliveries a tenant a pass, and this many sent at once (WB-I, WB-F). */
export const DELIVERIES_A_PASS = 50;
const AT_ONCE = 4;

/** How long a claimed delivery is held: past its ten seconds, and the connector's answer. */
const LEASE_MS = 60_000;

/**
 * One pass of the delivery loop (the WB plan, WB-I), in every tenant: the deliveries due claimed with a
 * lease, each asked first whether its service identity may read what it is about (WB-B), then sent
 * through the connector outside any transaction, and its attempt recorded after. Answers how many
 * were attempted.
 */
export async function deliverWebhooks(
  db: TenantDatabase,
  deliverer: Deliverer,
  log: WorkerLog,
): Promise<number> {
  let attempted = 0;
  for (const tenant of await db.tenants()) {
    try {
      attempted += await deliverInTenant(db, tenant, deliverer, log);
    } catch (error) {
      log.error({ tenant: tenant.id, err: error }, 'webhook delivery failed in a tenant');
    }
  }
  return attempted;
}

async function deliverInTenant(
  db: TenantDatabase,
  tenant: Tenant,
  deliverer: Deliverer,
  log: WorkerLog,
): Promise<number> {
  const claimed = await db.withTenant(
    tenant,
    (trx) => claimDeliveries(trx, DELIVERIES_A_PASS, LEASE_MS),
    SYSTEM,
  );
  const waiting = [...claimed];
  const one = async (delivery: ClaimedDelivery) => {
    const readable =
      delivery.artifactId === null ||
      (
        await db.withTenant(
          tenant,
          (trx) => readableOf(trx, delivery.serviceIdentity, [delivery.artifactId!]),
          SYSTEM,
        )
      ).has(delivery.artifactId);
    const answer = readable
      ? await deliverer({
          requestId: randomUUID(),
          tenant: tenant.id,
          subscription: delivery.subscriptionId,
          url: delivery.url,
          sealed: [...delivery.sealed],
          id: delivery.id,
          body: delivery.body,
        })
      : undefined;
    const done = await db.withTenant(
      tenant,
      (trx) =>
        recordAttempt(
          trx,
          delivery.id,
          answer === undefined
            ? { kind: 'unreadable' }
            : answer === 'busy'
              ? { kind: 'busy' }
              : answer.type === 'answered'
                ? {
                    kind: 'answered',
                    status: answer.status,
                    latencyMs: answer.latencyMs,
                    reply: answer.reply,
                  }
                : { kind: 'failed', failure: answer.code, latencyMs: answer.latencyMs },
        ),
      SYSTEM,
    );
    if (done.disabled !== undefined) {
      log.warn({ tenant: tenant.id, subscription: done.disabled }, 'disabled a failing webhook');
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, waiting.length) }, async () => {
      for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
        try {
          await one(next);
        } catch (error) {
          log.error({ tenant: tenant.id, err: error }, 'a webhook delivery failed');
        }
      }
    }),
  );
  return claimed.length;
}
