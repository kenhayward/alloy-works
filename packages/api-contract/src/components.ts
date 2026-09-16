import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/** A component, by the id its artifact carries. */
export const ComponentParams = z.object({ id: z.uuid() });
export type ComponentParams = z.infer<typeof ComponentParams>;

export const ComponentListQuery = z.object({
  cursor: z.string().optional().describe('Where the previous page ended; absent for the first'),
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/, 'Expected a whole number from 1 to 100')
    .optional()
    .describe('At most this many, 50 when absent'),
});
export type ComponentListQuery = z.infer<typeof ComponentListQuery>;

export const VersionSummary = z.object({
  id: z.string(),
  number: z.string().describe('`revision.version`, as `0.2`'),
  author: z.string().describe('The principal who cut it'),
  createdAt: z.string(),
  note: z.string().nullable(),
});

export const Lock = z.object({
  holder: z.object({ id: z.string(), name: z.string().nullable() }),
  expectedRelease: z.string().describe('When it lapses unless the holder saves again'),
  yours: z.boolean().describe('Whether the caller holds it, from this session or another'),
  session: z.string().nullable().describe('The holding session, told only to its own principal'),
});

export const ComponentList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      space: z.object({ id: z.string(), name: z.string() }),
      version: z.string().describe('`revision.version` of the latest version'),
    }),
  ),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
});
export type ComponentList = z.infer<typeof ComponentList>;

export const ComponentView = z.object({
  id: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  content: z
    .record(z.string(), z.unknown())
    .describe("The latest version's content document (content-model.md), exactly as stored"),
  mayEdit: z.boolean().describe('Whether the caller may take the lock and write'),
  lock: Lock.nullable(),
});
export type ComponentView = z.infer<typeof ComponentView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/** Finding and opening components (the editor plan's decision 9, and component-editor.md, "The API"). */
export const componentRoutes = {
  listComponents: {
    operationId: 'listComponents',
    method: 'GET',
    path: '/v1/components',
    summary: 'The components the caller may read, a page at a time',
    tenantScoped: true,
    access: { check: 'session' },
    query: ComponentListQuery,
    responses: {
      200: { description: 'A page of components', schema: ComponentList },
      400: { description: 'A cursor this listing did not give out', schema: ErrorBody },
      401: unauthenticated,
    },
  },
  getComponent: {
    operationId: 'getComponent',
    method: 'GET',
    path: '/v1/components/{id}',
    summary: 'A component at its latest version, whether the caller may edit it, and its lock',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ComponentParams,
    responses: {
      200: { description: 'The component', schema: ComponentView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a component the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: {
        description: 'No such component in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
