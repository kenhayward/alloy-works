import type { Tenant } from '@alloy-works/db';

export interface HostnameResolver {
  resolve(hostname: string): Promise<Tenant | undefined>;
}

/**
 * Hostname to tenant, remembering tenants it has found for a short while. A miss is never
 * remembered: a newly provisioned hostname answers at once, and requests with made-up hostnames
 * cannot fill the cache.
 */
export function cachedResolver(
  lookup: (hostname: string) => Promise<Tenant | undefined>,
  options: { readonly ttlMs: number; readonly now?: () => number },
): HostnameResolver {
  const now = options.now ?? Date.now;
  const found = new Map<string, { tenant: Tenant; expires: number }>();
  return {
    async resolve(hostname) {
      const key = hostname.toLowerCase();
      const hit = found.get(key);
      if (hit && hit.expires > now()) return hit.tenant;
      const tenant = await lookup(key);
      if (tenant) found.set(key, { tenant, expires: now() + options.ttlMs });
      else found.delete(key);
      return tenant;
    },
  };
}
