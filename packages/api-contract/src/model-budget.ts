import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid, PersonView } from './schemas.js';

const Budget = z.object({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .describe('The currency runs are counted in, as their endpoints price them'),
  limit: z
    .number()
    .positive()
    .max(1_000_000_000)
    .describe('What the environment means to spend on models a month, in that currency'),
  thresholds: z
    .array(z.number().int().min(1).max(100))
    .min(1)
    .max(5)
    .refine((each) => each.every((one, at) => at === 0 || one > each[at - 1]!), {
      message: 'Thresholds rise, each once',
    })
    .refine((each) => each[0]! < 100, {
      message: 'At least one threshold is below 100, so an alert comes before the limit',
    })
    .describe('The percents of the limit that alert, rising, at least one below 100'),
});

export const ModelBudgetBody = z.object({
  budget: Budget.nullable().describe('The budget; null lifts it'),
});
export type ModelBudgetBody = z.infer<typeof ModelBudgetBody>;

export const BudgetRecipientsBody = z.object({
  principals: z
    .array(LowercaseUuid)
    .max(20)
    .describe('Who is told, in place of who was: each from inside, administering the environment'),
});
export type BudgetRecipientsBody = z.infer<typeof BudgetRecipientsBody>;

export const ModelBudgetView = z.object({
  budget: Budget.nullable(),
  month: z.string().describe('This month, `YYYY-MM`, UTC'),
  spent: z.string().describe('What runs in the budget’s currency cost this month, to six places'),
  otherCurrencyRuns: z
    .number()
    .int()
    .nonnegative()
    .describe('Runs this month that cost something in another currency, counted in no budget'),
  recipients: z.array(PersonView).describe('Who is told when a threshold is crossed'),
  whenSpent: z
    .literal('everything_continues')
    .describe('What stops when the budget is spent, declared in advance (ADM-014): nothing'),
});

export const BudgetRecipientsRefusal = ErrorBody.extend({
  refused: z.array(LowercaseUuid).describe('Those who may not be told of spend'),
});

const administer = {
  check: 'permission',
  permission: 'administer',
  target: { tenant: true },
} as const;
const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller does not administer this environment',
  schema: ErrorBody,
} as const;

/**
 * The model budget (generation.md, "Cost"; the G6 plan, G6-B to G6-D): a monthly limit on what models
 * cost, the percents that alert, and who is told, through the inbox. Nothing stops when it is spent.
 */
export const modelBudgetRoutes = {
  getModelBudget: {
    operationId: 'getModelBudget',
    method: 'GET',
    path: '/v1/model-budget',
    summary: 'The monthly model budget, this month’s spend, and who is told',
    tenantScoped: true,
    access: administer,
    responses: {
      200: { description: 'The budget', schema: ModelBudgetView },
      401: unauthenticated,
      403: forbidden,
    },
  },
  setModelBudget: {
    operationId: 'setModelBudget',
    method: 'PUT',
    path: '/v1/model-budget',
    summary: 'Set or lift the monthly model budget',
    tenantScoped: true,
    access: administer,
    body: ModelBudgetBody,
    responses: {
      200: { description: 'Set, counting from this month', schema: ModelBudgetView },
      400: {
        description:
          'A currency not three capitals, a limit not positive, or thresholds that do not rise or none below 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
    },
  },
  setBudgetRecipients: {
    operationId: 'setBudgetRecipients',
    method: 'PUT',
    path: '/v1/model-budget/recipients',
    summary: 'Name who is told when the model budget crosses a threshold',
    tenantScoped: true,
    access: administer,
    body: BudgetRecipientsBody,
    responses: {
      200: { description: 'Named', schema: ModelBudgetView },
      400: {
        description:
          '`recipient_not_administrator`: somebody named is from outside, or does not administer the environment',
        schema: BudgetRecipientsRefusal,
      },
      401: unauthenticated,
      403: forbidden,
    },
  },
} as const satisfies Record<string, RouteContract>;
