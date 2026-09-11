import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A response by status. A redirect or a 204 has no body, and so no schema. */
export interface RouteResponse {
  readonly description: string;
  readonly schema?: z.ZodType;
}

/**
 * One route, declared once. The service registers it, validates and serialises with its schemas,
 * and the OpenAPI document is generated from it - so the three cannot disagree (API-002, API-003).
 */
export interface RouteContract {
  readonly operationId: string;
  readonly method: HttpMethod;
  /** OpenAPI style. No route has path parameters yet; the first one that does adds their schema. */
  readonly path: string;
  readonly summary: string;
  /** Whether the hostname must name a tenant before the route runs. */
  readonly tenantScoped: boolean;
  /** Whether the route needs a session; the cross-tenant harness tests every one that does. */
  readonly authenticated: boolean;
  readonly query?: z.ZodObject;
  readonly responses: Readonly<Record<number, RouteResponse>>;
}
