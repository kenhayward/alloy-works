import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

const MoveParams = z.object({ id: LowercaseUuid });
export type MoveParams = z.infer<typeof MoveParams>;

export const MoveBody = z
  .object({
    from: LowercaseUuid.describe('The space the caller read it in'),
    to: LowercaseUuid.describe('The space to move it to'),
    also: z
      .boolean()
      .describe(
        "A document's components and images too, each decided for itself and otherwise left",
      ),
  })
  .strict();
export type MoveBody = z.infer<typeof MoveBody>;

const MoveCounts = {
  moved: z
    .array(LowercaseUuid)
    .describe('Everything that moves: it, then what follows or is carried'),
  skipped: z
    .array(
      z.object({
        id: LowercaseUuid,
        kind: z.enum(['component', 'asset']),
        reason: z
          .enum([
            'not_permitted',
            'held',
            'kept',
            'placed_elsewhere',
            'archived',
            'in_use',
            'dataset',
            'uploading',
          ])
          .describe('Why it stays where it is'),
        title: z.string().nullable().describe('Its title, null where the caller may not read it'),
      }),
    )
    .describe('Each component or image of the document that stays, and why'),
  grantsEnded: z.number().int().describe('Grants on what moves that end with the move'),
  sharesKept: z.number().int().describe("Shares of the document's publications, which stay"),
};

export const MoveAnswer = z.object({
  changed: z.boolean().describe('False where it is in that space already'),
  ...MoveCounts,
});
export type MoveAnswer = z.infer<typeof MoveAnswer>;

export const MovePreviewAnswer = z.object({
  changed: z.boolean().describe('False where it is in that space already: nothing would move'),
  ...MoveCounts,
  consequences: z
    .object({
      citations: z.number().int().describe("Citations of the old space's bibliography"),
      terms: z.number().int().describe('Marked terms, which print as their words'),
      imagesStaying: z.number().int().describe('Images staying, which new readers may not read'),
      bound: z.number().int().describe('Bound parts, whose query definition stays'),
      usingTemplate: z.number().int().describe('Documents and cohorts using a moved template'),
      openRounds: z.number().int().describe('Open review rounds'),
      delivered: z
        .number()
        .int()
        .describe('What CT Studio delivered, which will refuse redelivery'),
    })
    .describe('What the move leaves behind: never refused, and named here'),
});
export type MovePreviewAnswer = z.infer<typeof MovePreviewAnswer>;

const refusals = {
  401: { description: 'Not signed in', schema: ErrorBody },
  403: {
    description: 'It needs administer on the artifact, and create or administer at the target',
    schema: ErrorBody,
  },
  404: {
    description: 'No such artifact or space, or the caller may not read it',
    schema: ErrorBody,
  },
  409: {
    description:
      'space_moved: it is no longer in `from`; space_archived: the target is archived; artifact_archived; artifact_not_movable: this kind moves with its document, or stays with its dataset, or a component group pins it; asset_uploading: a replacement is on its way; artifact_held: a hold on the space it is leaving, or on a publication of it; artifact_kept: a retention keep the target does not reach; move_too_large: more than 500 artifacts at once',
    schema: ErrorBody,
  },
} as const;

/** Moving content between spaces (moving.md; the MV plan). */
export const movingRoutes = {
  moveToSpace: {
    operationId: 'moveToSpace',
    method: 'POST',
    path: '/v1/artifacts/{id}/move',
    summary: 'Move a component, document, template or image to another space',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'administer',
      target: { artifact: 'id' },
      changesAccess: true,
    },
    params: MoveParams,
    body: MoveBody,
    responses: {
      200: { description: 'Moved, or there already', schema: MoveAnswer },
      ...refusals,
    },
  },
  previewMoveToSpace: {
    operationId: 'previewMoveToSpace',
    method: 'POST',
    path: '/v1/artifacts/{id}/move/preview',
    summary: 'What moving to another space would carry, leave and stop',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { artifact: 'id' } },
    params: MoveParams,
    body: MoveBody,
    responses: {
      200: { description: 'What the move would do, nothing changing', schema: MovePreviewAnswer },
      ...refusals,
    },
  },
} as const satisfies Record<string, RouteContract>;
