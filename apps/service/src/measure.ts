import type { CapabilityCount, Tenant } from '@alloy-works/db';
import { addBuckets, bucketOf, emptyBuckets } from '@alloy-works/domain';

/** How a request ended, as it is counted (the DG plan, pre-flight 3). */
export interface Measured {
  readonly status: number;
  readonly ms: number;
  /** Refused by the environment's state (TL-B): counted, and kept out of its health. */
  readonly refused: boolean;
}

export interface Measuring {
  /** Counts a request to a resolved tenant's capability; nothing is written on the request's path. */
  record(tenant: Tenant, capability: string, measured: Measured): void;
  /** Writes what is held, each tenant's minutes in turn; a minute whose write fails is kept. */
  flush(): Promise<void>;
  /** How many counts were not held, past the cap, since the process began. */
  dropped(): number;
}

interface Held {
  requests: number;
  clientErrors: number;
  serverErrors: number;
  refused: number;
  buckets: number[];
}

/** Every distinct tenant, minute and capability held at once, at most: memory is bounded. */
const MOST = 50_000;

/**
 * Measures requests in the process (diagnostics.md; the DG plan, pre-flight 4): summed in memory by
 * tenant, minute and capability, and written once a minute by `write`, which adds to what any other
 * process wrote for the same minute. At most a minute is lost when a process dies, and a write that
 * fails is tried again at the next flush.
 */
export function createMeasuring(
  write: (tenant: Tenant, minute: Date, counts: readonly CapabilityCount[]) => Promise<void>,
  options: {
    readonly now?: () => Date;
    readonly most?: number;
    readonly failed?: (error: unknown) => void;
  } = {},
): Measuring {
  const now = options.now ?? (() => new Date());
  const most = options.most ?? MOST;
  // tenant id -> minute -> capability -> counts
  const held = new Map<string, { tenant: Tenant; minutes: Map<number, Map<string, Held>> }>();
  let size = 0;
  let notHeld = 0;

  const holder = (tenant: Tenant, minute: number, capability: string): Held | undefined => {
    let byTenant = held.get(tenant.id);
    const existing = byTenant?.minutes.get(minute)?.get(capability);
    if (existing) return existing;
    if (size >= most) return undefined;
    if (!byTenant) {
      byTenant = { tenant, minutes: new Map() };
      held.set(tenant.id, byTenant);
    }
    let byMinute = byTenant.minutes.get(minute);
    if (!byMinute) {
      byMinute = new Map();
      byTenant.minutes.set(minute, byMinute);
    }
    const made: Held = {
      requests: 0,
      clientErrors: 0,
      serverErrors: 0,
      refused: 0,
      buckets: emptyBuckets(),
    };
    byMinute.set(capability, made);
    size += 1;
    return made;
  };

  return {
    record(tenant, capability, measured) {
      const minute = Math.floor(now().getTime() / 60_000) * 60_000;
      const counts = holder(tenant, minute, capability);
      if (!counts) {
        notHeld += 1;
        return;
      }
      counts.requests += 1;
      if (measured.refused) counts.refused += 1;
      else if (measured.status >= 500) counts.serverErrors += 1;
      else if (measured.status >= 400) counts.clientErrors += 1;
      counts.buckets[bucketOf(measured.ms)]! += 1;
    },

    async flush() {
      for (const [id, { tenant, minutes }] of [...held]) {
        for (const [minute, capabilities] of [...minutes]) {
          const counts = [...capabilities].map(([capability, each]) => ({ capability, ...each }));
          // Taken out before the write, so what arrives meanwhile starts afresh.
          minutes.delete(minute);
          size -= capabilities.size;
          try {
            await write(tenant, new Date(minute), counts);
          } catch (error) {
            options.failed?.(error);
            restore(tenant, minute, counts);
          }
        }
        if (held.get(id)?.minutes.size === 0) held.delete(id);
      }
    },

    dropped: () => notHeld,
  };

  function restore(tenant: Tenant, minute: number, counts: readonly CapabilityCount[]): void {
    for (const each of counts) {
      const into = holder(tenant, minute, each.capability);
      if (!into) {
        notHeld += each.requests;
        continue;
      }
      into.requests += each.requests;
      into.clientErrors += each.clientErrors;
      into.serverErrors += each.serverErrors;
      into.refused += each.refused;
      into.buckets = addBuckets(into.buckets, each.buckets);
    }
  }
}
