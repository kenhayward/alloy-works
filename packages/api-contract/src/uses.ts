import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** One reference to the component in a document's latest version (REU-007; the R1 plan, R1-C). */
const UsingReference = z.object({
  node: z.string().describe("The reference's node in the document's outline"),
  mode: z
    .enum(['latest', 'approved', 'pinned'])
    .describe(
      'latest: takes each new version of the component; approved: each revision approved; pinned: one version, which no change reaches',
    ),
  version: z
    .object({ id: LowercaseUuid, number: z.string().describe('`revision.version`, as `0.2`') })
    .nullable()
    .describe('pinned: the version it pins; null otherwise'),
  overridden: z
    .boolean()
    .describe('Whether it carries local overrides in its document, which no other document has'),
});

const UsingDocument = z.object({
  id: LowercaseUuid,
  title: z.string(),
  state: z
    .object({
      key: z.string(),
      name: z.string(),
      approved: z.boolean().describe('Whether its state is an approved one, not a draft (REU-009)'),
    })
    .nullable()
    .describe('Its workflow state now'),
  references: z.array(UsingReference).describe('Each place it places the component'),
});

/** Where a component is used (REU-006, REU-007, REU-009; the R1 plan, R1-B). */
export const ComponentUsesView = z.object({
  documents: z
    .array(UsingDocument)
    .describe(
      'Each document the caller may read whose latest version places the component: the live references a change may reach',
    ),
  unreadableDocuments: z
    .boolean()
    .describe(
      'Whether a document the caller may not read places it too: never how many, nor which',
    ),
  baselines: z
    .object({
      named: z.array(z.object({ id: LowercaseUuid, name: z.string(), document: LowercaseUuid })),
      unreadable: z.boolean(),
    })
    .describe('The baselines pinning a version of it, which no change reaches'),
  publications: z
    .object({
      named: z.array(z.object({ id: LowercaseUuid, title: z.string() })),
      unreadable: z.boolean(),
    })
    .describe('The publications that placed a version of it, which no change reaches'),
});
export type ComponentUsesView = z.infer<typeof ComponentUsesView>;

export const ComponentUsesParams = z.object({ id: z.uuid() });
export type ComponentUsesParams = z.infer<typeof ComponentUsesParams>;

/** Where a component is used (relationships.md; the R1 plan, Task 1). */
export const usesRoutes = {
  getComponentUses: {
    operationId: 'getComponentUses',
    method: 'GET',
    path: '/v1/components/{id}/uses',
    summary: 'Where a component is used: the documents placing it, and what pins it',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ComponentUsesParams,
    responses: {
      200: {
        description:
          'The documents whose latest versions place it, each reference with how it follows the component, and the baselines and publications pinning a version of it: those the caller may read named, and whether there are more',
        schema: ComponentUsesView,
      },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
      403: {
        description: 'Never answered: a component the caller may not read is not found',
        schema: ErrorBody,
      },
      404: { description: 'No such component the caller may read', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
