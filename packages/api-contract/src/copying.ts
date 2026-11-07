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
        "A document's components: reuse every one, copy only those no other document places (the default), or copy every one",
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
    .describe('Of those it would copy, the ones the caller may not read, which refuse the copy'),
  approvedToLatest: z
    .number()
    .int()
    .describe('References to a copy that tracked the approved revision, now its latest'),
  newestShown: z
    .number()
    .int()
    .describe('Components placed at more than one version, copied at the newest shown'),
  overridesDropped: z
    .number()
    .int()
    .describe('Local overrides dropped, their paragraph changed at the version copied'),
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
    .describe('copy_unreadable: how many components it would copy the caller may not read'),
  failures: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('values_invalid: each value that no longer fits its field'),
});

const refusals = {
  400: {
    description:
      'content_invalid: the title is not one its kind takes; copy_too_large: more components than the limit at once; copy_unreadable: a component it would copy is one the caller may not read; values_invalid: a value of a component no longer stores; template_unresolved, or another refusal making a template answers',
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
