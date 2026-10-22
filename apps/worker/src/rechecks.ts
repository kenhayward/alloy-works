import { randomUUID } from 'node:crypto';

import {
  entriesDue,
  recordEntryCheck,
  type CheckableEntry,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { entryCheck, REFERENCE_SOURCE_IDS, type ReferenceSourceId } from '@alloy-works/domain';

import type { Referencer } from './referencer.js';
import type { WorkerLog } from './worker.js';

/** Each source's deployment-wide budget, calls a second (the XR plan, XR-E). */
export const REFERENCE_RATES: Readonly<Record<ReferenceSourceId, number>> = {
  crossref: 10,
  pubmed: 3,
};

/** The most entries a tenant has checked a night, oldest check first. */
const PER_TENANT = 2000;

/** Whether tonight's re-check is due: once a UTC day, from 02:00. */
export function nightDue(last: Date | undefined, now: Date): boolean {
  if (now.getUTCHours() < 2) return false;
  return last === undefined || last.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);
}

/**
 * The nightly re-check (the XR plan, XR-E): in every tenant, the entries a component's latest version
 * cites, obtained from a source the tenant has on, oldest check first; each source's own lane, taking
 * one entry from each tenant in turn and never past its budget. Each found answer is recorded as the
 * entry's status by the system, telling owners of a retraction or correction (XR-F, XR-G); a failure
 * or a busy connector records nothing, so the entry stays first for the next night. Answers how many
 * were recorded.
 */
export async function recheckEntries(
  db: TenantDatabase,
  referencer: Referencer,
  log: WorkerLog,
  options: { readonly now?: () => number; readonly sleep?: (ms: number) => Promise<void> } = {},
): Promise<number> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const due = new Map<Tenant, CheckableEntry[]>();
  for (const tenant of await db.tenants()) {
    try {
      due.set(tenant, await db.withTenant(tenant, (trx) => entriesDue(trx, PER_TENANT)));
    } catch (error) {
      log.error({ tenant: tenant.id, err: error }, 'the entries due a check were not read');
    }
  }

  let recorded = 0;
  const lane = async (source: ReferenceSourceId) => {
    // One from each tenant in turn, as long as any has one.
    const queues = [...due].map(([tenant, entries]) => ({
      tenant,
      entries: entries.filter((each) => each.source === source),
    }));
    const gap = 1000 / REFERENCE_RATES[source];
    let next = now();
    for (let round = 0; queues.some((each) => each.entries.length > round); round += 1) {
      for (const { tenant, entries } of queues) {
        const entry = entries[round];
        if (entry === undefined) continue;
        const wait = next - now();
        if (wait > 0) await sleep(wait);
        next = now() + gap;
        const answer = await referencer({
          requestId: randomUUID(),
          tenant: tenant.id,
          source,
          op: 'check',
          identifier: entry.identifier,
        });
        if (answer === 'busy' || answer.type === 'failed') {
          log.warn(
            { tenant: tenant.id, source, reason: answer === 'busy' ? 'busy' : answer.reason },
            'an entry was not checked',
          );
          continue;
        }
        try {
          await db.withTenant(
            tenant,
            (trx) =>
              recordEntryCheck(trx, {
                entryId: entry.entryId,
                source,
                check: entryCheck(entry.csl, answer.results),
              }),
            { actorKind: 'system' },
          );
          recorded += 1;
        } catch (error) {
          log.error({ tenant: tenant.id, err: error }, "an entry's check was not recorded");
        }
      }
    }
  };
  await Promise.all(REFERENCE_SOURCE_IDS.map(lane));
  return recorded;
}
