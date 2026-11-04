import { allRoutes } from '@alloy-works/api-contract';
import type { ResolvedTenant } from '@alloy-works/db';
import type { TenantState } from '@alloy-works/domain';
import { AppError } from './errors.js';

export interface HostnameResolver {
  resolve(hostname: string): Promise<ResolvedTenant | undefined>;
}

/**
 * What every route answers while its tenant is not active (ADM-028; tenant-lifecycle.md, TL-B). It says
 * the state and never the reason, which is for the audit log and the organisation.
 */
export const environmentNotOpen = (state: TenantState) =>
  state === 'suspended'
    ? new AppError(
        503,
        'environment_suspended',
        'This environment is suspended. Nothing in it has been lost.',
        'ADM-028',
      )
    : new AppError(
        503,
        'environment_closing',
        'This environment is closing, and this is not open while it does.',
        'ADM-030',
      );

/** Either of those, as a path outside the API's own errors keeps them apart from a failure. */
export const isEnvironmentRefusal = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'environment_suspended' || code === 'environment_closing';
};

const CLOSING_ROUTES: ReadonlySet<string> = new Set(
  allRoutes
    .filter((route) => route.openWhileClosing)
    .map((route) => `${route.method} ${route.path.replace(/\{(\w+)\}/g, ':$1')}`),
);

/**
 * Whether a request gets past its tenant's state (TL-A, TL-B). A closing or retained tenant answers
 * only what helps it close, by session: a token is automation, and this is a person's to do.
 */
export function refusalFor(
  state: TenantState,
  request: {
    readonly method: string;
    readonly route: string | undefined;
    readonly bearer: boolean;
  },
): AppError | undefined {
  if (state === 'active') return undefined;
  if (
    (state === 'closing' || state === 'retained') &&
    !request.bearer &&
    CLOSING_ROUTES.has(`${request.method} ${request.route}`)
  ) {
    return undefined;
  }
  return environmentNotOpen(state);
}

/**
 * A request's route that answers whatever its tenant's state: its health, and the files of the page
 * that says what has happened. Anything matching no route falls to the renderer or a 404 anyway.
 */
export const answersInAnyState = (route: string | undefined, pageFiles: ReadonlySet<string>) =>
  route === undefined || route === '/health' || pageFiles.has(route);

/**
 * Hostname to tenant, remembering tenants it has found for a short while. A miss is never
 * remembered: a newly provisioned hostname answers at once, and requests with made-up hostnames
 * cannot fill the cache.
 */
export function cachedResolver(
  lookup: (hostname: string) => Promise<ResolvedTenant | undefined>,
  options: { readonly ttlMs: number; readonly now?: () => number },
): HostnameResolver {
  const now = options.now ?? Date.now;
  const found = new Map<string, { tenant: ResolvedTenant; expires: number }>();
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
