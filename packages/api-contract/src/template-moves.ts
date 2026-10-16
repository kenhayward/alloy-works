import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** What moving a document to its template's newest version changes (TPL-034, TPL-058; WF6-D). */
export const TemplateMoveReport = z.object({
  theme: z
    .object({ from: z.string(), to: z.string() })
    .nullable()
    .describe('The theme it would be published under, where the newer version names another'),
  layout: z
    .object({ from: z.string(), to: z.string() })
    .nullable()
    .describe('The layout it would be published under, where the newer version names another'),
  fields: z
    .array(
      z.object({
        level: z.enum(['document', 'section']),
        field: z.string(),
        name: z.string(),
        change: z.enum(['added', 'removed', 'required', 'optional']),
      }),
    )
    .describe('Each field the newer version assigns, no longer assigns, or makes required or not'),
  notCarried: z
    .array(
      z.object({
        node: z.string().nullable().describe("The section's node; null for the document's own"),
        field: z.string(),
        name: z.string(),
        value: z.unknown(),
      }),
    )
    .describe('Each value the move would not carry forward, as a component type change names them'),
  missing: z
    .array(z.object({ key: z.string(), title: z.string() }))
    .describe(
      'Each section the newer version requires that the document lacks, to add or remove with a reason',
    ),
  components: z
    .array(z.object({ key: z.string(), component: z.string() }))
    .describe('Each component the newer version requires that the document lacks, by its key'),
});
export type TemplateMoveReport = z.infer<typeof TemplateMoveReport>;

export const TemplateMovePreview = z.object({
  template: z.string(),
  from: z.string().describe('The template version the document is bound to now'),
  to: z.string().describe('The newest version, which the move binds it to'),
  latest: z.string().describe('The document version the move is against: send it back to move'),
  report: TemplateMoveReport,
});
export type TemplateMovePreview = z.infer<typeof TemplateMovePreview>;

export const TemplateMoveParams = z.object({ id: z.uuid() });
export const TemplateMoveQuery = z.object({
  to: LowercaseUuid.describe("The template's newest version"),
});
export type TemplateMoveQuery = z.infer<typeof TemplateMoveQuery>;

export const TemplateMoveBody = z.strictObject({
  latest: LowercaseUuid.describe(
    'The document version the preview was against: refused, version_precondition, where it is not the latest',
  ),
  to: LowercaseUuid.describe("The template's newest version, as the preview named it"),
});
export type TemplateMoveBody = z.infer<typeof TemplateMoveBody>;

export const TemplateMoved = z.object({
  version: z.object({ id: z.string(), number: z.string() }).describe('The document version now'),
  report: TemplateMoveReport,
});
export type TemplateMoved = z.infer<typeof TemplateMoved>;

const edit = { check: 'permission', permission: 'edit', target: { artifact: 'id' } } as const;
const refusals = {
  401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
  403: { description: 'The caller may read the document but may not edit it', schema: ErrorBody },
  404: {
    description: 'No such document the caller may read, or a template the caller may not read',
    schema: ErrorBody,
  },
  409: {
    description:
      'template_none: made blank; template_current: already at its newest version; template_not_latest: `to` is not the newest; artifact_archived; version_precondition: the document moved since',
    schema: ErrorBody,
  },
} as const;

/** Moving a document to its template's newest version (templates.md; the WF6 plan, WF6-C, WF6-D). */
export const templateMoveRoutes = {
  previewTemplateMove: {
    operationId: 'previewTemplateMove',
    method: 'GET',
    path: '/v1/documents/{id}/template-move',
    summary: "What moving a document to its template's newest version would change",
    tenantScoped: true,
    access: edit,
    params: TemplateMoveParams,
    query: TemplateMoveQuery,
    responses: {
      200: {
        description: 'What the move would change, recording nothing',
        schema: TemplateMovePreview,
      },
      400: {
        description: 'template_unresolved: the newer version names what does not resolve',
        schema: ErrorBody,
      },
      ...refusals,
    },
  },
  moveDocumentTemplate: {
    operationId: 'moveDocumentTemplate',
    method: 'POST',
    path: '/v1/documents/{id}/template-move',
    summary: "Move a document to its template's newest version",
    tenantScoped: true,
    access: edit,
    params: TemplateMoveParams,
    body: TemplateMoveBody,
    responses: {
      200: {
        description: 'Moved; the document version now, and what changed',
        schema: TemplateMoved,
      },
      400: {
        description: 'template_unresolved: the newer version names what does not resolve',
        schema: ErrorBody,
      },
      ...refusals,
    },
  },
} as const satisfies Record<string, RouteContract>;
