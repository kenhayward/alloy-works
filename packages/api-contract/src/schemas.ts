import { z } from 'zod';

export const ErrorBody = z.object({
  code: z.string().describe('Stable and machine-readable: branch on this, never on the message'),
  message: z.string().describe('For people. It may change between releases'),
  rule: z
    .string()
    .optional()
    .describe('The requirement or rule that refused the request, where one did'),
  traceId: z.string().describe('Quote this when reporting a problem'),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const Health = z.object({
  status: z.literal('ok'),
});
export type Health = z.infer<typeof Health>;

export const TenantProfile = z.object({
  name: z.string().describe('What this environment is called, as its own people see it'),
});
export type TenantProfile = z.infer<typeof TenantProfile>;
