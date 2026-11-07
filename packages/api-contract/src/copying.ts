import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';
import { TemplateRefusal } from './templates.js';

const CopyParams = z.object({ id: LowercaseUuid });
export type CopyParams = z.infer<typeof CopyParams>;

export const CopyBody = z
  .object({
    to: LowercaseUuid.describe('The space to make the copy in: its own, or another'),
    title: z
      .string()
      .min(1)
      .max(500)
      .describe("The copy's title, or a template's name; one in use there is warned of"),
    components: z
      .enum(['reuse', 'own', 'all'])
      .optional()
      .describe(
        "A document's components, where they start from: reuse every one, copy only those no other document places (the default), or copy every one",
      ),
    exceptions: z
      .array(
        z
          .object({
            component: LowercaseUuid.describe('A component the document places'),
            as: z.enum(['copy', 'reuse']).describe('Copied, or reused, whatever `components` says'),
          })
          .strict(),
      )
      .max(1000)
      .optional()
      .describe(
        "A document's components set otherwise than `components` starts them; one not placed in the document, or copying one that is fixed (required by its template, archived or deleted, or not the caller's to read), is refused",
      ),
    rewordings: z
      .enum(['keep', 'drop'])
      .optional()
      .describe(
        "A document's local overrides: kept on the copy (the default), or left behind on the original only",
      ),
  })
  .strict();
export type CopyBody = z.infer<typeof CopyBody>;

const CopyCounts = {
  kind: z.enum(['document', 'component', 'template']),
  titleInUse: z
    .boolean()
    .describe('Another of its kind the caller may read in that space has this title'),
  copied: z.number().int().describe("Components a document's copy makes"),
  reused: z.number().int().describe('Components it places that it reuses'),
  required: z
    .number()
    .int()
    .describe('Of those reused, the ones its template requires, never copied'),
  kept: z.number().int().describe('Of those reused, the deleted or archived ones, never copied'),
  unreadable: z
    .number()
    .int()
    .describe('Of those reused, the ones the caller may not read: never copied, never named'),
  approvedToLatest: z
    .number()
    .int()
    .describe('References to a copy that tracked the approved revision, now its latest'),
  newestShown: z
    .number()
    .int()
    .describe('Components placed at more than one version, copied at the newest shown'),
  overrides: z.number().int().describe("The document's local overrides"),
  overridesDropped: z
    .number()
    .int()
    .describe('Of those kept, the ones dropped, their paragraph changed at the version copied'),
  lines: z.number().int().describe('Divergent lines of what is copied, which are not'),
  translations: z.number().int().describe('Translations of what is copied, which are not'),
};

export const CopyPreviewAnswer = z.object({
  ...CopyCounts,
  limit: z.number().int().describe('The most components one copy makes'),
  consequences: z
    .object({
      citations: z.number().int().describe("Citations of the original space's bibliography"),
      terms: z.number().int().describe('Marked terms, which print as their words'),
      imagesStaying: z.number().int().describe('Images staying, which new readers may not read'),
      bound: z.number().int().describe('Bound parts, whose query definition stays'),
    })
    .nullable()
    .describe('What a copy in another space leaves behind in this one; null in the same space'),
  components: z
    .array(
      z.object({
        component: LowercaseUuid,
        title: z
          .string()
          .nullable()
          .describe('Its title; null where the caller may not read it, or it is gone'),
        placed: z
          .enum(['only', 'shared', 'required', 'kept', 'unreadable'])
          .describe(
            "Placed in no other document, or in others; or fixed, never copied: required by its template, archived or deleted, or not the caller's to read",
          ),
        others: z
          .number()
          .int()
          .nullable()
          .describe(
            'Other documents the caller may read that place it; null where it is not theirs to read',
          ),
        grouped: z
          .boolean()
          .describe('A member of a placed group: copying it makes the run plain references'),
        outcome: z
          .enum(['copy', 'reuse'])
          .describe('What the copy does with it, exceptions applied'),
      }),
    )
    .describe(
      "A document's components, each once in the order first placed; none for another kind",
    ),
});
export type CopyPreviewAnswer = z.infer<typeof CopyPreviewAnswer>;

export const CopyAnswer = z.object({
  id: LowercaseUuid.describe('The copy'),
  version: LowercaseUuid.describe('Its one version, 0.1'),
  ...CopyCounts,
  components: z
    .array(z.object({ from: LowercaseUuid, copy: LowercaseUuid }))
    .describe("Each component a document's copy made, by the one it was made from"),
});
export type CopyAnswer = z.infer<typeof CopyAnswer>;

/** A copy refused (RM-H, RM-K), or its template's copy refused as making a template is. */
export const CopyRefusal = TemplateRefusal.extend({
  limit: z.number().int().optional().describe('copy_too_large: the most components one copy makes'),
  unreadable: z
    .number()
    .int()
    .optional()
    .describe('No longer sent: a component the caller may not read is reused instead'),
  component: LowercaseUuid.optional().describe(
    'exception_unknown, exception_fixed: the component the exception names',
  ),
  failures: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('values_invalid: each value that no longer fits its field'),
});

const refusals = {
  400: {
    description:
      'content_invalid: the title is not one its kind takes; copy_too_large: more components than the limit at once, counted after the exceptions; exception_unknown: an exception names a component the document does not place; exception_fixed: an exception copies a component that is fixed; values_invalid: a value of a component no longer stores; template_unresolved, or another refusal making a template answers',
    schema: CopyRefusal,
  },
  401: { description: 'Not signed in', schema: ErrorBody },
  403: {
    description: 'It needs read on the artifact, and create at the target (design, for a template)',
    schema: ErrorBody,
  },
  404: {
    description: 'No such artifact or space, or the caller may not read it',
    schema: ErrorBody,
  },
  409: { description: 'space_archived: the target is archived', schema: ErrorBody },
} as const;

/** Duplicating a document, a component or a template (the RM plan, RM-F to RM-O). */
export const copyingRoutes = {
  copyArtifact: {
    operationId: 'copyArtifact',
    method: 'POST',
    path: '/v1/artifacts/{id}/copy',
    summary: 'Copy a document, component or template under a new title',
    tenantScoped: true,
    reads: 'metadata',
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: CopyParams,
    body: CopyBody,
    responses: {
      200: { description: 'Copied', schema: CopyAnswer },
      ...refusals,
    },
  },
  copyArtifactPreview: {
    operationId: 'copyArtifactPreview',
    method: 'POST',
    path: '/v1/artifacts/{id}/copy/preview',
    summary: 'What copying would make, reuse and leave behind',
    tenantScoped: true,
    reads: 'metadata',
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: CopyParams,
    body: CopyBody,
    responses: {
      200: { description: 'What the copy would do, nothing changing', schema: CopyPreviewAnswer },
      ...refusals,
    },
  },
} as const satisfies Record<string, RouteContract>;
