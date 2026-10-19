import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

export const ModelUsageQuery = z.strictObject({
  months: z
    .string()
    .regex(/^(?:[1-9]|1[0-3])$/)
    .optional()
    .describe('How many months, this one and those before it, from 1 to 13; 12 where none is said'),
});
export type ModelUsageQuery = z.infer<typeof ModelUsageQuery>;

export const ModelUsageView = z.object({
  months: z.array(z.string()).describe('Each month shown, `YYYY-MM`, UTC, the oldest first'),
  models: z
    .array(
      z.object({
        month: z.string(),
        purpose: z.string().describe('What the runs were for: drafting, chat, a trial, a test'),
        runs: z.number().int().nonnegative(),
        tokensIn: z.number().int().nonnegative(),
        tokensOut: z.number().int().nonnegative(),
        tokensCached: z
          .number()
          .int()
          .nonnegative()
          .describe('Of those in, how many the provider read from its cache'),
        costs: z
          .array(z.object({ currency: z.string(), cost: z.string() }))
          .describe('What they cost, by currency, to six places'),
      }),
    )
    .describe('Model runs ended, by month and purpose'),
  queries: z
    .array(
      z.object({
        month: z.string(),
        runs: z.number().int().nonnegative(),
        rows: z.number().int().nonnegative(),
        bytes: z.number().int().nonnegative(),
      }),
    )
    .describe('Query runs by month, kept 13 months'),
});

/**
 * Spend as a trend (generation.md, "Cost"; the G6 plan, G6-F): what models and queries were used,
 * month by month.
 */
export const modelUsageRoutes = {
  getModelUsage: {
    operationId: 'getModelUsage',
    method: 'GET',
    path: '/v1/model-usage',
    summary: 'What models and queries were used and cost, month by month',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    query: ModelUsageQuery,
    responses: {
      200: { description: 'The months', schema: ModelUsageView },
      400: { description: 'Months not a whole number from 1 to 13', schema: ErrorBody },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
      403: { description: 'The caller does not administer this environment', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
