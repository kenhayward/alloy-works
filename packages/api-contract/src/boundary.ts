import { OUTBOUND_WAYS } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

export const OutboundWayName = z
  .enum(OUTBOUND_WAYS)
  .describe(
    'model_endpoint, embedding, translation, reference_source, malware_scanning, data_connection, webhook, mail, extension, vocabulary_source or ct_studio',
  );

export const BoundaryItemView = z.object({
  id: z.string().describe('Its id, or a declared source’s key'),
  name: z.string().describe('Its name; a webhook without a description, its host'),
  on: z.boolean().describe('Whether anything is sent by it now'),
  host: z
    .string()
    .nullable()
    .describe(
      'The host it is sent to, never a path or query, which can carry a key; null where none',
    ),
  boundary: z
    .enum(['inside', 'outside'])
    .nullable()
    .describe('A model endpoint’s declared boundary; null for anything else, which declares none'),
  detail: z
    .string()
    .nullable()
    .describe(
      'A word more: a connection’s type, a relay’s owner (own or platform), an extension’s kind, the translation policy; null where none',
    ),
});
export type BoundaryItemView = z.infer<typeof BoundaryItemView>;

export const BoundaryWayView = z.object({
  way: OutboundWayName,
  what: z.string().describe('What may leave by it, in plain words'),
  onByDefault: z
    .boolean()
    .describe('Whether a new environment sends by it before anyone changes it'),
  changedBy: z
    .object({
      operation: z.string().describe('The operation that turns it on or changes where it goes'),
      permission: z.string().describe('The permission that operation needs'),
    })
    .nullable()
    .describe('Who may change it; null where nothing exists to change'),
  residency: z
    .enum(['endpoint', 'not_declared'])
    .describe(
      'endpoint: each endpoint declares its boundary, inside or outside; not_declared: no residency is stated, since what is promised (ADM-Q01) is open',
    ),
  absent: z.string().nullable().describe('Why nothing sends by it, where nothing does; else null'),
  on: z.boolean().describe('Whether anything configured here sends by it now'),
  items: z.array(BoundaryItemView).describe('What this environment has configured for it'),
});
export type BoundaryWayView = z.infer<typeof BoundaryWayView>;

export const BoundaryView = z.object({
  ways: z.array(BoundaryWayView).describe('Every way anything can leave this environment'),
});
export type BoundaryView = z.infer<typeof BoundaryView>;

/** Everything that can leave a tenant (docs/design/secrets.md, "The boundary"; ADM-041). */
export const boundaryRoutes = {
  getBoundary: {
    operationId: 'getBoundary',
    method: 'GET',
    path: '/v1/boundary',
    summary: 'Everything that can leave this environment, and what is configured for each',
    tenantScoped: true,
    reads: 'metadata',
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    responses: {
      200: {
        description: 'Every way out, never a secret or an address’s path',
        schema: BoundaryView,
      },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
      403: {
        description: 'The caller does not hold administer at the environment',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
