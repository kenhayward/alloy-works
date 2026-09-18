import { parseLevel, permissions } from '@alloy-works/domain';
import { z } from 'zod';

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A uuid, lowercase only. Postgres' `uuid` type returns its canonical form lowercase regardless of the
 * case it was written in, and a session or an opened-from version is compared against that reading in
 * JavaScript - never through Postgres' own case-insensitive equality - so an uppercase one sent back
 * would compare unequal to the very record it names, for as long as the session or the version lasts.
 * Refusing it at the door, rather than downcasing it, keeps what a caller sent and what is stored the
 * same string everywhere this is echoed back (a lock's `session`, a refusal's `holder`).
 *
 * Defined here, with the other shared primitives (`ErrorBody`, `Target`, `SampleParams`), rather than
 * in `editing.ts` or `components.ts`: those two already import from each other, so either owning the
 * definition and the other importing it is a circular import - live values referenced at module-body
 * evaluation time, which throws `ReferenceError: Cannot access 'Lock' before initialization` at
 * runtime the moment anything imports this module tree. `schemas.ts` imports from neither, so every
 * consumer (`components.ts`, `editing.ts`, `invitations.ts`, `managing-access.ts`) can import it
 * directly, with no re-export hop.
 */
export const LowercaseUuid = z.uuid().regex(LOWERCASE_UUID, 'Expected a lowercase uuid');

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

export const Me = z.object({
  id: z.string().describe('The principal, stable for as long as the environment exists'),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  environment: z.string().describe('The environment signed in to, as its people see it'),
});
export type Me = z.infer<typeof Me>;

export const SignInCallback = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});
export type SignInCallback = z.infer<typeof SignInCallback>;

export const GoogleHandoff = z.object({ code: z.string() });
export type GoogleHandoff = z.infer<typeof GoogleHandoff>;

export const Sample = z.object({
  id: z.string(),
  state: z.enum(['queued', 'done', 'failed']),
  download: z
    .string()
    .nullable()
    .describe('A link to the PDF, good for a few minutes, once a worker has made it'),
});
export type Sample = z.infer<typeof Sample>;

export const SampleParams = z.object({ sampleId: z.uuid() });
export type SampleParams = z.infer<typeof SampleParams>;

/** A target: the environment, one space or one artifact (access.md, "Deciding"). */
export const Target = z
  .string()
  .refine((text) => parseLevel(text) !== undefined, {
    message: 'Expected tenant, space:<id> or artifact:<id>',
  })
  .describe('`tenant`, `space:<id>` or `artifact:<id>`');

export const PermissionName = z.enum(permissions);

export const AccessQuery = z.object({ target: Target });
export type AccessQuery = z.infer<typeof AccessQuery>;

export const AccessAnswers = z.object({
  target: z.string(),
  permissions: z.array(z.object({ permission: PermissionName, allowed: z.boolean() })),
});
export type AccessAnswers = z.infer<typeof AccessAnswers>;

export const ExplainQuery = z.object({
  principal: z.uuid().describe('The principal whose access is explained'),
  target: Target,
});
export type ExplainQuery = z.infer<typeof ExplainQuery>;

export const AccessExplanation = z.object({
  principal: z.string(),
  target: z.string(),
  permissions: z.array(
    z.object({
      permission: PermissionName,
      allowed: z.boolean(),
      reason: z
        .enum(['allowed', 'denied', 'not_granted', 'capped'])
        .describe('capped: an external principal, refused whatever the grants say'),
      level: z
        .string()
        .nullable()
        .describe('The level that decided, or null when none said anything'),
      checked: z.array(z.string()).describe('Every level looked at, nearest first'),
      grants: z
        .array(
          z.object({
            id: z.string(),
            role: z.string(),
            effect: z.enum(['allow', 'deny']),
            subject: z.union([
              z.object({ principal: z.string() }),
              z.object({ group: z.string() }),
            ]),
            through: z.string().nullable().describe('The group it reached the principal through'),
            expiresAt: z.string().nullable(),
          }),
        )
        .describe('The grants that decided, at the deciding level'),
    }),
  ),
});
export type AccessExplanation = z.infer<typeof AccessExplanation>;
