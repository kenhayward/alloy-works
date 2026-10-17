import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/** A period of runs (the R18 plan, R18-E): the last 30 days unless named, never more than 13 months. */
export const QueryUsageQuery = z.object({
  from: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('The start of the period, inclusive; 30 days before `to` where absent'),
  to: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('The end of the period, exclusive; now where absent'),
});
export type QueryUsageQuery = z.infer<typeof QueryUsageQuery>;

const Total = z.object({
  id: z.string(),
  title: z
    .string()
    .nullable()
    .describe('Its title at its latest version, or null where it has gone'),
  runs: z.int(),
  failed: z.int(),
  throttled: z.int().describe('Runs that waited for a slot and found none (query_throttled)'),
  durationMs: z.int().describe('The time its runs took, in all'),
  rows: z.int(),
  bytes: z.int().describe("The bytes of its runs' results, in all"),
});

export const QueryUsageView = z.object({
  from: z.string(),
  to: z.string(),
  byQueryDefinition: z
    .array(Total)
    .describe('Most time first; a sample of an unsaved draft is none'),
  byDocument: z.array(Total).describe('Most time first; a sample is no document'),
});
export type QueryUsageView = z.infer<typeof QueryUsageView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

export const queryUsageRoutes = {
  getQueryUsage: {
    operationId: 'getQueryUsage',
    method: 'GET',
    path: '/v1/data/usage',
    summary: "What the environment's query runs cost in a period, by query and by document",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    query: QueryUsageQuery,
    responses: {
      200: { description: 'The totals', schema: QueryUsageView },
      400: {
        description: 'A period that ends before it starts, or longer than 13 months',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'The caller does not administer the environment', schema: ErrorBody },
    },
  },
  getQueryRunsCsv: {
    operationId: 'getQueryRunsCsv',
    method: 'GET',
    path: '/v1/data/usage/runs.csv',
    summary: 'Every query run in a period, one to a row, as CSV',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    query: QueryUsageQuery,
    responses: {
      200: {
        description:
          'when, act, outcome, failure, who, connection, query definition, document, milliseconds, rows and bytes, oldest first',
        binary: { contentTypes: ['text/csv'] },
      },
      400: {
        description:
          'A period that ends before it starts, longer than 13 months, or holding more than 100,000 runs',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'The caller does not administer the environment', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
