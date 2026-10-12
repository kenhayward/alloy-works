import { z } from 'zod';
import { BaselineParams } from './baselines.js';
import { ComponentParams } from './components.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

const WordOp = z.object({
  op: z.enum(['keep', 'insert', 'delete']),
  text: z.string().describe('The text, an inline node that is not text standing as U+FFFC'),
});

/** One unit's change, as `compareContent` answers it (comparison.md, "Anchored changes"). */
export const UnitChangeView = z.discriminatedUnion('change', [
  z.object({
    change: z.literal('inserted'),
    newer: z.string(),
    type: z.string(),
    parent: z.string(),
    after: z
      .string()
      .nullable()
      .describe('The unit it stands after under its parent, or null first'),
  }),
  z.object({
    change: z.literal('deleted'),
    older: z.string(),
    type: z.string(),
    parent: z.string(),
  }),
  z.object({
    change: z.literal('matched'),
    older: z.string(),
    newer: z.string(),
    type: z.string(),
    parent: z.string(),
    matched: z.enum(['identity', 'similarity']).describe('How the two were found to be one'),
    moved: z.object({ after: z.string().nullable() }).nullable(),
    edited: z
      .union([z.object({ ops: z.array(WordOp) }), z.object({ whole: z.literal(true) })])
      .nullable()
      .describe(
        'Its text compared word by word, `whole` past the bound a block is compared within',
      ),
    changed: z.array(z.string()).describe('Each attribute that differs'),
    split: z.string().nullable(),
    joined: z.string().nullable(),
  }),
]);
export type UnitChangeView = z.infer<typeof UnitChangeView>;

const VersionSide = z.object({
  id: LowercaseUuid,
  number: z.string().describe('`revision.version`'),
});

export const ComponentComparisonQuery = z.strictObject({
  from: LowercaseUuid.describe('The older version'),
  to: LowercaseUuid.describe('The newer version'),
});
export type ComponentComparisonQuery = z.infer<typeof ComponentComparisonQuery>;

/** Two versions of a component compared (VER-025, CNT-112). */
export const ComponentComparisonView = z.object({
  component: LowercaseUuid,
  from: VersionSide,
  to: VersionSide,
  older: z.record(z.string(), z.unknown()).describe("The older version's content document"),
  newer: z.record(z.string(), z.unknown()).describe("The newer version's content document"),
  changes: z.array(UnitChangeView),
});
export type ComponentComparisonView = z.infer<typeof ComponentComparisonView>;

export const BaselineComparisonQuery = z.strictObject({
  with: z
    .string()
    .regex(/^(now|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/)
    .describe('A later baseline of the same document, or `now`: the document as it resolves now'),
});
export type BaselineComparisonQuery = z.infer<typeof BaselineComparisonQuery>;

const Side = z.object({
  baseline: z
    .object({ id: LowercaseUuid, name: z.string() })
    .nullable()
    .describe('The baseline, or null for the document now'),
  version: VersionSide.describe('The document version'),
  outline: z
    .record(z.string(), z.unknown())
    .describe('Its outline, a component the caller may not read withheld as the document’s own is'),
});

/** Two baselines of a document compared, or one and the document now (VER-024, VER-025, VER-050). */
export const BaselineComparisonView = z.object({
  older: Side,
  newer: Side,
  structure: z.array(UnitChangeView).describe("The outline's changes"),
  titles: z
    .array(z.object({ node: z.string(), title: z.string() }))
    .describe('Each reference the caller may read, by the title of the component it places'),
  components: z
    .array(
      z.object({
        node: z.string(),
        component: LowercaseUuid,
        from: VersionSide,
        to: VersionSide,
        older: z.record(z.string(), z.unknown()),
        newer: z.record(z.string(), z.unknown()),
        changes: z.array(UnitChangeView),
      }),
    )
    .describe(
      'Each node whose component the caller may read and whose version differs between the two sides',
    ),
});
export type BaselineComparisonView = z.infer<typeof BaselineComparisonView>;

/** What a publish of each side would print, compared, each difference with its causes (VER-031, VER-045). */
export const ResolvedComparisonView = z.object({
  document: z
    .array(z.enum(['layout', 'theme', 'template', 'definition']))
    .describe(
      "What differs for the whole document: its layout's, theme's or template's version, or the definitions it was validated against",
    ),
  nodes: z
    .array(
      z.object({
        node: z.string(),
        title: z.string().describe("The component's title"),
        causes: z
          .array(z.enum(['edited', 'data', 'definition']))
          .describe(
            'Why it prints differently: somebody edited it, its data changed, or a definition it was written against did',
          ),
        values: z.array(
          z.object({
            binding: z.string(),
            older: z.string().nullable(),
            newer: z.string().nullable(),
          }),
        ),
      }),
    )
    .describe(
      'Each component the caller may read that prints differently, or would for a cause it names',
    ),
});
export type ResolvedComparisonView = z.infer<typeof ResolvedComparisonView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/** Comparison (comparison.md; the CP plan, Task 2). */
export const comparisonRoutes = {
  compareComponentVersions: {
    operationId: 'compareComponentVersions',
    method: 'GET',
    path: '/v1/components/{id}/comparison',
    summary: 'Two versions of a component compared, as anchored changes',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ComponentParams,
    query: ComponentComparisonQuery,
    responses: {
      200: { description: 'The two versions and their changes', schema: ComponentComparisonView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a reader of the component compares its versions',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such component the caller may read, or a version that is not one of its versions',
        schema: ErrorBody,
      },
    },
  },
  compareBaseline: {
    operationId: 'compareBaseline',
    method: 'GET',
    path: '/v1/baselines/{id}/comparison',
    summary: 'A baseline compared with another of its document, or with the document now',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { baseline: 'id' } },
    params: BaselineParams,
    query: BaselineComparisonQuery,
    responses: {
      200: {
        description: 'The structure and content compared, as the caller may read them',
        schema: BaselineComparisonView,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a reader of the document compares its baselines',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such baseline the caller may read, or `with` naming none of the same document',
        schema: ErrorBody,
      },
    },
  },
  compareBaselineResolved: {
    operationId: 'compareBaselineResolved',
    method: 'GET',
    path: '/v1/baselines/{id}/comparison/resolved',
    summary:
      'What a baseline and another, or the document now, would print, compared with the cause of each difference',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { baseline: 'id' } },
    params: BaselineParams,
    query: BaselineComparisonQuery,
    responses: {
      200: {
        description: 'The resolved output compared, as the caller may read it',
        schema: ResolvedComparisonView,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a reader of the document compares its baselines',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such baseline the caller may read, or `with` naming none of the same document',
        schema: ErrorBody,
      },
    },
  },
} as const;
