import { routes, type RouteContract } from '@alloy-works/api-contract';
import type { Tenant, TenantDatabase } from '@alloy-works/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppError } from './errors.js';
import { createHttp, type HttpOptions } from './http.js';
import { cachedResolver } from './tenants.js';
import type { ZodTypeProvider } from './type-provider.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set before a tenant-scoped handler runs; null on routes that are not tenant-scoped. */
    tenant: Tenant | null;
  }
}

export interface AppOptions extends HttpOptions {
  readonly db: TenantDatabase;
  readonly tenantCacheMs?: number;
}

type Success<R extends RouteContract> = R['responses'] extends {
  200: { schema: infer S extends z.ZodType };
}
  ? z.input<S>
  : never;

type Handlers = {
  [K in keyof typeof routes]: (request: FastifyRequest) => Promise<Success<(typeof routes)[K]>>;
};

function tenantOf(request: FastifyRequest): Tenant {
  if (!request.tenant) throw new Error('A tenant-scoped handler ran without a tenant');
  return request.tenant;
}

/**
 * The service: the contract's routes and nothing else. Every route in `routes` must have a handler
 * here - the Handlers type refuses to compile otherwise - and each is registered with the schemas its
 * contract declares, so the document, the validation and the serialisation cannot disagree.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const { db } = options;
  const app = createHttp(options);
  const tenants = cachedResolver((hostname) => db.resolveHostname(hostname), {
    ttlMs: options.tenantCacheMs ?? 30_000,
  });
  app.decorateRequest('tenant', null);

  const handlers: Handlers = {
    getHealth: async () => ({ status: 'ok' }),
    getTenant: async (request) => {
      const profile = await db.withTenant(tenantOf(request), (trx) =>
        trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow(),
      );
      return { name: profile.display_name };
    },
  };

  const http = app.withTypeProvider<ZodTypeProvider>();
  for (const [name, route] of Object.entries(routes) as [keyof Handlers, RouteContract][]) {
    const response = Object.fromEntries(
      Object.entries(route.responses).map(([status, declared]) => [status, declared.schema]),
    );
    http.route({
      method: route.method,
      url: route.path,
      schema: { response },
      ...(route.tenantScoped
        ? {
            onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
              const tenant = await tenants.resolve(request.hostname);
              if (!tenant) {
                throw new AppError(
                  404,
                  'tenant_not_found',
                  'No environment is served at this address.',
                );
              }
              request.tenant = tenant;
              // Both loggers: the reply's was captured before this hook ran, and it writes the
              // "request completed" line.
              request.log = request.log.child({ tenant: tenant.id });
              reply.log = request.log;
            },
          }
        : {}),
      handler: handlers[name],
    });
  }
  return app;
}
