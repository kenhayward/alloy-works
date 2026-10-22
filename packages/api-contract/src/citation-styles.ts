import { citationStyleSchema, requiresSchema } from '@alloy-works/domain';
import { z } from 'zod';
import { VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const StyleParams = z.object({ id: LowercaseUuid });
export type StyleParams = z.infer<typeof StyleParams>;

export const CreateStyleBody = z.strictObject({ style: citationStyleSchema });
export type CreateStyleBody = z.infer<typeof CreateStyleBody>;

/** A style's next version: the whole style, from the version it was opened at. */
export const StyleVersionBody = z.strictObject({
  openedFrom: LowercaseUuid,
  style: citationStyleSchema,
});
export type StyleVersionBody = z.infer<typeof StyleVersionBody>;

export const StyleView = z.object({
  id: z.string(),
  version: VersionSummary,
  style: citationStyleSchema,
  seeded: z
    .boolean()
    .describe('One of the three every environment is given: CSE, Vancouver, Harvard'),
  mayEdit: z.boolean().describe('Whether the caller may cut its next version: design here'),
});
export type StyleView = z.infer<typeof StyleView>;

export const StyleSummary = z.object({
  id: z.string(),
  name: z.string(),
  seeded: z.boolean(),
  version: z.object({ id: z.string(), number: z.string() }),
});
export const StyleList = z.object({
  items: z.array(StyleSummary).describe("By name: an environment's handful"),
});
export type StyleList = z.infer<typeof StyleList>;

/** One run of rendered text, with the marks a published run carries. */
export const RunView = z.object({
  text: z.string(),
  marks: z.array(
    z.object({
      kind: z
        .string()
        .describe('`emphasis`, `strong`, `underline`, `subscript`, `superscript` or `hyperlink`'),
      href: z.string().optional(),
    }),
  ),
});

export const StyleProblemView = z.object({
  rule: z.literal('style_invalid'),
  path: z.string().describe('The member refused, dotted, as `csl` or `requires.book.0`'),
  message: z.string(),
});

export const PreviewStyleBody = z.strictObject({
  csl: citationStyleSchema.shape.csl,
  language: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)
    .optional()
    .describe('A language tag; a locale not bundled falls back to en-US'),
});
export type PreviewStyleBody = z.infer<typeof PreviewStyleBody>;

export const StylePreview = z.object({
  title: z.string().optional().describe("The style's own title, from its `info`"),
  problems: z.array(StyleProblemView).describe('Why it would be refused; empty where it would not'),
  proposed: requiresSchema.describe(
    'A `requires` to start from: for each type, the variables a reader needs that the style always prints',
  ),
  sample: z
    .object({
      citations: z.array(z.array(RunView)).describe('Each sample citation in reading order'),
      bibliography: z.array(
        z.object({
          entry: z.string(),
          label: z.array(RunView).optional(),
          runs: z.array(RunView),
        }),
      ),
    })
    .nullable()
    .describe('The invented sample entries rendered, or null where the style is refused'),
});
export type StylePreview = z.infer<typeof StylePreview>;

/** A style refused (`style_invalid`), each problem named, or its newer version. */
export const StyleRefusal = ErrorBody.extend({
  problems: z.array(StyleProblemView).optional(),
  current: StyleView.optional(),
});

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such citation style in this environment',
  schema: ErrorBody,
} as const;
const styleRefused = {
  description:
    '`style_invalid`: not a CSL 1.0.2 style with both forms that renders, or a `requires` naming what is not a CSL type or variable, each problem named',
  schema: StyleRefusal,
} as const;
const read = { check: 'permission', permission: 'read', target: { tenant: true } } as const;
const design = { check: 'permission', permission: 'design', target: { tenant: true } } as const;

/**
 * Citation styles (citations.md, "The style"; the CI plan, CI-D): the environment's, as themes and
 * prompt libraries are; `design` here uploads and changes one, `read` shows one.
 */
export const citationStyleRoutes = {
  listCitationStyles: {
    operationId: 'listCitationStyles',
    method: 'GET',
    path: '/v1/citation-styles',
    summary: "The environment's citation styles, by name",
    tenantScoped: true,
    access: read,
    responses: {
      200: { description: 'The styles', schema: StyleList },
      401: unauthenticated,
      403: { description: 'The caller may not read the environment', schema: ErrorBody },
    },
  },
  createCitationStyle: {
    operationId: 'createCitationStyle',
    method: 'POST',
    path: '/v1/citation-styles',
    summary: 'Upload a CSL style, at version 0.1',
    tenantScoped: true,
    access: design,
    body: CreateStyleBody,
    responses: {
      200: { description: 'Made, at version 0.1', schema: StyleView },
      400: styleRefused,
      401: unauthenticated,
      403: { description: 'The caller may not design here', schema: ErrorBody },
    },
  },
  previewCitationStyle: {
    operationId: 'previewCitationStyle',
    method: 'POST',
    path: '/v1/citation-styles/preview',
    summary: 'Render the sample entries in a CSL style, and propose what it requires',
    tenantScoped: true,
    access: design,
    body: PreviewStyleBody,
    responses: {
      200: { description: 'The preview, or why the style would be refused', schema: StylePreview },
      401: unauthenticated,
      403: { description: 'The caller may not design here', schema: ErrorBody },
    },
  },
  getCitationStyle: {
    operationId: 'getCitationStyle',
    method: 'GET',
    path: '/v1/citation-styles/{id}',
    summary: 'A citation style at its latest version',
    tenantScoped: true,
    access: read,
    params: StyleParams,
    responses: {
      200: { description: 'The style', schema: StyleView },
      401: unauthenticated,
      403: { description: 'The caller may not read the environment', schema: ErrorBody },
      404: notFound,
    },
  },
  recordCitationStyleVersion: {
    operationId: 'recordCitationStyleVersion',
    method: 'POST',
    path: '/v1/citation-styles/{id}/versions',
    summary: "Cut a citation style's next version from the one the caller opened",
    tenantScoped: true,
    access: design,
    params: StyleParams,
    body: StyleVersionBody,
    responses: {
      200: {
        description:
          'The style at its latest version: the one cut, or the one before where nothing changed',
        schema: StyleView,
      },
      400: styleRefused,
      401: unauthenticated,
      403: { description: 'The caller may not design here', schema: ErrorBody },
      404: notFound,
      409: {
        description:
          '`version_precondition`: the style has a newer version than the one named, answered with it',
        schema: StyleRefusal,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
