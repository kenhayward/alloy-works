import type { Permission } from '@alloy-works/domain';
import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A response by status. A redirect or a 204 has no body, and so no schema. */
export interface RouteResponse {
  readonly description: string;
  readonly schema?: z.ZodType;
  /** A stream of events rather than a body: `text/event-stream`, which no schema describes. */
  readonly stream?: true;
}

/**
 * What a permission-checked route asks about. A space or an artifact names the path parameter holding
 * its id; a query or a body names the member holding a target spelled `tenant`, `space:<id>` or
 * `artifact:<id>`; a grant names the path parameter holding a grant's id, and the target is the level
 * that grant was made at - which a caller who may not manage the grant is never told exists.
 */
export type RouteTarget =
  | { readonly tenant: true }
  | { readonly space: string }
  | { readonly artifact: string }
  | { readonly query: string }
  | { readonly body: string }
  | { readonly grant: string };

/**
 * What a route checks before its handler runs (access.md, "Refusing"): nothing; a session; or a
 * session and a permission on a target, decided in the transaction the handler then runs in.
 */
export type RouteAccess =
  | { readonly check: 'none' }
  | { readonly check: 'session' }
  | { readonly check: 'permission'; readonly permission: Permission; readonly target: RouteTarget };

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
  /** What it checks. Anything but `none` needs a session, and the cross-tenant harness tests it. */
  readonly access: RouteAccess;
  /** Path parameters, named as the path names them. The service validates them before a handler. */
  readonly params?: z.ZodObject;
  readonly query?: z.ZodObject;
  /** A JSON request body. The service validates it before a handler, as it does parameters. */
  readonly body?: z.ZodObject;
  readonly responses: Readonly<Record<number, RouteResponse>>;
}
